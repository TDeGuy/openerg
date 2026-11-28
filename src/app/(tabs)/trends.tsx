import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { computePersonalRecords, statsPool, trends } from '@/analysis';
import {
  STANDARD_EVENTS,
  bestSoFar,
  eventLabel,
  formatDate,
  formatShortDate,
  progression,
  seasonStart,
  streaks,
  totals,
} from '@/components/analysis/helpers';
import { StatGrid, Table } from '@/components/analysis/ui';
import { BarChart, LineChart, type LineSeries } from '@/components/charts';
import type { MachineType, PersonalRecord, WorkoutListItem } from '@/core/types';
import { formatDistance, formatDuration, formatPace, paceUnit } from '@/core/units';
import { listWorkouts, useDbVersion } from '@/storage/db';
import { Button, Card, EmptyState, Screen, SectionTitle, Segmented, Text } from '@/ui/kit';
import { spacing, useTheme } from '@/ui/theme';

const km = (m: number) => (m >= 100000 ? `${Math.round(m / 1000)}k` : m >= 1000 ? `${(m / 1000).toFixed(1)}k` : `${Math.round(m)}`);

export default function TrendsScreen() {
  const t = useTheme();
  const version = useDbVersion();
  const [items, setItems] = useState<WorkoutListItem[] | null>(null);
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [machine, setMachine] = useState<MachineType>('rower');
  const [event, setEvent] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listWorkouts()
      .then((l) => alive && setItems(l))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [version]);

  // Simulator rows and other machines never count in any stat.
  const all = useMemo(() => statsPool(items ?? [], machine), [items, machine]);
  const fmtPace = useCallback((v: number) => formatPace(v, machine), [machine]);
  const paceTick = useCallback((v: number) => fmtPace(v).replace(/\.\d$/, ''), [fmtPace]);
  const points = useMemo(() => trends(all, period).sort((a, b) => a.periodStart - b.periodStart).slice(-12), [all, period]);
  const records = useMemo(() => computePersonalRecords(all, machine), [all, machine]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [items]);
  const life = useMemo(() => totals(all), [all]);
  const season = useMemo(() => totals(all, seasonStart(now)), [all, now]);
  const streak = useMemo(() => streaks(all, now), [all, now]);

  const metresBars = useMemo(
    () => points.map((p) => ({ label: formatShortDate(p.periodStart, period), value: p.metres, color: t.accent })),
    [points, period, t.accent],
  );
  const timeBars = useMemo(
    () => points.map((p) => ({ label: formatShortDate(p.periodStart, period), value: p.durationMs / 60000, color: t.rate })),
    [points, period, t.rate],
  );
  const perfSeries = useMemo<LineSeries[]>(() => {
    // Watts are a fixed function of pace (2.80 / pace³), so a second line would only repeat this one.
    const active = points.filter((p) => p.sessions > 0 && p.avgPaceMsPer500 > 0);
    return [{ key: 'pace', label: 'Avg pace', points: active.map((p) => ({ x: p.periodStart, y: p.avgPaceMsPer500 })), color: t.pace, format: fmtPace }];
  }, [points, t, fmtPace]);

  const eventsWithData = useMemo(() => STANDARD_EVENTS.filter((e) => progression(all, e).length > 0), [all]);
  const activeEvent = event && eventsWithData.includes(event) ? event : (eventsWithData.find((e) => e === '2000m') ?? eventsWithData[0] ?? null);
  const prog = useMemo(() => (activeEvent ? progression(all, activeEvent) : []), [all, activeEvent]);
  const progSeries = useMemo<LineSeries[]>(
    () => [
      { key: 'p', label: 'Pace', points: prog, color: t.pace, format: fmtPace },
      { key: 'b', label: 'Best so far', points: bestSoFar(prog), color: t.good, step: true, dashed: true, format: fmtPace },
    ],
    [prog, t, fmtPace],
  );

  if (items === null) {
    return (
      <Screen scroll={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={t.accent} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text size="xxl" weight="700">
        Trends
      </Text>
      <Segmented
        value={machine}
        onChange={setMachine}
        options={[
          { value: 'rower', label: 'Row' },
          { value: 'skierg', label: 'Ski' },
          { value: 'bikeerg', label: 'Bike' },
        ]}
      />
      {all.length === 0 ? (
        <EmptyState
          title="No training yet"
          detail="Simulator sessions are not counted. Your weekly volume, progress and personal records appear here once you have rowed a few pieces."
          action={<Button title="Go to Row" onPress={() => router.navigate('/')} />}
        />
      ) : (
        <>
          <Card>
            <SectionTitle>Totals</SectionTitle>
            <StatGrid
              items={[
                { label: 'Lifetime', value: formatDistance(life.metres) },
                { label: 'Time', value: formatDuration(life.durationMs, { tenths: false }) },
                { label: 'Sessions', value: String(life.sessions) },
                { label: 'This season', value: formatDistance(season.metres), tone: 'accent' },
                { label: 'Season time', value: formatDuration(season.durationMs, { tenths: false }) },
                { label: 'Season sessions', value: String(season.sessions) },
                { label: 'Streak', value: `${streak.current}`, unit: streak.current === 1 ? 'day' : 'days', tone: streak.current > 0 ? 'good' : 'default' },
                { label: 'Longest streak', value: `${streak.longest}`, unit: 'days' },
                { label: 'Calories', value: life.calories.toFixed(0), unit: 'kcal' },
              ]}
            />
            <Text size="xs" tone="faint">
              Season runs 1 May – 30 April, like the Concept2 logbook.
            </Text>
          </Card>

          <Segmented
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'week', label: 'Weekly' },
              { value: 'month', label: 'Monthly' },
            ]}
          />
          <Card>
            <SectionTitle>Metres</SectionTitle>
            <BarChart bars={metresBars} format={km} />
          </Card>
          <Card>
            <SectionTitle>Time (minutes)</SectionTitle>
            <BarChart bars={timeBars} format={(v) => v.toFixed(0)} />
          </Card>
          <Card>
            <SectionTitle>Average pace</SectionTitle>
            {perfSeries[0].points.length > 1 ? (
              <LineChart
                series={perfSeries}
                left={{ invert: true, format: paceTick }}
                xFormat={(x) => formatShortDate(x, period)}
                height={180}
              />
            ) : (
              <Text tone="dim">Row in at least two different {period}s to see a trend.</Text>
            )}
          </Card>

          <Card>
            <SectionTitle>Personal records</SectionTitle>
            {records.length === 0 ? (
              <Text tone="dim">Complete a standard distance (e.g. 2000m) or time (e.g. 30:00) to set a record.</Text>
            ) : (
              <Table<PersonalRecord>
                rows={records}
                onPressRow={(r) => router.push(`/workout/${encodeURIComponent(r.workoutId)}`)}
                columns={[
                  { title: 'Event', flex: 1.1, align: 'left', render: (r) => eventLabel(r.event) },
                  { title: 'Result', flex: 1.2, render: (r) => (r.eventType === 'distance' ? formatDuration(r.result) : formatDistance(r.result)), tone: () => 'accent' },
                  { title: `Pace ${paceUnit(machine)}`, render: (r) => fmtPace(r.paceMsPer500) },
                  { title: 'W', flex: 0.6, render: (r) => r.watts.toFixed(0) },
                  { title: 'Date', flex: 1.1, render: (r) => formatShortDate(r.achievedAt) + `/${String(new Date(r.achievedAt).getFullYear()).slice(2)}` },
                ]}
              />
            )}
          </Card>

          <Card>
            <SectionTitle>Progression</SectionTitle>
            {activeEvent ? (
              <>
                <Segmented value={activeEvent} onChange={setEvent} options={eventsWithData.map((e) => ({ value: e, label: eventLabel(e) }))} />
                {prog.length > 1 ? (
                  <LineChart series={progSeries} left={{ invert: true, format: paceTick }} xFormat={(x) => formatShortDate(x, 'day')} height={180} />
                ) : (
                  <Text tone="dim">
                    One {eventLabel(activeEvent)} so far ({formatDate(prog[0].x, false)}, {fmtPace(prog[0].y)}). Row it again to see your progression.
                  </Text>
                )}
              </>
            ) : (
              <Text tone="dim">Row a standard event (500m, 2k, 5k, 30:00 …) to track your progression.</Text>
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}
