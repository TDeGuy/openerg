import { Stack } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Field } from '@/components/analysis/ui';
import type { UploadMode, UploadService } from '@/core/types';
import { C2_REDIRECT } from '@/integrations/concept2';
import { useIntegrations } from '@/integrations/store';
import { STRAVA_CALLBACK_DOMAIN, STRAVA_REDIRECT } from '@/integrations/strava';
import { connectService, disconnectService, SERVICE_NAME } from '@/integrations/upload';
import { useSettings } from '@/storage/settings';
import { dialog } from '@/ui/dialog';
import { Button, Card, Divider, Screen, SectionTitle, Segmented, Text } from '@/ui/kit';
import { spacing } from '@/ui/theme';

const MODES: { value: UploadMode; label: string }[] = [
  { value: 'ask', label: 'Ask each time' },
  { value: 'always', label: 'Always upload' },
  { value: 'never', label: 'Never' },
];

const STEPS: Record<UploadService, string[]> = {
  strava: [
    '1. Open strava.com/settings/api and create an app (any name and website).',
    `2. Set "Authorization Callback Domain" to: ${STRAVA_CALLBACK_DOMAIN}  (OpenErg redirects to ${STRAVA_REDIRECT}).`,
    '3. Copy the Client ID and Client Secret into the fields above, then tap Connect.',
  ],
  concept2: [
    '1. Register an application in the developer portal at log.concept2.com/developers. It starts on log-dev.concept2.com until Concept2 approves production.',
    `2. Register this redirect URI: ${C2_REDIRECT}`,
    '3. Copy the Client ID and Client Secret into the fields above, pick Development or Production, then tap Connect.',
    'Development uses a separate account on log-dev.concept2.com; results there do not appear in your real logbook.',
  ],
};

function ServiceCard({ service }: { service: UploadService }) {
  const auth = useIntegrations((s) => s[service]);
  const c2Env = useIntegrations((s) => s.c2Env);
  const patch = useIntegrations((s) => s.patch);
  const modes = useSettings((s) => s.settings.uploads);
  const update = useSettings((s) => s.update);
  const [busy, setBusy] = useState(false);
  const connected = !!auth.tokens;

  const set = (p: Partial<typeof auth>) => patch({ [service]: { ...auth, ...p } });
  const connect = async () => {
    setBusy(true);
    try {
      await connectService(service);
    } catch (e) {
      dialog(`Could not connect to ${SERVICE_NAME[service]}`, e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    await disconnectService(service);
    setBusy(false);
    const { alert, dismissAlert } = useIntegrations.getState();
    if (alert?.kind === 'disconnect-failed') {
      dialog('Disconnected on this phone', alert.message);
      dismissAlert();
    }
  };

  return (
    <Card>
      <SectionTitle>{SERVICE_NAME[service]}</SectionTitle>
      <Text tone={connected ? 'good' : 'dim'}>{connected ? 'Connected' : 'Not connected'}</Text>

      <Text size="sm" tone="dim">
        After a workout
      </Text>
      <Segmented value={modes[service]} onChange={(v) => update({ uploads: { ...modes, [service]: v } })} options={MODES} />
      <Divider />

      {service === 'concept2' ? (
        <Segmented
          value={c2Env}
          onChange={(v) => {
            if (v === c2Env) return;
            const name = v === 'production' ? 'Production' : 'Development';
            const apply = () => patch({ c2Env: v, concept2: { ...auth, tokens: null } });
            if (!connected) return apply();
            dialog(`Switch to ${name}?`, 'Development and Production are separate Concept2 accounts, so this disconnects Concept2 Logbook. You will need to connect again.', [
              { text: 'Cancel', style: 'cancel' },
              { text: `Switch and disconnect`, style: 'destructive', onPress: apply },
            ]);
          }}
          options={[
            { value: 'dev', label: 'Development' },
            { value: 'production', label: 'Production' },
          ]}
        />
      ) : null}
      <Field label="Client ID" value={auth.clientId} onChangeText={(v) => set({ clientId: v.trim() })} autoCapitalize="none" autoCorrect={false} editable={!connected} />
      <Field
        label="Client secret"
        value={auth.clientSecret}
        onChangeText={(v) => set({ clientSecret: v.trim() })}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        editable={!connected}
      />
      {connected ? (
        <Button title="Disconnect" variant="secondary" loading={busy} onPress={disconnect} />
      ) : (
        <Button title="Connect" loading={busy} onPress={connect} />
      )}

      <Divider />
      <Text size="sm" weight="700">
        Setup
      </Text>
      <View style={{ gap: spacing.xs }}>
        {STEPS[service].map((t) => (
          <Text key={t} size="sm" tone="dim" selectable>
            {t}
          </Text>
        ))}
      </View>
    </Card>
  );
}

export default function ServicesScreen() {
  const load = useIntegrations((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Connected services' }} />
      <Text size="sm" tone="dim">
        Uploads need your own API application on each service. Credentials and tokens stay on this phone, and nothing is sent until you connect and upload.
      </Text>
      <ServiceCard service="strava" />
      <ServiceCard service="concept2" />
    </Screen>
  );
}
