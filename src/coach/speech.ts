/**
 * TTS-friendly number wording. Pure.
 * The coxswain never says "one colon fifty-two point three" — it says "one fifty-two".
 */

import { paceFor } from '@/core/units';
const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** 52 → "fifty-two", 1500 → "one thousand five hundred". Rounds, ignores sign. */
export function numberWords(value: number): string {
  const n = Math.round(Math.abs(value));
  if (n < 20) return ONES[n]!;
  if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]!}` : '');
  if (n < 1000) {
    const r = n % 100;
    return `${ONES[Math.floor(n / 100)]!} hundred${r ? ` and ${numberWords(r)}` : ''}`;
  }
  if (n < 1_000_000) {
    const r = n % 1000;
    const head = `${numberWords(Math.floor(n / 1000))} thousand`;
    if (!r) return head;
    return r < 100 ? `${head} and ${numberWords(r)}` : `${head} ${numberWords(r)}`;
  }
  const r = n % 1_000_000;
  return `${numberWords(Math.floor(n / 1_000_000))} million${r ? ` ${numberWords(r)}` : ''}`;
}

function secondsPart(s: number): string {
  return s < 10 ? `oh ${ONES[s]!}` : numberWords(s);
}

/** Pace ms/500 → "one fifty-two" (1:52.3), "two oh five", "two flat"; per 1000 m on a bike. */
export function speakPace(paceMsPer500: number, machine?: string): string {
  if (!(paceMsPer500 > 0) || !Number.isFinite(paceMsPer500)) return 'unknown';
  const total = Math.round(paceFor(paceMsPer500, machine) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${numberWords(s)} seconds`;
  if (s === 0) return `${numberWords(m)} flat`;
  return `${numberWords(m)} ${secondsPart(s)}`;
}

/** A pace difference: "half a second", "a second", "two seconds". */
export function speakSeconds(ms: number): string {
  const s = Math.abs(ms) / 1000;
  if (s < 0.75) return 'half a second';
  if (s < 1.25) return 'a second';
  if (s < 1.75) return 'a second and a half';
  return `${numberWords(Math.round(s))} seconds`;
}

/** Remaining / rest time: "thirty seconds", "five minutes", "two thirty", "one hour ten minutes". */
export function speakDuration(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${numberWords(sec)} second${sec === 1 ? '' : 's'}`;
  const min = Math.floor(sec / 60);
  const r = sec % 60;
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const mm = min % 60;
    return `${numberWords(h)} hour${h > 1 ? 's' : ''}${mm ? ` ${numberWords(mm)} minute${mm > 1 ? 's' : ''}` : ''}`;
  }
  if (r === 0) return `${numberWords(min)} minute${min > 1 ? 's' : ''}`;
  return `${numberWords(min)} ${secondsPart(r)}`;
}

/** Result clock: 418400 → "six fifty-eight point four", 420000 → "seven minutes flat". */
export function speakClock(ms: number): string {
  const tenths = Math.max(0, Math.round(ms / 100));
  const t = tenths % 10;
  const totalSec = Math.floor(tenths / 10);
  const h = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    const parts = [`${numberWords(h)} hour${h > 1 ? 's' : ''}`];
    if (min) parts.push(`${numberWords(min)} minute${min > 1 ? 's' : ''}`);
    if (s) parts.push(`${numberWords(s)} second${s > 1 ? 's' : ''}`);
    return parts.join(' ');
  }
  if (min === 0) return `${numberWords(s)}${t ? ` point ${ONES[t]!}` : ''} seconds`;
  if (s === 0 && t === 0) return `${numberWords(min)} minute${min > 1 ? 's' : ''} flat`;
  // 7:00.4 → "seven oh oh point four" (secondsPart(0) would say "oh zero").
  return `${numberWords(min)} ${s === 0 ? 'oh oh' : secondsPart(s)}${t ? ` point ${ONES[t]!}` : ''}`;
}

/** Metres the way a cox says them: 250 → "two fifty", 1250 → "twelve fifty", 1500 → "fifteen hundred", 2000 → "two thousand". */
export function speakMetres(metres: number): string {
  const m = Math.max(0, Math.round(metres));
  if (m === 0) return 'zero';
  if (m % 1000 === 0) return `${numberWords(m / 1000)} thousand`;
  if (m < 10000 && m % 100 === 0) return `${numberWords(m / 100)} hundred`;
  if (m > 100 && m < 10000 && m % 50 === 0) return `${numberWords(Math.floor(m / 100))} ${numberWords(m % 100)}`;
  return numberWords(m);
}
