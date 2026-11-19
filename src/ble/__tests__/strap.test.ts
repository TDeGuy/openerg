import { afterEach, describe, expect, it, vi } from 'vitest';

import { createScanTimer, parseBatteryLevel } from '../heartRateParser';

afterEach(() => vi.useRealTimers());

describe('strap scan timer', () => {
  it('restarting cancels the old timer so a new scan is not cut short', () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    const t = createScanTimer(15_000, fired);
    t.start();
    vi.advanceTimersByTime(10_000);
    t.start();
    vi.advanceTimersByTime(10_000); // 20 s after first start, 10 s after second
    expect(fired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(fired).toHaveBeenCalledTimes(1);
  });
  it('clear prevents the timeout', () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    const t = createScanTimer(1000, fired);
    t.start();
    t.clear();
    vi.advanceTimersByTime(5000);
    expect(fired).not.toHaveBeenCalled();
  });
});

describe('battery level', () => {
  it('parses 0-100 and rejects junk', () => {
    expect(parseBatteryLevel([87])).toBe(87);
    expect(parseBatteryLevel([0])).toBe(0);
    expect(parseBatteryLevel([])).toBeNull();
    expect(parseBatteryLevel([200])).toBeNull();
  });
});
