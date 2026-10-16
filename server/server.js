'use strict';

/*
 * Homework Hub — local server (pure Node stdlib, no npm deps).
 *
 * Run:   node server/server.js
 * Env:   PORT (default 8787), HOST (default 127.0.0.1)
 *
 * Serves the static UI from ../web and a small JSON API backed by
 * ../data/assignments.json (atomic writes: temp file + rename).
 *
 * Local only, no auth, CORS restricted to localhost origins.
 */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '8787', 10);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'assignments.json');
const JOBS_DIR = path.join(DATA_DIR, 'jobs');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const WEB_DIR = path.join(ROOT, 'web');
const SPAWN_SCRIPT = path.join(ROOT, 'scripts', 'spawn_agent.sh');

// Subject -> repo folder mapping. MUST match scripts/commit_to_repo.sh and README.
const SUBJECTS = {
  'Basics of IP Law': 'basics-of-ip-law',
  'OS And Syst Software': 'os-and-syst-software',
  'Machine Learning': 'machine-learning',
  'Soft Engineering': 'soft-engineering',
  'Multithread Java': 'multithread-java'
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const DEFAULT_DATA = {
  assignments: [],
  meta: { version: 1, source: 'default', updated_at: new Date().toISOString() }
};

// ---------- data layer ----------

async function ensureDirs() {
  for (const d of [DATA_DIR, JOBS_DIR, LOGS_DIR]) {
    await fsp.mkdir(d, { recursive: true });
  }
}

async function loadData() {
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.assignments)) {
      throw new Error('bad shape');
    }
    if (!parsed.meta) parsed.meta = {};
    return parsed;
  } catch (err) {
    // Missing or corrupt file: create a default with an empty list rather than crash.
    if (err.code !== 'ENOENT') {
      console.error('[homework-hub] data file unreadable, recreating:', err.message);
    }
    await saveData(DEFAULT_DATA);
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

async function saveData(data) {
  // Atomic write: temp file in the same dir, then rename over the target.
  const tmp = path.join(DATA_DIR, `.assignments.${process.pid}.${Date.now()}.tmp`);
  const body = JSON.stringify(data, null, 2) + '\n';
  await fsp.writeFile(tmp, body, 'utf8');
  await fsp.rename(tmp, DATA_FILE);
}

// ---------- derived helpers ----------

function withDerived(a) {
  const now = Date.now();
  const dueMs = a.due ? Date.parse(a.due) : NaN;
  const overdue = Boolean(a.due) && !Number.isNaN(dueMs) && dueMs < now && a.status !== 'done';
  return Object.assign({}, a, { overdue });
}

function groupByDue(list) {
  // Ascending by due date; nulls last.
  const sorted = list.slice().sort((x, y) => {
    const dx = x.due ? Date.parse(x.due) : Infinity;
    const dy = y.due ? Date.parse(y.due) : Infinity;
    if (dx !== dy) return dx - dy;
    return String(x.title).localeCompare(String(y.title));
  });
  const groups = [];
  const index = new Map();
  for (const a of sorted) {
    const key = a.due ? a.due.slice(0, 10) : 'no-due';
    if (!index.has(key)) {
      const g = { date: key === 'no-due' ? null : key, items: [] };
      index.set(key, g);
      groups.push(g);
    }
    index.get(key).items.push(a);
  }
  return groups;
}

function groupByStatus(list) {
  return {
    not_started: list.filter((a) => a.status === 'not_started'),
    in_progress: list.filter((a) => a.status === 'in_progress'),
    done: list.filter((a) => a.status === 'done')
  };
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || crypto.randomBytes(4).toString('hex');
}

// ---------- agent spawn ----------

async function spawnAgent(a) {
  const now = new Date().toISOString();
  const folder = SUBJECTS[a.subject] || slugify(a.subject);
  const sessionKey = 'agent:main:subject-' + folder;
  const jobPath = path.join(JOBS_DIR, `${a.id}.json`);

  // Don't relaunch if an agent for this assignment is already running.
  try {
    const prev = JSON.parse(await fsp.readFile(jobPath, 'utf8'));
    if (prev && prev.agent_pid) {
      try { process.kill(prev.agent_pid, 0); return prev.agent_pid; } catch (_) { /* dead */ }
    }
  } catch (_) { /* no prior job */ }

  const job = {
    id: a.id,
    assignment_id: a.id,
    title: a.title,
    subject: a.subject,
    repo_folder: folder,
    repo_path: a.repo_path || (folder + '/' + a.id),
    status: 'running',
    requested_at: now,
    started_at: now,
    agent_session: sessionKey
  };

  // Spawn the local agent launcher detached; real OpenClaw agent runs inside
  // spawn_agent.sh, which also writes finished_at/exit_code back into this job.
  let pid = null;
  try {
    const logPath = path.join(LOGS_DIR, `agent-${a.id}.log`);
    const out = fs.openSync(logPath, 'a');
    const child = spawn('bash', [SPAWN_SCRIPT, a.id, a.subject, a.title], {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', out, out]
    });
    child.unref();
    pid = child.pid;
    fs.closeSync(out);
  } catch (err) {
    console.error('[homework-hub] spawn failed:', err.message);
  }
  job.agent_pid = pid;
  await fsp.writeFile(jobPath, JSON.stringify(job, null, 2) + '\n', 'utf8');
  return pid;
}

// ---------- http helpers ----------

function corsHeaders(req) {
  const origin = req.headers.origin || '';
  const ok = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'http://127.0.0.1:8787',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function sendJson(req, res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  }, corsHeaders(req)));
  res.end(body);
}

