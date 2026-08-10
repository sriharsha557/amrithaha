/** Daily totals. Invalid orders are excluded from every figure. */
export function summarise(orders) {
  return orders
    .filter((o) => o.status === 'valid')
    .reduce((acc, o) => {
      const amount = Number(o.total_amount);
      acc.count += 1;
      acc.revenue += amount;
      if (o.payment_mode === 'cash') acc.cash += amount;
      else acc.upi += amount;
      return acc;
    }, { count: 0, revenue: 0, cash: 0, upi: 0 });
}

/** Best sellers by quantity. Caller passes lines of valid orders only. */
export function topItems(items, n = 3) {
  const totals = new Map();
  for (const it of items) {
    totals.set(it.item_name, (totals.get(it.item_name) || 0) + Number(it.quantity));
  }
  return [...totals.entries()]
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name))
    .slice(0, n);
}
