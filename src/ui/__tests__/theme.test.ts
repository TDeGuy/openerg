import { describe, expect, it, vi } from 'vitest';

vi.mock('@/storage/settings', () => ({ useSettings: () => 'glacier' }));

import { resolveThemeId, THEMES } from '../theme';

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('themes', () => {
  it('maps legacy stored values', () => {
    expect(resolveThemeId('system')).toBe('glacier');
    expect(resolveThemeId('dark')).toBe('glacier');
    expect(resolveThemeId('light')).toBe('chalk');
    expect(resolveThemeId('daylight')).toBe('chalk');
    expect(resolveThemeId('tide')).toBe('glacier');
    expect(resolveThemeId('ember')).toBe('ember');
  });

  // WCAG: 4.5 for body text, 3 for large numbers, labels and graph lines.
  it.each(Object.entries(THEMES))('%s is readable', (_id, { palette: p }) => {
    for (const bg of [p.bg, p.surface]) {
      expect(contrast(p.text, bg)).toBeGreaterThanOrEqual(7);
      expect(contrast(p.textDim, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.textFaint, bg)).toBeGreaterThanOrEqual(3);
      for (const c of [p.accent, p.good, p.warn, p.bad, p.pace, p.watts, p.rate, p.heart, p.force, ...p.zones]) {
        expect(contrast(c, bg), `${c} on ${bg}`).toBeGreaterThanOrEqual(3);
      }
    }
    expect(contrast(p.accentText, p.accent)).toBeGreaterThanOrEqual(4.5);
  });
});
