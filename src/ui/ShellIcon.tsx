import React from 'react';
import Svg, { Path } from 'react-native-svg';

/** Racing shell seen from above with its oars out; Ionicons only has a generic boat. */
export function ShellIcon({ size = 24, color }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 2C13.3 6 13.3 18 12 22C10.7 18 10.7 6 12 2Z" />
      <Path d="M11 9L4 6.5M13 9L20 6.5M11 14.5L4 12M13 14.5L20 12" />
    </Svg>
  );
}
