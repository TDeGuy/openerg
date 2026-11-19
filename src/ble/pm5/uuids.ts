/**
 * Concept2 PM5 GATT UUIDs.
 *
 * Source: "Concept2 PM CSAFE Communication Definition" rev 0.31/0.34 (2025-07-17), which
 * embeds the PM5 Bluetooth Smart attribute table (pp. 14-47). Base UUID
 * CE06xxxx-43E5-11E4-916C-0800200C9A66.
 */

export function pm5Uuid(short: number): string {
  return `ce06${short.toString(16).padStart(4, '0')}-43e5-11e4-916c-0800200c9a66`;
}

export const PM5 = {
  /** The PM5 advertises this "base" service. */
  ADVERTISED_SERVICE: pm5Uuid(0x0000),

  DEVICE_INFO_SERVICE: pm5Uuid(0x0010),
  MODEL_NUMBER: pm5Uuid(0x0011),
  SERIAL_NUMBER: pm5Uuid(0x0012),
  HARDWARE_REVISION: pm5Uuid(0x0013),
  FIRMWARE_REVISION: pm5Uuid(0x0014),
  MANUFACTURER_NAME: pm5Uuid(0x0015),
  ERG_MACHINE_TYPE: pm5Uuid(0x0016),
  ATT_MTU: pm5Uuid(0x0017),

  CONTROL_SERVICE: pm5Uuid(0x0020),
  /** Write CSAFE frames to the PM (max 20 bytes per write). */
  CSAFE_RECEIVE: pm5Uuid(0x0021),
  /** CSAFE responses from the PM (notify). */
  CSAFE_TRANSMIT: pm5Uuid(0x0022),

  ROWING_SERVICE: pm5Uuid(0x0030),
  GENERAL_STATUS: pm5Uuid(0x0031),
  ADDITIONAL_STATUS: pm5Uuid(0x0032),
  ADDITIONAL_STATUS_2: pm5Uuid(0x0033),
  SAMPLE_RATE: pm5Uuid(0x0034),
  STROKE_DATA: pm5Uuid(0x0035),
  ADDITIONAL_STROKE_DATA: pm5Uuid(0x0036),
  SPLIT_DATA: pm5Uuid(0x0037),
  ADDITIONAL_SPLIT_DATA: pm5Uuid(0x0038),
  WORKOUT_SUMMARY: pm5Uuid(0x0039),
  ADDITIONAL_WORKOUT_SUMMARY: pm5Uuid(0x003a),
  HEART_RATE_BELT_INFO: pm5Uuid(0x003b),
  /** Additional workout summary 2: multiplexed only (no standalone characteristic). */
  ADDITIONAL_WORKOUT_SUMMARY_2: pm5Uuid(0x003c),
  FORCE_CURVE: pm5Uuid(0x003d),
  MULTIPLEXED: pm5Uuid(0x0080),
} as const;

/** Individual notify characteristics (fallback path when the multiplexed one is unusable). */
export const PM5_NOTIFY_CHARACTERISTICS: { uuid: string; id: number }[] = [
  { uuid: PM5.GENERAL_STATUS, id: 0x31 },
  { uuid: PM5.ADDITIONAL_STATUS, id: 0x32 },
  { uuid: PM5.ADDITIONAL_STATUS_2, id: 0x33 },
  { uuid: PM5.STROKE_DATA, id: 0x35 },
  { uuid: PM5.ADDITIONAL_STROKE_DATA, id: 0x36 },
  { uuid: PM5.SPLIT_DATA, id: 0x37 },
  { uuid: PM5.ADDITIONAL_SPLIT_DATA, id: 0x38 },
  { uuid: PM5.WORKOUT_SUMMARY, id: 0x39 },
  { uuid: PM5.ADDITIONAL_WORKOUT_SUMMARY, id: 0x3a },
  { uuid: PM5.FORCE_CURVE, id: 0x3d },
];

/** Sample-rate characteristic values (0x0034). 3 = 100 ms is the fastest. */
export const SAMPLE_RATE = { MS_1000: 0, MS_500: 1, MS_250: 2, MS_100: 3 } as const;

/** Standard Bluetooth SIG heart-rate service. */
export const HEART_RATE_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb';
export const HEART_RATE_MEASUREMENT = '00002a37-0000-1000-8000-00805f9b34fb';

export function isPm5Name(name: string | null | undefined): boolean {
  return !!name && /^PM5/i.test(name.trim());
}

/** Standard Bluetooth SIG battery service / level. */
export const BATTERY_SERVICE = '0000180f-0000-1000-8000-00805f9b34fb';
export const BATTERY_LEVEL = '00002a19-0000-1000-8000-00805f9b34fb';
