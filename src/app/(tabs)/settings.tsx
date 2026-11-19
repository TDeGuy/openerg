import { router } from 'expo-router';
import Constants from 'expo-constants';
import React from 'react';

import { NavRow } from '@/components/analysis/ui';
import { formatDuration } from '@/core/units';
import { useSettings } from '@/storage/settings';
import type { ForceOverlay } from '@/core/types';
import { Card, Divider, Row, Screen, SectionTitle, Segmented, Text, Toggle } from '@/ui/kit';
import { ThemePicker } from '@/ui/ThemePicker';

const OVERLAYS: { value: ForceOverlay; label: string; hint: string }[] = [
  { value: 'ideal', label: 'Ideal curve', hint: 'Reference shape of a good drive' },
  { value: 'previous', label: 'Previous stroke', hint: 'Your last stroke' },
  { value: 'average', label: 'Rolling average', hint: 'Average of your recent strokes' },
];

export default function SettingsScreen() {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const p = settings.profile;
  const c = settings.coxswain;

  const profileHint = [p.name || null, p.weightKg ? `${p.weightKg} kg` : null, p.reference2kMs ? `2k ${formatDuration(p.reference2kMs)}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen>
      <Text size="xxl" weight="700">
        Settings
      </Text>

      <Card>
        <NavRow label="Athlete profile" hint={profileHint || 'Weight, heart rate, reference 2k'} icon="person-outline" onPress={() => router.push('/settings/profile')} />
        <Divider />
        <NavRow
          label="Coxswain"
          hint={c.enabled ? `${c.style === 'race' ? 'race' : c.personality} · ${c.frequency}${c.voiceEnabled ? ' · voice on' : ''}` : 'Off'}
          icon="megaphone-outline"
          onPress={() => router.push('/settings/coxswain')}
        />
        <Divider />
        <NavRow
          label="Rowing screen layout"
          hint={`${settings.livePages.length} page${settings.livePages.length === 1 ? '' : 's'}`}
          icon="grid-outline" onPress={() => router.push('/settings/dashboard')} />
        <Divider />
        <NavRow label="Connected services" hint="Strava, Concept2 Logbook" icon="cloud-upload-outline" onPress={() => router.push('/settings/services')} />
        <Divider />
        <NavRow label="Data & backup" hint="Backup, restore, delete" icon="server-outline" onPress={() => router.push('/settings/data')} />
      </Card>

      <SectionTitle>Rowing</SectionTitle>
      <Card>
        <Row label="Keep screen awake" hint="During workouts" right={<Toggle value={settings.keepAwake} onChange={(v) => update({ keepAwake: v })} />} />
        <Divider />
        <Row label="Auto reconnect" hint="Reconnect to the last PM5 if the link drops" right={<Toggle value={settings.autoReconnect} onChange={(v) => update({ autoReconnect: v })} />} />
        <Divider />
        <Row label="Use simulator" hint="Built-in PM5 simulator instead of Bluetooth" right={<Toggle value={settings.useSimulator} onChange={(v) => update({ useSimulator: v })} />} />
        <Divider />
        <Row label="Pace boat" hint="Show the target / ghost boat on the live screen" right={<Toggle value={settings.showPaceBoat} onChange={(v) => update({ showPaceBoat: v })} />} />
      </Card>

      <SectionTitle>Force curve overlays</SectionTitle>
      <Card>
        {OVERLAYS.map((o, i) => (
          <React.Fragment key={o.value}>
            {i > 0 ? <Divider /> : null}
            <Row
              label={o.label}
              hint={o.hint}
              right={
                <Toggle
                  value={settings.forceCurveOverlays.includes(o.value)}
                  onChange={(v) =>
                    update({ forceCurveOverlays: v ? [...settings.forceCurveOverlays, o.value] : settings.forceCurveOverlays.filter((x) => x !== o.value) })
                  }
                />
              }
            />
          </React.Fragment>
        ))}
      </Card>

      <SectionTitle>Display</SectionTitle>
      <Card>
        <Text size="sm" tone="dim">
          Force unit
        </Text>
        <Segmented
          value={settings.forceUnit}
          onChange={(v) => update({ forceUnit: v })}
          options={[
            { value: 'N', label: 'Newtons' },
            { value: 'kgf', label: 'kgf' },
            { value: 'lbf', label: 'lbf' },
          ]}
        />
        <Text size="sm" tone="dim">
          Theme
        </Text>
        <ThemePicker value={settings.theme} onChange={(v) => update({ theme: v })} />
      </Card>

      <SectionTitle>About</SectionTitle>
      <Card>
        <Text weight="700">OpenErg {Constants.expoConfig?.version ?? ''}</Text>
        <Text size="sm" tone="dim">
          A free companion for the Concept2 PM5. Every feature is free — no subscriptions, no premium tier, no accounts and no ads.
        </Text>
        <Text size="sm" tone="dim">
          Your workouts and settings stay on this device. Nothing is tracked; workouts only leave the phone when you share them or upload them to a service you connected.
        </Text>
        <Text size="xs" tone="faint">
          Not affiliated with Concept2. PM5, RowErg, SkiErg and BikeErg are trademarks of Concept2.
        </Text>
      </Card>
    </Screen>
  );
}
