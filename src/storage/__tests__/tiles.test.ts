import { describe, expect, it } from 'vitest';

import { METRIC_KEYS } from '@/components/live/metrics';
import { migrateTiles } from '../merge';

describe('distance / time tiles', () => {
  it('replaces the old Remaining tile with Distance and Time, without duplicates', () => {
    const [a, b] = migrateTiles([
      { tiles: ['pace', 'remaining', 'watts'] },
      { tiles: ['remaining', 'elapsed'] },
    ] as { tiles: import('@/core/types').MetricKey[] }[]);
    expect(a!.tiles).toEqual(['pace', 'distance', 'elapsed', 'watts']);
    expect(b!.tiles).toEqual(['distance', 'elapsed']);
  });
  it('no longer offers Remaining in the editor', () => {
    expect(METRIC_KEYS).not.toContain('remaining');
    expect(METRIC_KEYS).toContain('distance');
  });
});
