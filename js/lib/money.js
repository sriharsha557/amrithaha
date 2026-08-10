/** Format a number as Indian rupees, e.g. 4850 -> "₹4,850". */
export function formatINR(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
