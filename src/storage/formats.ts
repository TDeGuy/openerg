/** Pure export builders: CSV (stroke-by-stroke + splits) and Garmin TCX v2. */
import type { SplitSummary, StrokeSample, WorkoutRecord } from '@/core/types';
import { mean, pad2 } from '@/core/units';
import { strokeTimeline, type TimelinePoint } from './timeline';

export type ExportFormat = 'csv' | 'tcx' | 'json';

/* ───────────── CSV ───────────── */

function csvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const row = (cells: (string | number | null | undefined)[]) => cells.map(csvField).join(',');
const fx = (n: number, d: number) => (Number.isFinite(n) ? Number(n.toFixed(d)) : 0);

export const CSV_STROKE_HEADER = [
  'stroke', 'interval', 'elapsed_s', 'distance_m', 'pace_s_per_500m', 'watts', 'stroke_rate_spm', 'heart_rate_bpm',
  'drive_length_m', 'drive_time_s', 'recovery_time_s', 'stroke_distance_m', 'peak_force_n', 'avg_force_n',
  'work_per_stroke_j', 'force_curve_n',
];

export const CSV_SPLIT_HEADER = [
  'split', 'type', 'elapsed_s', 'distance_m', 'split_time_s', 'split_distance_m', 'rest_time_s', 'rest_distance_m',
  'avg_pace_s_per_500m', 'avg_watts', 'avg_stroke_rate_spm', 'avg_heart_rate_bpm', 'rest_heart_rate_bpm',
  'drag_factor', 'calories', 'strokes',
];

export function toCsv(record: WorkoutRecord): string {
  const lines: string[] = [row(CSV_STROKE_HEADER)];
  for (const s of record.strokes) {
    lines.push(
      row([
        s.strokeNumber, s.intervalCount + 1, fx(s.elapsedMs / 1000, 2), fx(s.distanceM, 1), fx(s.paceMsPer500 / 1000, 1),
        fx(s.watts, 0), fx(s.strokeRate, 0), s.heartRate, fx(s.driveLengthM, 2), fx(s.driveTimeMs / 1000, 2),
        fx(s.recoveryTimeMs / 1000, 2), fx(s.strokeDistanceM, 2), fx(s.peakForceN, 1), fx(s.avgForceN, 1),
        fx(s.workPerStrokeJ, 0), s.forceCurve.map((f) => Math.round(f)).join(' '),
      ]),
    );
  }
  if (record.splits.length) {
    lines.push('', row(CSV_SPLIT_HEADER));
    for (const p of record.splits) {
      lines.push(
        row([
          p.index + 1, p.type, fx(p.elapsedMs / 1000, 1), fx(p.distanceM, 1), fx(p.splitTimeMs / 1000, 1),
          fx(p.splitDistanceM, 1), fx(p.restTimeMs / 1000, 1), fx(p.restDistanceM, 1), fx(p.avgPaceMsPer500 / 1000, 1),
          fx(p.avgWatts, 0), fx(p.avgStrokeRate, 0), p.avgHeartRate, p.restHeartRate, fx(p.avgDragFactor, 0),
          fx(p.calories, 0), p.strokeCount,
        ]),
      );
    }
  }
  return lines.join('\r\n') + '\r\n';
}

/* ───────────── TCX ───────────── */

export function xmlEscape(s: string): string {
  // Drop characters that are illegal in XML 1.0, then escape markup.
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;',
  );
}

const iso = (ms: number) => new Date(Math.round(ms)).toISOString();
const ubyte = (n: number) => Math.max(0, Math.min(254, Math.round(n)));
const speedFromPace = (pace: number) => (pace > 0 ? 500 / (pace / 1000) : 0);

interface Lap {
  startOffsetMs: number;
  timeMs: number;
  distanceM: number;
  calories: number;
  avgHr: number | null;
  maxHr: number | null;
  avgRate: number;
  avgWatts: number;
  strokeIdx: number[];
}

export function isIntervalRecord(record: Pick<WorkoutRecord, 'workoutType' | 'strokes' | 'splits'>): boolean {
  if (record.workoutType.includes('interval')) return true;
  if (record.splits.some((s) => s.restTimeMs > 0)) return true;
  const set = new Set(record.strokes.map((s) => s.intervalCount));
  return set.size > 1;
}

