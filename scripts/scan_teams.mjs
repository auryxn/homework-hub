// scan_teams.mjs — standalone Teams Assignments scanner for Homework Hub.
// Reads the OpenClaw-managed browser (CDP :18800), drives the Assignments iframe,
// extracts assignments from ALL tabs (upcoming / overdue / completed) via React
// fiber props, and upserts them into homework-hub/data/assignments.json.
//
// Usage: node scan_teams.mjs [--dry] [--completed]
//   --dry        parse but do not write
//   --completed  also scan the "Выполнено" tab (skipped by default)
import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.HOME;
const HUB = path.join(HOME, '.openclaw/workspace/homework-hub');
const DATA = path.join(HUB, 'data/assignments.json');
const CDP = process.env.CDP_URL || 'http://127.0.0.1:18800';
const DRY = process.argv.includes('--dry');
const INCLUDE_COMPLETED = process.argv.includes('--completed');
const TENANT = 'b1bece90-2038-4afb-9f19-6bcd2a777a1c';
const LIST_URL = `https://assignments.edu.cloud.microsoft/classes/all/list?locale=ru-RU&tenantId=${TENANT}&theme=default&userRole=student`;

const SUBJECT_MAP = {
  'Soft Engineering': 'soft-engineering',
  'Basics of IP Law': 'basics-of-ip-law',
  'OS And Syst Software': 'os-and-syst-software',
  'Machine Learning': 'machine-learning',
  'Multithread Java': 'multithread-java',
};
function guessSubject(course, title) {
  const hay = ((course || '') + ' ' + (title || '')).toLowerCase();
  if (/soft engineering|sse|triz/.test(hay)) return 'Soft Engineering';
  if (/ip law|intellectual property|patent|copyright|trademark/.test(hay)) return 'Basics of IP Law';
  if (/multithread|java|thread/.test(hay)) return 'Multithread Java';
  if (/machine learning|\bml\b|neural|model training/.test(hay)) return 'Machine Learning';
  if (/os and|operating system|system software|syst software/.test(hay)) return 'OS And Syst Software';
  return null;
}
const slug = (s) => String(s || 'task').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'task';
function safeISO(v) { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString(); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const list = await (await fetch(CDP + '/json/list')).json();
  const t = list.find((x) => x.type === 'iframe' && x.url.includes('assignments.edu.cloud.microsoft'))
    || list.find((x) => x.type === 'page' && x.url.includes('teams'));
  if (!t) throw new Error('no Assignments/Teams target — open Teams & log in first');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let c = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => { const id = ++c; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
  ws.addEventListener('message', (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } const p = pend.get(m.id); if (!p) return; pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); });
  await send('Runtime.enable'); await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result?.value;
  };
  return { ws, send, ev };
}

// JS injected in the page: collects assignments from the current tab's cards,
// climbing React fiber props to find { assignment, listname }.
const COLLECT_JS = `(function(){
  var out=[]; var cards=document.querySelectorAll('.aui-assignmentListCard');
  for(var i=0;i<cards.length;i++){
    var card=cards[i]; var key=null; var ks=Object.keys(card);
    for(var j=0;j<ks.length;j++){ if(ks[j].indexOf('__reactFiber')===0){key=ks[j];break;} }
    if(!key) continue;
    var f=card[key]; var depth=0; var asg=null; var listname=null;
    while(f && depth<50){ var p=f.memoizedProps; if(p && p.assignment){ asg=p.assignment; listname=p.listname; break; } f=f.return; depth++; }
    if(!asg) continue;
    out.push({
      id: asg.id||null, classId: asg.classId||null, displayName: asg.displayName||null,
      dueDateTime: (asg.dueDateTime&&asg.dueDateTime.dateTime)||asg.dueDateTime||null,
      assignedDateTime: (asg.assignedDateTime&&asg.assignedDateTime.dateTime)||null,
      status: asg.status||null, isCompleted: !!asg.isCompleted,
      anySubmittedState: !!asg.anySubmittedState, allTurnedIn: !!asg.allTurnedIn,
      webUrl: asg.webUrl||null, resourcesFolderUrl: asg.resourcesFolderUrl||null,
      grading: (asg.grading&&asg.grading.maxPoints!=null)?asg.grading.maxPoints:null,
      listname: listname
    });
  }
  // dedupe by id, keep first
  var seen={}; var res=[];
  for(var i=0;i<out.length;i++){ if(out[i].id && !seen[out[i].id]){ seen[out[i].id]=1; res.push(out[i]); } }
  return res;
})()`;

