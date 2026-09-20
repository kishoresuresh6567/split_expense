// Application state, persistence, and user actions.
(() => {
  const $ = selector => document.querySelector(selector);
  // Keep the original key so existing groups and expenses survive the redesign.
  const STORAGE_KEY = 'gather-expenses-v2';
  let state = {groups: []};
  let selectedGroupId = null;
  const linkedGroupId = new URL(location.href).searchParams.get('group');
  const linkToken = new URLSearchParams(location.hash.slice(1)).get('edit');
  const pendingLinkKey = 'gather-pending-sign-in-link';
  window.addEventListener('hashchange', () => {
    if (new URLSearchParams(location.hash.slice(1)).get('edit') !== linkToken) location.reload();
  });
  let section = 'expenses';
  let search = '';
  let toastTimer;
  let user = null;
  let records = new Map();
  let saving = false;
  let loading = false;
  let authEpoch = 0;
  let accountName = '';
  const isOwner = group => Boolean(user && records.get(group?.id)?.owner_id === user.id);

  const newId = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  const currentGroup = () => state.groups.find(group => group.id === selectedGroupId);
  const closeGroups = () => $('#groups-drawer').close();

  function notify(message) {
    clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').hidden = false;
    toastTimer = setTimeout(() => $('#toast').hidden = true, 4000);
  }

  function readState(value) {
    const parsed = value ? JSON.parse(value) : {groups: []};
    if (!Array.isArray(parsed.groups)) throw Error('Saved groups could not be read.');
    parsed.groups.forEach(group => group.payments ||= []);
    return parsed;
  }

  async function commit(change, message) {
    if (!user) throw Error('Sign in with Google first.');
    if (saving || loading) throw Error('Please wait for the current request to finish.');
    const next = structuredClone(state);
    change(next);
    const before = new Map(state.groups.map(group => [group.id, group]));
    const changed = next.groups.filter(group => JSON.stringify(group) !== JSON.stringify(before.get(group.id)));
    const removed = state.groups.filter(group => !next.groups.some(item => item.id === group.id));
    if (changed.length + removed.length !== 1) throw Error('Save one group at a time.');
    const epoch = authEpoch;
    saving = true;
    try {
      if (removed.length) await Cloud.remove(removed[0].id, records.get(removed[0].id).version);
      else {
        const group = changed[0], record = records.get(group.id);
        const saved = linkToken ? await Cloud.saveLink(linkToken, group, record.version)
          : record ? await Cloud.save(group.id, group, record.version) : await Cloud.create(group);
        if (epoch !== authEpoch) throw Error('Account changed. Sign in and refresh.');
        records.set(group.id, saved);
      }
      if (epoch !== authEpoch) throw Error('Account changed. Sign in and refresh.');
      state = next;
      render();
      if (message) notify(message);
    } catch (error) {
      if (epoch !== authEpoch) throw error;
      // Discard stale/revoked data, then fetch only what the server still permits.
      state = {groups: []};
      records.clear();
      render();
      saving = false;
      await refresh().catch(() => {});
      throw error;
    } finally {
      saving = false;
      if (epoch !== authEpoch && (user || linkToken)) refresh().catch(error => notify(error.message));
    }
  }

  function render() {
    $('#groups-toggle').hidden = !user && !state.groups.length;
    $('#auth-panel').hidden = Boolean(user);
    $('#create-group').hidden = $('#sign-out').hidden = !user;
    $('#leave-link').hidden = !linkToken;
    if (!currentGroup()) selectedGroupId = (state.groups.find(group => !group.closed) || state.groups[0])?.id || null;
    const group = currentGroup();
    $('#group-count').textContent = state.groups.length;
    const activeGroups = state.groups.filter(group => !group.closed);
    const closedGroups = state.groups.filter(group => group.closed);
    $('#group-nav').innerHTML = `<h3 class="menu-section-heading">Active groups <span>${activeGroups.length}</span></h3><div id="active-group-nav">${Views.groups(activeGroups, selectedGroupId) || '<p class="menu-empty">No active groups.</p>'}</div>
      <h3 class="menu-section-heading">Closed groups <span>${closedGroups.length}</span></h3><div id="closed-group-nav">${Views.groups(closedGroups, selectedGroupId) || '<p class="menu-empty">No closed groups.</p>'}</div>`;
    $('#welcome').hidden = !user || Boolean(group);
    $('#group-workspace').hidden = !group;
    if (!group) {
      for (const id of ['expenses','stats','payments','settlements','page-title','page-description']) $(`#${id}`).replaceChildren();
      return;
    }
    $('#group-options').open = false;
    $('#closed-group-note').hidden = !group.closed;
    $('#manage-members').hidden = Boolean(group.closed) || !isOwner(group);
    $('#group-options').hidden = !isOwner(group);
    $('#add-expense').hidden = Boolean(group.closed);
    $('#close-group').hidden = Boolean(group.closed);
    $('#reopen-group').hidden = !group.closed;

    $('#page-title').textContent = group.name;
    $('#page-description').textContent = `${group.closed ? 'Closed group · ' : ''}${group.members.length} members · Expenses in INR`;
    $('#stats').innerHTML = Views.summary(group);
    for (const name of ['expenses', 'balances']) {
      const active = section === name;
      $(`#${name}-section`).hidden = !active;
      $(`#${name}-tab`).classList.toggle('active', active);
      if (active) $(`#${name}-tab`).setAttribute('aria-current', 'page');
      else $(`#${name}-tab`).removeAttribute('aria-current');
    }
    const openIds = [...document.querySelectorAll('details[open]')].map(row => row.dataset.expense);
    const expenses = Views.expenseRows(group, search);
    $('#expenses').innerHTML = expenses.html;
    document.querySelectorAll('details').forEach(row => row.open = openIds.includes(row.dataset.expense));
    $('#expense-count').textContent = `${expenses.count} ${expenses.count === 1 ? 'expense' : 'expenses'}`;
    $('#settlements').innerHTML = Views.transfers(group);
    $('#payments-panel').hidden = !group.payments.length;
    $('#payments').innerHTML = Views.payments(group);
    if (group.closed) document.querySelectorAll('[data-edit], [data-delete], [data-pay], [data-undo]').forEach(button => button.hidden = true);
  }

  function parseMembers(value, existing = []) {
    const emails = String(value || '').split(',').map(email => email.trim().toLowerCase());
    if (emails.some(email => !email || !validEmail(email))) throw Error('Enter valid email addresses separated by commas.');
    if (emails.length + existing.length > 30) throw Error('A group can have up to 30 members.');
    const usedEmails = [...existing.map(member => member.email).filter(Boolean), ...emails];
    if (new Set(usedEmails).size !== usedEmails.length) throw Error('Use a unique email address for each member.');
    return emails.map(email => ({id: newId(), email}));
  }

  const validEmail = email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  function createGroup() {
    closeGroups();
    Forms.group(async data => {
      const name = data.get('name').trim();
      if (!name) throw Error('Enter a group name.');
      const creatorEmail = user?.email?.trim().toLowerCase();
      if (!validEmail(creatorEmail || '')) throw Error('Sign in with a verified email first.');
      const otherEmails = String(data.get('emails') || '').split(',')
        .filter(email => email.trim().toLowerCase() !== creatorEmail).join(',').trim();
      const creator = {id:newId(), email:creatorEmail};
      const members = [creator, ...(otherEmails ? parseMembers(otherEmails, [creator]) : [])];
      const group = {id: newId(), name, icon: '👥', members, expenses: [], payments: []};
      await commit(next => next.groups.push(group), 'Group created.');
      selectedGroupId = group.id;
      section = 'expenses';
      search = '';
      $('#search').value = '';
      render();
    });
  }

  function manageMembers() {
    const group = currentGroup();
    if (group.closed) return notify('Reopen this group before making changes.');
    Forms.members(group, async data => {
      const newEmails = String(data.get('emails') || '').trim();
      if (!newEmails) throw Error('Enter at least one member email.');
      const members = parseMembers(newEmails, currentGroup().members);
      await commit(next => next.groups.find(item => item.id === group.id).members.push(...members), 'Members added.');
    });
  }

  function expenseForm(expenseId) {
    const group = currentGroup();
    if (group.closed) return notify('Reopen this group before making changes.');
    const existing = expenseId ? group.expenses.find(expense => expense.id === expenseId) : null;
    if (expenseId && !existing) throw Error('This expense no longer exists.');
    Forms.expense(group, existing, async data => {
      const name = data.get('name').trim();
      const amount = Math.round(Number(data.get('amount')) * 100);
      const members = data.getAll('member');
      const payer = data.get('payer');
      const split = {method:data.get('splitMethod'), values:Object.fromEntries(members.map(id => [id, data.get(`split-${id}`)]))};
      if (!name) throw Error('Enter an expense name.');
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 10000000000) throw Error('Enter a valid amount.');
      if (split.method === 'even') split.values = {};
      const expense = {id: existing?.id || newId(), name, amount, members, payer, split, category: data.get('category'), date: data.get('date')};
      await commit(next => {
        const target = next.groups.find(item => item.id === group.id);
        if (existing) {
          Split.updateExpenseSplit(target, existing.id, members, payer, split, amount);
          Object.assign(target.expenses.find(item => item.id === existing.id), expense);
        } else {
          target.expenses.push(expense);
          Split.updateExpenseSplit(target, expense.id, members, payer, split, amount);
        }
      }, existing ? 'Expense updated. Balances recalculated.' : 'Expense added.');
    });
  }

  async function handleAction(button) {
    const group = currentGroup();
    const {dataset} = button;
    if (group?.closed && ['edit','changeMember','saveMember','removeMember','delete','pay','undo'].some(key => dataset[key])) throw Error('Reopen this group before making changes.');
    if (dataset.group) {
      closeGroups();
      selectedGroupId = dataset.group;
      section = 'expenses';
      search = '';
      $('#search').value = '';
      render();
    } else if (dataset.edit) {
      expenseForm(dataset.edit);
    } else if (dataset.changeMember) {
      document.querySelectorAll('.member-edit').forEach(editor => editor.hidden = true);
      const row = button.closest('[data-member-row]');
      const editor = row.querySelector('.member-edit');
      editor.hidden = false;
      editor.querySelector('input').focus();
      editor.querySelector('input').select();
    } else if (dataset.cancelMember) {
      button.closest('.member-edit').hidden = true;
    } else if (dataset.saveMember) {
      const memberId = dataset.saveMember;
      const member = group.members.find(item => item.id === memberId);
      if (!member) throw Error('This member is no longer in the group.');
      const email = button.closest('.member-edit').querySelector('input').value.trim().toLowerCase();
      if (!validEmail(email)) throw Error('Enter a valid email address.');
      if (group.members.some(item => item.id !== memberId && item.email === email)) throw Error('This email is already in the group.');
      if (member.email === email) { button.closest('.member-edit').hidden = true; return; }
      await commit(next => { next.groups.find(item => item.id === group.id).members.find(item => item.id === memberId).email = email; }, 'Member email changed.');
      $('#member-list').innerHTML = Views.members(currentGroup());
    } else if (dataset.removeMember) {
      await commit(next => Split.removeMember(next.groups.find(item => item.id === group.id), dataset.removeMember), 'Member removed.');
      $('#member-list').innerHTML = Views.members(currentGroup());
    } else if (dataset.delete) {
      Forms.confirm('Delete expense?', 'This removes the expense and updates balances. Recorded repayments stay unchanged.', async () => {
        await commit(next => {
          const target = next.groups.find(item => item.id === group.id);
          target.expenses = target.expenses.filter(expense => expense.id !== dataset.delete);
        }, 'Expense deleted.');
      }, 'Delete expense');
    } else if (dataset.pay) {
      const payment = {id: newId(), from: dataset.pay, to: dataset.to, amount: Number(dataset.amount), date: Forms.today()};
      const message = `Has ${Views.memberName(group, payment.from)} paid ${Views.money(payment.amount)} to ${Views.memberName(group, payment.to)}? This records a payment; it does not transfer money.`;
      Forms.confirm('Record repayment', message, async () => {
        await commit(next => next.groups.find(item => item.id === group.id).payments.push(payment), 'Repayment recorded.');
      }, 'Confirm repayment');
    } else if (dataset.undo) {
      Forms.confirm('Undo repayment?', 'This removes the repayment record and restores the outstanding balance.', async () => {
        await commit(next => {
          const target = next.groups.find(item => item.id === group.id);
          target.payments = target.payments.filter(payment => payment.id !== dataset.undo);
        }, 'Repayment removed.');
      }, 'Undo repayment');
    }
  }

  async function changeGroupStatus(closed) {
    const group = currentGroup();
    $('#group-options').open = false;
    if (!closed) {
      await commit(next => { next.groups.find(item => item.id === group.id).closed = false; }, 'Group reopened.');
      return;
    }
    Forms.confirm('Close group?', `Move “${group.name}” to Closed groups? All expenses, balances, and repayments will be kept. You can reopen it later. Closing does not mark unpaid balances as paid.`, () => {
      return commit(next => { next.groups.find(item => item.id === group.id).closed = true; }, 'Group moved to Closed groups.');
    }, 'Close group');
  }

  function deleteGroup() {
    const group = currentGroup();
    $('#group-options').open = false;
    Forms.confirm('Delete group permanently?', `Delete “${group.name}” and all its ${group.members.length} members, ${group.expenses.length} expenses, and ${group.payments.length} repayments? This cannot be undone.`, async () => {
      await commit(next => { next.groups = next.groups.filter(item => item.id !== group.id); }, 'Group deleted.');
      section = 'expenses';
      search = '';
      $('#search').value = '';
      render();
    }, 'Delete group');
  }

  $('#close-group').onclick = () => changeGroupStatus(true).catch(error => notify(error.message));
  $('#reopen-group').onclick = () => changeGroupStatus(false).catch(error => notify(error.message));
  $('#delete-group').onclick = deleteGroup;
  $('#groups-toggle').onclick = () => {
    $('#groups-drawer').showModal();
    $('#groups-toggle').setAttribute('aria-expanded', 'true');
  };
  $('#close-groups').onclick = closeGroups;
  $('#groups-drawer').addEventListener('close', () => $('#groups-toggle').setAttribute('aria-expanded', 'false'));
  $('#groups-drawer').addEventListener('click', event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeGroups();
  });
  $('#create-group').onclick = createGroup;
  $('#manage-members').onclick = manageMembers;
  $('#add-expense').onclick = () => expenseForm();
  $('#close-dialog').onclick = Forms.close;
  $('#cancel').onclick = Forms.close;
  $('#search').oninput = event => { search = event.target.value; render(); };
  for (const name of ['expenses', 'balances']) {
    $(`#${name}-tab`).onclick = () => { section = name; render(); };
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    try { await handleAction(button); }
    catch (error) {
      if (button.dataset.saveMember) button.closest('.member-edit').querySelector('.member-edit-error').textContent = error.message;
      else notify(error.message);
    }
  });
  document.addEventListener('keydown', event => {
    if (!event.target.matches('.member-edit input')) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.target.closest('.member-edit').querySelector('[data-save-member]').click();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      event.target.closest('.member-edit').querySelector('[data-cancel-member]').click();
    }
  });
  // Creator accounts and shared edit links.
  async function refresh() {
    if (!user || saving || loading) return;
    loading = true;
    const epoch = authEpoch;
    try {
      if (linkToken) {
        const row = await Cloud.readLink(linkToken);
        const names = await Cloud.memberNames(row.id);
        if (epoch !== authEpoch) return;
        Views.setNames(names.map(item => [item.email, item.display_name]));
        if (accountName) Views.setName(user.email, accountName);
        records = new Map([[row.id, row]]);
        state = {groups:[row.document]};
        selectedGroupId = row.id;
        $('#group-link-message').textContent = 'You can view and edit this group using its shared link.';
        render();
        return;
      }
      const rows = await Cloud.groups();
      const names = await Promise.all(rows.map(row => Cloud.memberNames(row.id)));
      if (epoch !== authEpoch) return;
      Views.setNames(names.flat().map(item => [item.email, item.display_name]));
      if (accountName) Views.setName(user.email, accountName);
      records = new Map(rows.map(row => [row.id, row]));
      state = {groups: rows.map(row => row.document)};
      if (linkedGroupId && !selectedGroupId && records.has(linkedGroupId)) selectedGroupId = linkedGroupId;
      render();
      $('#group-link-message').textContent = linkedGroupId && !records.has(linkedGroupId)
        ? 'This group is not available to your signed-in email.' : '';
    } catch (error) {
      if (epoch === authEpoch) {
        state = {groups:[]}; records.clear(); render();
        if (linkToken) {
          Forms.close();
          $('#fields').replaceChildren();
          $('#group-link-message').textContent = error.message;
        }
      }
      throw error;
    } finally {
      loading = false;
      if (epoch !== authEpoch && (user || linkToken)) refresh().catch(error => notify(error.message));
    }
  }

  $('#refresh-groups').onclick = () => refresh().then(() => notify('Groups refreshed.')).catch(error => notify(error.message));
  $('#sign-in-submit').onclick = async () => {
    $('#sign-in-submit').disabled = true;
    $('#auth-message').textContent = '';
    try {
      if (linkToken) sessionStorage.setItem(pendingLinkKey, location.href);
      await Cloud.signIn();
    }
    catch (error) {
      sessionStorage.removeItem(pendingLinkKey);
      $('#auth-message').textContent = error.message;
    }
    finally { $('#sign-in-submit').disabled = false; }
  };
  $('#sign-out').onclick = async () => {
    try { await Cloud.signOut(); setAccount(null); }
    catch (error) { notify(`Sign out failed: ${error.message}`); }
  };
  function promptName() {
    if (!user || $('#dialog').open) return;
    Forms.open('Your name', `<p>What name should other group members see for you?</p>
      <label for="profile-name">Name</label><input id="profile-name" name="name" maxlength="60" value="${Views.escape(accountName)}" autocomplete="name" required>`, async data => {
      const name = String(data.get('name') || '').trim();
      if (!name || name.length > 60) throw Error('Enter a name of 1 to 60 characters.');
      const accountId = user.id;
      accountName = await Cloud.setMyName(name);
      if (user?.id !== accountId) return;
      $('#account-name').textContent = accountName;
      Views.setName(user.email, accountName);
      render();
      await refresh();
    }, 'Save name');
    $('#profile-name').focus();
  }
  $('#edit-name').onclick = () => { closeGroups(); promptName(); };
  $('#import-groups').onclick = () => {
    closeGroups();
    try {
      const local = readState(localStorage.getItem(STORAGE_KEY));
      Forms.confirm('Import browser groups?', `Import ${local.groups.length} groups into ${user.email}? You will own them. Add other members by email under Manage members. The local copy remains in this browser until you remove it.`, async () => {
        const accountId = user.id;
        for (const group of local.groups) {
          if (user?.id !== accountId) throw Error('Account changed. Import stopped.');
          if (records.has(group.id)) {
            if (!isOwner(group)) throw Error('This group already belongs to another account.');
            continue;
          }
          // Preserve IDs so retrying after a partial import does not duplicate data.
          await commit(next => next.groups.push(group));
        }
        notify('Groups imported. Add other members by email under Manage members.');
      }, 'Import into my account');
    } catch (error) { notify(error.message); }
  };

  function setAccount(session) {
    const nextUser = session?.user || null;
    if (nextUser?.id === user?.id && nextUser?.email === user?.email) return;
    authEpoch++;
    user = nextUser;
    accountName = '';
    Views.setNames([]);
    $('#auth-message').textContent = '';
    state = {groups:[]}; records.clear(); selectedGroupId = null;
    Forms.close(); closeGroups();
    // Remove account data from hidden DOM as well as the visible workspace.
    for (const id of ['fields','expenses','stats','payments','settlements','page-title','page-description']) $(`#${id}`).replaceChildren();
    $('#group-link-message').textContent = '';
    $('#account-email').textContent = user?.email || '';
    $('#account-name').textContent = '';
    $('#edit-name').hidden = !user;
    $('#import-groups').hidden = true;
    if (user) {
      try { $('#import-groups').hidden = !readState(localStorage.getItem(STORAGE_KEY)).groups.length; } catch {}
    }
    render();
    // Do not call Supabase APIs from inside the synchronous Auth callback.
    if (user) setTimeout(() => {
      const epoch = authEpoch;
      refresh().catch(error => notify(error.message));
      Cloud.myName().then(name => {
        if (epoch !== authEpoch) return;
        accountName = name || '';
        $('#account-name').textContent = accountName;
        if (!accountName) promptName();
      }).catch(error => notify(error.message));
    }, 0);
  }
  render();
  if (linkedGroupId && !linkToken) $('#auth-description').textContent = 'Sign in with Google. This group will appear if your email is listed.';
  if (!window.Cloud?.configured) {
    $('#auth-description').textContent = 'Sign-in is not available yet. Please contact the app owner. Existing browser data has not been changed.';
    if (linkToken) $('#group-link-message').textContent = 'Group access is not configured yet. Please contact the app owner.';
  } else {
    $('#sign-in-submit').hidden = false;
    Cloud.watch(session => setAccount(session));
    const initialEpoch = authEpoch;
    Cloud.session().then(session => {
      if (initialEpoch === authEpoch) setAccount(session);
      const pendingLink = sessionStorage.getItem(pendingLinkKey);
      if (session?.user && pendingLink) {
        sessionStorage.removeItem(pendingLinkKey);
        if (!linkToken && new URL(pendingLink).origin === location.origin) location.replace(pendingLink);
      }
    }).catch(error => { $('#auth-message').textContent = error.message; });
  }
  if (window.Cloud?.configured) {
    window.addEventListener('focus', () => { if (!$('#dialog').open) refresh().catch(error => notify(error.message)); });
    setInterval(() => { if (user && !document.hidden && !$('#dialog').open) refresh().catch(error => notify(error.message)); }, 30000);
  }
})();
