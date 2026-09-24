// The office: agents, the task board, and the agent work loop.
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const store = require('./store');
const providers = require('./providers');
const tools = require('./tools');

const MAX_AGENTS = 8;
const MAX_DELEGATION_DEPTH = 3;
const uid = (p) => `${p}_${crypto.randomBytes(5).toString('hex')}`;

class Office {
  constructor(emit) {
    this.emit = emit;
    this.state = store.loadState();
    this.histories = new Map();
    this.runtime = new Map(); // agentId -> { status, detail, queue, controller, busy }
    this.approvals = new Map(); // approvalId -> { resolve, agentId }
    // Tasks that were mid-flight when the app closed are put back on the board.
    for (const t of this.state.tasks) if (t.status === 'running' || t.status === 'queued') t.status = 'backlog';
    for (const a of this.state.agents) this.rt(a.id);
    this.ensureWorkspace();
  }

  // ---------- helpers ----------

  ensureWorkspace() {
    try { fs.mkdirSync(this.state.settings.workspace, { recursive: true }); } catch {}
  }

  rt(agentId) {
    if (!this.runtime.has(agentId)) this.runtime.set(agentId, { status: 'idle', detail: '', queue: [], controller: null, busy: false });
    return this.runtime.get(agentId);
  }

  agent(id) { return this.state.agents.find((a) => a.id === id); }
  task(id) { return this.state.tasks.find((t) => t.id === id); }
  provider(id) { return this.state.providers.find((p) => p.id === id); }

  history(agentId) {
    if (!this.histories.has(agentId)) this.histories.set(agentId, store.loadHistory(agentId));
    return this.histories.get(agentId);
  }

  snapshot() {
    const runtime = {};
    for (const [id, r] of this.runtime) runtime[id] = { status: r.status, detail: r.detail, queued: r.queue.length };
    return { ...this.state, runtime };
  }

  changed() {
    store.saveState(this.state);
    this.emit('state', this.snapshot());
  }

  setStatus(agentId, status, detail = '') {
    const r = this.rt(agentId);
    r.status = status;
    r.detail = detail;
    this.emit('agent-status', { agentId, status, detail, queued: r.queue.length });
  }

  addFeed(text, agentId) {
    this.state.feed.unshift({ id: uid('f'), ts: Date.now(), text, agentId });
    this.state.feed.length = Math.min(this.state.feed.length, 100);
  }

  appendHistory(agentId, entry) {
    const h = this.history(agentId);
    entry.ts = entry.ts || Date.now();
    h.push(entry);
    store.saveHistory(agentId, h);
    this.emit('history', { agentId, entry: publicEntry(entry) });
  }

  // ---------- providers ----------

  saveProvider(p) {
    const existing = p.id && this.provider(p.id);
    if (existing) Object.assign(existing, p);
    else this.state.providers.push({ ...p, id: uid('prov') });
    this.changed();
    return existing ? existing.id : this.state.providers[this.state.providers.length - 1].id;
  }

  deleteProvider(id) {
    this.state.providers = this.state.providers.filter((p) => p.id !== id);
    for (const a of this.state.agents) if (a.providerId === id) a.providerId = null;
    this.changed();
  }

  // ---------- agents ----------

  saveAgent(a) {
    const existing = a.id && this.agent(a.id);
    if (existing) {
      Object.assign(existing, a);
    } else {
      if (this.state.agents.length >= MAX_AGENTS) throw new Error(`The office is full (${MAX_AGENTS} agents max).`);
      const agent = { permission: 'ask', autoApprove: [], stats: { tasksDone: 0, tokensIn: 0, tokensOut: 0 }, ...a, id: uid('agent'), hiredAt: Date.now() };
      this.state.agents.push(agent);
      this.rt(agent.id);
      this.addFeed(`${agent.name} joined ${agent.department}.`, agent.id);
    }
    this.changed();
  }

