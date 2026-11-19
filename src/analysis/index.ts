/** @/analysis — pure workout & technique analysis. See docs/MODULES.md for the contract. */
export { resampleCurve, idealForceCurve, analyzeForceCurve, analyzeForceSession, recoveryRatioBounds, driveLengthBounds, CURVE_POINTS, IDEAL_PEAK_POSITION } from './forceCurve';
export type { ForceCurveContext } from './forceCurve';
export { analyzePacing, classifyPacing } from './pacing';
export { analyzeIntervals } from './intervals';
export { trainingZones, heartRateZone, heartRateBands, ZONE_DEFS } from './zones';
export { predictRaces, paulsLawPace, PREDICTION_DISTANCES, PREDICTION_TIMES } from './predictions';
export { computePersonalRecords, bestEffort, PR_DISTANCES, PR_TIMES } from './records';
export { trends, periodStart } from './trends';
export { weightAdjustedTime, weightAdjustedDistance, weightFactor, wattsPerKg, dragFactorAdvice, DRAG_RANGES } from './equipment';
export { describeFlag, describeShape, describePacingProfile, FLAG_COPY, SHAPE_COPY, PACING_COPY } from './describe';
export { filterWorkouts, statsPool, pbEvents, pbEventsFor, best2k, nextReference2k, workoutKind } from './logbook';
export type { LogbookFilter, WorkoutKind } from './logbook';
