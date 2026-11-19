/** Pure chart maths: scales, ticks, downsampling, path building. No React Native imports. */

export interface XY {
  x: number;
  y: number;
}

/** Drops non-finite points. */
export function cleanPoints(points: readonly XY[]): XY[] {
  const out: XY[] = [];
  for (const p of points) {
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/**
 * Reduces a long series to at most `maxPoints` by averaging equal-width index buckets.
 * First and last points are preserved exactly so the line still spans the full x range.
 */
export function downsample(points: readonly XY[], maxPoints = 240): XY[] {
  const n = points.length;
  if (maxPoints < 3 || n <= maxPoints) return points.slice();
  const out: XY[] = [points[0]];
  const inner = maxPoints - 2;
  const size = (n - 2) / inner;
  for (let b = 0; b < inner; b++) {
    const start = 1 + Math.floor(b * size);
    const end = Math.max(start + 1, 1 + Math.floor((b + 1) * size));
    let sx = 0;
    let sy = 0;
    let c = 0;
    for (let i = start; i < end && i < n - 1; i++) {
      sx += points[i].x;
      sy += points[i].y;
      c++;
    }
    if (c > 0) out.push({ x: sx / c, y: sy / c });
  }
  out.push(points[n - 1]);
  return out;
}

/** Reduces a plain number array (e.g. per-stroke scores) by bucket averaging. */
export function downsampleValues(values: readonly number[], maxPoints = 240): XY[] {
  return downsample(
    values.map((y, i) => ({ x: i + 1, y })),
    maxPoints,
  );
}

/** Centred moving average over `window` points (odd windows work best). */
export function movingAverage(points: readonly XY[], window: number): XY[] {
  const n = points.length;
  if (window <= 1 || n < 3) return points.slice();
  const half = Math.floor(window / 2);
  const prefix = new Array<number>(n + 1);
  prefix[0] = 0;
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + points[i].y;
  const out: XY[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    out[i] = { x: points[i].x, y: (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1) };
  }
  return out;
}

export function extent(values: readonly number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === Infinity) return [0, 1];
  return [lo, hi];
}

/** Pads a domain so lines do not touch the plot edge; guarantees a non-zero span. */
export function padDomain(lo: number, hi: number, fraction = 0.08): [number, number] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (hi < lo) [lo, hi] = [hi, lo];
  let span = hi - lo;
  if (span === 0) {
    span = Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 1;
    return [lo - span / 2, hi + span / 2];
  }
  return [lo - span * fraction, hi + span * fraction];
}

function niceStep(rawStep: number): number {
  if (!(rawStep > 0) || !Number.isFinite(rawStep)) return 1;
  const exp = Math.floor(Math.log10(rawStep));
  const base = Math.pow(10, exp);
  const f = rawStep / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * base;
}

/** "Nice" tick values (1/2/2.5/5 × 10^n) inside [lo, hi]. */
export function niceTicks(lo: number, hi: number, target = 4): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi === lo) return [lo];
  const step = niceStep((hi - lo) / Math.max(1, target));
  const first = Math.ceil(lo / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = first; v <= hi + step * 1e-9 && out.length < 50; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  }
  return out;
}

/** Linear scale factory. `invert` flips the range (used so faster pace plots higher). */
export function linearScale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0;
  if (span === 0) return () => (r0 + r1) / 2;
  const k = (r1 - r0) / span;
  return (v) => r0 + (v - d0) * k;
}

function n1(v: number): string {
  return (Math.round(v * 10) / 10).toString();
}

/** SVG path (M/L) through already-scaled points. */
export function linePath(points: readonly XY[]): string {
  if (points.length === 0) return '';
  let d = `M${n1(points[0].x)} ${n1(points[0].y)}`;
  for (let i = 1; i < points.length; i++) d += `L${n1(points[i].x)} ${n1(points[i].y)}`;
  return d;
}

/** Step ("staircase") path — horizontal then vertical — for plan/target overlays. */
export function stepPath(points: readonly XY[]): string {
  if (points.length === 0) return '';
  let d = `M${n1(points[0].x)} ${n1(points[0].y)}`;
  for (let i = 1; i < points.length; i++) {
    d += `L${n1(points[i].x)} ${n1(points[i - 1].y)}L${n1(points[i].x)} ${n1(points[i].y)}`;
  }
  return d;
}

/** Closed area under a line down to `baseY`. */
export function areaPath(points: readonly XY[], baseY: number): string {
  if (points.length < 2) return '';
  return `${linePath(points)}L${n1(points[points.length - 1].x)} ${n1(baseY)}L${n1(points[0].x)} ${n1(baseY)}Z`;
}

/** Closed band between an upper and a lower line sharing x positions. */
export function bandPath(upper: readonly XY[], lower: readonly XY[]): string {
  if (upper.length < 2 || lower.length < 2) return '';
  let d = linePath(upper);
  for (let i = lower.length - 1; i >= 0; i--) d += `L${n1(lower[i].x)} ${n1(lower[i].y)}`;
  return `${d}Z`;
}

/** Index of the point whose x is nearest to `x`. Points must be sorted by x. -1 when empty. */
export function nearestIndex(points: readonly XY[], x: number): number {
  const n = points.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x <= x) lo = mid;
    else hi = mid;
  }
  return Math.abs(points[lo].x - x) <= Math.abs(points[hi].x - x) ? lo : hi;
}

/** Equal-width histogram bins. */
export function binValues(values: readonly number[], binCount = 12): { from: number; to: number; count: number }[] {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0 || binCount < 1) return [];
  const [lo, hi] = extent(clean);
  if (lo === hi) return [{ from: lo, to: hi, count: clean.length }];
  const width = (hi - lo) / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({ from: lo + i * width, to: lo + (i + 1) * width, count: 0 }));
  for (const v of clean) {
    const i = Math.min(binCount - 1, Math.floor((v - lo) / width));
    bins[i].count++;
  }
  return bins;
}

/** Index of the largest value; -1 when empty. */
export function argMax(values: readonly number[]): number {
  let best = -1;
  let bestV = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > bestV) {
      bestV = values[i];
      best = i;
    }
  }
  return best;
}

/** Tap on a chart: pin at x, or clear when something is already pinned. */
export const tapPin = (pinned: boolean, x: number): number | null => (pinned ? null : x);

/** Bar slot under pixel x, or -1 when outside the plot. */
export function slotIndex(x: number, left: number, slot: number, n: number): number {
  const i = Math.floor((x - left) / slot);
  return i >= 0 && i < n ? i : -1;
}
