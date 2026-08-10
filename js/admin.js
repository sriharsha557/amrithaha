import { signIn, signOut, getSession, getRole } from './auth.js';

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
