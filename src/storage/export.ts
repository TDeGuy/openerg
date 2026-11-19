/** File export / share / backup / restore. */
import * as DocumentPicker from 'expo-document-picker';
import { File, FileMode, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { WorkoutRecord } from '@/core/types';
import { useIntegrations } from '@/integrations/store';
import { backupHead, backupTail, backupWorkoutLines, parseBackupStream, RESTORE_BATCH, type ParsedBackup, type UploadLedger } from './backup';
import { getAllWorkouts, getFavoritePlanIds, getWorkoutBatch, getWorkoutIds, listCustomPlans, listWorkouts, saveWorkouts, savePlan, setPlanFavorite } from './db';
import { exportFileName, toCsv, toJson, toSummaryCsv, toTcx, type ExportFormat } from './formats';
import { skipDuplicates, parseLogbookCsv, parseTcx } from './import/parse';
import { GROUPS, GROUP_LABEL, mergeLedger, mergeRestoredSettings, planRestore, type RestoreOptions } from './restore';
import { flushSettings, useSettings } from './settings';
import { zipStore } from './zip';

export { toCsv, toTcx, toJson, exportFileName, type ExportFormat } from './formats';

const MIME: Record<ExportFormat | 'zip', { mimeType: string; UTI: string }> = {
  csv: { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' },
  tcx: { mimeType: 'application/vnd.garmin.tcx+xml', UTI: 'public.xml' },
  json: { mimeType: 'application/json', UTI: 'public.json' },
  zip: { mimeType: 'application/zip', UTI: 'public.zip-archive' },
};

function webDownload(name: string, content: string | Uint8Array | string[], mimeType: string): void {
  const g = globalThis as unknown as {
    document?: { createElement(t: string): { href: string; download: string; click(): void; remove(): void }; body: { appendChild(n: unknown): void } };
    Blob?: new (parts: (string | Uint8Array)[], opts: { type: string }) => unknown;
    URL?: { createObjectURL(b: unknown): string; revokeObjectURL(u: string): void };
  };
  if (!g.document || !g.Blob || !g.URL) throw new Error('Saving files is not supported here.');
  const url = g.URL.createObjectURL(new g.Blob(Array.isArray(content) ? content : [content], { type: mimeType }));
  const a = g.document.createElement('a');
  a.href = url;
  a.download = name;
  g.document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => g.URL?.revokeObjectURL(url), 10_000);
}

async function shareText(name: string, content: string | Uint8Array, format: ExportFormat | 'zip', dialogTitle: string): Promise<void> {
  const { mimeType, UTI } = MIME[format];
  if (Platform.OS === 'web') {
    webDownload(name, content, mimeType);
    return;
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  await file.write(content);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType, UTI, dialogTitle });
}

export async function shareWorkout(record: WorkoutRecord, format: ExportFormat): Promise<void> {
  const content = format === 'csv' ? toCsv(record) : format === 'tcx' ? toTcx(record) : toJson(record);
  await shareText(exportFileName(record, format), content, format, `Export ${record.title}`);
}

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Writes the backup a batch of workouts at a time, so memory stays bounded however many workouts there are. */
export async function shareBackup(): Promise<void> {
  await useIntegrations.getState().load();
  const [plans, favoritePlanIds] = await Promise.all([listCustomPlans(), getFavoritePlanIds()]);
  const head = backupHead({
    settings: useSettings.getState().settings,
    plans: plans.map(({ favorite: _f, ...p }) => p),
    favoritePlanIds,
    uploads: useIntegrations.getState().uploads, // statuses only; API tokens never leave the phone
  });
  const name = `OpenErg_backup_${stamp()}.json`;
  const web = Platform.OS === 'web';
  const parts: string[] = [];
  const file = new File(Paths.cache, name);
  let handle: ReturnType<File['open']> | null = null;
  const enc = new TextEncoder();
  const put = async (text: string) => (web ? void parts.push(text) : handle!.writeBytes(enc.encode(text)));
  if (!web) {
    if (file.exists) file.delete();
    file.create();
    handle = file.open(FileMode.Truncate);
  }
  try {
    await put(head);
    for (let offset = 0; ; offset += RESTORE_BATCH) {
      const batch = await getWorkoutBatch(offset, RESTORE_BATCH);
      if (!batch.length) break;
      await put(backupWorkoutLines(batch, offset === 0));
    }
    await put(backupTail());
  } finally {
    handle?.close();
  }
  if (web) return webDownload(name, parts, MIME.json.mimeType);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(file.uri, { ...MIME.json, dialogTitle: 'OpenErg backup' });
}

/** One zip: summary.csv (a row per workout) plus a TCX file per workout. Returns the workout count. */
export async function shareAllWorkouts(): Promise<number> {
  const workouts = await getAllWorkouts();
  const files = [{ name: 'OpenErg_workouts.csv', text: toSummaryCsv(workouts) }];
  const used = new Set<string>();
  for (const w of workouts) {
    let name = exportFileName(w, 'tcx');
    while (used.has(name)) name = name.replace('.tcx', '_2.tcx');
    used.add(name);
    files.push({ name, text: toTcx(w) });
  }
  await shareText(`OpenErg_all_workouts_${stamp()}.zip`, zipStore(files), 'zip', 'OpenErg workouts');
  return workouts.length;
}

