export { Coxswain, sampleCalls, mulberry32, derivedFlags, type CoxswainOptions } from './engine';
export { buildPacePlan, segmentAt, planAveragePace, baseRateFor } from './pacePlan';
export { computePaceBoat, PaceProfile } from './paceBoat';
export { CallScheduler, FREQUENCY_GAP_MS } from './scheduler';
export { PHRASES, TECHNIQUE_CUES } from './phrases';
export { speakPace, speakClock, speakDuration, speakMetres, speakSeconds, numberWords } from './speech';
export { createVoice, type CoxVoice } from './voice';
export { coxFor } from './override';