async function clickTab(ev, label) {
  // Click a tab by its visible text inside the iframe.
  const ok = await ev(`(function(){
    var tabs=document.querySelectorAll('[role="tab"]');
    for(var i=0;i<tabs.length;i++){ if((tabs[i].innerText||'').trim()===${JSON.stringify(label)}){ tabs[i].click(); return true; } }
    return false;
  })()`);
  await sleep(3000);
  return ok;
}

async function main() {
  const { ws, ev } = await connect();
  await ev(`(function(){ try{ location.href=${JSON.stringify(LIST_URL)}; }catch(e){} return 1; })()`);
  await sleep(4500);

  const tabsToScan = [['Предстоящие', 'upcoming'], ['Просрочено', 'overdue']];
  if (INCLUDE_COMPLETED) tabsToScan.push(['Выполнено', 'completed']);

  const collected = [];
  for (const [label, kind] of tabsToScan) {
    const clicked = await clickTab(ev, label);
    const raw = await ev(COLLECT_JS);
    const items = Array.isArray(raw) ? raw : [];
    console.log(`[scan] tab "${label}" (${kind}): ${clicked ? 'ok' : 'TAB NOT FOUND'}, ${items.length} cards`);
    for (const it of items) collected.push(Object.assign({ _tab: kind }, it));
  }
  ws.close();

  const byId = new Map();
  for (const c of collected) if (c.id && !byId.has(c.id)) byId.set(c.id, c);
  const found = [...byId.values()];
  console.log(`[scan] total unique: ${found.length}`);

  const data = fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA, 'utf8')) : { assignments: [], meta: {} };
  if (!Array.isArray(data.assignments)) data.assignments = [];
  const byTeams = new Map();
  for (const a of data.assignments) if (a.teams_id) byTeams.set(a.teams_id, a);
  const byTitle = new Map();
  for (const a of data.assignments) byTitle.set((a.title || '').trim().toLowerCase(), a);

  let added = 0, updated = 0;
  for (const c of found) {
    const title = (c.displayName || '').trim();
    if (!title) continue;
    const subject = guessSubject(null, title);
    const due = c.dueDateTime ? safeISO(c.dueDateTime) : null;
    const status = c.isCompleted || c.allTurnedIn ? 'done'
      : (c.anySubmittedState ? 'in_progress' : 'not_started');
    let a = byTeams.get(c.id) || byTitle.get(title.toLowerCase());
    if (!a) {
      a = {
        id: slug(title), teams_id: c.id, class_id: c.classId, title, subject, course: null,
        due, points: c.grading ?? 10, status, description: '', files: [],
        repo_path: subject ? SUBJECT_MAP[subject] + '/' + slug(title) : null,
        repo_url: null, teams_url: c.webUrl || null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      data.assignments.push(a); added++;
    } else {
      let changed = false;
      if (c.id && a.teams_id !== c.id) { a.teams_id = c.id; changed = true; }
      if (c.classId && a.class_id !== c.classId) { a.class_id = c.classId; changed = true; }
      if (due && a.due !== due) { a.due = due; changed = true; }
      if (c.grading != null && a.points !== c.grading) { a.points = c.grading; changed = true; }
      if (!a.subject && subject) { a.subject = subject; changed = true; }
      if (!a.repo_path && (a.subject || subject)) { a.repo_path = SUBJECT_MAP[a.subject || subject] + '/' + slug(title); changed = true; }
      if (c.webUrl && a.teams_url !== c.webUrl) { a.teams_url = c.webUrl; changed = true; }
      // only upgrade status forward: done is terminal
      if (a.status !== 'done' && status === 'done') { a.status = 'done'; changed = true; }
      if (changed) { a.updated_at = new Date().toISOString(); updated++; }
    }
  }
  data.meta = Object.assign({}, data.meta, { last_scan: new Date().toISOString(), scanned_total: data.assignments.length });

  if (DRY) { console.log(`[dry] added=${added} updated=${updated}`); return; }
  const tmp = DATA + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DATA);
  console.log(`[scan] wrote ${DATA}: added=${added} updated=${updated} total=${data.assignments.length}`);
}
main().catch((e) => { console.error('[scan] ERROR', e.message); process.exit(1); });
