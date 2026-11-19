import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/core/defaults';
import type { LiveMetrics } from '@/core/types';
import { speakPace } from '@/coach/speech';
import { METRICS, type MetricContext } from '../metrics';

const ctx = (machine?: 'rower' | 'bikeerg'): MetricContext => ({
  m: { paceMsPer500: 120_000, avgPaceMsPer500: 121_000, splitAvgPaceMsPer500: 122_000 } as LiveMetrics,
  profile: DEFAULT_SETTINGS.profile,
  forceUnit: 'N',
  plan: null,
  paceBoat: null,
  analysis: null,
  target: { paceMsPer500: null, strokeRate: null, label: null },
  progress: null,
  machine,
});

describe('live pace follows the machine', () => {
  it('shows /500m on the rower', () => {
    expect(METRICS.pace.compute(ctx('rower'))).toMatchObject({ value: '2:00.0', unit: '/500m' });
    expect(METRICS.avgPace.compute(ctx()).unit).toBe('/500m');
  });
  it('shows per-1000m values on the BikeErg', () => {
    expect(METRICS.pace.compute(ctx('bikeerg'))).toMatchObject({ value: '4:00.0', unit: '/1000m' });
    expect(METRICS.avgPace.compute(ctx('bikeerg'))).toMatchObject({ value: '4:02.0', unit: '/1000m' });
    expect(METRICS.splitPace.compute(ctx('bikeerg'))).toMatchObject({ value: '4:04.0', unit: '/1000m' });
  });
  it('speaks the per-1000m split on a bike', () => {
    expect(speakPace(120_000)).toBe('two flat');
    expect(speakPace(120_000, 'bikeerg')).toBe('four flat');
  });
});
