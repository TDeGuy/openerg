/**
 * OpenErg shared contracts.
 *
 * Every module (ble, analysis, coach, session, storage, workouts, UI) codes against
 * these types. Do NOT change this file from inside a module — if something is missing,
 * extend it locally in your module and report it.
 *
 * Unit conventions (always): time = milliseconds, distance = metres, pace = ms per 500 m,
 * power = watts, force = newtons, rate = strokes/min, heart rate = bpm, energy = kcal,
 * work = joules, lengths = metres. A pace/number of 0 means "unknown / not rowing".
 */

export type Unsubscribe = () => void;

/* ───────────────────────── Machine & connection ───────────────────────── */

export type MachineType = 'rower' | 'skierg' | 'bikeerg';

export type ConnectionStatus =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface ConnectionState {
  status: ConnectionStatus;
  device: ErgInfo | null;
  /** Human readable error when status === 'error'. */
  error?: string;
}

export interface DiscoveredErg {
  id: string;
  /** Advertised name, e.g. "PM5 430123456". */
  name: string;
  rssi: number | null;
  simulated?: boolean;
}

export interface ErgInfo {
  id: string;
  name: string;
  serialNumber?: string;
  hardwareRevision?: string;
  firmwareRevision?: string;
  manufacturer?: string;
  machineType: MachineType;
  simulated?: boolean;
}

/* ───────────────────────── PM5 state enums ───────────────────────── */

export type WorkoutState =
  | 'waiting-to-begin'
  | 'workout-row'
  | 'countdown-pause'
  | 'interval-rest'
  | 'interval-work-time'
  | 'interval-work-distance'
  | 'interval-rest-end-to-work-time'
  | 'interval-rest-end-to-work-distance'
  | 'interval-work-time-to-rest'
  | 'interval-work-distance-to-rest'
  | 'workout-end'
  | 'terminate'
  | 'workout-logged'
  | 'rearm';

export type RowingState = 'inactive' | 'active';

export type StrokeState =
  | 'waiting-for-wheel-to-reach-min-speed'
  | 'waiting-for-wheel-to-accelerate'
  | 'driving'
  | 'dwelling-after-drive'
  | 'recovery';

export type PmWorkoutType =
  | 'just-row-no-splits'
  | 'just-row-splits'
  | 'fixed-distance-no-splits'
  | 'fixed-distance-splits'
  | 'fixed-time-no-splits'
  | 'fixed-time-splits'
  | 'fixed-time-interval'
  | 'fixed-distance-interval'
  | 'variable-interval'
  | 'variable-undefined-rest-interval'
  | 'fixed-calorie'
  | 'fixed-watt-minutes'
  | 'fixed-calorie-interval'
  | 'unknown';

export type IntervalType =
  | 'time'
  | 'distance'
  | 'rest'
  | 'time-rest-undefined'
  | 'distance-rest-undefined'
  | 'rest-undefined'
  | 'calorie'
  | 'calorie-rest-undefined'
  | 'watt-minute'
  | 'watt-minute-rest-undefined'
  | 'none';

/* ───────────────────────── Live data ───────────────────────── */

/**
 * Merged snapshot of everything the PM5 is currently reporting. Emitted by an
 * ErgDataSource whenever any underlying characteristic updates (throttle to ≤ 10 Hz).
 * All fields always present; unknown numeric values are 0, unknown HR is null.
 */
export interface LiveMetrics {
  /** Wall-clock timestamp (Date.now()) of this snapshot. */
  timestamp: number;
  /** Elapsed workout time (work + rest as shown on PM). */
  elapsedMs: number;
  distanceM: number;
  /** Instantaneous pace of last stroke. */
  paceMsPer500: number;
  avgPaceMsPer500: number;
  watts: number;
  avgWatts: number;
  strokeRate: number;
  avgStrokeRate: number;
  heartRate: number | null;
  /** Total calories so far. */
  calories: number;
  caloriesPerHour: number;
  speedMps: number;
  dragFactor: number;
  strokeCount: number;

  /* latest stroke mechanics (duplicated from StrokeSample for convenience) */
  driveLengthM: number;
  driveTimeMs: number;
  recoveryTimeMs: number;
  strokeDistanceM: number;
  peakForceN: number;
  avgForceN: number;
  workPerStrokeJ: number;

