import { dialog } from '@/ui/dialog';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { useStrapStatus } from '@/ble/hrStatus';
import { createScanTimer } from '@/ble/heartRateParser';
import { Badge, errorMessage } from '@/components/live/common';
import { launchWorkout, peekPendingStart, setPendingStart, subscribePendingStart, takePendingStart } from '@/components/live/start';
import type { HeartRateDevice, Unsubscribe } from '@/core/types';
import { useSession } from '@/session';
import { useSettings } from '@/storage/settings';
import { Button, Card, Divider, EmptyState, Row, Screen, SectionTitle, Text, Toggle } from '@/ui/kit';
import { radius, spacing, useTheme } from '@/ui/theme';

function SignalBars({ rssi }: { rssi: number | null }) {
  const t = useTheme();
  const level = rssi === null ? 0 : rssi >= -60 ? 4 : rssi >= -70 ? 3 : rssi >= -80 ? 2 : 1;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 }} accessibilityLabel={`Signal ${level} of 4`}>
      {[1, 2, 3, 4].map((i) => (
        <View key={i} style={{ width: 4, height: 4 + i * 4, borderRadius: 1, backgroundColor: i <= level ? t.accent : t.border }} />
      ))}
    </View>
  );
}

function DeviceRow({
  name,
  detail,
  rssi,
  busy,
  onPress,
}: {
  name: string;
  detail?: string;
  rssi: number | null;
  busy?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Connect to ${name}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: 56,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        backgroundColor: pressed ? t.surfaceAlt : t.surface,
        borderWidth: 1,
        borderColor: t.border,
      })}>
      <SignalBars rssi={rssi} />
      <View style={{ flex: 1 }}>
        <Text weight="700">{name}</Text>
        <Text size="sm" tone="faint">
          {detail ?? (rssi !== null ? `${rssi} dBm` : 'signal unknown')}
        </Text>
      </View>
      {busy ? <ActivityIndicator color={t.accent} /> : <Ionicons name="chevron-forward" size={20} color={t.textFaint} />}
    </Pressable>
  );
}

