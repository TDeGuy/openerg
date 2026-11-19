import { dialog } from '@/ui/dialog';
import { Stack } from 'expo-router';
import React, { useEffect, useState } from 'react';

import { formatDistance } from '@/core/units';
import type { ParsedBackup } from '@/storage/backup';
import { deleteAllWorkouts, listWorkouts, useDbVersion } from '@/storage/db';
import { importWorkoutFiles, pickBackup, restoreBackup, shareAllWorkouts, shareBackup } from '@/storage/export';
import { GROUPS, GROUP_LABEL, type RestoreMode, type RestoreOptions } from '@/storage/restore';
import { useSettings } from '@/storage/settings';
import { Button, Card, Divider, Row, Screen, SectionTitle, Segmented, Text, Toggle } from '@/ui/kit';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const MODES: { value: RestoreMode; label: string }[] = [
  { value: 'none', label: 'Skip' },
  { value: 'new', label: 'Add new only' },
  { value: 'update', label: 'Add + update' },
];
const DEFAULTS: RestoreOptions = {
  workouts: 'new',
  plans: 'new',
  groups: { coxswain: true, layouts: true, display: true, profile: true, services: true, devices: false },
};

export default function DataScreen() {
  const version = useDbVersion();
  const resetSettings = useSettings((s) => s.reset);
  const [stats, setStats] = useState<{ count: number; metres: number } | null>(null);
  const [busy, setBusy] = useState<'backup' | 'restore' | 'delete' | 'export' | 'import' | null>(null);
  const [pending, setPending] = useState<ParsedBackup | null>(null);
  const [opts, setOpts] = useState<RestoreOptions>(DEFAULTS);

  useEffect(() => {
    let alive = true;
    listWorkouts()
      .then((l) => alive && setStats({ count: l.length, metres: l.reduce((a, w) => a + (w.distanceM || 0), 0) }))
      .catch(() => alive && setStats({ count: 0, metres: 0 }));
    return () => {
      alive = false;
    };
  }, [version]);

  const run = async (kind: NonNullable<typeof busy>, title: string, fn: () => Promise<string | void | null>) => {
    setBusy(kind);
    try {
      const done = await fn();
      if (done) dialog(title, done);
    } catch (e) {
      dialog(`${title} failed`, msg(e));
    } finally {
      setBusy(null);
    }
  };

  const choose = () =>
    run('restore', 'Restore', async () => {
      const parsed = await pickBackup();
      if (parsed) {
        setOpts(DEFAULTS);
        setPending(parsed);
      }
    });

  const restore = () => {
    const p = pending;
    setPending(null);
    if (p) void run('restore', 'Restore complete', () => restoreBackup(p, opts));
  };

  const del = (includePlans: boolean) =>
    run('delete', 'Delete', async () => {
      await deleteAllWorkouts(includePlans);
    });

  const deleteAll = () => {
    if (!stats || stats.count === 0) return;
    dialog(
      `Delete all ${stats.count} workouts?`,
      'Every workout and its stroke data will be permanently removed from this device. This cannot be undone — make a backup first if you might want them back. Also delete your custom workouts and favourites?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Workouts only', style: 'destructive', onPress: () => void del(false) },
        { text: 'Workouts + custom', style: 'destructive', onPress: () => void del(true) },
      ],
    );
  };

  const reset = (forgetDevices: boolean) => {
    const { lastErgId, lastHrDeviceId, useSimulator } = useSettings.getState().settings;
    resetSettings();
    if (!forgetDevices) useSettings.getState().update({ lastErgId, lastHrDeviceId, useSimulator });
  };

  const confirmReset = () =>
    dialog(
      'Reset settings?',
      'Returns to defaults: athlete profile, coxswain, rowing-screen layouts and saved layouts, theme, units and display, and upload choices (ask / always / never). Kept: workouts, custom workouts, upload history and connected-service logins. "Keep devices" also keeps your paired PM5, HR strap and simulator choice; "Forget devices" resets those too.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Keep devices', style: 'destructive', onPress: () => reset(false) },
        { text: 'Forget devices', style: 'destructive', onPress: () => reset(true) },
      ],
    );

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'Data & backup' }} />
      <Card>
        <Text>
          {stats == null ? 'Counting workouts…' : `${stats.count} workout${stats.count === 1 ? '' : 's'} · ${formatDistance(stats.metres)} stored on this device.`}
        </Text>
        <Text size="sm" tone="dim">
          Everything stays on your phone. Nothing is synced or uploaded unless you share it yourself.
        </Text>
      </Card>

      <SectionTitle>Backup & restore</SectionTitle>
      <Card>
        <Text size="sm" tone="dim">
          A backup is one JSON file with every workout, custom workout, your settings and upload history (never login tokens). When restoring you choose what to bring back and what to keep from this phone.
        </Text>
        <Button title="Back up everything" onPress={() => run('backup', 'Backup', shareBackup)} loading={busy === 'backup'} disabled={busy != null} />
        <Button title="Restore from backup" variant="secondary" onPress={choose} loading={busy === 'restore'} disabled={busy != null || !!pending} />
      </Card>

      {pending ? (
        <Card>
          <Text weight="700">
            Restore {pending.workoutCount} workouts, {pending.plans.length} custom workouts
          </Text>
          <Text size="sm" tone="dim">Workouts</Text>
          <Segmented value={opts.workouts} onChange={(workouts) => setOpts({ ...opts, workouts })} options={MODES} />
          <Text size="sm" tone="dim">Custom workouts</Text>
          <Segmented value={opts.plans} onChange={(plans) => setOpts({ ...opts, plans })} options={MODES} />
          <Text size="xs" tone="faint">"Add + update" replaces workouts already on this phone with the backup's version (titles, notes, tags).</Text>
          {pending.settings || Object.keys(pending.uploads).length ? (
            <>
              <Divider />
              <Text size="sm" tone="dim">Settings to restore (off = keep this phone's)</Text>
              {GROUPS.map((g) => (
                <Row key={g} label={GROUP_LABEL[g]} right={<Toggle value={opts.groups[g]} onChange={(v) => setOpts({ ...opts, groups: { ...opts.groups, [g]: v } })} />} />
              ))}
            </>
          ) : null}
          <Button title="Restore" onPress={restore} disabled={busy != null} />
          <Button title="Cancel" variant="secondary" onPress={() => setPending(null)} />
        </Card>
      ) : null}

      <SectionTitle>Export & import</SectionTitle>
      <Card>
        <Button
          title="Export all workouts (.zip)"
          variant="secondary"
          onPress={() => run('export', 'Export', async () => `Exported ${await shareAllWorkouts()} workouts.`)}
          loading={busy === 'export'}
          disabled={busy != null || !stats || stats.count === 0}
        />
        <Button title="Import TCX / Concept2 Logbook CSV" variant="secondary" onPress={() => run('import', 'Import', importWorkoutFiles)} loading={busy === 'import'} disabled={busy != null} />
        <Text size="xs" tone="faint">
          The zip holds a summary CSV (one row per workout) and a TCX file per workout. Import accepts TCX files and the CSV from log.concept2.com Export; workouts with the same start time and distance are skipped. Single workouts can also be exported as CSV, TCX or JSON from their detail screen.
        </Text>
      </Card>

      <SectionTitle>Danger zone</SectionTitle>
      <Card>
        <Button title="Reset settings" variant="secondary" onPress={confirmReset} disabled={busy != null} />
        <Button
          title="Delete all workouts"
          variant="danger"
          onPress={deleteAll}
          loading={busy === 'delete'}
          disabled={busy != null || !stats || stats.count === 0}
        />
      </Card>
    </Screen>
  );
}
