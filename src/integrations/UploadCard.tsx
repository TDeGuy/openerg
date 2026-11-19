/** Upload status + Upload / Don't upload / Retry buttons. `summary` = post-workout, `detail` = saved workout screen. */
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import type { UploadService, WorkoutRecord } from '@/core/types';
import { getWorkout } from '@/storage/db';
import { useSettings } from '@/storage/settings';
import { Button, Card, SectionTitle, Text } from '@/ui/kit';
import { spacing } from '@/ui/theme';

import { useIntegrations } from './store';
import { SERVICE_NAME, uploadWorkout } from './upload';

const SERVICES: UploadService[] = ['strava', 'concept2'];

export function UploadCard({ workoutId, variant }: { workoutId: string | null; variant: 'summary' | 'detail' }) {
  const load = useIntegrations((s) => s.load);
  const auth = useIntegrations();
  const modes = useSettings((s) => s.settings.uploads);
  const [record, setRecord] = useState<WorkoutRecord | null>(null);
  const [declined, setDeclined] = useState<Partial<Record<UploadService, true>>>({});

  useEffect(() => {
    void load();
    let alive = true;
    if (workoutId) getWorkout(workoutId).then((r) => alive && setRecord(r)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [workoutId, load]);

  if (!record) return null;
  const rows = SERVICES.filter((s) => {
    if (!auth[s].tokens) return false;
    if (variant === 'detail') return true;
    const st = auth.uploads[record.id]?.[s];
    return !!st || auth.busy[`${record.id}:${s}`] || (modes[s] === 'ask' && !declined[s]);
  });

  if (!rows.length) {
    if (variant === 'summary' || SERVICES.some((s) => auth[s].tokens)) return null;
    return (
      <Card>
        <SectionTitle>Upload</SectionTitle>
        <Text size="sm" tone="dim">
          Send this workout to Strava or the Concept2 Logbook.
        </Text>
        <Button title="Connected services" variant="secondary" onPress={() => router.push('/settings/services')} />
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle>Upload</SectionTitle>
      {rows.map((s) => {
        const st = auth.uploads[record.id]?.[s];
        const busy = !!auth.busy[`${record.id}:${s}`];
        return (
          <View key={s} style={{ gap: spacing.xs }}>
            <Text weight="700">{SERVICE_NAME[s]}</Text>
            {busy ? (
              <Text tone="dim">Uploading…</Text>
            ) : st?.state === 'done' ? (
              <Text tone="good">Uploaded</Text>
            ) : (
              <>
                {st?.state === 'failed' ? (
                  <Text size="sm" tone="bad">
                    Failed: {st.error}
                  </Text>
                ) : null}
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button title={st ? 'Retry' : 'Upload'} small onPress={() => uploadWorkout(record, s)} style={{ flex: 1 }} />
                  {variant === 'summary' && !st ? (
                    <Button title="Don't upload" variant="secondary" small onPress={() => setDeclined({ ...declined, [s]: true })} style={{ flex: 1 }} />
                  ) : null}
                </View>
              </>
            )}
          </View>
        );
      })}
    </Card>
  );
}