  deleteAgent(id) {
    const a = this.agent(id);
    if (!a) return;
    this.stop(id);
    this.state.agents = this.state.agents.filter((x) => x.id !== id);
    for (const t of this.state.tasks) if (t.agentId === id && t.status !== 'done') { t.agentId = null; t.status = 'backlog'; }
    this.runtime.delete(id);
    this.histories.delete(id);
    store.deleteHistory(id);
    this.addFeed(`${a.name} left the office.`);
    this.changed();
  }

  getHistory(id) {
    return this.history(id).map(publicEntry);
  }

  clearHistory(id) {
    this.histories.set(id, []);
    store.saveHistory(id, []);
    this.emit('history-reset', { agentId: id });
  }

  // ---------- tasks ----------

  saveTask(t) {
    const existing = t.id && this.task(t.id);
    if (existing) Object.assign(existing, t);
    else this.state.tasks.push({ status: 'backlog', priority: 'normal', depth: 0, createdAt: Date.now(), ...t, id: uid('task') });
    this.changed();
    return existing ? existing.id : this.state.tasks[this.state.tasks.length - 1].id;
  }

  deleteTask(id) {
    const t = this.task(id);
    if (t && (t.status === 'running' || t.status === 'queued') && t.agentId) {
      const r = this.rt(t.agentId);
      r.queue = r.queue.filter((q) => q.taskId !== id);
      if (r.currentTaskId === id) this.stop(t.agentId);
    }
    this.state.tasks = this.state.tasks.filter((x) => x.id !== id);
    this.changed();
  }

  startTask(id) {
    const t = this.task(id);
    if (!t) throw new Error('Task not found.');
    if (!t.agentId || !this.agent(t.agentId)) throw new Error('Assign the task to an agent first.');
    if (t.status === 'running' || t.status === 'queued') return;
    t.status = 'queued';
    t.result = '';
    this.enqueue(t.agentId, { type: 'task', taskId: t.id });
    this.changed();
  }

  // ---------- running ----------

  send(agentId, text) {
    if (!this.agent(agentId)) throw new Error('Agent not found.');
    this.enqueue(agentId, { type: 'chat', text });
  }

  enqueue(agentId, item) {
    const r = this.rt(agentId);
    r.queue.push(item);
    this.emit('agent-status', { agentId, status: r.status, detail: r.detail, queued: r.queue.length });
    this.pump(agentId);
  }

  async pump(agentId) {
    const r = this.rt(agentId);
    if (r.busy) return;
    r.busy = true;
    try {
      while (r.queue.length && this.agent(agentId)) {
        const item = r.queue.shift();
        if (item.type === 'chat') await this.runTurn(agentId, item.text, null);
        else await this.runTask(agentId, item.taskId);
      }
    } finally {
      r.busy = false;
      if (this.agent(agentId) && r.status !== 'error') this.setStatus(agentId, 'idle');
    }
  }

  async runTask(agentId, taskId) {
    const t = this.task(taskId);
    const a = this.agent(agentId);
    if (!t || !a) return;
    const r = this.rt(agentId);
    r.currentTaskId = taskId;
    t.status = 'running';
    t.startedAt = Date.now();
    this.addFeed(`${a.name} started “${t.title}”.`, agentId);
    this.changed();

    const from = t.fromAgentId && this.agent(t.fromAgentId);
    const prompt = [
      `NEW TASK${from ? ` (delegated by ${from.name}, ${from.department})` : ''}: ${t.title}`,
      t.description ? `\nDetails:\n${t.description}` : '',
      '\nWork on it autonomously using your tools. When finished, reply with a concise report of what you did and where any output files are.',
    ].join('');

    const outcome = await this.runTurn(agentId, prompt, taskId);
    r.currentTaskId = null;
    if (!this.task(taskId)) return; // deleted while running
    t.finishedAt = Date.now();
    t.result = outcome.text;
    t.status = outcome.ok ? 'done' : 'failed';
    if (outcome.ok) {
      a.stats.tasksDone = (a.stats.tasksDone || 0) + 1;
      this.addFeed(`${a.name} finished “${t.title}”.`, agentId);
      this.emit('task-done', { taskId, agentId });
    } else {
      this.addFeed(`${a.name} could not finish “${t.title}”.`, agentId);
    }
    this.changed();
  }

