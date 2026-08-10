import { signIn, signOut, getSession, getRole } from './auth.js';
import * as db from './db.js';
import { addLine, changeQty, removeLine, billTotal } from './lib/bill.js';
import { formatINR } from './lib/money.js';

const $ = (id) => document.getElementById(id);
export const state = { role: null };

async function render() {
  const session = await getSession();
  if (!session) {
    $('login-view').classList.remove('hidden');
    $('app-view').classList.add('hidden');
    return;
  }
  state.role = await getRole();
  $('login-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
  $('role-badge').textContent = state.role || 'unknown';
  document.dispatchEvent(new CustomEvent('admin:ready'));
}

$('login-btn').addEventListener('click', async () => {
  const err = $('login-error');
  err.classList.add('hidden');
  $('login-btn').disabled = true;
  try {
    await signIn($('email').value.trim(), $('password').value);
    await render();
  } catch (e) {
    err.textContent = e.message || 'Could not sign in.';
    err.classList.remove('hidden');
  } finally {
    $('login-btn').disabled = false;
  }
});

$('logout-btn').addEventListener('click', async () => {
  await signOut();
  location.reload();
});

function selectTab(name) {
  const isOrders = name === 'orders';
  $('tab-orders-btn').setAttribute('aria-selected', String(isOrders));
  $('tab-menu-btn').setAttribute('aria-selected', String(!isOrders));
  $('tab-orders').classList.toggle('hidden', !isOrders);
  $('tab-menu').classList.toggle('hidden', isOrders);
}
$('tab-orders-btn').addEventListener('click', () => selectTab('orders'));
$('tab-menu-btn').addEventListener('click', () => selectTab('menu'));

render();

let menuItems = [];
let lines = [];
let orderType = 'counter';
let paymentMode = 'cash';

function entryHtml() {
  return `
    <div class="card">
      <div class="tabs">
        <button id="type-counter"  aria-selected="${orderType === 'counter'}">Counter</button>
        <button id="type-catering" aria-selected="${orderType === 'catering'}">Catering</button>
      </div>

      <div id="counter-form" class="${orderType === 'counter' ? '' : 'hidden'}">
        <div id="item-buttons"></div>
        <div id="bill-lines" style="margin-top:12px"></div>
      </div>

      <div id="catering-form" class="${orderType === 'catering' ? '' : 'hidden'}">
        <label for="cat-desc">What is it for</label>
        <input id="cat-desc" placeholder="e.g. Office lunch, 20 boxes">
        <label for="cat-amount">Amount</label>
        <input id="cat-amount" type="number" inputmode="decimal" min="0">
        <label for="cat-name">Customer name (optional)</label>
        <input id="cat-name">
        <label for="cat-phone">Phone (optional)</label>
        <input id="cat-phone" type="tel">
      </div>

      <label>Payment</label>
      <div class="tabs">
        <button id="pay-cash" aria-selected="${paymentMode === 'cash'}">Cash</button>
        <button id="pay-upi"  aria-selected="${paymentMode === 'upi'}">UPI</button>
      </div>

      <button class="btn-primary" id="save-order">Save order</button>
      <p class="err hidden" id="order-error"></p>
    </div>`;
}

function renderItemButtons() {
  const available = menuItems.filter((i) => i.is_available);
  const categories = [...new Set(available.map((i) => i.category))];
  document.getElementById('item-buttons').innerHTML = categories.map((cat) => `
    <div style="margin-bottom:10px">
      <div class="muted" style="font-weight:600;margin-bottom:6px">${cat}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${available.filter((i) => i.category === cat).map((i) => `
          <button class="btn-ghost add-item" data-id="${i.id}"
                  style="padding:10px 14px;font-size:.9rem">
            ${i.name} <span class="muted">${formatINR(i.price)}</span>
          </button>`).join('')}
      </div>
    </div>`).join('');

  document.querySelectorAll('.add-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = menuItems.find((i) => i.id === btn.dataset.id);
      lines = addLine(lines, item);
      renderBill();
    });
  });
}

function renderBill() {
  const el = document.getElementById('bill-lines');
  if (!lines.length) { el.innerHTML = '<p class="muted">No items yet.</p>'; return; }
  el.innerHTML = lines.map((l) => `
    <div class="row">
      <span>${l.name}<br><span class="muted">${formatINR(l.price)}</span></span>
      <span style="display:flex;align-items:center;gap:10px">
        <button class="btn-ghost qty" data-id="${l.menu_item_id}" data-d="-1" style="padding:6px 12px">-</button>
        <strong>${l.quantity}</strong>
        <button class="btn-ghost qty" data-id="${l.menu_item_id}" data-d="1" style="padding:6px 12px">+</button>
        <button class="btn-danger drop" data-id="${l.menu_item_id}">Remove</button>
      </span>
    </div>`).join('')
    + `<div class="row"><strong>Total</strong><strong>${formatINR(billTotal(lines))}</strong></div>`;

  el.querySelectorAll('.qty').forEach((b) => b.addEventListener('click', () => {
    lines = changeQty(lines, b.dataset.id, Number(b.dataset.d));
    renderBill();
  }));
  el.querySelectorAll('.drop').forEach((b) => b.addEventListener('click', () => {
    lines = removeLine(lines, b.dataset.id);
    renderBill();
  }));
}

function wireEntry() {
  const setType = (t) => { orderType = t; renderOrdersTab(); };
  document.getElementById('type-counter').onclick  = () => setType('counter');
  document.getElementById('type-catering').onclick = () => setType('catering');

  const setPay = (p) => {
    paymentMode = p;
    document.getElementById('pay-cash').setAttribute('aria-selected', String(p === 'cash'));
    document.getElementById('pay-upi').setAttribute('aria-selected',  String(p === 'upi'));
  };
  document.getElementById('pay-cash').onclick = () => setPay('cash');
  document.getElementById('pay-upi').onclick  = () => setPay('upi');

  document.getElementById('save-order').onclick = saveOrder;
}

async function saveOrder() {
  const btn = document.getElementById('save-order');
  const err = document.getElementById('order-error');
  err.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    if (orderType === 'counter') {
      if (!lines.length) throw new Error('Add at least one item.');
      await db.createCounterOrder(paymentMode, lines);
      lines = [];
    } else {
      const description = document.getElementById('cat-desc').value.trim();
      const amount = Number(document.getElementById('cat-amount').value);
      if (!description) throw new Error('Describe the catering order.');
      if (!(amount >= 0)) throw new Error('Enter a valid amount.');
      await db.createCateringOrder({
        description, amount, paymentMode,
        customerName:  document.getElementById('cat-name').value.trim(),
        customerPhone: document.getElementById('cat-phone').value.trim(),
      });
    }
    await renderOrdersTab();
  } catch (e) {
    // The bill stays on screen so nothing is lost; the user can retry.
    err.textContent = (e.message || 'Could not save.') + ' Your order is still here — try again.';
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save order';
  }
}

export async function renderOrdersTab() {
  document.getElementById('tab-orders').innerHTML = entryHtml();
  wireEntry();
  if (orderType === 'counter') { renderItemButtons(); renderBill(); }
}

document.addEventListener('admin:ready', async () => {
  menuItems = await db.listMenuItems();
  await renderOrdersTab();
});
