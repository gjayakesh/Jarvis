// JARVIS background host.
//
// Runs with the Node.js already installed on this PC (no native modules, so it
// works with Windows Smart App Control on). It:
//   - serves the built UI (apps/desktop/dist) on 127.0.0.1 only,
//   - opens it as a Chrome app window with its own profile, so the microphone
//     permission and voice data stay separate from normal browsing,
//   - keeps JARVIS listening while the window is hidden,
//   - shows / hides that window when the page asks (wake phrase, close command),
//   - reopens the window hidden if it is closed, until you choose Quit.
//
// Usage: node jarvis-host.mjs [--background]
//   --background  start with the window hidden (used at Windows sign-in)

import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync, rmSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = 47811;
const ORIGIN = `http://${HOST}:${PORT}`;
const here = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(here, '..', 'dist');
const DATA = join(process.env.LOCALAPPDATA ?? here, 'JARVIS');
const PROFILE = join(DATA, 'chrome-profile');
const STATE_FILE = join(DATA, 'host.json');
const LOG_FILE = join(DATA, 'host.log');
const background = process.argv.includes('--background');

mkdirSync(DATA, { recursive: true });

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > 1_000_000) rmSync(LOG_FILE);
    appendFileSync(LOG_FILE, line);
  } catch {
    /* logging must never stop the host */
  }
}

// ---------------------------------------------------------------------------
// Single instance: if a host is already running, ask it to show the window.

async function postToRunningHost(path) {
  try {
    const { token } = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    return await new Promise((done) => {
      const req = request(
        { host: HOST, port: PORT, path, method: 'POST', headers: { 'x-jarvis-token': token, 'content-type': 'application/json' }, timeout: 3000 },
        (res) => {
          res.resume();
          done(res.statusCode === 200);
        },
      );
      req.on('error', () => done(false));
      req.on('timeout', () => {
        req.destroy();
        done(false);
      });
      req.end('{}');
    });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Chrome app window

function findChrome() {
  const candidates = [
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

const CHROME = findChrome();
let chromeProc = null;
let quitting = false;
let restarts = [];
let wantHiddenOnLoad = background;

/**
 * First run only: JARVIS's own Chrome profile allows the microphone for the
 * JARVIS page (and nothing else), so it can listen from sign-in without a
 * prompt in a hidden window. The user's normal Chrome profile is untouched.
 */
function seedProfile() {
  const prefs = join(PROFILE, 'Default', 'Preferences');
  if (existsSync(prefs)) return;
  mkdirSync(dirname(prefs), { recursive: true });
  const site = `${ORIGIN},*`;
  writeFileSync(
    prefs,
    JSON.stringify({
      profile: { content_settings: { exceptions: { media_stream_mic: { [site]: { setting: 1 } }, notifications: { [site]: { setting: 1 } } } } },
      browser: { has_seen_welcome_page: true },
    }),
  );
  log('seeded JARVIS profile: microphone and notifications allowed for the JARVIS page only');
}

function launchChrome() {
  if (!CHROME) {
    log('Chrome not found');
    return;
  }
  const args = [
    `--app=${ORIGIN}/#/home`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required',
    // Lighter on an 8 GB PC: no separate GPU process (JARVIS is hidden most of the time).
    '--disable-gpu',
    '--renderer-process-limit=1',
    '--disable-extensions',
    '--disable-component-update',
    '--disable-default-apps',
    '--window-size=1320,860',
  ];
  chromeProc = spawn(CHROME, args, { detached: false, stdio: 'ignore', windowsHide: false });
  log(`chrome started pid=${chromeProc.pid}${wantHiddenOnLoad ? ' (will hide when ready)' : ''}`);
  chromeProc.on('exit', (code) => {
    log(`chrome exited code=${code}`);
    chromeProc = null;
    if (quitting) return;
    // Closing the window with X keeps JARVIS running in the background.
    const now = Date.now();
    restarts = restarts.filter((t) => now - t < 10 * 60_000);
    if (restarts.length >= 5) {
      log('chrome keeps exiting; giving up until the next sign-in');
      shutdown(1);
      return;
    }
    restarts.push(now);
    wantHiddenOnLoad = true;
    setTimeout(launchChrome, 1500);
  });
}

// ---------------------------------------------------------------------------
// Window agent (PowerShell, kept running so show/hide is instant)

let agent = null;
let agentReady = false;
let nextId = 1;
const pending = new Map(); // request id -> resolve
let readyWaiters = [];

function startAgent() {
  agent = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'window-agent.ps1'), '-ProfileDir', PROFILE],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  let buffer = '';
  agent.stdout.setEncoding('utf8');
  agent.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line === 'ready') {
        agentReady = true;
        log('window agent ready');
        readyWaiters.splice(0).forEach((wake) => wake());
        continue;
      }
      // Replies carry the request id, so a late reply can never answer the wrong request.
      const space = line.indexOf(' ');
      const id = Number(line.slice(0, space));
      const done = pending.get(id);
      if (done) {
        pending.delete(id);
        done(line.slice(space + 1));
      }
    }
  });
  agent.stderr.on('data', (d) => log(`agent stderr: ${String(d).trim()}`));
  agent.on('exit', (code) => {
    log(`window agent exited code=${code}`);
    pending.forEach((done) => done('err:agent-exited'));
    pending.clear();
    agent = null;
    agentReady = false;
    if (!quitting) setTimeout(startAgent, 1000);
  });
}

