import { describe, expect, it } from 'vitest';

import { METRIC_KEYS } from '@/components/live/metrics';

describe('distance / time tiles', () => {
  it('offers the adaptive Piece tile and both speed units', () => {
    expect(METRIC_KEYS).toEqual(expect.arrayContaining(['remaining', 'distance', 'elapsed', 'speed', 'speedKmh']));
  });
});
