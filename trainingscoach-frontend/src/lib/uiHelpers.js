/**
 * Small helpers that only the interface needs.
 *
 * These used to sit at the bottom of calculations.js, which made that file a
 * near-copy of the server's calculation core plus three extras — and the
 * "keep the two in sync by hand" rule quietly did not apply to the tail.
 * calculations.js is now generated from the server copy, so anything that
 * exists only in the browser lives here instead.
 */

/** Client-side id for a record the user just created. */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Best guess at which part of the day it is, used to prefill the log form. */
export function defaultTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return "ochtend";
  if (h < 18) return "middag";
  return "avond";
}

export function timeOfDayLabel(id) {
  const map = { ochtend: "Ochtend", middag: "Middag", avond: "Avond" };
  return map[id] || null;
}
