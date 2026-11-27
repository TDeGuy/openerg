/** Pure unit conversion + formatting helpers. No React Native imports. */

/** Concept2 formula: watts = 2.80 / (sec per metre)^3. */
export function paceToWatts(paceMsPer500: number): number {
  if (!(paceMsPer500 > 0)) return 0;
  const secPerM = paceMsPer500 / 1000 / 500;
  return 2.8 / Math.pow(secPerM, 3);
}

export function wattsToPace(watts: number): number {
  if (!(watts > 0)) return 0;
  return Math.cbrt(2.8 / watts) * 500 * 1000;
}

/** Concept2 calorie formula (kcal/h) for a 175 lb athlete. */
export function wattsToCalPerHour(watts: number): number {
  return watts > 0 ? watts * 4 * 0.8604 + 300 : 0;
}

/** Weight-corrected kcal/h as used by the Concept2 calorie calculator. */
export function wattsToCalPerHourForWeight(watts: number, weightKg: number): number {
  if (!(watts > 0)) return 0;
  const lbs = weightKg * 2.20462;
  return watts * 4 * 0.8604 + (1.714 * lbs);
}

export function paceFromTimeDistance(elapsedMs: number, distanceM: number): number {
  return distanceM > 0 && elapsedMs > 0 ? (elapsedMs / distanceM) * 500 : 0;
}

export function speedToPace(speedMps: number): number {
  return speedMps > 0 ? (500 / speedMps) * 1000 : 0;
}

export const N_PER_LBF = 4.4482216;
export const N_PER_KGF = 9.80665;

export function convertForce(newtons: number, unit: 'N' | 'kgf' | 'lbf'): number {
  if (unit === 'kgf') return newtons / N_PER_KGF;
  if (unit === 'lbf') return newtons / N_PER_LBF;
  return newtons;
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** BikeErg pace is shown per 1000 m; every stored pace stays on the /500m basis. */
export const paceBasisM = (machine?: string): number => (machine === 'bikeerg' ? 1000 : 500);
export const paceUnit = (machine?: string): string => `/${paceBasisM(machine)}m`;
/** Stored (/500m) pace → the machine's display basis. */
export const paceFor = (paceMsPer500: number, machine?: string): number => (paceMsPer500 * paceBasisM(machine)) / 500;

/** 105300 → "1:45.3". Unknown (≤0 / non-finite) → "–:––". BikeErg (machine) shows /1000m. */
export function formatPace(paceMsPer500: number, machine?: string): string {
  if (!(paceMsPer500 > 0) || !Number.isFinite(paceMsPer500) || paceMsPer500 > 10 * 60 * 1000) return '–:––';
  const tenths = Math.round(paceFor(paceMsPer500, machine) / 100);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${pad2(s)}.${tenths % 10}`;
}

/** Workout clock. 3723400 → "1:02:03.4" ; 423400 → "7:03.4". tenths optional. */
export function formatDuration(ms: number, opts: { tenths?: boolean } = {}): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const showTenths = opts.tenths ?? true;
  const totalTenths = showTenths ? Math.round(ms / 100) : Math.round(ms / 1000) * 10;
  const h = Math.floor(totalTenths / 36000);
  const m = Math.floor((totalTenths % 36000) / 600);
  const s = Math.floor((totalTenths % 600) / 10);
  const t = totalTenths % 10;
  const tail = showTenths ? `.${t}` : '';
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}${tail}` : `${m}:${pad2(s)}${tail}`;
}

/** 2000 → "2,000m"; 21097 → "21,097m". */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return '0m';
  return `${Math.round(m).toLocaleString('en-US')}m`;
}

/** Signed gap, e.g. +1.4s / −0.8s. */
export function formatDelta(ms: number, digits = 1): string {
  const s = ms / 1000;
  const sign = s > 0 ? '+' : s < 0 ? '−' : '±';
  return `${sign}${Math.abs(s).toFixed(digits)}s`;
}

/** Parses "1:45", "1:45.3", "7:03.4", "1:02:03", "105.3" (seconds) → ms. NaN if invalid. */
export function parseDuration(text: string): number {
  const t = text.trim();
  if (!t) return NaN;
  const parts = t.split(':').map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return NaN;
  let sec = 0;
  for (const p of parts) sec = sec * 60 + p;
  return Math.round(sec * 1000);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function uid(prefix = ''): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