/** Wait (up to 30 s) for the agent to finish starting; it is slow right after sign-in. */
function agentStarted() {
  if (agentReady) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 30_000);
    readyWaiters.push(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function windowCommand(cmd) {
  if (!(await agentStarted()) || !agent) return 'err:agent-not-ready';
  return new Promise((done) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      done('err:timeout');
    }, 8000);
    pending.set(id, (result) => {
      clearTimeout(timer);
      done(result);
    });
    agent.stdin.write(`${id} ${cmd}\n`);
  });
}

// ---------------------------------------------------------------------------
// HTTP: static UI + a few authenticated control endpoints

const TOKEN = randomBytes(24).toString('hex');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};
let lastBeat = null;
let lastHeardLogged = '';

function tokenOk(req) {
  const given = Buffer.from(String(req.headers['x-jarvis-token'] ?? ''));
  const want = Buffer.from(TOKEN);
  return given.length === want.length && timingSafeEqual(given, want);
}

// ---------------------------------------------------------------------------
// Diagnostic agent (apps/agent, Python FastAPI): read-only PC evidence, rules and
// the evidence-grounded assistant. Loopback only, with its own per-launch token.

const AGENT_DIR = resolve(here, '..', '..', 'agent');
const AGENT_PY = join(AGENT_DIR, '.venv', 'Scripts', 'python.exe');
const AGENT_PORT = 47812;
const AGENT_TOKEN = randomBytes(24).toString('hex');
let diag = null;
let diagRestarts = [];
let diagState = 'starting';

function startDiagAgent() {
  if (!existsSync(AGENT_PY)) {
    diagState = 'not-installed';
    log('diagnostic agent not installed (run apps\\agent\\setup-agent.ps1)');
    return;
  }
  diag = spawn(AGENT_PY, ['-m', 'jarvis'], {
    cwd: AGENT_DIR,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
    env: { ...process.env, JARVIS_AGENT_TOKEN: AGENT_TOKEN, JARVIS_AGENT_PORT: String(AGENT_PORT), JARVIS_HOST_PID: String(process.pid), PYTHONUTF8: '1' },
  });
  diagState = 'starting';
  log(`diagnostic agent started pid=${diag.pid}`);
  diag.stderr.setEncoding('utf8');
  diag.stderr.on('data', (d) => log(`diag: ${String(d).trim().slice(0, 300)}`));
  diag.on('exit', (code) => {
    log(`diagnostic agent exited code=${code}`);
    diag = null;
    diagState = 'offline';
    if (quitting) return;
    const now = Date.now();
    diagRestarts = diagRestarts.filter((t) => now - t < 10 * 60_000);
    if (diagRestarts.length >= 5) {
      log('diagnostic agent keeps exiting; not restarting until JARVIS restarts');
      return;
    }
    diagRestarts.push(now);
    setTimeout(startDiagAgent, 2000 * diagRestarts.length);
  });
}