  /* state */
  workoutState: WorkoutState;
  rowingState: RowingState;
  strokeState: StrokeState;
  workoutType: PmWorkoutType;
  intervalType: IntervalType;
  /** 0-based index of the current interval / split. */
  intervalCount: number;
  /** Rest time remaining during interval rest, else 0. */
  restTimeRemainingMs: number;
  restDistanceM: number;

  /* projections as computed by PM */
  projectedWorkTimeMs: number;
  projectedWorkDistanceM: number;

  /* split in progress */
  splitAvgPaceMsPer500: number;
  splitAvgWatts: number;
  splitAvgCalPerHour: number;
  lastSplitTimeMs: number;
  lastSplitDistanceM: number;

  /** Target of the workout as programmed on the PM (0 if none). */
  workoutDurationMs: number;
  workoutDistanceM: number;
}

/** One record per completed stroke. */
export interface StrokeSample {
  strokeNumber: number;
  elapsedMs: number;
  distanceM: number;
  paceMsPer500: number;
  watts: number;
  strokeRate: number;
  heartRate: number | null;
  driveLengthM: number;
  driveTimeMs: number;
  recoveryTimeMs: number;
  strokeDistanceM: number;
  peakForceN: number;
  avgForceN: number;
  workPerStrokeJ: number;
  /** Interval index this stroke belongs to (0-based). */
  intervalCount: number;
  /**
   * Handle force samples across the drive, in newtons, evenly spaced in time over
   * driveTimeMs. Empty array when the PM did not deliver a curve for this stroke.
   */
  forceCurve: number[];
}

/** Summary of a completed split or interval as reported by the PM. */
export interface SplitSummary {
  /** 0-based. */
  index: number;
  type: IntervalType;
  /** Elapsed time at the end of the split. */
  elapsedMs: number;
  /** Cumulative distance at the end of the split. */
  distanceM: number;
  /** Duration of the work portion of this split. */
  splitTimeMs: number;
  splitDistanceM: number;
  restTimeMs: number;
  restDistanceM: number;
  avgPaceMsPer500: number;
  avgWatts: number;
  avgStrokeRate: number;
  avgHeartRate: number | null;
  /** HR at end of rest (intervals only). */
  restHeartRate: number | null;
  avgDragFactor: number;
  calories: number;
  strokeCount: number;
}

/** End-of-workout summary as reported by the PM. */
export interface PmWorkoutSummary {
  /** PM log timestamp if delivered, else end time by phone clock. */
  endedAt: number;
  elapsedMs: number;
  distanceM: number;
  avgPaceMsPer500: number;
  avgWatts: number;
  avgStrokeRate: number;
  avgHeartRate: number | null;
  minHeartRate: number | null;
  maxHeartRate: number | null;
  avgDragFactor: number;
  calories: number;
  strokeCount: number;
  workoutType: PmWorkoutType;
  intervalCount: number;
  totalRestMs: number;
}

/* ───────────────────────── Data source (BLE / simulator) ───────────────────────── */

export interface ErgEvents {
  connection: ConnectionState;
  metrics: LiveMetrics;
  stroke: StrokeSample;
  split: SplitSummary;
  workoutEnd: PmWorkoutSummary;
}

export type ErgSourceKind = 'ble' | 'simulator';

export interface ErgDataSource {
  readonly kind: ErgSourceKind;
  /** Request BT permissions / check adapter. Resolves false (never throws) if unavailable. */
  prepare(): Promise<{ ok: boolean; reason?: string }>;
  /** Starts scanning; resolves with a function that stops the scan. */
  scan(onFound: (erg: DiscoveredErg) => void): Promise<Unsubscribe>;
  connect(id: string): Promise<ErgInfo>;
  disconnect(): Promise<void>;
  getConnectionState(): ConnectionState;
  on<K extends keyof ErgEvents>(event: K, cb: (payload: ErgEvents[K]) => void): Unsubscribe;
  /** Program a workout onto the PM (CSAFE). No-op-resolves for 'just-row'. */
  programWorkout(plan: WorkoutPlan): Promise<void>;
  /** Ends the workout in progress and returns the PM to its main menu. */
  terminateWorkout(): Promise<void>;
  /** Free all resources. */
  destroy(): void;
}

