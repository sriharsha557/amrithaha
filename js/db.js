import { supabase } from './supabase.js';
import { istBusinessDate } from './lib/date.js';

export async function listMenuItems() {
  const { data, error } = await supabase
    .from('menu_items').select('*')
    .order('category').order('display_order').order('name');
  if (error) throw error;
  return data;
}

export async function createCounterOrder(paymentMode, lines) {
  const items = lines.map((l) => ({ menu_item_id: l.menu_item_id, quantity: l.quantity }));
  const { data, error } = await supabase.rpc('create_counter_order', {
    p_payment_mode: paymentMode,
    p_items: items,
  });
  if (error) throw error;
  return data;
}

export async function createCateringOrder(f) {
  const { data, error } = await supabase.rpc('create_catering_order', {
    p_description: f.description,
    p_amount: f.amount,
    p_payment_mode: f.paymentMode,
    p_customer_name: f.customerName || null,
    p_customer_phone: f.customerPhone || null,
  });
  if (error) throw error;
  return data;
}

export async function listTodayOrders() {
  const { data, error } = await supabase
    .from('orders').select('*')
    .eq('business_date', istBusinessDate())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function listTodayOrderItems() {
  const { data, error } = await supabase
    .from('order_items')
    .select('item_name, quantity, order_id, orders!inner(business_date, status)')
    .eq('orders.business_date', istBusinessDate())
    .eq('orders.status', 'valid');
  if (error) throw error;
  return data;
}

export async function orderLines(orderId) {
  const { data, error } = await supabase
    .from('order_items').select('*').eq('order_id', orderId);
  if (error) throw error;
  return data;
}

export async function markInvalid(orderId) {
  const { error } = await supabase.rpc('mark_order_invalid', { p_order_id: orderId });
  if (error) throw error;
}

export async function setAvailability(itemId, available) {
  const { error } = await supabase.rpc('set_item_availability', {
    p_item_id: itemId, p_available: available,
  });
  if (error) throw error;
}

export async function exportRange(from, to) {
  const { data, error } = await supabase
    .from('orders')
    .select('business_date, created_at, order_type, description, total_amount, payment_mode, status, order_items(item_name, unit_price, quantity, line_total)')
    .gte('business_date', from).lte('business_date', to)
    .order('created_at');
  if (error) throw error;

  // One CSV row per line item; catering orders emit a single row.
  const rows = [];
  for (const o of data) {
    const base = {
      date: o.business_date,
      time: new Date(o.created_at).toLocaleTimeString('en-IN'),
      type: o.order_type,
      description: o.description || '',
      payment: o.payment_mode,
      status: o.status,
      order_total: o.total_amount,
    };
    if (o.order_items?.length) {
      for (const i of o.order_items) {
        rows.push({ ...base, item: i.item_name, unit_price: i.unit_price,
                    quantity: i.quantity, line_total: i.line_total });
      }
    } else {
      rows.push({ ...base, item: '', unit_price: '', quantity: '', line_total: '' });
    }
  }
  return rows;
}