function lapFromStrokes(strokes: StrokeSample[], tl: TimelinePoint[], idx: number[], startOffsetMs: number): Lap {
  const last = idx.length ? tl[idx[idx.length - 1]] : null;
  const prevIdx = idx.length ? idx[0] - 1 : -1;
  const base = prevIdx >= 0 ? tl[prevIdx] : { t: 0, w: 0, d: 0 };
  const hrs = idx.map((i) => strokes[i].heartRate).filter((h): h is number => h != null && h > 0);
  return {
    startOffsetMs,
    timeMs: last ? last.w - base.w : 0,
    distanceM: last ? last.d - base.d : 0,
    calories: 0,
    avgHr: hrs.length ? mean(hrs) : null,
    maxHr: hrs.length ? Math.max(...hrs) : null,
    avgRate: mean(idx.map((i) => strokes[i].strokeRate).filter((r) => r > 0)),
    avgWatts: mean(idx.map((i) => strokes[i].watts).filter((w) => w > 0)),
    strokeIdx: idx,
  };
}

function lapFromSplit(split: SplitSummary, strokes: StrokeSample[], idx: number[], startOffsetMs: number): Lap {
  const hrs = idx.map((i) => strokes[i].heartRate).filter((h): h is number => h != null && h > 0);
  return {
    startOffsetMs,
    timeMs: split.splitTimeMs,
    distanceM: split.splitDistanceM,
    calories: split.calories,
    avgHr: split.avgHeartRate ?? (hrs.length ? mean(hrs) : null),
    maxHr: hrs.length ? Math.max(...hrs) : null,
    avgRate: split.avgStrokeRate,
    avgWatts: split.avgWatts,
    strokeIdx: idx,
  };
}

export function buildLaps(record: WorkoutRecord): Lap[] {
  const { strokes } = record;
  const splits = [...record.splits].sort((a, b) => a.index - b.index);
  const tl = strokeTimeline(strokes, splits);
  const all = strokes.map((_, i) => i);

  if (!splits.length) {
    const lap = lapFromStrokes(strokes, tl, all, 0);
    lap.timeMs = record.elapsedMs || lap.timeMs;
    lap.distanceM = record.distanceM || lap.distanceM;
    lap.calories = record.calories;
    lap.avgHr = record.avgHeartRate ?? lap.avgHr;
    lap.maxHr = record.maxHeartRate ?? lap.maxHr;
    lap.avgRate = record.avgStrokeRate || lap.avgRate;
    lap.avgWatts = record.avgWatts || lap.avgWatts;
    return [lap];
  }

  const intervals = isIntervalRecord(record);
  const groups: number[][] = splits.map(() => []);
  const leftovers: number[] = [];
  if (intervals) {
    const pos = new Map(splits.map((s, i) => [s.index, i]));
    for (const i of all) {
      const g = pos.get(strokes[i].intervalCount);
      if (g === undefined) leftovers.push(i);
      else groups[g].push(i);
    }
  } else {
    const ends: number[] = [];
    let cum = 0;
    for (const s of splits) ends.push((cum += s.splitTimeMs));
    let g = 0;
    for (const i of all) {
      while (g < ends.length && tl[i].w > ends[g] + 500) g++;
      if (g < ends.length) groups[g].push(i);
      else leftovers.push(i);
    }
  }

  const laps: Lap[] = [];
  let offset = 0;
  splits.forEach((s, gi) => {
    laps.push(lapFromSplit(s, strokes, groups[gi], offset));
    offset += s.splitTimeMs + s.restTimeMs;
  });
  if (leftovers.length) {
    const lap = lapFromStrokes(strokes, tl, leftovers, offset);
    laps.push(lap);
  }
  return laps;
}