export interface HeartRateDevice {
  id: string;
  name: string;
  rssi: number | null;
}

/** Optional direct-to-phone BLE heart-rate strap (standard 0x180D service). */
export interface HeartRateSource {
  scan(onFound: (d: HeartRateDevice) => void): Promise<Unsubscribe>;
  connect(id: string): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  onHeartRate(cb: (bpm: number) => void): Unsubscribe;
}

/* ───────────────────────── Workout plans ───────────────────────── */

export type WorkoutKind = 'just-row' | 'single-distance' | 'single-time' | 'single-calorie' | 'intervals';

export interface IntervalDef {
  type: 'distance' | 'time' | 'calorie';
  /** metres | ms | kcal depending on type. */
  value: number;
  /** Rest after this interval; 0 = no rest. */
  restMs: number;
  /** Rest ends when the athlete starts rowing rather than on a timer. */
  undefinedRest?: boolean;
  target?: IntervalTarget;
}

export interface IntervalTarget {
  paceMsPer500?: number;
  strokeRate?: number;
  /** 1-5, see HR zone model in analysis. */
  hrZone?: number;
}

/** One stretch of a continuous single piece: `duration` is ms on a time piece, metres on a distance piece. */
export interface PlanSegment {
  duration: number;
  paceMsPer500?: number;
  strokeRate?: number;
}

/** Per-workout coxswain override; unset fields follow the global settings. */
export interface PlanCox {
  enabled?: boolean;
  style?: CoxStyle;
}

export interface WorkoutPlan {
  id: string;
  name: string;
  description?: string;
  kind: WorkoutKind;
  /** single-distance: metres; single-time: ms; single-calorie: kcal. */
  value?: number;
  /** Split length for single pieces (metres for distance, ms for time). */
  splitValue?: number;
  /** For 'intervals'. Fixed intervals = identical entries. */
  intervals?: IntervalDef[];
  /**
   * Fixed intervals with no set count: `intervals` holds exactly one entry which the
   * PM repeats until the rower ends the workout (the PM's native fixed-interval mode).
   */
  repeatForever?: boolean;
  target?: IntervalTarget;
  /** Pacing strategy for the coxswain / pace boat on single pieces. */
  pacePlan?: PacePlan;
  /**
   * Ordered target changes inside a single distance/time piece (rate ladders, build pieces). The PM rows one
   * continuous piece; the app finds the current segment from elapsed time / distance. The last segment runs to the end.
   */
  segments?: PlanSegment[];
  cox?: PlanCox;
  category?: WorkoutCategory;
  favorite?: boolean;
  builtIn?: boolean;
}

export type WorkoutCategory =
  | 'test'
  | 'steady-state'
  | 'threshold'
  | 'vo2max'
  | 'sprint'
  | 'technique'
  | 'warmup'
  | 'custom';

export type PaceStrategy = 'even' | 'negative-split' | 'fast-start-settle-sprint' | 'custom';

export interface PacePlanSegment {
  /** Segment covers [startFraction, endFraction) of the piece (0..1 of distance or time). */
  startFraction: number;
  endFraction: number;
  targetPaceMsPer500: number;
  targetStrokeRate?: number;
  /** Short label the coxswain can announce, e.g. "Start", "Settle", "Sprint". */
  label: string;
}

export interface PacePlan {
  strategy: PaceStrategy;
  /** Overall goal: average pace across the piece. */
  goalPaceMsPer500: number;
  segments: PacePlanSegment[];
}

/* ───────────────────────── Recorded workouts ───────────────────────── */

export interface HeartRatePoint {
  elapsedMs: number;
  bpm: number;
}