function proxyToAgent(req, res, url) {
  if (diagState === 'not-installed') return send(res, 503, { code: 'COLLECTOR_UNAVAILABLE', message: 'The JARVIS agent is not installed' });
  if (!diag) return send(res, 503, { code: 'COLLECTOR_UNAVAILABLE', message: 'The JARVIS agent is not running' });
  const headers = { authorization: `Bearer ${AGENT_TOKEN}`, host: `127.0.0.1:${AGENT_PORT}` };
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.headers['x-request-id']) headers['x-request-id'] = String(req.headers['x-request-id']).slice(0, 64);
  const upstream = request(
    { host: '127.0.0.1', port: AGENT_PORT, path: url.pathname + url.search, method: req.method, headers, timeout: 150_000 },
    (agentRes) => {
      diagState = 'online';
      res.writeHead(agentRes.statusCode ?? 502, {
        'content-type': agentRes.headers['content-type'] ?? 'application/json',
        'cache-control': 'no-store',
        'x-request-id': agentRes.headers['x-request-id'] ?? '',
      });
      agentRes.pipe(res);
    },
  );
  upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
  upstream.on('error', () => {
    if (!res.headersSent) send(res, 503, { code: 'COLLECTOR_UNAVAILABLE', message: 'The JARVIS agent is starting or not responding' });
  });
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > 64_000) upstream.destroy(new Error('too large'));
  });
  req.pipe(upstream);
}

// ---------------------------------------------------------------------------
// Voice requests like "open notepad" or "search for ...". Only this fixed list
// of Windows programs can be started, and only https web pages opened (in the
// user's default browser, not JARVIS's own profile). Nothing else is run.

const WINDIR = process.env.SystemRoot ?? 'C:\\Windows';
const APPS = {
  notepad: [join(WINDIR, 'System32', 'notepad.exe')],
  calculator: [join(WINDIR, 'System32', 'calc.exe')],
  explorer: [join(WINDIR, 'explorer.exe')],
  settings: [join(WINDIR, 'explorer.exe'), 'ms-settings:'],
  // Through the shell, which handles Task Manager's elevation the normal Windows way.
  'task-manager': [join(WINDIR, 'explorer.exe'), join(WINDIR, 'System32', 'Taskmgr.exe')],
  paint: [join(WINDIR, 'System32', 'mspaint.exe')],
};

