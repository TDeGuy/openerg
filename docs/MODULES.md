# OpenErg — module contracts

OpenErg is a free, no-paywall companion app for the Concept2 PM5 (RowErg / SkiErg / BikeErg):
Expo SDK 58, React Native 0.88, TypeScript strict, expo-router (routes in `src/app`), zustand,
react-native-ble-plx, expo-sqlite, expo-speech, react-native-svg. Import alias `@/` → `src/`.

Several agents build this in parallel, each owning disjoint folders. **Only write inside the
folders you own.** Everything is wired together through the exports below, so the export names,
paths and signatures here are binding. Shared types live in `src/core/types.ts` (read it first,
never edit it); helpers in `src/core/units.ts`, defaults in `src/core/defaults.ts`.
You may add extra exports, but other modules only know about what is listed here.

Unit conventions: ms, metres, pace = ms/500m, watts, newtons, spm, bpm, kcal, joules.

## Ground rules

- Windows machine, PowerShell. Node is not on PATH by default — start every shell command with
  `$env:Path = "C:\Program Files\nodejs;$env:Path";`
- Do not run `npm install` / `expo install` (dependency list is fixed; parallel installs corrupt
  node_modules). If you truly need a package, say so in your final report instead.
- Do not edit `package.json`, `app.json`, `tsconfig.json`, `src/core/**`, `src/ui/**`,
  `src/app/_layout.tsx`, `src/app/(tabs)/_layout.tsx`, or another module's folder.
- Expo SDK 58 is newer than your training data. Before using an Expo / RN library API, check the
  installed package's `.d.ts` in `node_modules` (authoritative) or the versioned docs at
  `https://docs.expo.dev/versions/v58.0.0/`.
- Type-check with `npx tsc --noEmit -p .` and fix every error **in your own files**. Errors in
  other modules' files (still being written) are expected — ignore them. Imports from other
  modules that don't exist yet are fine as long as they match this document.
- Logic that can be pure must be pure (no `react-native` / `expo-*` imports) and unit tested with
  vitest: tests in `src/<module>/__tests__/*.test.ts`, run with
  `npx vitest run src/<module>`. Tests must pass before you finish.
- No placeholder / TODO / "coming soon" features, no paywalls, no premium gates, no accounts, no
  analytics. Everything works offline.
- Final report: files created, what is verified (tsc/tests), and any contract deviations or
  assumptions other modules need to know. Keep it under 300 words.

## `@/ble` — owner: BLE agent (`src/ble/**`)

```ts
export function createErgSource(kind: ErgSourceKind): ErgDataSource;
export function createHeartRateSource(): HeartRateSource;
```

- `'ble'` → real PM5 over Bluetooth LE via react-native-ble-plx; `'simulator'` → built-in
  physics-plausible PM5 simulator (no native imports) that produces metrics, strokes with
  realistic force curves, splits and workoutEnd, honours `programWorkout`, and "rows" by itself
  once a workout starts.
- `src/ble/index.ts` must not import `react-native-ble-plx` at module top level in a way that
  breaks web / vitest: load it lazily inside the BLE implementation (`require` on first use).
- Pure PM5 packet parsers + CSAFE framing live in files with no native imports and are unit
  tested with byte fixtures.

## `@/analysis` — owner: Analysis agent (`src/analysis/**`) — all pure

```ts
export function resampleCurve(curve: number[], points?: number /* 32 */): number[];
export function idealForceCurve(peakForceN: number, points?: number /* 32 */): number[];
export function analyzeForceCurve(
  curve: number[],
  ctx?: { driveTimeMs?: number; recoveryTimeMs?: number; driveLengthM?: number; strokeRate?: number; heightCm?: number | null },
): ForceCurveAnalysis;
export function analyzeForceSession(strokes: StrokeSample[]): ForceSessionAnalysis;
export function analyzePacing(record: WorkoutRecord): PacingAnalysis;
/** null when the record is not an interval workout. */
export function analyzeIntervals(record: WorkoutRecord): IntervalAnalysis | null;
/** Zones from reference 2k (pace/watts) and max/resting HR. [] when no reference 2k. */
export function trainingZones(profile: AthleteProfile): TrainingZone[];
export function heartRateZone(bpm: number, profile: AthleteProfile): 1 | 2 | 3 | 4 | 5 | null;
/** Paul's-law style predictions for the standard distances from one reference result. */
export function predictRaces(refDistanceM: number, refTimeMs: number): RacePrediction[];
export function computePersonalRecords(items: WorkoutListItem[]): PersonalRecord[];
/** Best rolling effort for a distance inside a longer piece; null if piece too short / no strokes. */
export function bestEffort(record: WorkoutRecord, distanceM: number): { timeMs: number; startM: number; paceMsPer500: number } | null;
export function trends(items: WorkoutListItem[], period: 'week' | 'month'): TrendPoint[];
/** Concept2 weight adjustment. */
export function weightAdjustedTime(timeMs: number, weightKg: number): number;
export function weightAdjustedDistance(distanceM: number, weightKg: number): number;
export function wattsPerKg(watts: number, weightKg: number | null): number;
/** Human label + one-line explanation for a technique flag / curve shape. */
export function describeFlag(flag: TechniqueFlag): { title: string; detail: string; drill: string };
export function describeShape(shape: ForceCurveShape): { title: string; detail: string };
export function describePacingProfile(p: PacingProfile): { title: string; detail: string };
/** Drag factor guidance for a machine. */
export function dragFactorAdvice(dragFactor: number, machine: MachineType): Insight;
```

