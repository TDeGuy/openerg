/** Pure importers: Garmin TCX and the Concept2 Logbook "Export" CSV → WorkoutRecord (summary only, no strokes). */
import type { MachineType, WorkoutRecord } from '@/core/types';
import { paceToWatts, parseDuration } from '@/core/units';

function summary(p: {
  startedAt: number; elapsedMs: number; distanceM: number; title: string; machineType: MachineType;
  restMs?: number; rate?: number; strokes?: number; watts?: number; hr?: number | null; maxHr?: number | null;
  calories?: number; drag?: number; notes?: string;
}): WorkoutRecord {
  const pace = p.distanceM > 0 ? (p.elapsedMs / p.distanceM) * 500 : 0;
  return {
    id: `import-${p.startedAt}-${Math.round(p.distanceM)}`,
    startedAt: p.startedAt, endedAt: p.startedAt + p.elapsedMs + (p.restMs ?? 0), machineType: p.machineType, plan: null,
    title: p.title, workoutType: 'unknown', elapsedMs: p.elapsedMs, distanceM: p.distanceM, avgPaceMsPer500: pace,
    avgWatts: p.watts || (pace > 0 ? paceToWatts(pace) : 0), avgStrokeRate: p.rate ?? 0, avgHeartRate: p.hr || null,
    maxHeartRate: p.maxHr || null, calories: p.calories ?? 0, strokeCount: p.strokes ?? 0, avgDragFactor: p.drag ?? 0,
    totalRestMs: p.restMs ?? 0, splits: [], strokes: [], heartRate: [], coxCalls: [], notes: p.notes || undefined,
  };
}

const machineOf = (s: string): MachineType => (/ski/i.test(s) ? 'skierg' : /bike/i.test(s) ? 'bikeerg' : 'rower');

/* ───────────── duplicates ───────────── */

const key = (w: { startedAt: number; distanceM: number }) => `${Math.round(w.startedAt / 1000)}|${Math.round(w.distanceM)}`;

/** Drops workouts whose start time (to the second) and distance already exist, or repeat within the batch. */
export function skipDuplicates<T extends { startedAt: number; distanceM: number }>(existing: { startedAt: number; distanceM: number }[], incoming: T[]) {
  const seen = new Set(existing.map(key));
  const fresh = incoming.filter((w) => !seen.has(key(w)) && !!seen.add(key(w)));
  return { fresh, duplicates: incoming.length - fresh.length };
}

/* ───────────── TCX ───────────── */

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`))?.[1];
const num = (xml: string, name: string) => {
  const v = Number(tag(xml, name));
  return tag(xml, name) !== undefined && Number.isFinite(v) ? v : 0;
};

/** One <Activity> per record. Throws when the text has no usable laps. */
export function parseTcx(text: string): WorkoutRecord[] {
  const out: WorkoutRecord[] = [];
  for (const act of text.match(/<Activity\b[\s\S]*?<\/Activity>/g) ?? []) {
    const laps = act.match(/<Lap\b[\s\S]*?<\/Lap>/g) ?? [];
    const startedAt = Date.parse(tag(act, 'Id') ?? act.match(/<Lap StartTime="([^"]+)"/)?.[1] ?? '');
    const elapsedMs = laps.reduce((a, l) => a + num(l, 'TotalTimeSeconds') * 1000, 0);
    const distanceM = laps.reduce((a, l) => a + num(l, 'DistanceMeters'), 0);
    if (!Number.isFinite(startedAt) || elapsedMs <= 0 || distanceM <= 0) continue;
    const hrLaps = laps.filter((l) => /<AverageHeartRateBpm>/.test(l));
    const hrTime = hrLaps.reduce((a, l) => a + num(l, 'TotalTimeSeconds'), 0);
    const hr = hrTime > 0 ? hrLaps.reduce((a, l) => a + num(l.match(/<AverageHeartRateBpm>[\s\S]*?<\/AverageHeartRateBpm>/)![0], 'Value') * num(l, 'TotalTimeSeconds'), 0) / hrTime : null;
    const maxHr = Math.max(0, ...laps.map((l) => num(l.match(/<MaximumHeartRateBpm>[\s\S]*?<\/MaximumHeartRateBpm>/)?.[0] ?? '', 'Value')));
    const rates = laps.map((l) => num(l, 'Cadence')).filter((c) => c > 0);
    const notes = unxml(tag(act, 'Notes') ?? '');
    const [first, ...rest] = notes.split('\n');
    out.push(summary({
      startedAt, elapsedMs, distanceM, hr, maxHr, title: first.trim() || `${Math.round(distanceM)}m`, notes: rest.join('\n').trim(),
      machineType: machineOf(`${notes} ${tag(act, 'Name') ?? ''}`), calories: laps.reduce((a, l) => a + num(l, 'Calories'), 0),
      rate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0,
    }));
  }
  if (!out.length) throw new Error('No workouts found in this TCX file.');
  return out;
}

/* ───────────── Concept2 Logbook CSV ───────────── */

/** RFC 4180 parser (quoted fields, doubled quotes, CRLF). */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else f += c;
  }
  row.push(f);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/**
 * log.concept2.com "Export" CSV. Columns (as reported by Concept2 users): Log ID, Date, Description,
 * Work Time (Formatted), Work Time (Seconds), Rest Time (Formatted), Rest Time (Seconds), Work Distance,
 * Rest Distance, Stroke Rate/Cadence, Stroke Count, Pace, Avg Watts, Cal/Hour, Total Cal, Avg Heart Rate,
 * Drag Factor, Age, Weight, Type, Ranked, Comments, Date Entered. Read by header name, so order/extras don't matter.
 */
export function parseLogbookCsv(text: string): WorkoutRecord[] {
  const [head, ...rows] = parseCsvRows(text.replace(/^﻿/, ''));
  const col = (name: string) => head?.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase()) ?? -1;
  const [iDate, iDist, iSec] = [col('Date'), col('Work Distance'), col('Work Time (Seconds)')];
  if (iDate < 0 || iDist < 0) throw new Error('This is not a Concept2 Logbook CSV export.');
  const out: WorkoutRecord[] = [];
  for (const r of rows) {
    const get = (name: string) => (r[col(name)] ?? '').trim();
    const n = (name: string) => Number(get(name).replace(/,/g, '')) || 0;
    const d = get('Date').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    const distanceM = Number(r[iDist]?.replace(/,/g, '')) || 0;
    const elapsedMs = (iSec >= 0 ? Number(r[iSec]) * 1000 : parseDuration(get('Work Time (Formatted)'))) || parseDuration(get('Work Time (Formatted)'));
    if (!d || !(distanceM > 0) || !(elapsedMs > 0)) continue;
    const startedAt = new Date(+d[1], +d[2] - 1, +d[3], +(d[4] ?? 0), +(d[5] ?? 0), +(d[6] ?? 0)).getTime(); // logbook dates carry no zone
    out.push(summary({
      startedAt, elapsedMs, distanceM, title: get('Description') || `${Math.round(distanceM)}m`, machineType: machineOf(get('Type')),
      restMs: n('Rest Time (Seconds)') * 1000, rate: n('Stroke Rate/Cadence'), strokes: n('Stroke Count'), watts: n('Avg Watts'),
      hr: n('Avg Heart Rate'), calories: n('Total Cal'), drag: n('Drag Factor'), notes: get('Comments'),
    }));
  }
  if (!out.length) throw new Error('No workouts found in this CSV file.');
  return out;
}
