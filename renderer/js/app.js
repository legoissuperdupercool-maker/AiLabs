// AI Labs Office — UI controller.
(function () {
  const { esc, h, $, $$, md, timeAgo, fmtTokens, beep } = window.U;
  const api = window.office;

  const DEPARTMENTS = {
    Engineering: { color: '#4f8cff', icon: '⌨', roles: ['Senior Software Engineer', 'DevOps Engineer', 'QA Engineer', 'Automation Engineer'],
      brief: 'You write, run and debug code. Test what you build before reporting back.' },
    Research: { color: '#a66bff', icon: '🔬', roles: ['Research Analyst', 'Data Scientist', 'Market Researcher'],
      brief: 'You investigate topics thoroughly using the web and local files, and write clear, sourced reports.' },
    Design: { color: '#ff6bb5', icon: '✎', roles: ['Product Designer', 'UI Designer', 'Brand Designer'],
      brief: 'You create layouts, HTML/CSS mockups, SVG graphics and design specs with a strong visual sense.' },
    Marketing: { color: '#ffb347', icon: '📣', roles: ['Content Writer', 'Growth Marketer', 'Social Media Manager'],
      brief: 'You write persuasive copy, blog posts, social posts and campaign plans.' },
    Operations: { color: '#3ddc97', icon: '⚙', roles: ['Operations Manager', 'IT Administrator', 'Project Manager'],
      brief: 'You organise files, automate chores on this computer, plan projects and coordinate coworkers via delegate_task.' },
    Finance: { color: '#f5d547', icon: '$', roles: ['Financial Analyst', 'Accountant', 'Budget Planner'],
      brief: 'You build budgets, analyse spreadsheets/CSVs and produce precise financial summaries.' },
    Sales: { color: '#ff7a59', icon: '🤝', roles: ['Sales Lead', 'Account Executive', 'Proposal Writer'],
      brief: 'You research prospects and write outreach emails, proposals and pitch material.' },
    Support: { color: '#4dd0e1', icon: '💬', roles: ['Customer Support Specialist', 'Technical Writer', 'Help Desk Agent'],
      brief: 'You answer questions, troubleshoot problems and write documentation and FAQs.' },
  };

  const NAMES = ['Ada', 'Linus', 'Grace', 'Alan', 'Margaret', 'Hedy', 'Dennis', 'Radia', 'Ken', 'Barbara', 'Tim', 'Katherine', 'Guido', 'Frances', 'Claude', 'Sophie', 'Milo', 'Nova', 'Iris', 'Otto', 'Juno', 'Felix', 'Luna', 'Kai', 'Zara', 'Remy', 'Pixel', 'Byte'];

  const PERMISSIONS = {
    ask: { label: 'Ask first', desc: 'Reads freely, writes inside the workspace. Commands and other changes need your OK.' },
    auto: { label: 'Full auto', desc: 'Does everything without asking. Only for agents you trust.' },
    readonly: { label: 'Read-only', desc: 'Can look at files and the web, but never changes anything.' },
  };

  const STATUS_TEXT = { idle: 'Idle', thinking: 'Thinking', working: 'Working', waiting: 'Needs approval', error: 'Error' };

  const S = {
    state: null, presets: [], tools: [], platform: '', version: '',
    view: 'office', selected: null, histories: {}, approvals: [], sideFor: undefined,
  };

  let scene;

  // ---------- boot ----------
  async function boot() {
    const res = await api.get();
    if (!res.ok) { document.body.textContent = res.error; return; }
    Object.assign(S, { state: res.data.state, presets: res.data.presets, tools: res.data.tools, platform: res.data.platform, version: res.data.version });
    drawBrand();
    scene = new window.OfficeScene($('#officeCanvas'), {
      onSelect: (id) => select(id),
      onHire: () => openAgentModal(),
    });
    $$('#tabs button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    $('#newTaskBtn').addEventListener('click', () => openTaskModal());
    api.onEvent(onEvent);
    renderAll();
    if (!S.state.providers.length) openWelcome();
    setInterval(() => { if (S.view === 'office' && !S.selected) renderSide(true); }, 30000);
  }

  function drawBrand() {
    const c = $('#brandIcon'); const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 22, 22); g.addColorStop(0, '#6d7dff'); g.addColorStop(1, '#c86bff');
    x.fillStyle = g; x.beginPath(); x.roundRect(0, 0, 22, 22, 6); x.fill();
    x.fillStyle = '#fff'; x.fillRect(5, 6, 4, 4); x.fillRect(13, 6, 4, 4); x.fillRect(5, 14, 12, 2);
  }

  function setView(v) {
    S.view = v;
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    $$('.view').forEach((el) => el.classList.toggle('active', el.id === `view-${v}`));
    renderAll();
  }

  // ---------- events from the main process ----------
  function onEvent({ type, payload }) {
    switch (type) {
      case 'state':
        S.state = payload;
        renderAll();
        break;
      case 'agent-status':
        S.state.runtime[payload.agentId] = { status: payload.status, detail: payload.detail, queued: payload.queued };
        renderRoster();
        if (S.selected === payload.agentId) renderSideHeader();
        renderTitleStats();
        if (S.view === 'tasks') renderBoard();
        break;
      case 'history': {
        const list = S.histories[payload.agentId];
        if (list) list.push(payload.entry);
        if (S.selected === payload.agentId) appendEntry(payload.entry, true);
        const e = payload.entry;
        if (e.role === 'assistant' && e.content) scene.say(payload.agentId, plain(e.content.split('\n').find((l) => l.trim()) || ''), 5);
        for (const call of e.toolCalls || []) {
          if (call.name === 'delegate_task') {
            const target = S.state.agents.find((a) => a.name.toLowerCase() === String(call.args?.coworker || '').toLowerCase());
            if (target) scene.visit(payload.agentId, target.id);
          }
        }
        break;
      }
      case 'history-reset':
        S.histories[payload.agentId] = [];
        if (S.selected === payload.agentId) { S.sideFor = undefined; renderSide(); }
        break;
      case 'approval':
        S.approvals.push(payload);
        if (S.state.settings.sound) beep('alert');
        showApproval();
        break;
      case 'approval-closed':
        S.approvals = S.approvals.filter((a) => a.id !== payload.id);
        showApproval();
        break;
      case 'task-done': {
        const t = S.state.tasks.find((x) => x.id === payload.taskId);
        const a = agentById(payload.agentId);
        if (t && a) toast(`<b>${esc(a.name)}</b> finished “${esc(t.title)}”`, 'ok', () => openResult(t.id));
        if (S.state.settings.sound) beep('done');
        break;
      }
      default: break;
    }
  }

  // ---------- helpers ----------
  const plain = (s) => s.replace(/[*_`#>]+/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
  const agentById = (id) => S.state.agents.find((a) => a.id === id);
  const providerById = (id) => S.state.providers.find((p) => p.id === id);
  const deptColor = (a) => DEPARTMENTS[a?.department]?.color || '#8b93c9';
  const runOf = (id) => S.state.runtime?.[id] || { status: 'idle' };

  function portrait(agent, size = 40) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    c.className = 'portrait';
    c.style.width = `${size}px`; c.style.height = `${size}px`;
    c.style.setProperty('--dc', deptColor(agent));
    window.Sprites.drawPortrait(c, agent.look, '#1a1e38');
    return c;
  }

  async function call(fn, ...args) {
    const res = await fn(...args);
    if (!res.ok) { toast(esc(res.error), 'err'); throw new Error(res.error); }
    return res.data;
  }

  function toast(html, kind = 'info', onClick) {
    const el = h(`<div class="toast ${kind}">${html}</div>`);
    if (onClick) { el.classList.add('clickable'); el.addEventListener('click', () => { onClick(); el.remove(); }); }
    $('#toasts').append(el);
    setTimeout(() => el.classList.add('out'), 4500);
    setTimeout(() => el.remove(), 5000);
  }

  function select(id) {
    S.selected = id;
    if (S.view !== 'office') setView('office');
    renderSide();
    renderRoster();
    scene.selected = id;
  }

  // ---------- rendering ----------
  function renderAll() {
    if (!S.state) return;
    renderTitleStats();
    const active = S.state.tasks.filter((t) => t.status === 'running' || t.status === 'queued').length;
    $('#taskCount').textContent = active || '';
    scene.setData({ agents: S.state.agents, runtime: S.state.runtime, departments: DEPARTMENTS, selected: S.selected, officeName: S.state.settings.officeName });
    if (S.selected && !agentById(S.selected)) S.selected = null;
    if (S.view === 'office') { renderRoster(); renderSide(); }
    if (S.view === 'tasks') renderBoard();
    if (S.view === 'settings') renderSettings();
  }

  function renderTitleStats() {
    const agents = S.state.agents;
    const busy = agents.filter((a) => runOf(a.id).status !== 'idle').length;
    const done = S.state.tasks.filter((t) => t.status === 'done').length;
    $('#titleStats').innerHTML = `<span><i class="dot ${busy ? 'on' : ''}"></i>${busy}/${agents.length} busy</span><span>✔ ${done} done</span>`;
  }

  function renderRoster() {
    const root = $('#roster');
    root.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const a = S.state.agents[i];
      if (!a) {
        const slot = h('<button class="slot empty"><span class="plus">+</span><span>Hire agent</span></button>');
        slot.addEventListener('click', () => openAgentModal());
        root.append(slot);
        continue;
      }
      const run = runOf(a.id);
      const el = h(`<button class="slot ${S.selected === a.id ? 'sel' : ''}" style="--dc:${deptColor(a)}">
        <div class="slot-body">
          <div class="slot-name">${esc(a.name)}</div>
          <div class="slot-dept">${esc(a.department)}</div>
          <div class="slot-status s-${run.status}"><i></i>${STATUS_TEXT[run.status] || run.status}${run.queued ? ` · +${run.queued}` : ''}</div>
        </div></button>`);
      el.prepend(portrait(a, 38));
      el.addEventListener('click', () => select(S.selected === a.id ? null : a.id));
      root.append(el);
    }
  }

  // Side panel: office overview, or the selected agent's chat.
  function renderSide(force) {
    const side = $('#side');
    if (!S.selected) {
      if (S.sideFor === null && !force) { renderOverviewStats(); return; }
      S.sideFor = null;
      side.innerHTML = '';
      side.append(overviewPanel());
      return;
    }
    if (S.sideFor === S.selected) { renderSideHeader(); return; }
    S.sideFor = S.selected;
    side.innerHTML = '';
    side.append(agentPanel(agentById(S.selected)));
    loadHistory(S.selected);
  }

  function overviewPanel() {
    const el = h(`<div class="panel overview">
      <div class="panel-head"><div><div class="eyebrow">Headquarters</div><h3>${esc(S.state.settings.officeName)}</h3></div></div>
      <div class="stats" id="ovStats"></div>
      <div class="quick">
        <button class="btn primary" data-a="hire">+ Hire agent</button>
        <button class="btn" data-a="task">+ New task</button>
      </div>
      <div class="section-title">Activity</div>
      <div class="feed" id="feed"></div>
      <div class="hint">Tip: click an agent in the office to chat with them. Click an open desk to hire.</div>
    </div>`);
    el.querySelector('[data-a=hire]').addEventListener('click', () => openAgentModal());
    el.querySelector('[data-a=task]').addEventListener('click', () => openTaskModal());
    setTimeout(renderOverviewStats);
    return el;
  }

  function renderOverviewStats() {
    const st = $('#ovStats'); const feed = $('#feed');
    if (!st || !feed) return;
    const tasks = S.state.tasks;
    const tokens = S.state.agents.reduce((n, a) => n + (a.stats?.tokensIn || 0) + (a.stats?.tokensOut || 0), 0);
    st.innerHTML = [
      ['Agents', `${S.state.agents.length}/8`], ['In progress', tasks.filter((t) => t.status === 'running' || t.status === 'queued').length],
      ['Completed', tasks.filter((t) => t.status === 'done').length], ['Tokens', fmtTokens(tokens)],
    ].map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
    feed.innerHTML = S.state.feed.length ? S.state.feed.slice(0, 40).map((f) => {
      const a = agentById(f.agentId);
      return `<div class="feed-item"><i style="background:${a ? deptColor(a) : '#556'}"></i><span>${esc(f.text)}</span><time>${timeAgo(f.ts)}</time></div>`;
    }).join('') : '<div class="empty-note">Nothing yet — hire your first agent and give them a task.</div>';
  }

  function agentPanel(a) {
    const el = h(`<div class="panel agent" style="--dc:${deptColor(a)}">
      <div class="agent-head">
        <div class="ph"></div>
        <div class="agent-meta">
          <div class="agent-name">${esc(a.name)} <span class="lvl" id="agentLvl"></span></div>
          <div class="agent-role">${esc(a.role || 'Generalist')} · <span class="dept-name">${esc(a.department)}</span></div>
          <div class="agent-status" id="agentStatus"></div>
        </div>
        <div class="agent-actions">
          <button class="icon-btn" title="Edit agent" data-a="edit">✎</button>
          <button class="icon-btn" title="Close" data-a="close">✕</button>
        </div>
      </div>
      <div class="agent-sub" id="agentSub"></div>
      <div class="chat" id="chat"></div>
      <div class="composer">
        <textarea id="composerInput" rows="2" placeholder="Message ${esc(a.name)}…  (Enter to send, Shift+Enter for new line)"></textarea>
        <div class="composer-row">
          <div class="composer-left">
            <button class="btn ghost small" data-a="stop" title="Stop the current work">■ Stop</button>
            <button class="btn ghost small" data-a="clear" title="Clear the conversation memory">Clear chat</button>
          </div>
          <div class="composer-right">
            <button class="btn small" data-a="task" title="Put this on the task board and start it">Make task</button>
            <button class="btn primary small" data-a="send">Send ➤</button>
          </div>
        </div>
      </div>
    </div>`);
    el.querySelector('.ph').append(portrait(a, 56));
    const input = el.querySelector('#composerInput');
    const send = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      await call(api.send, a.id, text);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    el.querySelector('[data-a=send]').addEventListener('click', send);
    el.querySelector('[data-a=task]').addEventListener('click', async () => {
      const text = input.value.trim();
      if (!text) { openTaskModal({ agentId: a.id }); return; }
      input.value = '';
      const [title, ...rest] = text.split('\n');
      const id = await call(api.saveTask, { title: title.slice(0, 120), description: rest.join('\n').trim() || (title.length > 120 ? text : ''), agentId: a.id });
      await call(api.startTask, id);
      toast(`Task created for <b>${esc(a.name)}</b>`);
    });
    el.querySelector('[data-a=stop]').addEventListener('click', () => call(api.stop, a.id));
    el.querySelector('[data-a=clear]').addEventListener('click', async () => {
      if (await confirmBox('Clear chat?', `${esc(a.name)} will forget this conversation. Tasks stay on the board.`, 'Clear')) call(api.clear, a.id);
    });
    el.querySelector('[data-a=edit]').addEventListener('click', () => openAgentModal(a));
    el.querySelector('[data-a=close]').addEventListener('click', () => select(null));
    setTimeout(() => { renderSideHeader(); input.focus(); });
    return el;
  }

  function renderSideHeader() {
    const a = agentById(S.selected);
    const st = $('#agentStatus'); const sub = $('#agentSub');
    if (!a || !st) return;
    const run = runOf(a.id);
    st.className = `agent-status s-${run.status}`;
    st.innerHTML = `<i></i>${STATUS_TEXT[run.status] || run.status}${run.detail ? ` — <span>${esc(run.detail)}</span>` : ''}${run.queued ? ` <em>(+${run.queued} queued)</em>` : ''}`;
    const p = providerById(a.providerId);
    const level = 1 + Math.floor(Math.sqrt(a.stats?.tasksDone || 0));
    $('#agentLvl').textContent = `LV ${level}`;
    sub.innerHTML = `<span class="chip">${p ? esc(p.name) : '<b class="warn">No provider</b>'}</span><span class="chip mono">${esc(a.model || 'no model')}</span>
      <span class="chip">${PERMISSIONS[a.permission || 'ask'].label}</span><span class="chip">✔ ${a.stats?.tasksDone || 0}</span><span class="chip">${fmtTokens((a.stats?.tokensIn || 0) + (a.stats?.tokensOut || 0))} tok</span>`;
  }

  async function loadHistory(id) {
    if (!S.histories[id]) S.histories[id] = await call(api.history, id);
    if (S.selected !== id) return;
    const chat = $('#chat');
    chat.innerHTML = '';
    const list = S.histories[id];
    if (!list.length) {
      const a = agentById(id);
      chat.append(h(`<div class="chat-empty">
        <div class="big">👋</div>
        <p><b>${esc(a.name)}</b> is ready. Ask anything, or give a task like:</p>
        <div class="suggest">
          ${suggestionsFor(a).map((s) => `<button class="sugg">${esc(s)}</button>`).join('')}
        </div></div>`));
      $$('.sugg', chat).forEach((b) => b.addEventListener('click', () => { $('#composerInput').value = b.textContent; $('#composerInput').focus(); }));
      return;
    }
    for (const e of list) appendEntry(e, false);
    chat.scrollTop = chat.scrollHeight;
  }

  function suggestionsFor(a) {
    return ({
      Engineering: ['Create a Python script in the workspace that renames my photos by date', 'Check which versions of node, python and git are installed'],
      Research: ['Research the top 5 open-source LLMs and write a comparison report', 'Summarize the files in my Downloads folder'],
      Design: ['Design a landing page for a coffee shop as a single HTML file and open it', 'Create an SVG logo for "AI Labs"'],
      Marketing: ['Write 5 tweet ideas announcing our new app', 'Draft a launch blog post and save it as launch.md'],
      Operations: ['Organise my Downloads folder into subfolders by file type', 'Show me disk usage and the largest folders in my home directory'],
      Finance: ['Create a monthly budget spreadsheet (CSV) template', 'Analyse a CSV I give you and summarise totals by category'],
      Sales: ['Write a cold outreach email for a web design agency', 'Create a one-page proposal template in Markdown'],
      Support: ['Write an FAQ for AI Labs Office', 'Explain how to reset a Windows network adapter step by step'],
    })[a.department] || ['Introduce yourself', 'What can you do on my computer?'];
  }

  function toolSummary(c) {
    const a = c.args || {};
    return a.command || a.path || a.url || a.target || (a.coworker ? `${a.coworker}: ${a.title}` : '') || a.message || a.name || a.text || a.action || '';
  }

  function appendEntry(e, live) {
    const chat = $('#chat');
    if (!chat) return;
    chat.querySelector('.chat-empty')?.remove();
    const stick = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80;
    if (e.role === 'user') {
      const isTask = e.content.startsWith('NEW TASK');
      const body = isTask ? e.content.replace(/\n\nWork on it autonomously[\s\S]*$/, '').replace(/\nWork on it autonomously[\s\S]*$/, '') : e.content;
      chat.append(h(`<div class="msg user ${isTask ? 'task' : ''}">${isTask ? '<div class="tag">TASK</div>' : ''}<div class="bubble">${md(body.replace(/^NEW TASK[^:]*:\s*/, ''))}</div></div>`));
    } else if (e.role === 'assistant') {
      if (e.content) chat.append(h(`<div class="msg bot"><div class="bubble">${md(e.content)}</div></div>`));
      for (const c of e.toolCalls || []) {
        const el = h(`<details class="tool pending" data-call="${esc(c.id)}">
          <summary><span class="tico">⚙</span><b>${esc(c.name)}</b><span class="targ">${esc(toolSummary(c))}</span><span class="tstate"></span></summary>
          <div class="tbody"><div class="tlabel">Input</div><pre>${esc(JSON.stringify(c.args || {}, null, 2))}</pre><div class="tlabel">Result</div><pre class="tres">…</pre></div>
        </details>`);
        chat.append(el);
      }
    } else if (e.role === 'tool') {
      const el = chat.querySelector(`[data-call="${CSS.escape(e.toolCallId)}"]`);
      if (el) {
        el.classList.remove('pending');
        el.classList.add(e.isError ? 'bad' : 'good');
        el.querySelector('.tres').textContent = e.content;
      }
    } else if (e.role === 'note') {
      chat.append(h(`<div class="note ${e.isError ? 'err' : ''}">${esc(e.content)}</div>`));
    }
    if (!live || stick) chat.scrollTop = chat.scrollHeight;
  }

  // ---------- task board ----------
  function renderBoard() {
    const board = $('#board');
    const cols = [
      { key: 'backlog', title: 'Backlog', match: (t) => t.status === 'backlog' },
      { key: 'active', title: 'In progress', match: (t) => t.status === 'running' || t.status === 'queued' },
      { key: 'done', title: 'Done', match: (t) => t.status === 'done' },
      { key: 'failed', title: 'Needs attention', match: (t) => t.status === 'failed' },
    ];
    const prio = { high: 0, normal: 1, low: 2 };
    board.innerHTML = '';
    for (const col of cols) {
      const tasks = S.state.tasks.filter(col.match).sort((a, b) => (col.key === 'backlog' ? (prio[a.priority] - prio[b.priority]) : 0) || (b.finishedAt || b.createdAt) - (a.finishedAt || a.createdAt));
      const colEl = h(`<div class="col col-${col.key}"><div class="col-head"><span>${col.title}</span><span class="count">${tasks.length}</span></div><div class="col-body"></div></div>`);
      const body = colEl.querySelector('.col-body');
      if (!tasks.length) body.append(h(`<div class="col-empty">${col.key === 'backlog' ? 'Create a task to get started' : '—'}</div>`));
      for (const t of tasks) body.append(taskCard(t));
      board.append(colEl);
    }
  }

  function taskCard(t) {
    const a = agentById(t.agentId);
    const from = agentById(t.fromAgentId);
    const run = a ? runOf(a.id) : null;
    const el = h(`<div class="card prio-${t.priority || 'normal'}" style="--dc:${a ? deptColor(a) : '#556'}">
      <div class="card-top"><div class="card-title">${esc(t.title)}</div>${t.priority === 'high' ? '<span class="tagp">HIGH</span>' : ''}</div>
      ${t.description ? `<div class="card-desc">${esc(t.description.slice(0, 180))}${t.description.length > 180 ? '…' : ''}</div>` : ''}
      ${t.status === 'running' && run ? `<div class="card-live"><span class="spinner"></span>${esc(run.detail || STATUS_TEXT[run.status])}</div>` : ''}
      ${t.status === 'queued' ? '<div class="card-live muted">Queued…</div>' : ''}
      ${(t.status === 'done' || t.status === 'failed') && t.result ? `<div class="card-result">${esc(t.result.slice(0, 160))}${t.result.length > 160 ? '…' : ''}</div>` : ''}
      <div class="card-foot">
        <div class="assignee"></div>
        <div class="card-btns"></div>
      </div>
      ${from ? `<div class="card-from">delegated by ${esc(from.name)}</div>` : ''}
    </div>`);
    const as = el.querySelector('.assignee');
    if (t.status === 'backlog' || t.status === 'failed' || t.status === 'done') {
      const sel = h(`<select class="mini">${['<option value="">Unassigned</option>', ...S.state.agents.map((x) => `<option value="${x.id}" ${x.id === t.agentId ? 'selected' : ''}>${esc(x.name)} · ${esc(x.department)}</option>`)].join('')}</select>`);
      sel.addEventListener('change', () => call(api.saveTask, { id: t.id, agentId: sel.value || null }));
      if (a) as.append(portrait(a, 22));
      as.append(sel);
    } else if (a) {
      as.append(portrait(a, 22));
      as.append(h(`<span>${esc(a.name)}</span>`));
    }
    const btns = el.querySelector('.card-btns');
    const btn = (label, title, fn, cls = '') => { const b = h(`<button class="icon-btn ${cls}" title="${title}">${label}</button>`); b.addEventListener('click', fn); btns.append(b); };
    if (t.status === 'backlog') btn('▶', 'Start', () => call(api.startTask, t.id), 'go');
    if (t.status === 'done' || t.status === 'failed') { btn('☰', 'View result', () => openResult(t.id)); btn('↻', 'Run again', () => call(api.startTask, t.id)); }
    if (t.status === 'running' || t.status === 'queued') btn('■', 'Stop agent', () => call(api.stop, t.agentId));
    if (a) btn('💬', 'Open chat', () => select(a.id));
    if (t.status !== 'running') btn('✎', 'Edit', () => openTaskModal(t));
    btn('🗑', 'Delete', async () => { if (await confirmBox('Delete task?', esc(t.title), 'Delete')) call(api.deleteTask, t.id); }, 'danger');
    return el;
  }

  // ---------- settings ----------
  function renderSettings() {
    const s = S.state.settings;
    const root = $('#settings');
    root.innerHTML = '';
    const el = h(`<div>
      <div class="set-section">
        <div class="set-head"><div><h2>AI Providers</h2><p class="muted">Connect cloud APIs or local models. Keys are stored only on this computer.</p></div>
          <button class="btn primary" id="addProv">+ Add provider</button></div>
        <div class="prov-list" id="provList"></div>
      </div>
      <div class="set-section">
        <h2>Office</h2>
        <div class="form-grid">
          <label>Office name<input id="setName" value="${esc(s.officeName)}" /></label>
          <label>Max steps per task<input id="setSteps" type="number" min="1" max="200" value="${esc(s.maxSteps)}" /></label>
          <label class="span2"><span>Workspace folder <span class="muted">(where agents create files by default)</span></span>
            <div class="row"><input id="setWs" value="${esc(s.workspace)}" /><button class="btn" id="pickWs">Browse…</button><button class="btn" id="openWs">Open</button></div></label>
          <label class="check"><input type="checkbox" id="setSound" ${s.sound ? 'checked' : ''}/> Sound effects</label>
        </div>
        <div class="row end"><button class="btn primary" id="saveSettings">Save settings</button></div>
      </div>
      <div class="set-section">
        <h2>Safety</h2>
        <p class="muted">Agents act on your real computer. Each agent has a permission level (edit an agent to change it):</p>
        <ul class="perm-list">${Object.values(PERMISSIONS).map((p) => `<li><b>${p.label}</b> — ${p.desc}</li>`).join('')}</ul>
        <p class="muted">Tools available to agents: ${S.tools.map((t) => `<code>${t.name}</code>`).join(' ')}</p>
      </div>
      <div class="set-section about"><b>AI Labs Office</b> v${esc(S.version)} · ${esc(S.platform)}</div>
    </div>`);
    root.append(el);
    const list = el.querySelector('#provList');
    if (!S.state.providers.length) list.append(h('<div class="empty-note">No providers yet. Add one to bring your agents to life.</div>'));
    for (const p of S.state.providers) {
      const used = S.state.agents.filter((a) => a.providerId === p.id).length;
      const card = h(`<div class="prov">
        <div class="prov-icon">${esc(p.name.slice(0, 1))}</div>
        <div class="prov-info"><div class="prov-name">${esc(p.name)}</div><div class="muted mono">${esc(p.baseUrl)}</div>
          <div class="muted">${p.type === 'anthropic' ? 'Anthropic API' : 'OpenAI-compatible'} · ${p.apiKey ? 'key saved' : 'no key'} · default model <span class="mono">${esc(p.defaultModel || '—')}</span> · used by ${used} agent${used === 1 ? '' : 's'}</div></div>
        <div class="prov-btns"><button class="btn small" data-a="edit">Edit</button><button class="btn small danger" data-a="del">Remove</button></div>
      </div>`);
      card.querySelector('[data-a=edit]').addEventListener('click', () => openProviderModal(p));
      card.querySelector('[data-a=del]').addEventListener('click', async () => {
        if (await confirmBox('Remove provider?', `${esc(p.name)} will be removed${used ? ` and ${used} agent(s) will need a new provider` : ''}.`, 'Remove')) call(api.deleteProvider, p.id);
      });
      list.append(card);
    }
    el.querySelector('#addProv').addEventListener('click', () => openProviderModal());
    el.querySelector('#pickWs').addEventListener('click', async () => { const d = await call(api.pickFolder); if (d) el.querySelector('#setWs').value = d; });
    el.querySelector('#openWs').addEventListener('click', () => api.open(S.state.settings.workspace));
    el.querySelector('#saveSettings').addEventListener('click', async () => {
      await call(api.saveSettings, {
        officeName: el.querySelector('#setName').value.trim() || 'AI Labs HQ',
        maxSteps: Math.max(1, Math.min(200, Number(el.querySelector('#setSteps').value) || 25)),
        workspace: el.querySelector('#setWs').value.trim(),
        sound: el.querySelector('#setSound').checked,
      });
      toast('Settings saved', 'ok');
    });
  }

  // ---------- modals ----------
  function modal(html, { wide, onClose } = {}) {
    const root = $('#modalRoot');
    const wrap = h(`<div class="modal-wrap"><div class="modal ${wide ? 'wide' : ''}">${html}</div></div>`);
    const close = () => { wrap.classList.add('out'); setTimeout(() => wrap.remove(), 150); onClose?.(); };
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    const onKey = (e) => { if (e.key === 'Escape' && wrap.isConnected && root.lastElementChild === wrap) { close(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
    root.append(wrap);
    return { el: wrap.querySelector('.modal'), close };
  }

  function confirmBox(title, text, okLabel = 'OK') {
    return new Promise((resolve) => {
      let answered = false;
      const m = modal(`<h3>${title}</h3><p class="muted">${text}</p><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn danger" data-ok>${okLabel}</button></div>`,
        { onClose: () => { if (!answered) resolve(false); } });
      m.el.querySelector('[data-ok]').addEventListener('click', () => { answered = true; resolve(true); m.close(); });
    });
  }

  function openWelcome() {
    const m = modal(`<div class="welcome">
      <div class="welcome-art"><canvas id="welcomeArt" width="96" height="96"></canvas></div>
      <h2>Welcome to AI Labs Office</h2>
      <p class="muted">Build a team of up to 8 AI agents that work on your computer. First, connect an AI provider — a cloud API or a model running locally.</p>
      <div class="preset-grid" id="welcomePresets"></div>
      <div class="modal-foot"><button class="btn ghost" data-close>Skip for now</button></div>
    </div>`, { wide: true });
    const c = m.el.querySelector('#welcomeArt');
    window.Sprites.drawPortrait(c, window.Sprites.randomLook('#4f8cff'), null);
    const grid = m.el.querySelector('#welcomePresets');
    for (const p of S.presets) {
      const b = h(`<button class="preset"><b>${esc(p.name)}</b><span>${p.needsKey ? 'API key' : 'No key needed'}</span></button>`);
      b.addEventListener('click', () => { m.close(); openProviderModal(null, p.kind, true); });
      grid.append(b);
    }
  }

  function openProviderModal(existing, presetKind, onboarding) {
    const preset = S.presets.find((p) => p.kind === (existing?.kind || presetKind)) || S.presets[0];
    const p = existing ? { ...existing } : { kind: preset.kind, type: preset.type, name: preset.name, baseUrl: preset.baseUrl, apiKey: '', models: preset.models, defaultModel: preset.models[0] || '' };
    const m = modal(`<h3>${existing ? 'Edit provider' : 'Add AI provider'}</h3>
      <div class="form-grid">
        <label class="span2">Provider type
          <select id="pKind">${S.presets.map((x) => `<option value="${x.kind}" ${x.kind === p.kind ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label>Display name<input id="pName" value="${esc(p.name)}" /></label>
        <label>Base URL<input id="pUrl" class="mono" value="${esc(p.baseUrl)}" /></label>
        <label class="span2"><span>API key <span class="muted" id="pKeyHint"></span></span>
          <div class="row"><input id="pKey" type="password" class="mono" value="${esc(p.apiKey || '')}" placeholder="Paste your key" autocomplete="off" /><button class="btn" id="pShow">Show</button></div></label>
        <label class="span2">Default model
          <div class="row"><input id="pModel" class="mono" list="pModels" value="${esc(p.defaultModel || '')}" placeholder="model id" /><datalist id="pModels"></datalist>
          <button class="btn" id="pFetch">Fetch models</button><button class="btn" id="pTest">Test</button></div></label>
      </div>
      <div class="test-out" id="pOut"></div>
      <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="pSave">${existing ? 'Save' : 'Add provider'}</button></div>`);
    const $m = (s) => m.el.querySelector(s);
    let models = [...(p.models || [])];
    const fillModels = () => { $m('#pModels').innerHTML = models.map((x) => `<option value="${esc(x)}">`).join(''); };
    const hint = () => {
      const pr = S.presets.find((x) => x.kind === $m('#pKind').value);
      $m('#pKeyHint').textContent = pr?.needsKey ? '(required)' : '(optional for local servers)';
    };
    fillModels(); hint();
    $m('#pKind').addEventListener('change', () => {
      const pr = S.presets.find((x) => x.kind === $m('#pKind').value);
      $m('#pName').value = pr.name; $m('#pUrl').value = pr.baseUrl; models = [...pr.models]; $m('#pModel').value = pr.models[0] || '';
      fillModels(); hint();
    });
    $m('#pShow').addEventListener('click', () => { const k = $m('#pKey'); k.type = k.type === 'password' ? 'text' : 'password'; });
    const current = () => {
      const pr = S.presets.find((x) => x.kind === $m('#pKind').value);
      return { ...(existing || {}), kind: pr.kind, type: pr.type, name: $m('#pName').value.trim() || pr.name, baseUrl: $m('#pUrl').value.trim(), apiKey: $m('#pKey').value.trim(), models, defaultModel: $m('#pModel').value.trim() };
    };
    const out = (html, cls) => { $m('#pOut').className = `test-out ${cls || ''}`; $m('#pOut').innerHTML = html; };
    $m('#pFetch').addEventListener('click', async () => {
      out('<span class="spinner"></span> Fetching models…');
      const res = await api.listModels(current());
      if (!res.ok) return out(`Could not fetch models: ${esc(res.error)}`, 'err');
      models = res.data; fillModels();
      if (!$m('#pModel').value && models[0]) $m('#pModel').value = models[0];
      out(`Found ${models.length} models. Pick one in the Default model box.`, 'ok');
    });
    $m('#pTest').addEventListener('click', async () => {
      const c = current();
      if (!c.defaultModel) return out('Enter a model first.', 'err');
      out('<span class="spinner"></span> Sending a test message…');
      const res = await api.testProvider(c, c.defaultModel);
      out(res.ok ? `✔ Connected — model replied: “${esc(res.data.slice(0, 80))}”` : `✖ ${esc(res.error)}`, res.ok ? 'ok' : 'err');
    });
    $m('#pSave').addEventListener('click', async () => {
      const c = current();
      if (!c.baseUrl) return out('Base URL is required.', 'err');
      const id = await call(api.saveProvider, c);
      m.close();
      toast(`${esc(c.name)} saved`, 'ok');
      if (onboarding && !S.state.agents.length) openStarterTeam(id, c.defaultModel);
    });
  }

  function openStarterTeam(providerId, model) {
    const m = modal(`<h3>Your provider is connected 🎉</h3>
      <p class="muted">Hire a starter team of four agents using <span class="mono">${esc(model || 'the default model')}</span>, or design your own agents one by one.</p>
      <div class="starter" id="starter"></div>
      <div class="modal-foot"><button class="btn" data-a="custom">I'll hire them myself</button><button class="btn primary" data-a="team">Hire starter team</button></div>`);
    const team = [
      { name: 'Ada', department: 'Engineering', role: 'Senior Software Engineer' },
      { name: 'Iris', department: 'Research', role: 'Research Analyst' },
      { name: 'Milo', department: 'Design', role: 'Product Designer' },
      { name: 'Otto', department: 'Operations', role: 'Operations Manager' },
    ].map((a) => ({ ...a, look: window.Sprites.randomLook(DEPARTMENTS[a.department].color) }));
    const st = m.el.querySelector('#starter');
    for (const a of team) {
      const card = h(`<div class="starter-card" style="--dc:${DEPARTMENTS[a.department].color}"><div class="sc-ph"></div><b>${a.name}</b><span>${a.role}</span></div>`);
      card.querySelector('.sc-ph').append(portrait(a, 56));
      st.append(card);
    }
    m.el.querySelector('[data-a=custom]').addEventListener('click', () => { m.close(); openAgentModal(); });
    m.el.querySelector('[data-a=team]').addEventListener('click', async () => {
      for (const a of team) {
        await call(api.saveAgent, { ...a, providerId, model, permission: 'ask', instructions: DEPARTMENTS[a.department].brief });
      }
      if (S.state.settings.sound) beep('hire');
      m.close();
      toast('Welcome aboard, team! Click an agent to give them work.', 'ok');
    });
  }

  function openAgentModal(existing) {
    if (!existing && S.state.agents.length >= 8) { toast('The office is full — 8 agents max.', 'err'); return; }
    const dept = existing?.department || Object.keys(DEPARTMENTS)[S.state.agents.length % 8];
    const firstProv = S.state.providers[0];
    const a = existing ? JSON.parse(JSON.stringify(existing)) : {
      name: NAMES.filter((n) => !S.state.agents.some((x) => x.name === n))[Math.floor(Math.random() * 20)] || 'Agent',
      department: dept, role: DEPARTMENTS[dept].roles[0], providerId: firstProv?.id || '', model: firstProv?.defaultModel || '',
      permission: 'ask', instructions: DEPARTMENTS[dept].brief, look: window.Sprites.randomLook(DEPARTMENTS[dept].color),
    };
    const m = modal(`<h3>${existing ? `Edit ${esc(existing.name)}` : 'Hire a new agent'}</h3>
      <div class="hire">
        <div class="hire-look">
          <canvas id="lookBig" width="160" height="160"></canvas>
          <button class="btn small" id="lookRand">🎲 Randomize</button>
          <div class="swatch-label">Shirt</div><div class="swatches" id="swShirt"></div>
          <div class="swatch-label">Hair</div><div class="swatches" id="swHair"></div>
          <div class="swatch-label">Skin</div><div class="swatches" id="swSkin"></div>
          <button class="btn small ghost" id="lookStyle">Change hairstyle</button>
        </div>
        <div class="hire-form form-grid">
          <label>Name<div class="row"><input id="aName" value="${esc(a.name)}" maxlength="24" /><button class="btn" id="aNameRand" title="Random name">🎲</button></div></label>
          <label>Role / job title<input id="aRole" list="aRoles" value="${esc(a.role || '')}" /><datalist id="aRoles"></datalist></label>
          <div class="span2"><div class="lbl">Department</div><div class="dept-grid" id="aDept"></div></div>
          <label>AI provider<select id="aProv">${S.state.providers.length ? S.state.providers.map((p) => `<option value="${p.id}" ${p.id === a.providerId ? 'selected' : ''}>${esc(p.name)}</option>`).join('') : '<option value="">— add a provider in Settings —</option>'}</select></label>
          <label>Model<input id="aModel" class="mono" list="aModels" value="${esc(a.model || '')}" placeholder="model id" /><datalist id="aModels"></datalist></label>
          <div class="span2"><div class="lbl">Permissions</div><div class="perm-grid" id="aPerm"></div></div>
          <label class="span2">Instructions / personality<textarea id="aInstr" rows="4">${esc(a.instructions || '')}</textarea></label>
        </div>
      </div>
      <div class="modal-foot">${existing ? '<button class="btn danger" id="aFire">Fire agent</button><span class="grow"></span>' : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" id="aSave">${existing ? 'Save changes' : 'Hire'}</button></div>`, { wide: true });
    const $m = (s) => m.el.querySelector(s);
    const drawLook = () => {
      const c = $m('#lookBig'); const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#1a1e38'; ctx.fillRect(0, 0, 160, 160);
      ctx.fillStyle = DEPARTMENTS[a.department].color + '33'; ctx.fillRect(0, 120, 160, 40);
      ctx.save(); ctx.scale(5, 5); window.Sprites.drawCharacter(ctx, 16, 28, a.look, { facing: 'down' }); ctx.restore();
    };
    const swatches = (id, colors, key) => {
      const el = $m(id); el.innerHTML = '';
      for (const col of colors) {
        const b = h(`<button class="sw ${a.look[key] === col ? 'on' : ''}" style="background:${col}"></button>`);
        b.addEventListener('click', () => { a.look[key] = col; swatches(id, colors, key); drawLook(); });
        el.append(b);
      }
    };
    const allSwatches = () => { swatches('#swShirt', window.Sprites.SHIRTS, 'shirt'); swatches('#swHair', window.Sprites.HAIRS, 'hair'); swatches('#swSkin', window.Sprites.SKINS, 'skin'); };
    const deptGrid = () => {
      const g = $m('#aDept'); g.innerHTML = '';
      for (const [name, d] of Object.entries(DEPARTMENTS)) {
        const b = h(`<button class="dept ${a.department === name ? 'on' : ''}" style="--dc:${d.color}"><span>${d.icon}</span>${name}</button>`);
        b.addEventListener('click', () => {
          const prevBrief = DEPARTMENTS[a.department].brief;
          a.department = name;
          if (!$m('#aInstr').value.trim() || $m('#aInstr').value.trim() === prevBrief) $m('#aInstr').value = d.brief;
          if (!existing) { $m('#aRole').value = d.roles[0]; a.look.shirt = d.color; allSwatches(); }
          $m('#aRoles').innerHTML = d.roles.map((r) => `<option value="${esc(r)}">`).join('');
          deptGrid(); drawLook();
        });
        g.append(b);
      }
      $m('#aRoles').innerHTML = DEPARTMENTS[a.department].roles.map((r) => `<option value="${esc(r)}">`).join('');
    };
    const permGrid = () => {
      const g = $m('#aPerm'); g.innerHTML = '';
      for (const [k, p] of Object.entries(PERMISSIONS)) {
        const b = h(`<button class="perm ${a.permission === k ? 'on' : ''}"><b>${p.label}</b><span>${p.desc}</span></button>`);
        b.addEventListener('click', () => { a.permission = k; permGrid(); });
        g.append(b);
      }
    };
    const fillModels = () => {
      const p = providerById($m('#aProv').value);
      $m('#aModels').innerHTML = (p?.models || []).map((x) => `<option value="${esc(x)}">`).join('');
    };
    $m('#aProv').addEventListener('change', () => { const p = providerById($m('#aProv').value); if (p?.defaultModel) $m('#aModel').value = p.defaultModel; fillModels(); });
    $m('#lookRand').addEventListener('click', () => { a.look = window.Sprites.randomLook(); allSwatches(); drawLook(); });
    $m('#lookStyle').addEventListener('click', () => { a.look.hairStyle = (a.look.hairStyle + 1) % window.Sprites.HAIR_STYLES; drawLook(); });
    $m('#aNameRand').addEventListener('click', () => { $m('#aName').value = NAMES[Math.floor(Math.random() * NAMES.length)]; });
    $m('#aSave').addEventListener('click', async () => {
      const name = $m('#aName').value.trim();
      if (!name) return toast('Give your agent a name.', 'err');
      if (S.state.agents.some((x) => x.name.toLowerCase() === name.toLowerCase() && x.id !== existing?.id)) return toast('Another agent already has that name.', 'err');
      await call(api.saveAgent, {
        ...(existing ? { id: existing.id } : {}),
        name, role: $m('#aRole').value.trim(), department: a.department,
        providerId: $m('#aProv').value || null, model: $m('#aModel').value.trim(),
        permission: a.permission, instructions: $m('#aInstr').value.trim(), look: a.look,
      });
      if (!existing && S.state.settings.sound) beep('hire');
      m.close();
      toast(existing ? 'Agent updated' : `${esc(name)} was hired!`, 'ok');
      if (existing && S.selected === existing.id) { S.sideFor = undefined; renderSide(); }
    });
    $m('#aFire')?.addEventListener('click', async () => {
      if (await confirmBox(`Fire ${esc(existing.name)}?`, 'Their chat history is deleted. Their open tasks go back to the backlog.', 'Fire')) {
        await call(api.deleteAgent, existing.id);
        m.close();
        if (S.selected === existing.id) select(null);
      }
    });
    allSwatches(); deptGrid(); permGrid(); fillModels(); drawLook();
  }

  function openTaskModal(t = {}) {
    const existing = !!t.id;
    const m = modal(`<h3>${existing ? 'Edit task' : 'New task'}</h3>
      <div class="form-grid">
        <label class="span2">Title<input id="tTitle" value="${esc(t.title || '')}" placeholder="e.g. Build a to-do web app in the workspace" /></label>
        <label class="span2">Details<textarea id="tDesc" rows="6" placeholder="Goals, files, constraints, what 'done' looks like…">${esc(t.description || '')}</textarea></label>
        <label>Assign to<select id="tAgent"><option value="">Unassigned</option>${S.state.agents.map((a) => `<option value="${a.id}" ${a.id === t.agentId ? 'selected' : ''}>${esc(a.name)} · ${esc(a.department)}</option>`).join('')}</select></label>
        <label>Priority<select id="tPrio">${['high', 'normal', 'low'].map((p) => `<option ${p === (t.priority || 'normal') ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
        ${existing ? '' : '<label class="check span2"><input type="checkbox" id="tStart" checked /> Start right away (if assigned)</label>'}
      </div>
      <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="tSave">${existing ? 'Save' : 'Create task'}</button></div>`);
    const $m = (s) => m.el.querySelector(s);
    setTimeout(() => $m('#tTitle').focus());
    $m('#tSave').addEventListener('click', async () => {
      const title = $m('#tTitle').value.trim();
      if (!title) return toast('A task needs a title.', 'err');
      const agentId = $m('#tAgent').value || null;
      const id = await call(api.saveTask, { ...(existing ? { id: t.id } : {}), title, description: $m('#tDesc').value.trim(), agentId, priority: $m('#tPrio').value });
      if (!existing && agentId && $m('#tStart').checked) await call(api.startTask, id);
      m.close();
    });
  }

  function openResult(taskId) {
    const t = S.state.tasks.find((x) => x.id === taskId);
    if (!t) return;
    const a = agentById(t.agentId);
    const dur = t.finishedAt && t.startedAt ? `${Math.max(1, Math.round((t.finishedAt - t.startedAt) / 1000))}s` : '';
    const m = modal(`<h3>${esc(t.title)}</h3>
      <div class="muted">${a ? `${esc(a.name)} · ${esc(a.department)}` : ''} ${dur ? `· took ${dur}` : ''} · <span class="st-${t.status}">${t.status}</span></div>
      <div class="result-body">${md(t.result || '(no result)')}</div>
      <div class="modal-foot">${a ? '<button class="btn" data-a="chat">Open chat</button>' : ''}<button class="btn" data-a="ws">Open workspace</button><button class="btn primary" data-close>Close</button></div>`, { wide: true });
    m.el.querySelector('[data-a=chat]')?.addEventListener('click', () => { m.close(); select(a.id); });
    m.el.querySelector('[data-a=ws]').addEventListener('click', () => api.open(S.state.settings.workspace));
  }

  // Approval requests queue up; show one at a time.
  let approvalModal = null;
  function showApproval() {
    const next = S.approvals[0];
    if (approvalModal && (!next || approvalModal.id !== next.id)) { approvalModal.m.close(); approvalModal = null; }
    if (!next || approvalModal) return;
    const a = agentById(next.agentId);
    const risky = next.tool === 'run_command' ? 'This will run a command on your computer.' : next.tool === 'open_on_computer' ? 'This will open something on your computer.' : 'This will change something outside the workspace.';
    const m = modal(`<div class="approval" style="--dc:${deptColor(a)}">
      <div class="ap-head"><div class="ap-ph"></div><div><div class="eyebrow">Permission request</div><h3>${esc(next.agentName)} wants to use <span class="mono">${esc(next.tool)}</span></h3><div class="muted">${risky}</div></div></div>
      <pre class="ap-args">${esc(next.tool === 'run_command' ? next.args?.command : next.summary || JSON.stringify(next.args, null, 2))}</pre>
      ${next.tool === 'run_command' ? '' : `<details><summary class="muted">Full details</summary><pre class="ap-args small">${esc(JSON.stringify(next.args, null, 2))}</pre></details>`}
      ${S.approvals.length > 1 ? `<div class="muted">${S.approvals.length - 1} more request(s) waiting</div>` : ''}
      <div class="modal-foot"><button class="btn danger" data-d="deny">Deny</button><span class="grow"></span><button class="btn" data-d="always">Always allow ${esc(next.tool)}</button><button class="btn primary" data-d="once">Allow once</button></div>
    </div>`, { onClose: () => { if (approvalModal?.id === next.id) { approvalModal = null; api.respondApproval(next.id, 'deny'); } } });
    if (a) m.el.querySelector('.ap-ph').append(portrait(a, 48));
    approvalModal = { id: next.id, m };
    m.el.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => {
      approvalModal = null;
      api.respondApproval(next.id, b.dataset.d);
      m.close();
    }));
  }

  boot();
})();