export interface WorkoutRecord {
  id: string;
  /** Epoch ms. */
  startedAt: number;
  endedAt: number;
  machineType: MachineType;
  ergName?: string;
  ergSerial?: string;
  plan: WorkoutPlan | null;
  /** Derived title, e.g. "2000m", "30:00", "8 x 500m / 2:00r". */
  title: string;
  workoutType: PmWorkoutType;
  /** Work totals (rest excluded). */
  elapsedMs: number;
  distanceM: number;
  avgPaceMsPer500: number;
  avgWatts: number;
  avgStrokeRate: number;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  calories: number;
  strokeCount: number;
  avgDragFactor: number;
  totalRestMs: number;
  splits: SplitSummary[];
  strokes: StrokeSample[];
  heartRate: HeartRatePoint[];
  /** Coxswain calls made during the session. */
  coxCalls: CoxCall[];
  notes?: string;
  /** True if recorded from the simulator. */
  simulated?: boolean;
  /** True if the workout was verified by the PM end-of-workout summary. */
  verified?: boolean;
  tags?: string[];
}

/** Lightweight row for list screens (no strokes). */
export type WorkoutListItem = Omit<WorkoutRecord, 'strokes' | 'heartRate' | 'coxCalls' | 'splits'>;

/* ───────────────────────── Athlete profile & settings ───────────────────────── */

export interface AthleteProfile {
  name: string;
  weightKg: number | null;
  heightCm: number | null;
  birthYear: number | null;
  sex: 'male' | 'female' | 'other' | null;
  maxHeartRate: number | null;
  restingHeartRate: number | null;
  /** Best / reference 2k time used for training zones and coxswain targets. */
  reference2kMs: number | null;
}

export type CoxPersonality = 'calm' | 'encouraging' | 'race';
/** Race = the aggressive race-recording bank; training = the user's calm/encouraging choice. */
export type CoxStyle = 'race' | 'training';
export type CoxFrequency = 'minimal' | 'normal' | 'chatty';

export interface CoxswainSettings {
  enabled: boolean;
  voiceEnabled: boolean;
  /** Show calls as on-screen banners. */
  bannerEnabled: boolean;
  hapticsEnabled: boolean;
  /** Default style; 'race' makes the cox use the race bank. */
  style: CoxStyle;
  /** The training voice (calm / encouraging). A legacy 'race' value is read as calm. */
  personality: CoxPersonality;
  frequency: CoxFrequency;
  pacingCalls: boolean;
  techniqueCalls: boolean;
  motivationCalls: boolean;
  /** Announce splits / distance milestones. */
  splitCalls: boolean;
  /** Speech rate 0.5-1.5 and pitch 0.5-2 passed to TTS. */
  voiceRate: number;
  voicePitch: number;
  /** TTS voice identifier or null for system default. */
  voiceId: string | null;
  /** Stroke-rate up/down calls (separate from pacing calls). */
  rateCalls: boolean;
  /** Ask other audio (music) to lower while the coxswain speaks, where the voice engine supports it. */
  duckMusic: boolean;
  /** Technique faults the cox never calls. */
  mutedFlags: TechniqueFlag[];
  /**
   * How many times one fault may be cued in a piece. The final cue is announced as the
   * last ("last time I'll say it…") and the fault is then dropped for the rest of the piece.
   * Steady-state pieces use one fewer (minimum 1).
   */
  maxCuesPerFault: number;
  /** 'system' = the phone's text-to-speech; 'neural' = on-device neural voice (falls back to system if unavailable). */
  voiceEngine: 'system' | 'neural';
  /** Voice id within the neural engine, or null for its default. */
  neuralVoiceId: string | null;
}

/** Metric tiles that can be placed on the live dashboard. */
export type MetricKey =
  | 'pace'
  | 'avgPace'
  | 'splitPace'
  | 'watts'
  | 'avgWatts'
  | 'strokeRate'
  | 'avgStrokeRate'
  | 'heartRate'
  | 'hrZone'
  | 'elapsed'
  | 'distance'
  | 'remaining'
  | 'calories'
  | 'calPerHour'
  | 'dragFactor'
  | 'driveLength'
  | 'driveTime'
  | 'recoveryTime'
  | 'driveRecoveryRatio'
  | 'strokeDistance'
  | 'peakForce'
  | 'avgForce'
  | 'workPerStroke'
  | 'strokeCount'
  | 'speed'
  | 'speedKmh'
  | 'projectedFinish'
  | 'projectedDistance'
  | 'wattsPerKg'
  | 'paceBoatGap'
  | 'strokeScore';

