import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

/** Tracks the width of a chart container via onLayout (0 until first layout). */
export function useChartWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width);
    setWidth((prev) => (Math.abs(prev - w) >= 1 ? w : prev));
  }, []);
  return [width, onLayout];
}
