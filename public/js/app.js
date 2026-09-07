// Application state, persistence, and user actions.
(() => {
  const $ = selector => document.querySelector(selector);
  // Keep the original key so existing groups and expenses survive the redesign.
  const STORAGE_KEY = 'gather-expenses-v2';
  let state = {groups: []};
  let selectedGroupId = null;
  let section = 'expenses';
  let search = '';
  let toastTimer;

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

  function commit(change, message) {
    const next = structuredClone(state);
    change(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch { throw Error('Could not save. Browser storage is unavailable or full.'); }
    state = next;
    render();
    if (message) notify(message);
  }

  function render() {
    if (!currentGroup()) selectedGroupId = (state.groups.find(group => !group.closed) || state.groups[0])?.id || null;
    const group = currentGroup();
    $('#group-count').textContent = state.groups.length;
    const activeGroups = state.groups.filter(group => !group.closed);
    const closedGroups = state.groups.filter(group => group.closed);
    $('#group-nav').innerHTML = `<h3 class="menu-section-heading">Active groups <span>${activeGroups.length}</span></h3><div id="active-group-nav">${Views.groups(activeGroups, selectedGroupId) || '<p class="menu-empty">No active groups.</p>'}</div>
      <h3 class="menu-section-heading">Closed groups <span>${closedGroups.length}</span></h3><div id="closed-group-nav">${Views.groups(closedGroups, selectedGroupId) || '<p class="menu-empty">No closed groups.</p>'}</div>`;
    $('#welcome').hidden = Boolean(group);
    $('#group-workspace').hidden = !group;
    if (!group) return;
    $('#group-options').open = false;
    $('#closed-group-note').hidden = !group.closed;
    $('#manage-members').hidden = Boolean(group.closed);
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
    const names = value.split(',').map(name => name.trim()).filter(Boolean);
    if (!names.length) throw Error('Enter at least one member name.');
    if (names.some(name => name.length > 50)) throw Error('Member names must be 50 characters or fewer.');
    const allNames = [...existing.map(member => member.name), ...names].map(name => name.toLowerCase());
    if (new Set(allNames).size !== allNames.length) throw Error('Use a unique name for each member.');
    if (allNames.length > 30) throw Error('A group can have up to 30 members.');
    return names.map(name => ({id: newId(), name}));
  }

  function createGroup() {
    closeGroups();
    Forms.group(data => {
      const name = data.get('name').trim();
      if (!name) throw Error('Enter a group name.');
      const members = parseMembers(data.get('members'));
      if (members.length < 2) throw Error('Add at least two members.');
      const group = {id: newId(), name, icon: '👥', members, expenses: [], payments: []};
      commit(next => next.groups.push(group), 'Group created.');
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
    Forms.members(group, data => {
      const members = parseMembers(data.get('members'), currentGroup().members);
      commit(next => next.groups.find(item => item.id === group.id).members.push(...members), 'Members added.');
    });
  }

  function expenseForm(expenseId) {
    const group = currentGroup();
    if (group.closed) return notify('Reopen this group before making changes.');
    const existing = expenseId ? group.expenses.find(expense => expense.id === expenseId) : null;
    if (expenseId && !existing) throw Error('This expense no longer exists.');
    Forms.expense(group, existing, data => {
      const name = data.get('name').trim();
      const amount = Math.round(Number(data.get('amount')) * 100);
      const members = data.getAll('member');
      const payer = data.get('payer');
      const split = {method:data.get('splitMethod'), values:Object.fromEntries(members.map(id => [id, data.get(`split-${id}`)]))};
      if (!name) throw Error('Enter an expense name.');
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 10000000000) throw Error('Enter a valid amount.');
      if (split.method === 'even') split.values = {};
      const expense = {id: existing?.id || newId(), name, amount, members, payer, split, category: data.get('category'), date: data.get('date')};
      commit(next => {
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

  function handleAction(button) {
    const group = currentGroup();
    const {dataset} = button;
    if (group?.closed && ['edit','removeMember','delete','pay','undo'].some(key => dataset[key])) throw Error('Reopen this group before making changes.');
    if (dataset.group) {
      closeGroups();
      selectedGroupId = dataset.group;
      section = 'expenses';
      search = '';
      $('#search').value = '';
      render();
    } else if (dataset.edit) {
      expenseForm(dataset.edit);
    } else if (dataset.removeMember) {
      commit(next => Split.removeMember(next.groups.find(item => item.id === group.id), dataset.removeMember), 'Member removed.');
      $('#member-list').innerHTML = Views.members(currentGroup());
    } else if (dataset.delete) {
      Forms.confirm('Delete expense?', 'This removes the expense and updates balances. Recorded repayments stay unchanged.', () => {
        commit(next => {
          const target = next.groups.find(item => item.id === group.id);
          target.expenses = target.expenses.filter(expense => expense.id !== dataset.delete);
        }, 'Expense deleted.');
      }, 'Delete expense');
    } else if (dataset.pay) {
      const payment = {id: newId(), from: dataset.pay, to: dataset.to, amount: Number(dataset.amount), date: Forms.today()};
      const message = `Has ${Views.memberName(group, payment.from)} paid ${Views.money(payment.amount)} to ${Views.memberName(group, payment.to)}? This records a payment; it does not transfer money.`;
      Forms.confirm('Record repayment', message, () => {
        commit(next => next.groups.find(item => item.id === group.id).payments.push(payment), 'Repayment recorded.');
      }, 'Confirm repayment');
    } else if (dataset.undo) {
      Forms.confirm('Undo repayment?', 'This removes the repayment record and restores the outstanding balance.', () => {
        commit(next => {
          const target = next.groups.find(item => item.id === group.id);
          target.payments = target.payments.filter(payment => payment.id !== dataset.undo);
        }, 'Repayment removed.');
      }, 'Undo repayment');
    }
  }

  function changeGroupStatus(closed) {
    const group = currentGroup();
    $('#group-options').open = false;
    if (!closed) {
      commit(next => { next.groups.find(item => item.id === group.id).closed = false; }, 'Group reopened.');
      return;
    }
    Forms.confirm('Close group?', `Move “${group.name}” to Closed groups? All expenses, balances, and repayments will be kept. You can reopen it later. Closing does not mark unpaid balances as paid.`, () => {
      commit(next => { next.groups.find(item => item.id === group.id).closed = true; }, 'Group moved to Closed groups.');
    }, 'Close group');
  }

  function deleteGroup() {
    const group = currentGroup();
    $('#group-options').open = false;
    Forms.confirm('Delete group permanently?', `Delete “${group.name}” and all its ${group.members.length} members, ${group.expenses.length} expenses, and ${group.payments.length} repayments? This cannot be undone.`, () => {
      commit(next => { next.groups = next.groups.filter(item => item.id !== group.id); }, 'Group deleted.');
      section = 'expenses';
      search = '';
      $('#search').value = '';
      render();
    }, 'Delete group');
  }

  $('#close-group').onclick = () => changeGroupStatus(true);
  $('#reopen-group').onclick = () => changeGroupStatus(false);
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
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    try { handleAction(button); }
    catch (error) { notify(error.message); }
  });
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY) return;
    try {
      state = readState(event.newValue);
      Forms.close();
      render();
      notify('Updated from another tab.');
    } catch (error) { notify(error.message); }
  });
  try { state = readState(localStorage.getItem(STORAGE_KEY)); }
  catch { notify('Saved data could not be read. No saved data has been changed.'); }
  render();
})();