function sendText(req, res, code, text, type) {
  res.writeHead(code, Object.assign({
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text)
  }, corsHeaders(req)));
  res.end(text);
}

function streamLog(req, res, logPath) {
  // Server-Sent Events stream of the agent log file (tail -f style).
  res.writeHead(200, Object.assign({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  }, corsHeaders(req)));
  let offset = 0;
  try { offset = fs.statSync(logPath).size; } catch (_) { offset = 0; }
  let closed = false;
  const tick = () => {
    if (closed) return;
    fs.stat(logPath, (err, st) => {
      if (closed) return;
      if (!err && st.size < offset) offset = 0; // truncated/rotated
      const len = (!err && st.size > offset) ? (st.size - offset) : 0;
      if (len > 0) {
        const buf = Buffer.alloc(len);
        fs.open(logPath, 'r', (e2, fd) => {
          if (e2) return;
          fs.read(fd, buf, 0, len, offset, (e3) => {
            fs.close(fd, () => {});
            if (e3) return;
            offset += len;
            const chunk = buf.toString('utf8');
            res.write('data: ' + JSON.stringify({ chunk }) + '\n\n');
          });
        });
      } else {
        res.write(': keepalive\n\n');
      }
    });
  };
  tick();
  const iv = setInterval(tick, 1500);
  req.on('close', () => { closed = true; clearInterval(iv); try { res.end(); } catch (_) {} });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let tooBig = false;
    req.on('data', (c) => {
      buf += c;
      if (buf.length > 2 * 1024 * 1024) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) return reject(new Error('payload too large'));
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); }
      catch (e) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

async function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = decodeURIComponent(rel.split('?')[0]);
  const full = path.normalize(path.join(WEB_DIR, rel));
  if (!full.startsWith(WEB_DIR + path.sep) && full !== WEB_DIR) {
    return sendText(req, res, 403, 'Forbidden');
  }
  try {
    const data = await fsp.readFile(full);
    const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, Object.assign({
      'Content-Type': type,
      'Content-Length': data.length
    }, corsHeaders(req)));
    res.end(data);
  } catch (err) {
    sendText(req, res, 404, 'Not found');
  }
}

// ---------- routes ----------

