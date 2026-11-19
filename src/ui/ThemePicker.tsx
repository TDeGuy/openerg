import React from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { font, radius, resolveThemeId, spacing, ThemeId, THEMES, useTheme } from './theme';

/** Grid of theme cards, each drawn in its own palette as a miniature rowing screen. */
export function ThemePicker({ value, onChange }: { value: string; onChange: (id: ThemeId) => void }) {
  const current = useTheme();
  const selected = resolveThemeId(value);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {(Object.keys(THEMES) as ThemeId[]).map((id) => {
        const { name, palette: p } = THEMES[id];
        const on = id === selected;
        return (
          <Pressable
            key={id}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${name} theme`}
            onPress={() => onChange(id)}
            style={{
              width: '48%',
              flexGrow: 1,
              backgroundColor: p.bg,
              borderRadius: radius.md,
              borderWidth: 2,
              borderColor: on ? current.accent : current.border,
              padding: spacing.sm,
              gap: 6,
            }}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <View style={{ flex: 1, backgroundColor: p.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: p.border, padding: 6 }}>
                <RNText style={{ color: p.textFaint, fontSize: 8, fontWeight: '700' }}>SPLIT</RNText>
                <RNText style={[font.metric, { color: p.text, fontSize: 20 }]}>1:47.2</RNText>
              </View>
              <View style={{ backgroundColor: p.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: p.border, padding: 6 }}>
                <RNText style={{ color: p.textFaint, fontSize: 8, fontWeight: '700' }}>RATE</RNText>
                <RNText style={[font.metric, { color: p.text, fontSize: 20 }]}>28</RNText>
              </View>
            </View>
            <View style={{ backgroundColor: p.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: p.border, height: 44 }}>
              <Svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none">
                <Path d="M0,40 C15,12 30,4 42,5 C60,7 80,26 100,40" fill="none" stroke={p.forceAlt} strokeWidth={1.5} strokeDasharray="4 3" />
                <Path d="M0,40 C13,16 28,7 40,8 C58,10 79,28 100,40 Z" fill={p.force + '33'} stroke={p.force} strokeWidth={2} />
              </Svg>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ backgroundColor: p.accent, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
                <RNText style={{ color: p.accentText, fontSize: 9, fontWeight: '800' }}>Row</RNText>
              </View>
              {p.zones.map((z, i) => (
                <View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: z }} />
              ))}
              <RNText numberOfLines={1} style={{ flex: 1, textAlign: 'right', color: p.textDim, fontSize: 11, fontWeight: '700' }}>
                {name}
              </RNText>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
