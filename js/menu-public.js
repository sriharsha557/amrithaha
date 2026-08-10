import { listMenuItems } from './db.js';
import { formatINR } from './lib/money.js';
import { escapeHtml } from './lib/html.js';

const CATEGORY_ORDER = ['Breakfast', 'Lunch', 'Drinks', 'Shelf'];

try {
  const items = (await listMenuItems()).filter((i) => i.is_available);
  const root = document.getElementById('menu-root');

  if (!items.length) {
    root.innerHTML = '<p class="muted">Menu is being updated. Please call us.</p>';
  } else {
    // Known categories first, in menu order. Anything else goes last rather
    // than being dropped: if a category is ever added to the database without
    // being added here, the items must still reach the customer.
    const present = [...new Set(items.map((i) => i.category))];
    const cats = [
      ...CATEGORY_ORDER.filter((c) => present.includes(c)),
      ...present.filter((c) => !CATEGORY_ORDER.includes(c)).sort(),
    ];
    root.innerHTML = cats.map((cat) => `
      <div class="cat">${escapeHtml(cat)}</div>
      <div class="card">
        ${items.filter((i) => i.category === cat).map((i) => `
          <div class="row"><span>${escapeHtml(i.name)}</span><strong>${formatINR(i.price)}</strong></div>
        `).join('')}
      </div>`).join('');
  }
} catch (e) {
  document.getElementById('menu-root').innerHTML =
    '<p class="muted">Could not load the menu right now. Please call us on +91 93921 16251.</p>';
}
