// A line is { menu_item_id, name, price, quantity }.
// Every function returns a new array; none mutate their input.

export function addLine(lines, item) {
  const existing = lines.find((l) => l.menu_item_id === item.id);
  if (existing) return changeQty(lines, item.id, 1);
  return [...lines, {
    menu_item_id: item.id,
    name: item.name,
    price: Number(item.price),
    quantity: 1,
  }];
}

export function changeQty(lines, id, delta) {
  return lines
    .map((l) => (l.menu_item_id === id ? { ...l, quantity: l.quantity + delta } : l))
    .filter((l) => l.quantity > 0);
}

export function removeLine(lines, id) {
  return lines.filter((l) => l.menu_item_id !== id);
}

export function billTotal(lines) {
  return lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
}