export interface AppSettings {
  profile: AthleteProfile;
  coxswain: CoxswainSettings;
  /** Pages of the live rowing screen, swiped between while rowing. At least one. */
  livePages: LivePageConfig[];
  /** Named page sets; the active one is mirrored into livePages. */
  savedLayouts: SavedLayout[];
  activeLayoutId: string | null;
  forceUnit: 'N' | 'kgf' | 'lbf';
  keepAwake: boolean;
  autoReconnect: boolean;
  /** Use the built-in PM5 simulator instead of Bluetooth. */
  useSimulator: boolean;
  /** Theme id from THEMES in src/ui/theme.ts (older installs may hold 'system' | 'dark' | 'light'). */
  theme: string;
  lastErgId: string | null;
  lastHrDeviceId: string | null;
  showPaceBoat: boolean;
  /** Curves drawn over the live force curve; any combination, [] = none. */
  forceCurveOverlays: ForceOverlay[];
  /** Workout ids shown (in order) in the home "Standard pieces" grid: quick pieces, built-ins or saved custom plans. */
  homeWorkoutIds: string[];
  /** What to do with a finished workout, per upload service. */
  uploads: Record<UploadService, UploadMode>;
}

export type UploadService = 'concept2';
export type UploadMode = 'ask' | 'always' | 'never';

export type ForceOverlay = 'previous' | 'average' | 'ideal';

/** Graphs that can be placed on a live page. */
export type LiveGraphKey =
  | 'forceCurve'
  | 'paceRate'      // rolling pace + stroke rate (faster pace plots higher)
  | 'paceHistory'   // split over the whole piece so far, with the pace-boat / plan target line when one is set
  | 'watts'
  | 'heartRate'
  | 'strokeScore'
  | 'splits'        // completed splits table
  | 'paceBoat'
  | 'wattsHistory'  // watts over the whole piece
  | 'rateHistory'   // stroke rate over the whole piece
  | 'hrHistory'     // heart rate over the whole piece, optional zone bands
  | 'splitBars'     // one bar per completed split
  | 'ratioTrend'    // recovery : drive ratio per stroke
  | 'peakForceTrend';

/** Where a page's graphs sit relative to its tiles; 'auto' = right in landscape, below in portrait. */
export type GraphPosition = 'auto' | 'right' | 'left' | 'top' | 'bottom' | 'graphsOnly' | 'tilesOnly';

/**
 * One page of the live rowing screen. Everything on a page must fit the screen
 * without scrolling: tiles share the space left over by the graphs.
 */
export interface SavedLayout {
  id: string;
  name: string;
  pages: LivePageConfig[];
}

export interface LivePageConfig {
  id: string;
  name: string;
  /** Ordered metric tiles; the first two are shown largest. */
  tiles: MetricKey[];
  /** 0-2 graphs shown beside (landscape) or below (portrait) the tiles. */
  graphs: LiveGraphKey[];
  /** Missing = 'auto'. */
  graphPosition?: GraphPosition;
  /** Enabled lines / overlays per graph (see components/live/graphs.ts); missing = that graph's defaults. */
  graphOptions?: Partial<Record<LiveGraphKey, string[]>>;
}

/* ───────────────────────── Coxswain ───────────────────────── */

export type CoxCallCategory = 'pacing' | 'rate' | 'technique' | 'motivation' | 'info' | 'race-plan' | 'safety';

export interface CoxCall {
  id: string;
  /** Workout elapsed time when the call was made. */
  elapsedMs: number;
  /** Text to speak / display. Short, natural coxswain language. */
  text: string;
  category: CoxCallCategory;
  /** 1 (low) – 3 (urgent). Urgent calls may interrupt speech in progress. */
  priority: 1 | 2 | 3;
  /** Optional technique flag this call addresses. */
  flag?: TechniqueFlag;
}

/* ───────────────────────── Analysis results ───────────────────────── */

export type ForceCurveShape =
  | 'ideal'          // smooth, single peak around 35-45% of the drive
  | 'front-loaded'   // early peak, drops away (legs only / "shooting the slide" variant)
  | 'back-loaded'    // late peak (slow catch, arms/back hauling at the finish)
  | 'double-peak'    // dip in the middle (legs-body disconnection)
  | 'flat'           // low plateau, no real peak (soft drive)
  | 'spiky';         // very sharp narrow peak (jerky, poor suspension)

