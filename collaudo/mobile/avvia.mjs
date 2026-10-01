/**
 * Avvia l'emulatore Android con Appium per l'area MOB del collaudo e aspetta che sia pronto.
 *
 *   npm run collaudo:mobile          avvia (o riprende) l'emulatore
 *   npm run collaudo:mobile -- stop  lo ferma
 *
 * Gira nel Docker Engine della distro WSL (WSL_DISTRO, di default Ubuntu-24.04), non in
 * Docker Desktop: l'emulatore vuole /dev/kvm. Al primo avvio scarica l'immagine (circa 10 GB)
 * e l'app di prova WikipediaSample.apk in collaudo/mobile/apps/.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DISTRO = process.env.WSL_DISTRO ?? 'Ubuntu-24.04';
const APPIUM = process.env.APPIUM_URL ?? 'http://localhost:4723';
const APK = 'WikipediaSample.apk';
const APK_URL = 'https://www.browserstack.com/app-automate/sample-apps/android/WikipediaSample.apk';

const wsl = (script, options = {}) =>
  spawnSync('wsl', ['-d', DISTRO, '-u', 'root', '--', 'bash', '-c', script], { encoding: 'utf8', ...options });

// C:\a\b -> /mnt/c/a/b
const toWsl = (p) => resolve(p).replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replaceAll('\\', '/');
const compose = (args) => `cd '${toWsl(HERE)}' && docker compose -f docker-compose.mobile.yml ${args}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEEPALIVE = join(HERE, '.keepalive.pid');

/**
 * WSL spegne la distro quando nessun processo `wsl.exe` è aperto, e con lei il Docker Engine
 * e l'emulatore. Un `sleep infinity` staccato la tiene accesa finché non si chiude la sessione
 * Windows o si lancia `stop`.
 */
function keepAlive() {
  try {
    process.kill(Number(readFileSync(KEEPALIVE, 'utf8')), 0);
    return;
  } catch {
    // Non c'è: se ne avvia uno.
  }
  const child = spawn('wsl', ['-d', DISTRO, '--exec', 'sleep', 'infinity'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  writeFileSync(KEEPALIVE, String(child.pid));
}

if (process.argv[2] === 'stop') {
  console.log(wsl(compose('down -v')).stderr);
  try {
    process.kill(Number(readFileSync(KEEPALIVE, 'utf8')));
    rmSync(KEEPALIVE);
  } catch {
    // Già chiuso.
  }
  process.exit(0);
}

keepAlive();

const kvm = wsl('test -c /dev/kvm && echo ok');
if (!kvm.stdout.includes('ok')) {
  console.error(`/dev/kvm non c'è nella distro ${DISTRO}: senza virtualizzazione l'emulatore non parte.`);
  process.exit(1);
}
if (wsl('docker info >/dev/null 2>&1 && echo ok').stdout.trim() !== 'ok') {
  console.log(`Avvio il Docker Engine di ${DISTRO}…`);
  wsl('systemctl start docker');
}

if (!existsSync(join(HERE, 'apps', APK))) {
  mkdirSync(join(HERE, 'apps'), { recursive: true });
  console.log(`Scarico ${APK}…`);
  const res = await fetch(APK_URL);
  if (!res.ok) throw new Error(`${APK_URL}: HTTP ${res.status}`);
  writeFileSync(join(HERE, 'apps', APK), Buffer.from(await res.arrayBuffer()));
}

// Un container rimasto da un avvio interrotto non riparte (vedi docker-compose.mobile.yml): da capo.
const bootedNow = () => wsl('docker exec -u androidusr wfm-android adb shell getprop sys.boot_completed 2>/dev/null').stdout?.trim() === '1';
if (wsl("docker ps -aq --filter name=wfm-android").stdout.trim() && !bootedNow()) {
  console.log("Il container dell'emulatore c'è ma Android non è avviato: lo ricreo.");
  wsl(compose('down -v'));
}

console.log("Avvio il container dell'emulatore (il primo avvio scarica l'immagine)…");
const up = spawnSync('wsl', ['-d', DISTRO, '-u', 'root', '--', 'bash', '-c', compose('up -d -V')], { stdio: 'inherit' });
if (up.status !== 0) process.exit(up.status ?? 1);

console.log("Aspetto che Android sia avviato e che Appium risponda (3-6 minuti)…");
const deadline = Date.now() + 15 * 60_000;
let booted = false;
let appium = false;
while (Date.now() < deadline && !(booted && appium)) {
  if (!booted) {
    booted = bootedNow();
  }
  if (!appium) {
    try {
      const res = await fetch(`${APPIUM}/status`, { signal: AbortSignal.timeout(4000) });
      appium = res.ok;
    } catch {
      appium = false;
    }
  }
  if (!(booted && appium)) await sleep(10_000);
}
if (!(booted && appium)) {
  console.error(`Non pronto: Android ${booted ? 'avviato' : 'non avviato'}, Appium ${appium ? 'risponde' : 'non risponde'}. wsl -d ${DISTRO} -- docker logs wfm-android`);
  process.exit(1);
}
console.log(`Pronto. Appium ${APPIUM}, schermo http://localhost:6081, app /apps/${APK} (percorso nel container).`);
console.log("Nel prodotto: griglia «Local Appium (agent)» con indirizzo http://host.docker.internal:4723 e il pool dell'agente.");