## `@/coach` — owner: Coach agent (`src/coach/**`)

```ts
/** Pure rules engine. One instance per workout. */
export class Coxswain {
  constructor(opts: { settings: CoxswainSettings; profile: AthleteProfile; plan: WorkoutPlan | null });
  onMetrics(m: LiveMetrics): void;
  onStroke(s: StrokeSample, analysis: ForceCurveAnalysis | null): void;
  onSplit(s: SplitSummary): void;
  onWorkoutEnd(summary: PmWorkoutSummary | null): void;
  subscribe(cb: (call: CoxCall) => void): Unsubscribe;
  setMuted(muted: boolean): void;
  updateSettings(settings: CoxswainSettings): void;
}
export function buildPacePlan(args: {
  kind: 'distance' | 'time';
  value: number;              // metres or ms
  goalPaceMsPer500: number;
  strategy: PaceStrategy;
}): PacePlan;
export function segmentAt(plan: PacePlan, fraction: number): PacePlanSegment;
/** Where the pace boat is relative to the rower right now. null if the plan has no target. */
export function computePaceBoat(plan: WorkoutPlan | null, m: LiveMetrics): PaceBoatState | null;
/** A few sample lines for the settings preview. */
export function sampleCalls(personality: CoxPersonality): string[];

/** Text-to-speech wrapper (expo-speech). Lives in src/coach/voice.ts, re-exported from index. */
export interface CoxVoice {
  speak(call: CoxCall, settings: CoxswainSettings): void;
  stop(): void;
  listVoices(): Promise<{ id: string; name: string; language: string }[]>;
}
export function createVoice(): CoxVoice;
```

The engine files must be pure (importable by vitest as `@/coach/engine`); only `voice.ts`
touches expo-speech.

## `@/workouts` — owner: Coach agent (`src/workouts/**`) — all pure

```ts
export const BUILT_IN_WORKOUTS: WorkoutPlan[];   // rich library, every category, builtIn: true
export function planTitle(plan: WorkoutPlan): string;            // "2000m", "30:00", "8 × 500m / 2:00r"
export function describePlan(plan: WorkoutPlan): string;         // one-sentence summary
export function planTotals(plan: WorkoutPlan): { distanceM: number | null; durationMs: number | null; restMs: number };
export function validatePlan(plan: WorkoutPlan): string[];       // [] = valid; PM5 limits enforced
export function titleFromPm(workoutType: PmWorkoutType, totals: { distanceM: number; elapsedMs: number }, splits: SplitSummary[]): string;
export function newPlan(kind: WorkoutKind): WorkoutPlan;         // sensible defaults, fresh id
```

## `@/storage/*` — owner: Session agent (`src/storage/**`)

