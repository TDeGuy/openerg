import { describe, expect, it } from 'vitest';

import { slotIndex, tapPin } from '../util';

describe('chart pin helpers', () => {
  it('tap pins when empty and clears when pinned', () => {
    expect(tapPin(false, 120)).toBe(120);
    expect(tapPin(true, 120)).toBeNull();
  });
  it('slotIndex maps pixels to bars and rejects outside', () => {
    expect(slotIndex(46, 46, 10, 5)).toBe(0);
    expect(slotIndex(75, 46, 10, 5)).toBe(2);
    expect(slotIndex(10, 46, 10, 5)).toBe(-1);
    expect(slotIndex(96, 46, 10, 5)).toBe(-1);
  });
});