export default function ConnectScreen() {
  const t = useTheme();
  const connection = useSession((s) => s.connection);
  const discovered = useSession((s) => s.discovered);
  const hrConnected = useSession((s) => s.hrConnected);
  const init = useSession((s) => s.init);
  const startScan = useSession((s) => s.startScan);
  const stopScan = useSession((s) => s.stopScan);
  const connect = useSession((s) => s.connect);
  const disconnect = useSession((s) => s.disconnect);
  const scanHeartRate = useSession((s) => s.scanHeartRate);
  const connectHeartRate = useSession((s) => s.connectHeartRate);
  const disconnectHeartRate = useSession((s) => s.disconnectHeartRate);
  const useSimulator = useSettings((s) => s.settings.useSimulator);
  const update = useSettings((s) => s.update);

  const [prep, setPrep] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hrDevices, setHrDevices] = useState<HeartRateDevice[]>([]);
  const [hrScanning, setHrScanning] = useState(false);
  const hrStop = useRef<Unsubscribe | null>(null);
  const hrTimer = useRef<ReturnType<typeof createScanTimer> | null>(null);
  const strapBpm = useStrapStatus((s) => s.bpm);
  const strapBattery = useStrapStatus((s) => s.battery);
  const lastHrId = useSettings((s) => s.settings.lastHrDeviceId);
  const pending = useSyncExternalStore(subscribePendingStart, peekPendingStart);
  // Leaving Connect any way (back, cancel, navigation) drops a queued start so a later connect cannot launch it.
  useEffect(() => () => setPendingStart(null), []);

  const prepare = useCallback(async () => {
    if (useSession.getState().connection.status === 'connected') {
      setPrep({ ok: true });
      return;
    }
    setPreparing(true);
    try {
      const r = await init();
      setPrep(r);
      if (r.ok) await startScan();
    } catch (e) {
      setPrep({ ok: false, reason: errorMessage(e) });
    } finally {
      setPreparing(false);
    }
  }, [init, startScan]);

  useEffect(() => {
    void prepare();
    return () => {
      stopScan();
      hrStop.current?.();
      hrTimer.current?.clear();
    };
  }, [prepare, stopScan, useSimulator]);

  const afterConnect = useCallback(async () => {
    stopScan();
    const p = takePendingStart();
    if (p) await launchWorkout(p, true);
    else if (router.canGoBack()) router.back();
  }, [stopScan]);

  const doConnect = async (id: string) => {
    setBusyId(id);
    try {
      await connect(id);
      await afterConnect();
    } catch (e) {
      dialog('Could not connect', `${errorMessage(e)}\n\nMake sure the PM5 is awake and showing the Connect screen.`);
    } finally {
      setBusyId(null);
    }
  };

  const toggleSimulator = async (v: boolean) => {
    if (connection.status === 'connected') {
      try {
        await disconnect();
      } catch {
        /* switching source anyway */
      }
    }
    stopScan();
    update({ useSimulator: v });
  };

  const scanHr = async () => {
    hrStop.current?.();
    hrTimer.current?.clear();
    setHrDevices([]);
    setHrScanning(true);
    try {
      hrStop.current = await scanHeartRate((d) =>
        setHrDevices((list) => (list.some((x) => x.id === d.id) ? list.map((x) => (x.id === d.id ? d : x)) : [...list, d])),
      );
      hrTimer.current = createScanTimer(15000, () => {
        hrStop.current?.();
        hrStop.current = null;
        setHrScanning(false);
      });
      hrTimer.current.start();
    } catch (e) {
      setHrScanning(false);
      dialog('Heart-rate scan failed', errorMessage(e));
    }
  };

  const connectHr = async (id: string) => {
    setBusyId(id);
    hrStop.current?.();
    hrStop.current = null;
    hrTimer.current?.clear();
    setHrScanning(false);
    try {
      await connectHeartRate(id);
      update({ lastHrDeviceId: id });
    } catch (e) {
      dialog('Could not connect strap', errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const forgetStrap = async () => {
    try {
      if (hrConnected) await disconnectHeartRate();
    } catch {
      /* forgetting anyway */
    }
    update({ lastHrDeviceId: null });
  };

  const connected = connection.status === 'connected';
  const scanning = connection.status === 'scanning';
  const dev = connection.device;

  return (
    <>
      <Stack.Screen options={{ title: 'Connect' }} />
      <Screen edges={['left', 'right', 'bottom']}>
        {pending ? (
          <Card style={{ borderColor: t.accent }}>
            <Text weight="700">Connect an erg to start your workout</Text>
            <Text size="sm" tone="dim">
              It will begin as soon as the monitor is connected.
            </Text>
            <Button
              title="Cancel start"
              small
              variant="ghost"
              style={{ minHeight: 44, alignSelf: 'flex-start' }}
              onPress={() => {
                setPendingStart(null);
                router.back();
              }}
            />
          </Card>
        ) : null}

        <Card>
          <Row
            label="Use simulator (no erg needed)"
            hint="A built-in virtual PM5 that rows by itself — great for trying the app."
            right={<Toggle value={useSimulator} onChange={(v) => void toggleSimulator(v)} />}
          />
        </Card>

        {connected && dev ? (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Ionicons name="checkmark-circle" size={24} color={t.good} />
              <Text size="lg" weight="700" style={{ flex: 1 }}>
                {dev.name}
              </Text>
              {dev.simulated ? <Badge label="SIMULATOR" color={t.warn} /> : null}
            </View>
            <Text size="sm" tone="dim">
              {[dev.serialNumber && `Serial ${dev.serialNumber}`, dev.firmwareRevision && `Firmware ${dev.firmwareRevision}`, dev.machineType]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            <Button title="Disconnect" variant="secondary" onPress={() => disconnect().catch((e) => dialog('Disconnect failed', errorMessage(e)))} />
            {pending ? <Button title="Start workout" onPress={() => void afterConnect()} /> : null}
          </Card>
        ) : null}

        <SectionTitle right={scanning || preparing ? <ActivityIndicator color={t.accent} /> : null}>
          {useSimulator ? 'Simulated ergs' : 'Nearby ergs'}
        </SectionTitle>

        {prep && !prep.ok ? (
          <Card style={{ borderColor: t.bad }}>
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
              <Ionicons name="bluetooth" size={22} color={t.bad} />
              <Text weight="700" style={{ flex: 1 }}>
                Bluetooth is not available
              </Text>
            </View>
            <Text tone="dim">{prep.reason ?? 'Bluetooth permission was denied or the adapter is off.'}</Text>
            <Text size="sm" tone="faint">
              Turn Bluetooth on and allow OpenErg to use “Nearby devices” (Android) or Bluetooth (iOS) in system settings. Or switch on the simulator above.
            </Text>
            <Button title="Retry" onPress={() => void prepare()} loading={preparing} />
          </Card>
        ) : null}

        {connection.status === 'error' && connection.error ? (
          <Text tone="bad" size="sm">
            {connection.error}
          </Text>
        ) : null}

        {prep?.ok && !connected ? (
          <>
            {discovered.length === 0 ? (
              <EmptyState
                title={scanning ? 'Looking for your PM5…' : 'No ergs found'}
                detail={useSimulator ? 'The simulator should appear in a moment.' : 'Wake the monitor and open Connect on it.'}
              />
            ) : (
              discovered.map((d) => (
                <DeviceRow
                  key={d.id}
                  name={d.name}
                  rssi={d.rssi}
                  detail={d.simulated ? 'Simulator' : undefined}
                  busy={busyId === d.id || (connection.status === 'connecting' && busyId === d.id)}
                  onPress={() => void doConnect(d.id)}
                />
              ))
            )}
            <Button title={scanning ? 'Stop scanning' : 'Scan again'} variant="secondary" onPress={() => (scanning ? stopScan() : void startScan())} />
          </>
        ) : null}

        <Divider />
        <SectionTitle>Heart-rate strap</SectionTitle>
        <Card>
          <Row
            label={hrConnected ? `Strap connected${strapBpm ? ` · ${strapBpm} bpm` : ''}` : 'No strap connected'}
            hint={`${hrConnected && strapBattery !== null ? `Battery ${strapBattery}%. ` : ''}Optional. A Bluetooth chest strap or armband (standard heart-rate profile). Overrides the HR the PM5 reports.`}
            right={<Ionicons name="heart" size={22} color={hrConnected ? t.heart : t.textFaint} />}
          />
          {hrConnected ? (
            <>
              <Button title="Disconnect strap" variant="secondary" onPress={() => disconnectHeartRate().catch((e) => dialog('Disconnect failed', errorMessage(e)))} />
              <Button title="Forget strap" variant="ghost" onPress={() => void forgetStrap()} />
            </>
          ) : (
            <>
              {hrDevices.map((d) => (
                <DeviceRow key={d.id} name={d.name || 'Heart-rate monitor'} rssi={d.rssi} busy={busyId === d.id} onPress={() => void connectHr(d.id)} />
              ))}
              {hrScanning && hrDevices.length === 0 ? (
                <Text tone="faint" size="sm">
                  Searching… wear the strap so it wakes up.
                </Text>
              ) : null}
              {lastHrId ? <Button title="Forget saved strap" variant="ghost" onPress={() => void forgetStrap()} /> : null}
              <Button title={hrScanning ? 'Scanning…' : 'Scan for straps'} variant="secondary" loading={hrScanning} onPress={() => void scanHr()} />
            </>
          )}
        </Card>

        <SectionTitle>How to pair</SectionTitle>
        <Card>
          {[
            'Press any button on the PM5 to wake it.',
            'On the main menu tap Connect — the screen shows the Bluetooth icon.',
            'Pick your PM5 above. The app connects directly; no pairing in phone settings is needed.',
            'Keep the monitor awake (it sleeps after a few idle minutes) and stay within a few metres.',
          ].map((s, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Text weight="700" tone="accent">
                {i + 1}.
              </Text>
              <Text tone="dim" style={{ flex: 1 }}>
                {s}
              </Text>
            </View>
          ))}
        </Card>
      </Screen>
    </>
  );
}
