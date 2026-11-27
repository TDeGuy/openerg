import { useSettings } from '@/storage/settings';

export interface Palette {
  /** Dark background (drives the status-bar style). */
  dark: boolean;
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  accentText: string;
  good: string;
  warn: string;
  bad: string;
  /** Chart series colours. */
  pace: string;
  watts: string;
  rate: string;
  heart: string;
  force: string;
  forceAlt: string;
  /** HR / training zone colours, index 0 = zone 1. */
  zones: [string, string, string, string, string];
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;

export const font = {
  /** Tabular numerals for live metrics. */
  metric: { fontVariant: ['tabular-nums'] as 'tabular-nums'[], fontWeight: '700' as const },
  size: { xs: 11, sm: 13, md: 15, lg: 18, xl: 24, xxl: 34, huge: 56 },
};

/** Glacier Pulse: indigo-black, ice blue and violet. The default theme. */
const glacier: Palette = {
  dark: true,
  bg: '#090D16', surface: '#161F33', surfaceAlt: '#1E293B', border: '#1B3853',
  text: '#F8FAFC', textDim: '#94A3B8', textFaint: '#7C8BA1',
  accent: '#38BDF8', accentText: '#090D16',
  good: '#2DD4BF', warn: '#FBBF24', bad: '#F43F5E',
  pace: '#38BDF8', watts: '#FBBF24', rate: '#A78BFA', heart: '#F43F5E',
  force: '#38BDF8', forceAlt: '#8B5CF6',
  zones: ['#64748B', '#2DD4BF', '#38BDF8', '#FBBF24', '#F43F5E'],
};

/** Ember: ink background, amber numbers, blue support. */
const ember: Palette = {
  dark: true,
  bg: '#110E0B', surface: '#1B1713', surfaceAlt: '#27211B', border: '#3A3128',
  text: '#F5F6F8', textDim: '#B6BCC8', textFaint: '#7F8796',
  accent: '#FFB224', accentText: '#2A1A00',
  good: '#5FD68B', warn: '#FF8A4C', bad: '#F26D6D',
  pace: '#FFB224', watts: '#9CC2FF', rate: '#C4A7FF', heart: '#F26D6D',
  force: '#FFB224', forceAlt: '#5B8DEF',
  zones: ['#7A8291', '#5FD68B', '#9CC2FF', '#FFB224', '#F26D6D'],
};

/** Regatta: black and green. */
const regatta: Palette = {
  dark: true,
  bg: '#07100C', surface: '#101B15', surfaceAlt: '#1A2A21', border: '#24392D',
  text: '#F2F5F3', textDim: '#B4BDB7', textFaint: '#7F8B83',
  accent: '#3DDC84', accentText: '#04210F',
  good: '#3DDC84', warn: '#F5C542', bad: '#F26D6D',
  pace: '#3DDC84', watts: '#F5C542', rate: '#8FD3FF', heart: '#F26D6D',
  force: '#3DDC84', forceAlt: '#B7F5CF',
  zones: ['#7F8B83', '#3DDC84', '#8FD3FF', '#F5C542', '#F26D6D'],
};

/** Boathouse: navy, blue and warm tan. */
const boathouse: Palette = {
  dark: true,
  bg: '#0D1826', surface: '#15263A', surfaceAlt: '#1D3350', border: '#2B4566',
  text: '#F4ECDF', textDim: '#B9C4D2', textFaint: '#8496AC',
  accent: '#4FA6FF', accentText: '#06203B',
  good: '#6FD39A', warn: '#F0B45A', bad: '#F2767A',
  pace: '#4FA6FF', watts: '#E3BC8C', rate: '#D6A06C', heart: '#F2767A',
  force: '#4FA6FF', forceAlt: '#E3BC8C',
  zones: ['#8496AC', '#6FD39A', '#4FA6FF', '#F0B45A', '#F2767A'],
};

/** Chalk: warm light theme for bright rooms. */
const chalk: Palette = {
  dark: false,
  bg: '#F5F1EA', surface: '#FFFDF9', surfaceAlt: '#EAE3D7', border: '#D6CDBD',
  text: '#1B1F24', textDim: '#4F5863', textFaint: '#6B7480',
  accent: '#1F5FBF', accentText: '#FFFFFF',
  good: '#1A8F5A', warn: '#B45309', bad: '#C8323C',
  pace: '#1F5FBF', watts: '#B45309', rate: '#6D3FC4', heart: '#C8323C',
  force: '#1F5FBF', forceAlt: '#8A94A3',
  zones: ['#6B7480', '#1A8F5A', '#1F5FBF', '#B45309', '#C8323C'],
};

export const THEMES = {
  glacier: { name: 'Glacier Pulse', palette: glacier },
  ember: { name: 'Ember', palette: ember },
  regatta: { name: 'Regatta', palette: regatta },
  boathouse: { name: 'Boathouse', palette: boathouse },
  chalk: { name: 'Chalk', palette: chalk },
} as const;

export type ThemeId = keyof typeof THEMES;

/** Stored values from before named themes existed map onto the new ids. */
export function resolveThemeId(pref: string): ThemeId {
  if (pref in THEMES) return pref as ThemeId;
  if (pref === 'light' || pref === 'daylight') return 'chalk';
  if (pref === 'tide') return 'glacier';
  return 'glacier';
}

/** Current palette, honouring the user's theme setting. */
export function useTheme(): Palette {
  const pref = useSettings((s) => s.settings.theme);
  return THEMES[resolveThemeId(pref)].palette;
}
