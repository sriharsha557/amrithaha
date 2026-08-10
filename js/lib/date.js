// IST is UTC+5:30 year round — India observes no daylight saving.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Business date in IST as YYYY-MM-DD. */
export function istBusinessDate(now = new Date()) {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
