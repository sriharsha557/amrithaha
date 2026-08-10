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
    const cats = CATEGORY_ORDER.filter((c) => items.some((i) => i.category === c));
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