export type TechniqueFlag =
  | 'slow-catch'
  | 'early-peak-fade'
  | 'late-peak'
  | 'double-peak'
  | 'weak-finish'
  | 'soft-drive'
  | 'jerky-drive'
  | 'short-stroke'
  | 'overreaching'
  | 'rushed-recovery'
  | 'slow-recovery'
  | 'inconsistent-strokes'
  | 'rate-too-high'
  | 'rate-too-low'
  | 'low-power-per-stroke';

export interface ForceCurveAnalysis {
  /** False when the curve was missing / too short to analyse. */
  valid: boolean;
  peakForceN: number;
  avgForceN: number;
  /** Position of peak force within the drive, 0..1. */
  peakPosition: number;
  /** avg/peak — "fullness" of the curve; ~0.65-0.75 is strong. */
  fullness: number;
  /** 0..1, 1 = perfectly smooth single hump. */
  smoothness: number;
  /** Time from catch to 70% of peak as a fraction of the drive (catch quickness). */
  riseFraction: number;
  /** Impulse (N·s) over the drive. */
  impulseNs: number;
  shape: ForceCurveShape;
  flags: TechniqueFlag[];
  /** 0-100 overall stroke quality score. */
  score: number;
}

export interface ForceSessionAnalysis {
  strokesAnalysed: number;
  /** Mean curve resampled to 32 points, newtons. */
  averageCurve: number[];
  /** Per-point standard deviation of the resampled curves, newtons. */
  curveStdDev: number[];
  /** 0..1, 1 = every stroke identical. */
  consistency: number;
  avgPeakForceN: number;
  avgPeakPosition: number;
  avgFullness: number;
  avgSmoothness: number;
  avgScore: number;
  dominantShape: ForceCurveShape;
  shapeDistribution: Partial<Record<ForceCurveShape, number>>;
  /** Fraction of strokes (0..1) exhibiting each flag. */
  flagFrequency: Partial<Record<TechniqueFlag, number>>;
  /** Average curve for the first / last third of the session — reveals fatigue changes. */
  earlyCurve: number[];
  lateCurve: number[];
  /** Per-stroke scores for charting. */
  scoreSeries: number[];
  /** Plain-language coaching insights, most important first. */
  insights: Insight[];
}

export interface Insight {
  severity: 'good' | 'info' | 'warn';
  title: string;
  detail: string;
  flag?: TechniqueFlag;
  /** A drill or fix suggestion. */
  drill?: string;
}

export type PacingProfile =
  | 'even'
  | 'negative-split'
  | 'positive-split'
  | 'fly-and-die'
  | 'u-shaped'      // fast start, slow middle, fast finish (classic 2k)
  | 'erratic'
  | 'unknown';

export interface SeriesPoint {
  /** x in elapsed ms (time series) or metres (distance series) as documented. */
  x: number;
  y: number;
}

export interface PacingSegment {
  index: number;
  startM: number;
  endM: number;
  startMs: number;
  endMs: number;
  avgPaceMsPer500: number;
  avgWatts: number;
  avgStrokeRate: number;
  avgHeartRate: number | null;
  /** Pace delta versus the session average, ms/500 (negative = faster). */
  deltaVsAvgMs: number;
  /** Delta versus plan target if a pace plan existed, else null. */
  deltaVsPlanMs: number | null;
}

export interface PacingAnalysis {
  profile: PacingProfile;
  /** Coefficient of variation of segment pace, %. */
  variabilityPct: number;
  /** (2nd-half pace − 1st-half pace) / 1st-half pace, %. Positive = slowed down. */
  fadePct: number;
  /** Fastest / slowest segment indexes. */
  fastestSegment: number;
  slowestSegment: number;
  /** Equal-size segments (default 8, or PM splits/intervals when present). */
  segments: PacingSegment[];
  /** x = elapsedMs. Smoothed. */
  paceSeries: SeriesPoint[];
  wattsSeries: SeriesPoint[];
  rateSeries: SeriesPoint[];
  heartRateSeries: SeriesPoint[];
  /** Metres per stroke over time. */
  distancePerStrokeSeries: SeriesPoint[];
  /** HR drift (decoupling) between halves at comparable power, %. null if no HR. */
  hrDriftPct: number | null;
  /** Time lost versus perfectly even pacing at the same average power, ms. */
  timeLostToPacingMs: number;
  /** 0-100. */
  score: number;
  insights: Insight[];
}

