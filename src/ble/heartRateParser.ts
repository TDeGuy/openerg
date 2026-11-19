/**
 * Bluetooth SIG Heart Rate Measurement (0x2A37) parser. Pure.
 * Flags: bit0 = HR value is uint16 (else uint8), bits1-2 = sensor contact status,
 * bit3 = energy expended present (uint16 kJ), bit4 = RR intervals present (uint16, 1/1024 s each).
 */
export interface HeartRateMeasurement {
  bpm: number;
  /** null = contact detection not supported. */
  contact: boolean | null;
  energyExpendedKj: number | null;
  /** RR intervals in ms. */
  rrIntervalsMs: number[];
}

export function parseHeartRateMeasurement(b: ArrayLike<number>): HeartRateMeasurement | null {
  if (b.length < 2) return null;
  const flags = b[0]! & 0xff;
  const wide = (flags & 0x01) !== 0;
  let o = 1;
  let bpm: number;
  if (wide) {
    if (b.length < 3) return null;
    bpm = (b[1]! & 0xff) | ((b[2]! & 0xff) << 8);
    o = 3;
  } else {
    bpm = b[1]! & 0xff;
    o = 2;
  }
  const contactSupported = (flags & 0x04) !== 0;
  const contact = contactSupported ? (flags & 0x02) !== 0 : null;
  let energy: number | null = null;
  if (flags & 0x08) {
    if (b.length >= o + 2) energy = (b[o]! & 0xff) | ((b[o + 1]! & 0xff) << 8);
    o += 2;
  }
  const rr: number[] = [];
  if (flags & 0x10) {
    for (; o + 1 < b.length; o += 2) {
      const v = (b[o]! & 0xff) | ((b[o + 1]! & 0xff) << 8);
      rr.push(Math.round((v * 1000) / 1024));
    }
  }
  return { bpm, contact, energyExpendedKj: energy, rrIntervalsMs: rr };
}

/** Battery Level (0x2A19): one byte, 0-100. null when absent or out of range. */
export function parseBatteryLevel(b: ArrayLike<number>): number | null {
  const v = b.length ? b[0]! & 0xff : -1;
  return v >= 0 && v <= 100 ? v : null;
}

/** One-shot scan timeout: starting again cancels the previous timer so it cannot cut the new scan short. Pure. */
export function createScanTimer(ms: number, onTimeout: () => void) {
  let id: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (id !== null) clearTimeout(id);
    id = null;
  };
  return {
    start() {
      clear();
      id = setTimeout(() => {
        id = null;
        onTimeout();
      }, ms);
    },
    clear,
  };
}