async function handleApi(req, res, urlPath) {
  const m = req.method.toUpperCase();

  // GET /api/health
  if (m === 'GET' && urlPath === '/api/health') {
    let count = 0;
    try { count = (await loadData()).assignments.length; } catch (_) {}
    return sendJson(req, res, 200, {
      ok: true, status: 'ok', time: new Date().toISOString(),
      pid: process.pid, assignments: count, version: 1
    });
  }

  // GET /api/subjects
  if (m === 'GET' && urlPath === '/api/subjects') {
    const data = await loadData();
    const list = Object.keys(SUBJECTS).map((s) => {
      const mine = data.assignments.filter((a) => a.subject === s);
      return {
        subject: s,
        repo_folder: SUBJECTS[s],
        total: mine.length,
        open: mine.filter((a) => a.status !== 'done').length,
        done: mine.filter((a) => a.status === 'done').length
      };
    });
    return sendJson(req, res, 200, { subjects: list });
  }

  // GET /api/assignments
  if (m === 'GET' && urlPath === '/api/assignments') {
    const data = await loadData();
    const withD = data.assignments.map(withDerived);
    return sendJson(req, res, 200, {
      assignments: withD,
      by_due: groupByDue(withD),
      by_status: groupByStatus(withD),
      overdue: withD.filter((a) => a.overdue),
      count: withD.length,
      meta: data.meta || {}
    });
  }

  // POST /api/assignments  (create or update — used by the daily scanner)
  if (m === 'POST' && urlPath === '/api/assignments') {
    const body = await readBody(req);
    const incoming = Array.isArray(body) ? body : (body.assignments || [body.assignment || body]);
    const items = Array.isArray(incoming) ? incoming : [incoming];
    if (!items.length || !items[0] || typeof items[0] !== 'object') {
      return sendJson(req, res, 400, { ok: false, error: 'expected an assignment object or list' });
    }
    const data = await loadData();
    const now = new Date().toISOString();
    const results = [];
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const id = raw.id || slugify(raw.title || 'assignment');
      let existing = data.assignments.find((a) => a.id === id);
      if (existing) {
        Object.assign(existing, raw, { id, updated_at: now });
        results.push({ id, action: 'updated' });
      } else {
        const created = Object.assign({
          id,
          title: raw.title || id,
          subject: raw.subject || 'Soft Engineering',
          course: raw.course || '',
          due: raw.due || null,
          points: typeof raw.points === 'number' ? raw.points : null,
          status: raw.status || 'not_started',
          description: raw.description || '',
          files: Array.isArray(raw.files) ? raw.files : [],
          repo_path: raw.repo_path || null,
          repo_url: raw.repo_url || null,
          teams_url: raw.teams_url || null,
          created_at: now,
          updated_at: now
        }, raw);
        created.id = id;
        data.assignments.push(created);
        results.push({ id, action: 'created' });
      }
    }
    data.meta = Object.assign({}, data.meta, { updated_at: now });
    await saveData(data);
    return sendJson(req, res, 200, { ok: true, results });
  }

  // Routes with :id
  const mId = urlPath.match(/^\/api\/assignments\/([^/]+)(?:\/(start|done|reset|delete|log|status))?$/);
  if (mId) {
    const id = decodeURIComponent(mId[1]);
    const action = mId[2] || null;

    // DELETE /api/assignments/:id  (also POST .../delete) — remove an assignment.
    if ((m === 'DELETE' && !action) || (m === 'POST' && action === 'delete')) {
      const data = await loadData();
      const idx = data.assignments.findIndex((x) => x.id === id);
      if (idx === -1) return sendJson(req, res, 404, { ok: false, error: 'not found' });
      const removed = data.assignments.splice(idx, 1)[0];
      data.meta = Object.assign({}, data.meta, { updated_at: new Date().toISOString() });
      await saveData(data);
      return sendJson(req, res, 200, { ok: true, id, deleted: removed.title });
    }

    // GET /api/assignments/:id/log — tail of the agent log (JSON, ?tail=N).
    if (m === 'GET' && action === 'log') {
      const q = new URL(req.url, 'http://x').searchParams;
      const stream = q.get('stream') === '1';
      const logPath = path.join(LOGS_DIR, `agent-${id}.log`);
      if (stream) return streamLog(req, res, logPath);
      let text = '';
      try { text = await fsp.readFile(logPath, 'utf8'); } catch (_) { text = ''; }
      const lines = text.split('\n');
      const tail = parseInt(q.get('tail') || '400', 10) || 400;
      const out = lines.slice(Math.max(0, lines.length - tail)).join('\n');
      return sendJson(req, res, 200, { ok: true, id, log: out, bytes: text.length });
    }

    // GET /api/assignments/:id/status — live agent status from the job file.
    if (m === 'GET' && action === 'status') {
      const jobPath = path.join(JOBS_DIR, `${id}.json`);
      let job = null;
      try { job = JSON.parse(await fsp.readFile(jobPath, 'utf8')); } catch (_) {}
      const data = await loadData();
      const a = data.assignments.find((x) => x.id === id);
      let running = false;
      if (job && job.agent_pid) {
        try { process.kill(job.agent_pid, 0); running = true; } catch (_) { running = false; }
      }
      return sendJson(req, res, 200, {
        ok: true, id,
        status: a ? a.status : null,
        agent: job ? { pid: job.agent_pid || null, session: job.agent_session || null,
          started_at: job.started_at || null, finished_at: job.finished_at || null,
          exit_code: job.exit_code != null ? job.exit_code : null } : null,
        running
      });
    }

    if (m === 'GET' && !action) {
      const data = await loadData();
      const a = data.assignments.find((x) => x.id === id);
      if (!a) return sendJson(req, res, 404, { ok: false, error: 'not found' });
      return sendJson(req, res, 200, withDerived(a));
    }

    if (m === 'POST' && action === 'start') {
      const data = await loadData();
      const a = data.assignments.find((x) => x.id === id);
      if (!a) return sendJson(req, res, 404, { ok: false, error: 'not found' });
      a.status = 'in_progress';
      a.updated_at = new Date().toISOString();
      data.meta = Object.assign({}, data.meta, { updated_at: a.updated_at });
      await saveData(data);
      const pid = await spawnAgent(a);
      return sendJson(req, res, 200, {
        ok: true, id, status: a.status,
        agentPid: pid, repo_path: a.repo_path || null,
        log: `data/logs/agent-${id}.log`
      });
    }

    if (m === 'POST' && action === 'done') {
      const body = await readBody(req);
      const data = await loadData();
      const a = data.assignments.find((x) => x.id === id);
      if (!a) return sendJson(req, res, 404, { ok: false, error: 'not found' });
      a.status = 'done';
      if (body && body.repo_url) a.repo_url = String(body.repo_url);
      if (body && body.repo_path) a.repo_path = String(body.repo_path);
      a.updated_at = new Date().toISOString();
      data.meta = Object.assign({}, data.meta, { updated_at: a.updated_at });
      await saveData(data);
      return sendJson(req, res, 200, { ok: true, id, status: a.status, repo_url: a.repo_url || null });
    }

    // Convenience reset back to not_started (used by tooling/tests).
    if (m === 'POST' && action === 'reset') {
      const data = await loadData();
      const a = data.assignments.find((x) => x.id === id);
      if (!a) return sendJson(req, res, 404, { ok: false, error: 'not found' });
      a.status = 'not_started';
      a.repo_url = null;
      a.updated_at = new Date().toISOString();
      data.meta = Object.assign({}, data.meta, { updated_at: a.updated_at });
      await saveData(data);
      return sendJson(req, res, 200, { ok: true, id, status: a.status });
    }

    return sendJson(req, res, 405, { ok: false, error: 'method not allowed' });
  }

  return sendJson(req, res, 404, { ok: false, error: 'no such API route' });
}

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(req));
      return res.end();
    }
    if (urlPath.startsWith('/api/')) {
      return await handleApi(req, res, urlPath);
    }
    return await serveStatic(req, res, urlPath);
  } catch (err) {
    console.error('[homework-hub] request error:', err && err.stack || err);
    try {
      sendJson(req, res, 500, { ok: false, error: String(err.message || err) });
    } catch (_) { /* headers already sent */ }
  }
});

(async function main() {
  await ensureDirs();
  await loadData(); // creates a default file if missing
  server.listen(PORT, HOST, () => {
    console.log(`[homework-hub] listening on http://${HOST}:${PORT}`);
    console.log(`[homework-hub] data: ${DATA_FILE}`);
    console.log(`[homework-hub] web:  ${WEB_DIR}`);
  });
})();

process.on('SIGINT', () => { console.log('\n[homework-hub] shutting down'); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
