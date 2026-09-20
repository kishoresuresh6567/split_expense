// Shared dialog and expense form. Creating and editing use the same fields.
const Forms = (() => {
  const $ = selector => document.querySelector(selector);
  const {escape, money} = Views;
  const categories = ['Food & drinks', 'Groceries', 'Travel', 'Stay', 'Activities', 'Other'];
  let generation = 0;
  const today = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  };
  function close() { generation++; $('#dialog').close(); }
  function open(title, html, save, label = 'Save') {
    const opened = ++generation;
    $('#dialog-title').textContent = title;
    $('#fields').innerHTML = html;
    $('#error').textContent = '';
    $('#submit').textContent = label;
    $('#submit').disabled = false;
    $('#form').onsubmit = async event => {
      event.preventDefault();
      $('#error').textContent = '';
      $('#submit').disabled = true;
      try { await save(new FormData(event.target)); if (opened === generation) close(); }
      catch (error) { if (opened === generation) $('#error').textContent = error.message; }
      finally { if (opened === generation || !$('#dialog').open) $('#submit').disabled = false; }
    };
    $('#dialog').showModal();
  }

  function group(save) {
    open('Create group', `<label for="group-name">Group name</label><input id="group-name" name="name" maxlength="60" placeholder="e.g. Flatmates" required>
      <label for="member-names">Member names</label><input id="member-names" name="members" maxlength="1500" placeholder="e.g. Alex, Bea, Casey" required>
      <label for="member-emails">Google email addresses (optional)</label><input id="member-emails" name="emails" maxlength="7600" placeholder="alex@gmail.com, bea@gmail.com, casey@gmail.com">
      <p class="form-help">Separate names and emails with commas in the same order. Include your name too. A member with an email can open this group after signing in.</p>`, save, 'Create group');
  }

  function members(group, save) {
    open('Manage members', `<p>${escape(group.name)}</p><div id="member-list">${Views.members(group)}</div>
      <div id="member-emails">${group.members.map(member => `<label for="email-${escape(member.id)}">${escape(member.name)}’s Google email</label><input id="email-${escape(member.id)}" name="email-${escape(member.id)}" type="email" maxlength="254" value="${escape(member.email || '')}" placeholder="name@gmail.com">`).join('')}</div>
      <label for="new-members">Add members</label><input id="new-members" name="members" maxlength="1500" placeholder="Names separated by commas">
      <label for="new-member-emails">New members’ Google emails (optional)</label><input id="new-member-emails" name="emails" maxlength="7600" placeholder="Emails in the same order as names">
      <p class="form-help">Members with a Google email can open this group after signing in. To include a new member in an existing expense, edit that expense.</p>`, save, 'Save members');
  }

  function expense(group, existing, save) {
    const selected = existing?.members || group.members.map(member => member.id);
    let method = existing?.split?.method || 'even';
    const drafts = {[method]: {...existing?.split?.values}};
    open(existing ? 'Edit expense' : 'Add expense', `<label for="description">Expense name</label><input id="description" name="name" value="${escape(existing?.name || '')}" maxlength="100" placeholder="e.g. Dinner" required>
      <div class="form-row"><div><label for="amount">Amount (₹)</label><input id="amount" name="amount" type="number" min="0.01" max="100000000" step="0.01" value="${existing ? existing.amount / 100 : ''}" required></div>
        <div><label for="date">Date</label><input id="date" name="date" type="date" value="${existing?.date || today()}" required></div></div>
      <div class="form-row"><div><label for="payer">Paid by</label><select id="payer" name="payer">${group.members.map(member => `<option value="${escape(member.id)}" ${member.id === existing?.payer ? 'selected' : ''}>${escape(member.name)}</option>`).join('')}</select></div>
        <div><label for="category">Category</label><select id="category" name="category">${categories.map(category => `<option ${category === existing?.category ? 'selected' : ''}>${category}</option>`).join('')}</select></div></div>
      <fieldset class="split-methods"><legend>How should this expense be split?</legend>${Object.entries(Split.splitMethods).map(([value,label])=>`<label><input type="radio" name="splitMethod" value="${value}" ${method===value?'checked':''}>${label}</label>`).join('')}</fieldset>
      <p class="form-help" id="method-help"></p>
      <div class="member-toolbar"><span>Members and their shares</span><button type="button" id="select-all-members" class="text-button">Select all</button></div>
      <div id="member-checks">${group.members.map(member => `<div class="split-member"><label class="member-choice"><input type="checkbox" name="member" value="${escape(member.id)}" ${selected.includes(member.id) ? 'checked' : ''}>${escape(member.name)}</label><input class="split-value" type="number" name="split-${escape(member.id)}" data-value="${escape(member.id)}" step="0.01" min="0" max="100000000" hidden disabled><span class="split-result" data-share="${escape(member.id)}"></span></div>`).join('')}</div>
      <p class="form-help" id="split-note" aria-live="polite"></p>${existing ? '<p class="form-help">Changes update this expense and its balances. Recorded repayments stay unchanged.</p>' : ''}`, save, existing ? 'Save changes' : 'Save expense');

    const inputs = [...document.querySelectorAll('[data-value]')];
    const selectedIds = () => [...document.querySelectorAll('#member-checks input[type="checkbox"]:checked')].map(input => input.value);
    function syncInputs() {
      const ids = selectedIds();
      const amount = Math.round(Number($('#amount').value) * 100);
      const defaultTotal = method === 'percentage' ? 10000 : amount;
      const defaults = ids.length && Number.isSafeInteger(defaultTotal) && defaultTotal > 0 ? Split.shares(defaultTotal,ids) : [];
      drafts[method] ||= {};
      inputs.forEach(input => {
        const id = input.dataset.value;
        input.hidden = method === 'even';
        input.disabled = method === 'even' || !ids.includes(id);
        input.required = !input.disabled;
        input.min = method === 'shares' ? '0.01' : '0';
        input.max = method === 'percentage' ? '100' : '100000000';
        const unit = {amounts:'Amount in rupees', shares:'Number of shares', percentage:'Percentage'}[method] || 'Share';
        input.setAttribute('aria-label', `${unit} for ${group.members.find(member => member.id === id).name}`);
        if (drafts[method][id] === undefined) drafts[method][id] = method === 'shares' ? '1' : String((defaults.find(part=>part.id===id)?.amount || 0) / 100);
        input.value = drafts[method][id];
      });
      $('#method-help').textContent = {
        even:'Everyone selected pays an equal amount.',
        amounts:'Enter each person’s amount in rupees. The amounts must equal the expense total.',
        shares:'Enter relative shares. For example, 2 shares pays twice as much as 1 share.',
        percentage:'Enter each person’s percentage. The percentages must total 100%.'
      }[method];
    }

    function preview() {
      const ids = selectedIds();
      const amount = Math.round(Number($('#amount').value) * 100);
      let shares = [], note = '';
      try {
        if (!ids.length) throw Error('Select at least one member.');
        if (!Number.isSafeInteger(amount) || amount <= 0) throw Error('Enter the expense amount to preview the split.');
        shares = Split.allocations({amount, members:ids, split:{method,values:drafts[method]}});
        note = `${ids.length} members selected · ${money(amount)} allocated.`;
      } catch(error) {
        note = error.message;
        if (ids.length && (method === 'amounts' || method === 'percentage')) {
          try {
            const total = ids.reduce((sum,id)=>sum + Split.decimalUnits(drafts[method][id]),0);
            const target = method === 'percentage' ? 10000 : amount;
            const format = value => method === 'percentage' ? `${(value/100).toFixed(2)}%` : money(value);
            if (Number.isSafeInteger(target) && total !== target) note = `${format(total)} allocated · ${format(Math.abs(target-total))} ${total > target ? 'over the total' : 'left to allocate'}.`;
          } catch { /* Keep the input validation message. */ }
        }
      }
      document.querySelectorAll('[data-share]').forEach(element => {
        const share = shares.find(share => share.id === element.dataset.share);
        element.textContent = share ? money(share.amount) : '';
      });
      $('#split-note').textContent = note;
      $('#split-note').classList.toggle('error', !shares.length);
    }
    $('#member-checks').onchange = event => { if(event.target.type === 'checkbox') syncInputs(); preview(); };
    $('#member-checks').oninput = event => {
      if (event.target.dataset.value) drafts[method][event.target.dataset.value] = event.target.value;
      preview();
    };
    document.querySelectorAll('[name="splitMethod"]').forEach(input => input.onchange = () => {
      method = input.value;
      $('#error').textContent = '';
      syncInputs(); preview();
    });
    $('#amount').oninput = preview;
    $('#select-all-members').onclick = () => {
      document.querySelectorAll('#member-checks input[type="checkbox"]').forEach(input => input.checked = true);
      syncInputs(); preview();
    };
    syncInputs(); preview();
  }

  function confirm(title, message, save, label) {
    open(title, `<p>${escape(message)}</p>`, save, label);
  }
  return {open, close, group, members, expense, confirm, today};
})();
