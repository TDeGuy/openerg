import { useRef } from 'react';
import { useSimultaneousGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';

import { tapPin } from './util';

/**
 * Tap pins / clears, a horizontal drag moves the pin and leaves it where the finger lifted.
 * Uses RNGH (not the JS responder) because the tab pager and ScrollView are native and steal
 * touches from a JS responder regardless of onResponderTerminationRequest; an active RNGH pan
 * blocks that. A vertical start fails the pan so the page still scrolls.
 */
export function usePinGesture(enabled: boolean, pinned: boolean, onPin: (x: number | null) => void) {
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const pan = usePanGesture({
    enabled,
    runOnJS: true,
    activeOffsetX: [-8, 8],
    failOffsetY: [-12, 12],
    onActivate: (e) => onPin(e.x),
    onUpdate: (e) => onPin(e.x),
  });
  const tap = useTapGesture({ enabled, runOnJS: true, maxDistance: 10, onActivate: (e) => onPin(tapPin(pinnedRef.current, e.x)) });
  return useSimultaneousGestures(pan, tap);
}