/** Intervals: per-rep comparison. */
export interface IntervalAnalysis {
  reps: PacingSegment[];
  /** Pace drop from best to worst rep, %. */
  dropOffPct: number;
  consistencyPct: number;
  /** HR recovered during each rest (bpm), null if unknown. */
  hrRecovery: (number | null)[];
  insights: Insight[];
}

export interface TrainingZone {
  zone: 1 | 2 | 3 | 4 | 5;
  /** UT2, UT1, AT, TR, AN */
  name: string;
  description: string;
  paceMinMsPer500: number;
  paceMaxMsPer500: number;
  wattsMin: number;
  wattsMax: number;
  hrMin: number | null;
  hrMax: number | null;
  strokeRateMin: number;
  strokeRateMax: number;
}

export interface RacePrediction {
  distanceM: number;
  label: string;
  predictedMs: number;
  paceMsPer500: number;
  watts: number;
}

export interface PersonalRecord {
  /** e.g. '500m','1000m','2000m','5000m','6000m','10000m','21097m','42195m','1:00','4:00','30:00','60:00' */
  event: string;
  eventType: 'distance' | 'time';
  /** distance events: time in ms; time events: metres. */
  result: number;
  paceMsPer500: number;
  watts: number;
  workoutId: string;
  achievedAt: number;
}

export interface TrendPoint {
  /** Start of period, epoch ms. */
  periodStart: number;
  metres: number;
  durationMs: number;
  sessions: number;
  avgPaceMsPer500: number;
  avgWatts: number;
}

/* ───────────────────────── Live session state (zustand store shape) ───────────────────────── */

export type SessionPhase = 'idle' | 'ready' | 'rowing' | 'rest' | 'paused' | 'finished';

export interface PaceBoatState {
  /** Positive = you are ahead of the boat, metres. */
  gapM: number;
  /** Positive = ahead, ms. */
  gapMs: number;
  targetPaceMsPer500: number;
  label: string;
}

export interface SessionState {
  connection: ConnectionState;
  discovered: DiscoveredErg[];
  hrConnected: boolean;
  phase: SessionPhase;
  plan: WorkoutPlan | null;
  metrics: LiveMetrics | null;
  lastStroke: StrokeSample | null;
  /** All strokes of the current session (mutable-append; new array ref on each stroke). */
  strokes: StrokeSample[];
  splits: SplitSummary[];
  /** Analysis of the latest stroke's force curve. */
  lastStrokeAnalysis: ForceCurveAnalysis | null;
  /** Rolling average force curve (last ~10 strokes), 32 points, N. */
  rollingAverageCurve: number[];
  paceBoat: PaceBoatState | null;
  /** Most recent coxswain call (for banner) and full list. */
  lastCoxCall: CoxCall | null;
  coxCalls: CoxCall[];
  /** Id of the record saved when the last workout finished. */
  lastSavedWorkoutId: string | null;
}

export interface SessionActions {
  /** Create the data source per settings, request permissions. */
  init(): Promise<{ ok: boolean; reason?: string }>;
  startScan(): Promise<void>;
  stopScan(): void;
  connect(id: string): Promise<void>;
  disconnect(): Promise<void>;
  /** Select a plan, program it on the PM and arm recording. null = just row. */
  startWorkout(plan: WorkoutPlan | null, opts?: { ghostWorkoutId?: string }): Promise<void>;
  /** Stop, save the record and return its id (null if nothing worth saving). */
  finishWorkout(): Promise<string | null>;
  discardWorkout(): void;
  scanHeartRate(onFound: (d: HeartRateDevice) => void): Promise<Unsubscribe>;
  connectHeartRate(id: string): Promise<void>;
  disconnectHeartRate(): Promise<void>;
  /** Manually silence / unsilence the cox mid-piece. */
  setCoxMuted(muted: boolean): void;
}