  systemPrompt(a) {
    const s = this.state.settings;
    const roster = this.state.agents.filter((x) => x.id !== a.id)
      .map((x) => `- ${x.name} — ${x.role || 'Generalist'} (${x.department})`).join('\n') || '- (you are the only employee right now)';
    const perm = {
      auto: 'You may use every tool freely.',
      ask: 'File writes inside the workspace are allowed; other writes and commands require the user\'s approval, which is requested automatically when you call the tool.',
      readonly: 'You are in read-only mode: you can inspect files and the web but cannot modify anything or run commands.',
    }[a.permission || 'ask'];
    return `You are ${a.name}, an AI employee working in the ${a.department} department of "${s.officeName}", a virtual office run by the user from the AI Labs Office desktop app.
Your role: ${a.role || 'Generalist'}.

You act on the user's real computer through tools. Environment:
- OS: ${os.type()} ${os.release()} (${process.platform}); shell for run_command: ${process.platform === 'win32' ? 'PowerShell' : 'bash'}
- Home folder: ${os.homedir()}
- Workspace folder (default location for files you create): ${s.workspace}
- Today: ${new Date().toDateString()}

Permissions: ${perm}

Coworkers you can hand work to with delegate_task:
${roster}

How to work:
- Be proactive and finish the job: break tasks into steps, use tools, check results, fix errors.
- Prefer creating deliverables as files in the workspace and mention their paths.
- Never run destructive commands (deleting user data, formatting drives, etc.) unless the user explicitly asked.
- Keep replies short and clear; the user sees them in a chat panel.${a.instructions ? `\n\nAdditional instructions from the user:\n${a.instructions}` : ''}`;
  }

  // Runs the model/tool loop for one user message. Returns { ok, text }.
  async runTurn(agentId, userText, taskId) {
    const a = this.agent(agentId);
    const r = this.rt(agentId);
    const controller = new AbortController();
    r.controller = controller;
    this.appendHistory(agentId, { role: 'user', content: userText, taskId });

    const ctx = {
      workspace: this.state.settings.workspace,
      agentName: a.name,
      delegate: (args) => this.delegate(a, taskId, args),
    };
    let lastText = '';
    try {
      const maxSteps = Math.max(1, Number(this.state.settings.maxSteps) || 25);
      for (let step = 0; step < maxSteps; step++) {
        const provider = this.provider(a.providerId);
        const available = tools.toolsForMode(a.permission || 'ask');
        this.setStatus(agentId, 'thinking', step ? 'Thinking about next step…' : 'Reading the request…');
        const history = this.history(agentId).filter((m) => m.role !== 'note');
        const res = await providers.chat(provider, a.model, this.systemPrompt(a), history, available, controller.signal);

        a.stats.tokensIn = (a.stats.tokensIn || 0) + res.usage.input;
        a.stats.tokensOut = (a.stats.tokensOut || 0) + res.usage.output;
        if (res.text) lastText = res.text;
        this.appendHistory(agentId, {
          role: 'assistant', content: res.text, toolCalls: res.toolCalls, taskId,
          raw: res.raw, rawProvider: res.raw ? provider.id : undefined,
        });
        if (!res.toolCalls.length) {
          this.changed();
          return { ok: true, text: lastText || '(done)' };
        }

        for (const call of res.toolCalls) {
          const result = await this.runTool(a, call, ctx, controller.signal);
          this.appendHistory(agentId, { role: 'tool', toolCallId: call.id, name: call.name, content: result.output, isError: !result.ok, taskId });
        }
      }
      this.appendHistory(agentId, { role: 'note', content: `Stopped after ${maxSteps} steps (limit set in Settings).` });
      return { ok: true, text: lastText || `Stopped after ${maxSteps} steps.` };
    } catch (e) {
      const aborted = controller.signal.aborted;
      this.repairHistory(agentId);
      const msg = aborted ? 'Stopped by you.' : `Error: ${e.message}`;
      this.appendHistory(agentId, { role: 'note', content: msg, isError: !aborted });
      if (!aborted) this.setStatus(agentId, 'error', e.message);
      return { ok: false, text: msg };
    } finally {
      r.controller = null;
    }
  }

