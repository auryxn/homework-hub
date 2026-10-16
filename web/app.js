/* Homework Hub — vanilla JS, no dependencies. */
(function () {
  'use strict';

  const API = '';

  const STATUS_LABEL = {
    not_started: 'Не начато',
    in_progress: 'Выполняется',
    done: 'Выполнено'
  };

  const STATUS_CLASS = {
    not_started: 'pill-not-started',
    in_progress: 'pill-in-progress',
    done: 'pill-done'
  };

  // ---------- utils ----------
  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDue(iso) {
    if (!iso) return { text: 'без срока', cls: 'due-none' };
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { text: 'без срока', cls: 'due-none' };
    const now = Date.now();
    const diff = d.getTime() - now;
    const txt = d.toLocaleString('ru-RU', {
      day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    let cls = 'due-ok';
    let rel = '';
    const days = Math.floor(Math.abs(diff) / 86400000);
    if (diff < 0) { cls = 'due-late'; rel = days === 0 ? 'сегодня' : days + ' дн. назад'; }
    else if (diff < 2 * 86400000) { cls = 'due-soon'; rel = 'менее 2 дней'; }
    else { rel = 'через ' + days + ' дн.'; }
    return { text: txt, cls, rel };
  }

  async function getJSON(url) {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    return r.json();
  }

  async function postJSON(url) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    return r.json();
  }

  async function delJSON(url) {
    const r = await fetch(url, { method: 'DELETE', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    return r.json();
  }

  function subjectBadge(subject) {
    const cls = 'subj-' + String(subject || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return '<span class="badge ' + cls + '">' + esc(subject) + '</span>';
  }

  function statusPill(a) {
    if (a.overdue) return '<span class="pill pill-overdue">Просрочено</span>';
    return '<span class="pill ' + (STATUS_CLASS[a.status] || '') + '">' + esc(STATUS_LABEL[a.status] || a.status) + '</span>';
  }

  // ---------- card actions ----------
  function actionsHTML(a) {
    if (a.status === 'in_progress') {
      return '<button class="btn btn-term" data-term="' + esc(a.id) + '">⯈ Терминал агента</button>';
    }
    if (a.status === 'done') {
      return '<button class="btn btn-term" data-term="' + esc(a.id) + '">⯈ Терминал</button>' +
        '<button class="btn btn-del" data-del="' + esc(a.id) + '">Удалить</button>';
    }
    return '<button class="btn btn-start" data-start="' + esc(a.id) + '">Начать выполнять</button>';
  }

  // ---------- card ----------
  function card(a) {
    const due = fmtDue(a.due);
    const node = el(
      '<article class="card" data-id="' + esc(a.id) + '">' +
        '<div class="card-top">' +
          subjectBadge(a.subject) +
          statusPill(a) +
        '</div>' +
        '<h3 class="card-title">' + esc(a.title) + '</h3>' +
        '<div class="card-due ' + due.cls + '">⏰ ' + esc(due.text) +
          (due.rel ? ' <span class="rel">(' + esc(due.rel) + ')</span>' : '') + '</div>' +
        '<div class="card-foot">' +
          '<span class="points">' + (a.points != null ? esc(a.points) + ' б.' : '—') + '</span>' +
          '<span class="card-actions">' + actionsHTML(a) + '</span>' +
        '</div>' +
      '</article>'
    );
    node.addEventListener('click', (e) => {
      if (e.target.closest('[data-start],[data-term],[data-del]')) return;
      location.href = 'assignment.html?id=' + encodeURIComponent(a.id);
    });
    const start = node.querySelector('[data-start]');
    if (start) start.addEventListener('click', async (e) => {
      e.stopPropagation();
      start.disabled = true;
      start.textContent = 'Запуск…';
      try {
        await postJSON('/api/assignments/' + encodeURIComponent(a.id) + '/start');
        location.href = 'agent.html?id=' + encodeURIComponent(a.id);
        return;
      } catch (err) {
        start.textContent = 'Ошибка';
        console.error(err);
      }
      setTimeout(() => refresh(a.id), 500);
    });
    const term = node.querySelector('[data-term]');
    if (term) term.addEventListener('click', (e) => {
      e.stopPropagation();
      location.href = 'agent.html?id=' + encodeURIComponent(a.id);
    });
    const del = node.querySelector('[data-del]');
    if (del) del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Удалить задание «' + a.title + '»?')) return;
      del.disabled = true; del.textContent = 'Удаление…';
      try { await delJSON('/api/assignments/' + encodeURIComponent(a.id)); }
      catch (err) { console.error(err); }
      refresh();
    });
    return node;
  }

  // ---------- views ----------
  let STATE = { active: 'due' };

  function renderDue(data, host) {
    host.innerHTML = '';
    const items = data._active || data.assignments;
    const groups = {};
    for (const a of items) {
      const key = a.due ? a.due.slice(0, 10) : '';
      (groups[key] = groups[key] || []).push(a);
    }
    const keys = Object.keys(groups).sort((x, y) => (x === '' ? 1 : y === '' ? -1 : x.localeCompare(y)));
    if (!keys.length) return host.appendChild(el('<div class="empty">Нет активных заданий 🎉</div>'));
    for (const key of keys) {
      const label = key
        ? new Date(key + 'T00:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric', weekday: 'short' })
        : 'Без срока';
      const sec = el('<section class="group"><h2 class="group-head">' + esc(label) +
        ' <span class="group-count">' + groups[key].length + '</span></h2><div class="grid"></div></section>');
      const grid = sec.querySelector('.grid');
      groups[key].forEach((a) => grid.appendChild(card(a)));
      host.appendChild(sec);
    }
  }

  function renderStatus(data, host) {
    const cols = [
      ['not_started', 'Не начато'],
      ['in_progress', 'Выполняется'],
      ['done', 'Выполнено']
    ];
    const active = data._active || data.assignments;
    const hist = data._history || [];
    const wrap = el('<div class="columns"></div>');
    for (const [key, label] of cols) {
      const items = key === 'done' ? hist : active.filter((a) => a.status === key);
      const col = el('<section class="column"><h2 class="col-head">' + label +
        ' <span class="group-count">' + items.length + '</span></h2><div class="col-body"></div></section>');
      const body = col.querySelector('.col-body');
      if (!items.length) body.appendChild(el('<div class="empty small">пусто</div>'));
      items.forEach((a) => body.appendChild(card(a)));
      wrap.appendChild(col);
    }
    host.innerHTML = '';
    host.appendChild(wrap);
  }

  function renderOverdue(data, host) {
    host.innerHTML = '';
    const items = data.overdue || [];
    if (!items.length) return host.appendChild(el('<div class="empty">Просроченных заданий нет 🎉</div>'));
    const sec = el('<section class="group"><h2 class="group-head">Просрочено <span class="group-count">' +
      items.length + '</span></h2><div class="grid"></div></section>');
    const grid = sec.querySelector('.grid');
    items.forEach((a) => grid.appendChild(card(a)));
    host.appendChild(sec);
  }

  function setTab(tab) {
    STATE.active = tab;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  }

  async function render() {
    const view = document.getElementById('view');
    try {
      const data = await getJSON('/api/assignments');
      const SUBJECTS = ['Soft Engineering', 'Basics of IP Law', 'OS And Syst Software', 'Machine Learning', 'Multithread Java'];
      // active = our 5 subjects and not done; history = everything else
      data._active = data.assignments.filter(a => SUBJECTS.includes(a.subject) && a.status !== 'done');
      data._history = data.assignments.filter(a => !data._active.includes(a));
      document.getElementById('topMeta').textContent =
        data._active.length + ' активных · ' + data.overdue.length + ' просрочено · ' + data._history.length + ' в истории';
      const oc = document.getElementById('overdueCount');
      if (oc) oc.textContent = data.overdue.length;
      if (STATE.active === 'due') renderDue(data, view);
      else if (STATE.active === 'status') renderStatus(data, view);
      else renderOverdue(data, view);
    } catch (err) {
      view.innerHTML = '<div class="empty error">Не удалось загрузить данные: ' + esc(err.message) + '</div>';
    }
  }

  async function refresh(id) {
    await render();
  }

  // ---------- detail page ----------
  async function initDetail() {
    const id = new URLSearchParams(location.search).get('id');
    const host = document.getElementById('detail');
    if (!id) {
      host.innerHTML = '<div class="empty error">Не указан id задания</div>';
      return;
    }
    try {
      const a = await getJSON('/api/assignments/' + encodeURIComponent(id));
      document.getElementById('topMeta').textContent = a.subject;
      document.title = a.title + ' · Homework Hub';
      const due = fmtDue(a.due);
      const files = (a.files || []).length
        ? '<ul class="files">' + a.files.map((f) =>
            '<li>📎 <a href="' + esc(f.url || '#') + '" target="_blank" rel="noopener">' + esc(f.name || f.url) + '</a></li>'
          ).join('') + '</ul>'
        : '<p class="muted">Файлов нет</p>';

      const repo = a.repo_url
        ? '<a class="btn btn-link" href="' + esc(a.repo_url) + '" target="_blank" rel="noopener">Открыть репозиторий ↗</a>'
        : (a.repo_path ? '<code>' + esc(a.repo_path) + '</code> <span class="muted">(ещё не загружено)</span>' : '<span class="muted">—</span>');

      const teams = a.teams_url
        ? '<a class="btn btn-link" href="' + esc(a.teams_url) + '" target="_blank" rel="noopener">Открыть в Teams ↗</a>'
        : '<span class="muted">—</span>';

      host.innerHTML = '';
      const isRunning = a.status === 'in_progress';
      const isDone = a.status === 'done';
      const actions =
        (!isRunning && !isDone ? '<button class="btn btn-start" id="actStart">Начать выполнять</button>' : '') +
        (isRunning || isDone ? '<button class="btn btn-term" id="actTerm">⯈ Терминал агента</button>' : '') +
        (!isDone ? '<button class="btn btn-done" id="actDone">Отметить выполненным</button>' : '') +
        '<button class="btn btn-del" id="actDel">Удалить</button>';
      host.appendChild(el(
        '<article class="detail">' +
          '<div class="card-top">' + subjectBadge(a.subject) + statusPill(a) + '</div>' +
          '<h1 class="detail-title">' + esc(a.title) + '</h1>' +
          '<dl class="fields">' +
            '<div><dt>Курс</dt><dd>' + esc(a.course || '—') + '</dd></div>' +
            '<div><dt>Дедлайн</dt><dd class="' + due.cls + '">' + esc(due.text) + (due.rel ? ' <span class="rel">(' + esc(due.rel) + ')</span>' : '') + '</dd></div>' +
            '<div><dt>Баллы</dt><dd>' + (a.points != null ? esc(a.points) : '—') + '</dd></div>' +
            '<div><dt>Статус</dt><dd>' + esc(STATUS_LABEL[a.status] || a.status) + '</dd></div>' +
            '<div><dt>ID</dt><dd><code>' + esc(a.id) + '</code></dd></div>' +
            '<div><dt>Обновлено</dt><dd>' + esc(a.updated_at || '—') + '</dd></div>' +
          '</dl>' +
          '<h2 class="section-h">Описание</h2>' +
          '<div class="desc">' + esc(a.description || 'Нет описания').replace(/\n/g, '<br>') + '</div>' +
          '<h2 class="section-h">Файлы</h2>' + files +
          '<h2 class="section-h">Репозиторий</h2><p>' + repo + '</p>' +
          '<h2 class="section-h">Teams</h2><p>' + teams + '</p>' +
          '<div class="actions">' + actions + '</div>' +
        '</article>'
      ));

      const reload = () => initDetail();
      const st = document.getElementById('actStart');
      if (st) st.addEventListener('click', async () => {
        st.disabled = true; st.textContent = 'Запуск…';
        await postJSON('/api/assignments/' + encodeURIComponent(id) + '/start');
        location.href = 'agent.html?id=' + encodeURIComponent(id);
      });
      const tm = document.getElementById('actTerm');
      if (tm) tm.addEventListener('click', () => { location.href = 'agent.html?id=' + encodeURIComponent(id); });
      const dn = document.getElementById('actDone');
      if (dn) dn.addEventListener('click', async (e) => {
        e.target.disabled = true; e.target.textContent = 'Сохранение…';
        await postJSON('/api/assignments/' + encodeURIComponent(id) + '/done');
        setTimeout(reload, 400);
      });
      const dl = document.getElementById('actDel');
      if (dl) dl.addEventListener('click', async () => {
        if (!confirm('Удалить задание «' + a.title + '»?')) return;
        dl.disabled = true; dl.textContent = 'Удаление…';
        try { await delJSON('/api/assignments/' + encodeURIComponent(id)); } catch (err) { console.error(err); }
        location.href = 'index.html';
      });
    } catch (err) {
      host.innerHTML = '<div class="empty error">Не найдено: ' + esc(err.message) + '</div>';
    }
  }

  // ---------- agent terminal page ----------
  async function initAgent() {
    const id = new URLSearchParams(location.search).get('id');
    const term = document.getElementById('terminal');
    const head = document.getElementById('agentHead');
    if (!id) { term.textContent = 'Не указан id задания'; return; }

    let a = null;
    try { a = await getJSON('/api/assignments/' + encodeURIComponent(id)); } catch (_) {}
    if (a) {
      document.title = 'Агент · ' + a.title;
      document.getElementById('topMeta').textContent = a.subject + ' · ' + (STATUS_LABEL[a.status] || a.status);
      head.innerHTML = '<h1>' + esc(a.title) + '</h1>' +
        '<div class="muted">' + esc(a.subject) + ' · статус: <b>' + esc(STATUS_LABEL[a.status] || a.status) + '</b>' +
        (a.repo_url ? ' · <a href="' + esc(a.repo_url) + '" target="_blank" rel="noopener">репозиторий ↗</a>' : '') + '</div>';
    }

    // Initial log tail.
    try {
      const r = await getJSON('/api/assignments/' + encodeURIComponent(id) + '/log?tail=800');
      if (r.log) term.textContent = r.log;
    } catch (_) {}
    term.scrollTop = term.scrollHeight;

    // Live stream via SSE.
    let es;
    try {
      es = new EventSource('/api/assignments/' + encodeURIComponent(id) + '/log?stream=1');
      es.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data);
          if (d.chunk) {
            term.textContent += d.chunk;
            term.scrollTop = term.scrollHeight;
          }
        } catch (_) {}
      };
      es.onerror = () => { /* EventSource auto-reconnects */ };
    } catch (_) {}

    // Poll status; stop stream + refresh pill when finished.
    let pollCount = 0;
    const poll = setInterval(async () => {
      try {
        const s = await getJSON('/api/assignments/' + encodeURIComponent(id) + '/status');
        const running = s.running;
        const badge = document.getElementById('agentState');
        if (badge) {
          badge.textContent = running ? '● агент работает' : (s.status === 'done' ? '✓ выполнено' : '○ остановлен');
          badge.className = 'agent-state ' + (running ? 'st-run' : (s.status === 'done' ? 'st-done' : 'st-idle'));
        }
        if (!running && pollCount++ > 2) {
          if (es) { try { es.close(); } catch (_) {} }
          clearInterval(poll);
          if (a && s.status === 'done') setTimeout(() => location.reload(), 1500);
        }
      } catch (_) {}
    }, 3000);
  }

  // ---------- boot ----------
  function initIndex() {
    document.getElementById('tabs').addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (!b) return;
      setTab(b.dataset.tab);
      render();
    });
    render();
  }

  window.HH = { initDetail, initAgent };

  if (document.getElementById('terminal')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAgent);
    else initAgent();
  } else if (document.getElementById('view')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initIndex);
    else initIndex();
  }
})();
