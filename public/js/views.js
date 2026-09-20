// HTML rendering only. State changes and event handling live in app.js.
const Views = (() => {
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const currency = new Intl.NumberFormat('en-IN', {style:'currency', currency:'INR'});
  const money = amount => currency.format(amount / 100);
  let names = new Map();
  const setNames = entries => { names = new Map(entries); };
  const setName = (email, name) => { names.set(email.toLowerCase(), name); };
  const memberLabel = member => names.get(member?.email?.toLowerCase()) || member?.email || member?.name || 'Unknown member';
  const memberName = (group, id) => {
    const member = group.members.find(member => member.id === id);
    return memberLabel(member);
  };
  const date = value => new Date(value + 'T12:00:00').toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric'});

  function groups(items, selectedId) {
    return items.map(group => `<button class="group-link ${group.id === selectedId ? 'active' : ''}" data-group="${escape(group.id)}" ${group.id === selectedId ? 'aria-current="page"' : ''}>
      <span>${escape(group.name)}</span>
    </button>`).join('');
  }

  function summary(group) {
    const total = group.expenses.reduce((sum, expense) => sum + expense.amount, 0);
    const outstanding = Split.settlements(group).reduce((sum, transfer) => sum + transfer.amount, 0);
    return [['Total expenses', money(total)], ['Unpaid balances', money(outstanding)], ['Members', group.members.length]]
      .map(([label, value]) => `<div class="summary-item"><span>${label}</span><strong>${value}</strong></div>`).join('');
  }

  function expenseRows(group, query, canEdit = () => true) {
    const expenses = group.expenses.filter(expense => `${expense.name} ${memberName(group, expense.payer)}`.toLowerCase().includes(query.toLowerCase()))
      .slice().sort((a, b) => b.date.localeCompare(a.date));
    const html = expenses.map(expense => `<details class="expense-row" data-expense="${escape(expense.id)}">
      <summary><div class="expense-main"><strong>${escape(expense.name)}</strong><small>${escape(memberName(group, expense.payer))} paid · ${date(expense.date)} · ${expense.members.length} members</small></div>
        <span class="expense-amount">${money(expense.amount)}</span><span class="expand-label">Details ⌄</span></summary>
      <div class="expense-expanded"><p class="share-heading">Split among ${expense.members.length} members · ${Split.splitMethods[expense.split?.method || 'even']}</p><div class="share-list">
        ${Split.allocations(expense).map(share => `<div class="share-row"><span>${escape(memberName(group, share.id))}</span><span>${money(share.amount)}</span></div>`).join('')}
      </div>${canEdit(expense) ? `<div class="row-actions"><button class="secondary" data-edit="${escape(expense.id)}">Edit expense</button><button class="danger" data-delete="${escape(expense.id)}">Delete expense</button></div>` : ''}</div>
    </details>`).join('');
    return {html: html || `<div class="empty">${query ? 'No matching expenses.' : 'No expenses yet. Click + Add expense to get started.'}</div>`, count: expenses.length};
  }

  function transfers(group, canRecord = () => true) {
    return Split.settlements(group).map(transfer => `<div class="transfer">
      <div class="transfer-text"><strong>${escape(memberName(group, transfer.from))}</strong> owes <strong>${escape(memberName(group, transfer.to))}</strong></div>
      <span class="transfer-amount">${money(transfer.amount)}</span>${canRecord(transfer) ? `<button class="secondary" data-pay="${escape(transfer.from)}" data-to="${escape(transfer.to)}" data-amount="${transfer.amount}">Record repayment</button>` : ''}
    </div>`).join('') || '<div class="empty">No outstanding balances.</div>';
  }

  function payments(group, canUndo = () => true) {
    return group.payments.map(payment => `<div class="repayment-row"><div class="repayment-text">${escape(memberName(group, payment.from))} paid ${escape(memberName(group, payment.to))}<small>${date(payment.date)}</small></div>
      <span class="transfer-amount">${money(payment.amount)}</span>${canUndo(payment) ? `<button class="danger" data-undo="${escape(payment.id)}">Undo</button>` : ''}</div>`).join('');
  }

  function members(group) {
    return group.members.map(member => {
      const reason = Split.memberRemovalReason(group, member.id);
      return `<div class="member-row" data-member-row="${escape(member.id)}"><div class="member-info">${escape(memberLabel(member))}${member.email && names.has(member.email.toLowerCase()) ? `<small>${escape(member.email)}</small>` : ''}${reason ? `<small>${escape(reason)}</small>` : ''}</div>
        <div class="member-actions"><button type="button" class="secondary" data-change-member="${escape(member.id)}" aria-label="Change email for ${escape(memberLabel(member))}">Change</button>
        <button type="button" class="danger" data-remove-member="${escape(member.id)}" aria-label="Remove ${escape(memberLabel(member))}" ${reason ? 'disabled' : ''}>Remove</button></div>
        <div class="member-edit" hidden><label for="change-email-${escape(member.id)}">New email</label>
          <div class="member-edit-controls"><input id="change-email-${escape(member.id)}" type="email" maxlength="254" value="${escape(member.email || '')}" autocomplete="off">
            <button type="button" class="primary" data-save-member="${escape(member.id)}">Save</button>
            <button type="button" class="secondary" data-cancel-member="${escape(member.id)}">Cancel</button></div>
          <small class="member-edit-error" role="alert"></small></div></div>`;
    }).join('');
  }
  return {escape, money, memberName, memberLabel, setNames, setName, groups, summary, expenseRows, transfers, payments, members};
})();