export function toTcx(record: WorkoutRecord): string {
  const { strokes } = record;
  const tl = strokeTimeline(strokes, record.splits);
  const laps = buildLaps(record);
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"' +
      ' xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2"' +
      ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' +
      ' xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">',
  );
  out.push('  <Activities>');
  out.push('    <Activity Sport="Other">');
  out.push(`      <Id>${iso(record.startedAt)}</Id>`);

  for (const lap of laps) {
    const paces = lap.strokeIdx.map((i) => strokes[i].paceMsPer500).filter((p) => p > 0);
    const maxSpeed = paces.length ? speedFromPace(Math.min(...paces)) : 0;
    const avgSpeed = lap.timeMs > 0 ? lap.distanceM / (lap.timeMs / 1000) : 0;
    out.push(`      <Lap StartTime="${iso(record.startedAt + lap.startOffsetMs)}">`);
    out.push(`        <TotalTimeSeconds>${(lap.timeMs / 1000).toFixed(1)}</TotalTimeSeconds>`);
    out.push(`        <DistanceMeters>${lap.distanceM.toFixed(1)}</DistanceMeters>`);
    if (maxSpeed > 0) out.push(`        <MaximumSpeed>${maxSpeed.toFixed(3)}</MaximumSpeed>`);
    out.push(`        <Calories>${Math.max(0, Math.min(65535, Math.round(lap.calories)))}</Calories>`);
    if (lap.avgHr && lap.avgHr >= 1) out.push(`        <AverageHeartRateBpm><Value>${ubyte(lap.avgHr)}</Value></AverageHeartRateBpm>`);
    if (lap.maxHr && lap.maxHr >= 1) out.push(`        <MaximumHeartRateBpm><Value>${ubyte(lap.maxHr)}</Value></MaximumHeartRateBpm>`);
    out.push('        <Intensity>Active</Intensity>');
    if (lap.avgRate > 0) out.push(`        <Cadence>${ubyte(lap.avgRate)}</Cadence>`);
    out.push('        <TriggerMethod>Manual</TriggerMethod>');
    if (lap.strokeIdx.length) {
      out.push('        <Track>');
      for (const i of lap.strokeIdx) {
        const s = strokes[i];
        const p = tl[i];
        out.push('          <Trackpoint>');
        out.push(`            <Time>${iso(record.startedAt + p.t)}</Time>`);
        out.push(`            <DistanceMeters>${p.d.toFixed(1)}</DistanceMeters>`);
        if (s.heartRate && s.heartRate >= 1) out.push(`            <HeartRateBpm><Value>${ubyte(s.heartRate)}</Value></HeartRateBpm>`);
        out.push(`            <Cadence>${ubyte(s.strokeRate)}</Cadence>`);
        out.push('            <Extensions>');
        out.push('              <ns3:TPX>');
        out.push(`                <ns3:Speed>${speedFromPace(s.paceMsPer500).toFixed(3)}</ns3:Speed>`);
        out.push(`                <ns3:Watts>${Math.max(0, Math.round(s.watts))}</ns3:Watts>`);
        out.push('              </ns3:TPX>');
        out.push('            </Extensions>');
        out.push('          </Trackpoint>');
      }
      out.push('        </Track>');
    }
    out.push('        <Extensions>');
    out.push('          <ns3:LX>');
    out.push(`            <ns3:AvgSpeed>${avgSpeed.toFixed(3)}</ns3:AvgSpeed>`);
    if (lap.avgWatts > 0) out.push(`            <ns3:AvgWatts>${Math.round(lap.avgWatts)}</ns3:AvgWatts>`);
    out.push('          </ns3:LX>');
    out.push('        </Extensions>');
    out.push('      </Lap>');
  }

  const notes = [record.title, record.notes].filter(Boolean).join('\n');
  if (notes) out.push(`      <Notes>${xmlEscape(notes)}</Notes>`);
  out.push('      <Creator xsi:type="Device_t">');
  out.push(`        <Name>${xmlEscape(record.ergName || 'Concept2 PM5')}</Name>`);
  out.push('        <UnitId>0</UnitId>');
  out.push('        <ProductID>0</ProductID>');
  out.push('        <Version><VersionMajor>1</VersionMajor><VersionMinor>0</VersionMinor></Version>');
  out.push('      </Creator>');
  out.push('    </Activity>');
  out.push('  </Activities>');
  out.push('</TrainingCenterDatabase>');
  return out.join('\n') + '\n';
}

export function toJson(record: WorkoutRecord): string {
  return JSON.stringify(record, null, 2);
}

/** Safe file name like "2026-03-12 2000m.tcx". */
export function exportFileName(record: Pick<WorkoutRecord, 'startedAt' | 'title'>, format: ExportFormat): string {
  const d = new Date(record.startedAt);
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  const title = record.title.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'workout';
  return `OpenErg_${date}_${title}.${format}`;
}

export const CSV_SUMMARY_HEADER = [
  'start', 'title', 'machine', 'distance_m', 'time_s', 'avg_pace_s_per_500m', 'avg_watts', 'avg_stroke_rate_spm',
  'avg_heart_rate_bpm', 'max_heart_rate_bpm', 'calories', 'drag_factor', 'rest_time_s', 'notes', 'tags',
];

export const summaryCsvHeader = () => row(CSV_SUMMARY_HEADER);

/** One summary row for one workout. */
export const summaryCsvRow = (r: WorkoutRecord) =>
  row([
    iso(r.startedAt), r.title, r.machineType, fx(r.distanceM, 1), fx(r.elapsedMs / 1000, 1), fx(r.avgPaceMsPer500 / 1000, 1),
    fx(r.avgWatts, 0), fx(r.avgStrokeRate, 0), r.avgHeartRate, r.maxHeartRate, fx(r.calories, 0), fx(r.avgDragFactor, 0),
    fx(r.totalRestMs / 1000, 1), r.notes, (r.tags ?? []).join(' '),
  ]);

/** One row per workout (summary only), for spreadsheets. */
export function toSummaryCsv(records: WorkoutRecord[]): string {
  return [summaryCsvHeader(), ...records.map(summaryCsvRow)].join('\r\n') + '\r\n';
}
