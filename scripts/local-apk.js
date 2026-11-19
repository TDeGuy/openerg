// Builds a signed 64-bit release APK on this PC (no Expo servers). Run: build-apk.cmd (or `node scripts/local-apk.js`).
// Needs: Android Studio (for its Java), the Android SDK, and credentials.json + its keystore downloaded with
// `npx.cmd eas-cli credentials -p android` (kept out of git). Output: dist/openerg-<version>-build<code>.apk
//
// The native build runs in a mirror at C:\OpenErgBuild\app: Android's C++ tools (ninja) fail on Windows paths over
// 260 characters and nest the project path inside their build folders, so the project needs a very short real path.
// (A subst drive or junction does not work: some tools resolve it to the real path and refuse the mix.)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const work = process.env.OPENERG_BUILD_DIR || 'C:\\OpenErgBuild\\app';
const sdk = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const javaHome = process.env.JAVA_HOME || 'C:\\Program Files\\Android\\Android Studio\\jbr';
const env = { ...process.env, ANDROID_HOME: sdk, JAVA_HOME: javaHome, PATH: `${path.join(javaHome, 'bin')};${process.env.PATH}` };
const run = (cmd, args, cwd, extra = {}) => execFileSync(cmd, args, { cwd, env: { ...env, ...extra }, stdio: 'inherit', shell: process.platform === 'win32' });

const credsFile = path.join(root, 'credentials.json');
if (!fs.existsSync(credsFile)) throw new Error('credentials.json missing: run `npx.cmd eas-cli credentials -p android` and download it first.');
const ks = JSON.parse(fs.readFileSync(credsFile, 'utf8')).android.keystore;

// Android refuses to install a lower build number over a higher one, so every local build gets the next one.
const appFile = path.join(root, 'app.json');
const appText = fs.readFileSync(appFile, 'utf8');
const app = JSON.parse(appText);
const code = (app.expo.android.versionCode ?? 2) + 1;
app.expo.android.versionCode = code;
fs.writeFileSync(appFile, JSON.stringify(app, null, 2) + '\n');
const version = app.expo.version;
console.log(`\nBuilding OpenErg ${version} (build ${code}) in ${work}...\n`);

try {
  // Mirror the project (not its packages, native folder, builds, git or signing key) into the short build folder.
  fs.mkdirSync(work, { recursive: true });
  const lock = (dir) => (fs.existsSync(path.join(dir, 'package-lock.json')) ? fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8') : '');
  const depsChanged = lock(root) !== lock(work) || !fs.existsSync(path.join(work, 'node_modules'));
  try {
    execFileSync('robocopy', [root, work, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XD', 'node_modules', 'android', 'dist', '.git', 'credentials', '.expo', '/XF', 'credentials.json'], { stdio: 'inherit' });
  } catch (e) {
    if (e.status >= 8) throw e; // robocopy: 0-7 mean success
  }
  if (depsChanged) run('npm', ['ci', '--no-audit', '--no-fund'], work);

  run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install'], work);
  const androidDir = path.join(work, 'android');
  run(`"${path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')}"`, ['assembleRelease', '-PreactNativeArchitectures=arm64-v8a'], androidDir);
} catch (e) {
  fs.writeFileSync(appFile, appText); // failed build: keep the build number for the next attempt
  throw e;
}

const built = path.join(work, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `openerg-${version}-build${code}.apk`);
const tools = path.join(sdk, 'build-tools');
const latest = fs.readdirSync(tools).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
const apksigner = `"${path.join(tools, latest, 'apksigner.bat')}"`;
// Passwords go through environment variables, never the command line.
run(apksigner, [
  'sign', '--ks', `"${path.join(root, ks.keystorePath)}"`, '--ks-key-alias', ks.keyAlias,
  '--ks-pass', 'env:OPENERG_KS_PASS', '--key-pass', 'env:OPENERG_KEY_PASS', '--out', `"${out}"`, `"${built}"`,
], root, { OPENERG_KS_PASS: ks.keystorePassword, OPENERG_KEY_PASS: ks.keyPassword });
run(apksigner, ['verify', `"${out}"`], root);
console.log(`\nDone: ${out}\n`);