async function pick(multiple: boolean) {
  const result = await DocumentPicker.getDocumentAsync({ type: ['*/*'], copyToCacheDirectory: true, multiple });
  return result.canceled ? [] : result.assets ?? [];
}

async function readPicked(asset: DocumentPicker.DocumentPickerAsset): Promise<string> {
  const webFile = (asset as { file?: { text(): Promise<string> } }).file;
  if (webFile && typeof webFile.text === 'function') return webFile.text();
  try {
    return await new File(asset.uri).text();
  } catch {
    const res = await fetch(asset.uri);
    return res.text();
  }
}

async function* pickedChunks(asset: DocumentPicker.DocumentPickerAsset): AsyncGenerator<Uint8Array> {
  const webFile = (asset as { file?: { text(): Promise<string> } }).file;
  if (webFile && typeof webFile.text === 'function') {
    yield new TextEncoder().encode(await webFile.text());
    return;
  }
  let handle: ReturnType<File['open']>;
  try {
    handle = new File(asset.uri).open(FileMode.ReadOnly);
  } catch {
    yield new TextEncoder().encode(await (await fetch(asset.uri)).text());
    return;
  }
  try {
    for (;;) {
      const chunk = await handle.readBytes(256 * 1024);
      if (!chunk.length) return;
      yield chunk;
    }
  } finally {
    handle.close();
  }
}

/** Lets the user pick a backup file; null when cancelled. Throws a readable error when invalid. */
export async function pickBackup(): Promise<ParsedBackup | null> {
  const [asset] = await pick(false);
  return asset ? parseBackupStream(() => pickedChunks(asset)) : null;
}

/** Applies the chosen parts of a backup and returns a human summary. */
export async function restoreBackup(parsed: ParsedBackup, o: RestoreOptions): Promise<string> {
  const lines: string[] = [];
  const count = (label: string, r: { added: number; updated: number; unchanged: number }) =>
    lines.push(`${label}: ${r.added} added, ${r.updated} updated, ${r.unchanged} left as on this phone.`);

  const w = { added: 0, updated: 0, unchanged: 0 };
  if (o.workouts !== 'none') {
    const have = await getWorkoutIds();
    for await (const batch of parsed.batches ? parsed.batches() : [parsed.workouts]) {
      const r = planRestore(have, batch, o.workouts);
      await saveWorkouts(r.toSave);
      w.added += r.added;
      w.updated += r.updated;
      w.unchanged += r.unchanged;
    }
    count('Workouts', w);
  }

  if (o.plans !== 'none') {
    const p = planRestore((await listCustomPlans()).map((x) => x.id), parsed.plans, o.plans);
    for (const plan of p.toSave) await savePlan(plan);
    const favs = new Set(await getFavoritePlanIds());
    for (const id of parsed.favoritePlanIds) if (!favs.has(id)) await setPlanFavorite(id, true);
    count('Custom workouts', p);
  }

  const chosen = GROUPS.filter((g) => o.groups[g] && (parsed.settings || (g === 'services' && Object.keys(parsed.uploads).length)));
  if (parsed.settings && chosen.length) {
    useSettings.getState().update(mergeRestoredSettings(useSettings.getState().settings, parsed.settings, o.groups));
    await flushSettings();
  }
  if (o.groups.services && Object.keys(parsed.uploads).length) {
    const store = useIntegrations.getState();
    await store.load();
    store.patch({ uploads: mergeLedger(store.uploads as UploadLedger, parsed.uploads) as typeof store.uploads });
  }
  lines.push(chosen.length ? `Restored: ${chosen.map((g) => GROUP_LABEL[g]).join(', ')}.` : 'No settings were restored.');
  const kept = GROUPS.filter((g) => !chosen.includes(g));
  if (parsed.settings && kept.length) lines.push(`Kept from this phone: ${kept.map((g) => GROUP_LABEL[g]).join(', ')}.`);
  if (parsed.skipped) lines.push(`${parsed.skipped} unreadable entries were skipped.`);
  return lines.join('\n');
}

/** Imports TCX files and Concept2 Logbook CSV exports. Returns a human summary. */
export async function importWorkoutFiles(): Promise<string | null> {
  const assets = await pick(true);
  if (!assets.length) return null;
  const incoming: WorkoutRecord[] = [];
  const failed: string[] = [];
  for (const a of assets) {
    try {
      const text = await readPicked(a);
      incoming.push(...(/<TrainingCenterDatabase/.test(text) ? parseTcx(text) : parseLogbookCsv(text)));
    } catch (e) {
      failed.push(`${a.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  const { fresh, duplicates } = skipDuplicates(await listWorkouts(), incoming);
  await saveWorkouts(fresh);
  return [`Imported ${fresh.length} workout${fresh.length === 1 ? '' : 's'}, skipped ${duplicates} duplicate${duplicates === 1 ? '' : 's'}.`, ...failed].join('\n');
}