function openFor(body) {
  let argv;
  if (typeof body.app === 'string' && Object.hasOwn(APPS, body.app)) {
    argv = APPS[body.app];
  } else if (typeof body.url === 'string' && body.url.length <= 600) {
    let url;
    try {
      url = new URL(body.url);
    } catch {
      return 'bad url';
    }
    if (url.protocol !== 'https:' || url.username || url.password) return 'bad url';
    argv = [join(WINDIR, 'explorer.exe'), url.href];
  } else {
    return 'not allowed';
  }
  try {
    const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', (e) => log(`open failed: ${e.message}`));
    child.unref();
    return 'ok';
  } catch (e) {
    return `failed: ${e.message}`;
  }
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error('too large');
  }
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  try {
    // Only this machine, and only our own origin, may talk to the host.
    if (req.headers.host !== `${HOST}:${PORT}`) return send(res, 421, { error: 'wrong host' });
    const url = new URL(req.url ?? '/', ORIGIN);

    if (url.pathname.startsWith('/api/v1/')) {
      // The page talks to the diagnostic agent through the host: same token and origin
      // checks as /host, and the agent's own token never reaches the page.
      const origin = req.headers.origin;
      if (origin && origin !== ORIGIN) return send(res, 403, { error: 'origin' });
      if (!tokenOk(req)) return send(res, 401, { code: 'AUTH_REQUIRED', message: 'token' });
      return proxyToAgent(req, res, url);
    }

    if (url.pathname.startsWith('/host/')) {
      if (req.method !== 'POST') return send(res, 405, { error: 'method' });
      const origin = req.headers.origin;
      if (origin && origin !== ORIGIN) return send(res, 403, { error: 'origin' });
      if (!tokenOk(req)) return send(res, 401, { error: 'token' });
      const body = await readJson(req);
      switch (url.pathname) {
        case '/host/show': {
          const result = await windowCommand('show');
          log(`show -> ${result}`);
          return send(res, result.startsWith('ok') ? 200 : 500, { result });
        }
        case '/host/hide': {
          const result = await windowCommand('hide');
          log(`hide -> ${result}`);
          return send(res, result.startsWith('ok') ? 200 : 500, { result });
        }
        case '/host/heartbeat': {
          const first = lastBeat === null;
          lastBeat = { ...body, at: new Date().toISOString(), window: (await windowCommand('state')).replace(/^ok:/, '') };
          if (first) log(`page connected ${JSON.stringify(lastBeat)}`);
          const newest = body.heard?.[0];
          if (newest && JSON.stringify(newest) !== lastHeardLogged) {
            lastHeardLogged = JSON.stringify(newest);
            log(`heard ${lastHeardLogged}`);
          }
          if (wantHiddenOnLoad && body.ready) {
            wantHiddenOnLoad = false;
            log(`hide on start -> ${await windowCommand('hide')}`);
          }
          return send(res, 200, { ok: true, window: lastBeat.window });
        }
        case '/host/open': {
          const result = openFor(body);
          log(`open ${JSON.stringify(body).slice(0, 200)} -> ${result}`);
          return send(res, result === 'ok' ? 200 : 400, { result });
        }
        case '/host/status':
          return send(res, 200, { lastBeat, chrome: !!chromeProc, background });
        case '/host/quit':
          send(res, 200, { ok: true });
          log('quit requested by the user');
          shutdown(0);
          return;
        default:
          return send(res, 404, { error: 'unknown' });
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method' });
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';
    const file = normalize(join(DIST, path));
    if (!file.startsWith(DIST + sep)) return send(res, 403, { error: 'path' });
    if (!existsSync(file) || statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
    let body = readFileSync(file);
    if (path === '/index.html') {
      // The page learns it is hosted (and gets the per-launch token) from this tag.
      body = Buffer.from(String(body).replace('<head>', `<head>\n    <meta name="jarvis-host-token" content="${TOKEN}" />`));
    }
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': path === '/index.html' ? 'no-store' : path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      // Cross-origin isolation lets the local AI models use several CPU threads.
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
      'cross-origin-resource-policy': 'same-origin',
      // Only this app's own files; WebAssembly allowed for the on-device models; nothing remote.
      'content-security-policy':
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob: data:; media-src 'self' blob:; frame-ancestors 'none'",
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    log(`request error ${err?.message}`);
    send(res, 500, { error: 'internal' });
  }
});

function shutdown(code) {
  quitting = true;
  try {
    chromeProc?.kill();
  } catch {
    /* already gone */
  }
  try {
    agent?.kill();
  } catch {
    /* already gone */
  }
  // A venv python.exe is a launcher with the real interpreter as its child: stop the whole tree.
  if (diag?.pid) {
    try {
      spawn('taskkill.exe', ['/PID', String(diag.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch {
      /* already gone */
    }
  }
  try {
    rmSync(STATE_FILE, { force: true });
  } catch {
    /* ignore */
  }
  server.close();
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

server.on('error', async (err) => {
  if (err.code === 'EADDRINUSE') {
    const shown = await postToRunningHost('/host/show');
    log(`another host is running; asked it to show the window: ${shown}`);
    process.exit(0);
  }
  log(`server error ${err.message}`);
  process.exit(1);
});

if (!existsSync(join(DIST, 'index.html'))) {
  log(`UI not built: ${DIST} is missing. Run: pnpm --dir apps/desktop build`);
  console.error('JARVIS UI is not built yet. Run: pnpm --dir apps/desktop build');
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  writeFileSync(STATE_FILE, JSON.stringify({ pid: process.pid, port: PORT, token: TOKEN }), { mode: 0o600 });
  log(`host listening on ${ORIGIN} (background=${background})`);
  startAgent();
  startDiagAgent();
  seedProfile();
  launchChrome();
});