  async runTool(a, call, ctx, signal) {
    const def = tools.BY_NAME[call.name];
    if (!def) return { ok: false, output: `Unknown tool "${call.name}".` };
    const summary = def.summarize(call.args || {});
    let verdict = tools.needsApproval(a.permission || 'ask', def, call.args, ctx);
    if (verdict === true && (a.autoApprove || []).includes(call.name)) verdict = false;
    if (verdict === 'blocked') return { ok: false, output: 'Blocked: this agent is in read-only mode.' };
    if (verdict) {
      this.setStatus(a.id, 'waiting', `Needs approval: ${call.name}`);
      const decision = await this.requestApproval(a, call, summary, signal);
      if (decision === 'deny') return { ok: false, output: 'The user denied this action. Try another approach or ask the user.' };
      if (decision === 'always') {
        a.autoApprove = [...new Set([...(a.autoApprove || []), call.name])];
        this.changed();
      }
    }
    this.setStatus(a.id, 'working', `${call.name} ${summary}`.trim().slice(0, 120));
    return tools.execute(call.name, call.args, ctx, signal);
  }

  requestApproval(a, call, summary, signal) {
    return new Promise((resolve) => {
      const id = uid('appr');
      const done = (d) => { this.approvals.delete(id); this.emit('approval-closed', { id }); resolve(d); };
      this.approvals.set(id, { resolve: done, agentId: a.id });
      signal.addEventListener('abort', () => done('deny'), { once: true });
      this.emit('approval', { id, agentId: a.id, agentName: a.name, tool: call.name, summary, args: call.args });
    });
  }

  respondApproval(id, decision) {
    this.approvals.get(id)?.resolve(decision);
  }

  // After an abort/error, every tool call must still get a result or providers reject the history.
  repairHistory(agentId) {
    const h = this.history(agentId);
    const answered = new Set(h.filter((m) => m.role === 'tool').map((m) => m.toolCallId));
    const last = [...h].reverse().find((m) => m.role === 'assistant');
    for (const c of last?.toolCalls || []) {
      if (!answered.has(c.id)) h.push({ role: 'tool', toolCallId: c.id, name: c.name, content: 'Cancelled.', isError: true, ts: Date.now() });
    }
    store.saveHistory(agentId, h);
  }

  delegate(fromAgent, parentTaskId, { coworker, title, description }) {
    const target = this.state.agents.find((x) => x.name.toLowerCase() === String(coworker || '').trim().toLowerCase());
    if (!target) return `No coworker named "${coworker}". Available: ${this.state.agents.map((x) => x.name).join(', ')}`;
    if (target.id === fromAgent.id) return 'You cannot delegate to yourself.';
    const parent = parentTaskId && this.task(parentTaskId);
    const depth = (parent?.depth || 0) + 1;
    if (depth > MAX_DELEGATION_DEPTH) return 'Delegation chain is too deep; do this part yourself.';
    const id = this.saveTask({ title, description, agentId: target.id, fromAgentId: fromAgent.id, depth });
    this.addFeed(`${fromAgent.name} handed “${title}” to ${target.name}.`, fromAgent.id);
    this.startTask(id);
    return `Task "${title}" created and assigned to ${target.name}. It runs in parallel; you'll see the result on the task board.`;
  }

  stop(agentId) {
    const r = this.rt(agentId);
    for (const q of r.queue) if (q.taskId) { const t = this.task(q.taskId); if (t) t.status = 'backlog'; }
    r.queue = [];
    r.controller?.abort();
    this.setStatus(agentId, 'idle');
    this.changed();
  }

  saveSettings(partial) {
    Object.assign(this.state.settings, partial);
    this.ensureWorkspace();
    this.changed();
  }

  shutdown() {
    for (const [, r] of this.runtime) r.controller?.abort();
    store.flushState(this.state);
  }
}

// What the renderer gets: no raw provider blocks.
function publicEntry(m) {
  const { raw, rawProvider, ...rest } = m;
  return rest;
}

module.exports = { Office, MAX_AGENTS };
