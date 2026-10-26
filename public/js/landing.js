// Illustrative groups only; these never enter the account's expense data.
(() => {
  const panel = document.querySelector('#auth-panel');
  const tile = panel.querySelector('.landing-preview');
  const pause = document.querySelector('#preview-pause');
  const examples = [
    ['YOUR NEXT ADVENTURE', 'Weekend in Goa', '☀', '3 friends. One shared tab.', 9600, 'Our seaside stay', 7200, 'Dinner by the beach', 2400, 3200],
    ['A PLACE TO CALL OURS', 'The shared apartment', '⌂', '3 flatmates. Everything together.', 30000, 'Monthly rent', 24000, 'Groceries for home', 6000, 10000],
    ['GOOD FOOD, GREAT COMPANY', 'Friday dinner club', '♨', '3 friends. Another great evening.', 3600, 'Dinner with everyone', 2700, 'Dessert to share', 900, 1200],
    ['TAKE THE SCENIC ROUTE', 'The mountain road trip', '△', '3 explorers. Miles of memories.', 15000, 'Cabin in the hills', 12000, 'Fuel for the journey', 3000, 5000],
    ['MAKE IT A CELEBRATION', 'Birthday plans', '☆', '3 friends. One happy surprise.', 6000, 'Party food', 4500, 'Cake and decorations', 1500, 2000]
  ];
  const money = value => '₹' + value.toLocaleString('en-IN');
  let index = 0;
  let paused = false;
  const put = (selector, value) => { tile.querySelector(selector).textContent = value; };
  function showExample() {
    const [label, title, icon, members, total, first, firstCost, second, secondCost, debt] = examples[index];
    tile.setAttribute('aria-label', `Illustrative example: ${title}`);
    put('.preview-heading p', label);
    put('.preview-heading h2', title);
    put('.preview-trip-icon', icon);
    put('.preview-members p', members);
    const amount = tile.querySelector('.preview-total strong');
    const decimals = document.createElement('span');
    decimals.textContent = '.00';
    amount.replaceChildren(money(total), decimals);
    const rows = tile.querySelectorAll('.preview-expense');
    [[first, firstCost], [second, secondCost]].forEach(([name, cost], i) => {
      rows[i].querySelector('strong').textContent = name;
      rows[i].querySelector('b').textContent = money(cost);
    });
    put('.preview-balance p', `Rohan owes Alex ${money(debt)}`);
  }
  pause.addEventListener('click', () => {
    paused = !paused;
    pause.textContent = paused ? 'Resume examples' : 'Pause examples';
    pause.setAttribute('aria-pressed', String(paused));
  });
  showExample();
  setInterval(() => {
    if (paused || panel.hidden || document.hidden || tile.matches(':hover, :focus-within')) return;
    index = (index + 1) % examples.length;
    showExample();
  }, 1000);
})();
