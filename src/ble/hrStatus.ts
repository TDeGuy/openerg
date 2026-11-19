/** Live strap readout (BPM, battery) for the connect screen; written by HeartRateBle. */
import { create } from 'zustand';

export const useStrapStatus = create<{ bpm: number | null; battery: number | null }>(() => ({ bpm: null, battery: null }));
