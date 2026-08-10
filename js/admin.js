import { signIn, signOut, getSession, getRole } from './auth.js';
import * as db from './db.js';
import { addLine, changeQty, removeLine, billTotal } from './lib/bill.js';
import { formatINR } from './lib/money.js';
import { escapeHtml } from './lib/html.js';
import { summarise, topItems } from './lib/summary.js';

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
let lastOrderId = null;

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
    </div>

    <div id="today"></div>`;
}

function renderItemButtons() {
  const available = menuItems.filter((i) => i.is_available);
  const categories = [...new Set(available.map((i) => i.category))];
  document.getElementById('item-buttons').innerHTML = categories.map((cat) => `
    <div style="margin-bottom:10px">
      <div class="muted" style="font-weight:600;margin-bottom:6px">${escapeHtml(cat)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${available.filter((i) => i.category === cat).map((i) => `
          <button class="btn-ghost add-item" data-id="${i.id}"
                  style="padding:10px 14px;font-size:.9rem">
            ${escapeHtml(i.name)} <span class="muted">${formatINR(i.price)}</span>
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
      <span>${escapeHtml(l.name)}<br><span class="muted">${formatINR(l.price)}</span></span>
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
      const id = await db.createCounterOrder(paymentMode, lines);
      lastOrderId = id;
      lines = [];
    } else {
      const description = document.getElementById('cat-desc').value.trim();
      const rawAmount = document.getElementById('cat-amount').value.trim();
      if (!description) throw new Error('Describe the catering order.');
      if (rawAmount === '') throw new Error('Enter the catering amount.');
      const amount = Number(rawAmount);
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Enter a valid amount.');
      lastOrderId = await db.createCateringOrder({
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
  await renderToday();
}

document.addEventListener('admin:ready', async () => {
  menuItems = await db.listMenuItems();
  await renderOrdersTab();
});

async function renderToday() {
  const [orders, items] = await Promise.all([
    db.listTodayOrders(), db.listTodayOrderItems(),
  ]);
  const s = summarise(orders);
  const top = topItems(items, 3);
  const itemsSold = items.reduce((n, i) => n + Number(i.quantity), 0);

  document.getElementById('today').innerHTML = `
    <div class="card">
      <h3>Today</h3>
      <div class="row"><span>Orders</span><strong>${s.count}</strong></div>
      <div class="row"><span>Revenue</span><strong>${formatINR(s.revenue)}</strong></div>
      <div class="row"><span>UPI</span><span>${formatINR(s.upi)}</span></div>
      <div class="row"><span>Cash</span><span>${formatINR(s.cash)}</span></div>
      <div class="row"><span>Items sold</span><span>${itemsSold}</span></div>
      <div class="row"><span>Top items</span><span class="muted">${
        top.length ? top.map((t) => `${escapeHtml(t.name)} (${t.quantity})`).join(', ') : '—'
      }</span></div>
    </div>

    <div class="card">
      <h3>Today's orders</h3>
      ${orders.length ? orders.map((o) => `
        <div class="row ${o.status === 'invalid' ? 'invalid' : ''}">
          <span>
            ${o.order_type === 'catering' ? `Catering — ${escapeHtml(o.description)}` : 'Counter'}
            <br><span class="muted">${new Date(o.created_at).toLocaleTimeString('en-IN',
              { hour: '2-digit', minute: '2-digit' })} · ${o.payment_mode.toUpperCase()}</span>
          </span>
          <span style="display:flex;align-items:center;gap:10px">
            <strong>${formatINR(o.total_amount)}</strong>
            ${o.status === 'valid'
              ? `<button class="btn-danger invalidate" data-id="${o.id}">${
                   o.id === lastOrderId ? 'Undo' : 'Mark invalid'}</button>`
              : '<span class="muted">invalid</span>'}
          </span>
        </div>`).join('') : '<p class="muted">No orders yet today.</p>'}
    </div>`;

  document.querySelectorAll('.invalidate').forEach((b) => {
    b.addEventListener('click', () => invalidate(b.dataset.id));
  });
}

/** Undo and Mark invalid are the same operation. Undo additionally reloads
 *  the order's lines into the entry form so the correction is one tap away.
 *  Nothing is ever deleted. */
async function invalidate(orderId) {
  const isUndo = orderId === lastOrderId;
  const reload = isUndo ? await db.orderLines(orderId) : [];
  await db.markInvalid(orderId);
  if (isUndo && reload.length) {
    orderType = 'counter';
    lines = reload.map((r) => ({
      menu_item_id: r.menu_item_id,
      name: r.item_name,
      price: Number(r.unit_price),
      quantity: r.quantity,
    }));
    lastOrderId = null;
    await renderOrdersTab();
    return;
  }
  lastOrderId = null;
  await renderToday();
}