```ts
// @/storage/settings  (zustand; persisted)
export const useSettings: UseBoundStore<StoreApi<{
  settings: AppSettings;
  loaded: boolean;
  load(): Promise<void>;
  update(patch: Partial<AppSettings>): void;
  updateProfile(patch: Partial<AthleteProfile>): void;
  updateCoxswain(patch: Partial<CoxswainSettings>): void;
  reset(): void;
}>>;

// @/storage/db  (expo-sqlite)
export function saveWorkout(record: WorkoutRecord): Promise<void>;
export function getWorkout(id: string): Promise<WorkoutRecord | null>;
export function listWorkouts(opts?: { limit?: number; offset?: number; search?: string }): Promise<WorkoutListItem[]>;
export function deleteWorkout(id: string): Promise<void>;
export function updateWorkoutMeta(id: string, patch: { title?: string; notes?: string; tags?: string[] }): Promise<void>;
export function listCustomPlans(): Promise<WorkoutPlan[]>;
export function savePlan(plan: WorkoutPlan): Promise<void>;
export function deletePlan(id: string): Promise<void>;
/** Favourite flags for built-in + custom plans. */
export function getFavoritePlanIds(): Promise<string[]>;
export function setPlanFavorite(id: string, favorite: boolean): Promise<void>;
/** Bumped whenever workouts/plans change, so lists can refetch: useDbVersion() hook. */
export function useDbVersion(): number;

// @/storage/export
export type ExportFormat = 'csv' | 'tcx' | 'json';
/** Pure builders (in src/storage/formats.ts, unit tested). */
export function toCsv(record: WorkoutRecord): string;      // stroke-by-stroke
export function toTcx(record: WorkoutRecord): string;      // Garmin TCX, imports into Strava / C2 Logbook / TrainingPeaks
/** Writes the file to cache and opens the OS share sheet. */
export function shareWorkout(record: WorkoutRecord, format: ExportFormat): Promise<void>;
/** Full backup (all workouts + plans + settings) as JSON via share sheet. */
export function shareBackup(): Promise<void>;
/** Restore from a backup JSON picked with expo-document-picker. Returns imported count. */
export function importBackup(): Promise<number>;
```

## `@/session` — owner: Session agent (`src/session/**`)

```ts
/** The live session store: SessionState & SessionActions from core/types. */
export const useSession: UseBoundStore<StoreApi<SessionState & SessionActions>>;
```

Wires `createErgSource` (per `settings.useSimulator`) → store → `analyzeForceCurve` →
`Coxswain` + `createVoice` → `computePaceBoat` → recorder → `saveWorkout`. Handles
auto-reconnect, keep-awake, phase transitions from PM workout state, HR-strap override of PM HR,
ghost/pace-boat versus a previous workout, autosave on PM `workoutEnd`.

## Routes

Root is a Stack (`src/app/_layout.tsx`, integrator) with a bottom-tab group; screens set their
own titles via `<Stack.Screen options={{ title }} />`.

| Route file | Owner | Purpose |
| --- | --- | --- |
| `src/app/(tabs)/index.tsx` | Live UI | "Row" home: connection card, quick start, favourites, recents |
| `src/app/connect.tsx` | Live UI | Scan / connect PM5, simulator toggle, HR strap |
| `src/app/workouts/index.tsx` | Live UI | Workout library (built-in + custom), favourites, search |
| `src/app/workouts/builder.tsx` | Live UI | Create / edit plan (`?id=` to edit), targets, pace plan |
| `src/app/live.tsx` | Live UI | Live dashboard during a workout |
| `src/app/(tabs)/history.tsx` | Analysis UI | Logbook list |
| `src/app/(tabs)/trends.tsx` | Analysis UI | Trends, totals, personal records |
| `src/app/(tabs)/tools.tsx` | Analysis UI | Calculators: pace/watts, predictions, zones, weight adjust, drag guide |
| `src/app/(tabs)/settings.tsx` | Analysis UI | Settings hub |
| `src/app/workout/[id].tsx` | Analysis UI | Workout detail + analysis + export |
| `src/app/compare.tsx` | Analysis UI | Compare two workouts (`?a=&b=`) |
| `src/app/settings/profile.tsx` | Analysis UI | Athlete profile |
| `src/app/settings/coxswain.tsx` | Analysis UI | Coxswain settings + voice preview |
| `src/app/settings/dashboard.tsx` | Analysis UI | Choose / reorder live dashboard tiles |
| `src/app/settings/data.tsx` | Analysis UI | Backup / restore / export / delete all |

Live UI components go in `src/components/live/**`; Analysis UI components in
`src/components/analysis/**` and charts in `src/components/charts/**` (Analysis UI owns
charts; Live UI draws its own live force curve in its folder).

UI rules: build from `@/ui/kit` (`Screen, Card, Text, Button, Stat, Chip, Segmented, Row,
Toggle, Divider, SectionTitle, EmptyState`) and `@/ui/theme` (`useTheme, spacing, radius,
font`) — read both files. Colours only from the palette (works in dark and light). Charts with
react-native-svg. Icons: `Ionicons` from `@expo/vector-icons`. Navigation: `router`, `Link`,
`useLocalSearchParams`, `Stack` from `expo-router`. Format with `@/core/units`.
Phone-first portrait layout; `live.tsx` must also work in landscape (phone on the erg's
device holder) and have large glanceable numbers.
