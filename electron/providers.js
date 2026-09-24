// Model providers. Everything speaks one internal message format:
//   { role: 'user' | 'assistant' | 'tool', content, toolCalls?, toolCallId?, raw? }
// and is translated to the OpenAI-compatible or Anthropic wire format here.
const Anthropic = require('@anthropic-ai/sdk').default;

const PRESETS = [
  { kind: 'anthropic', name: 'Anthropic (Claude)', type: 'anthropic', baseUrl: 'https://api.anthropic.com', needsKey: true,
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-fable-5-1'] },
  { kind: 'openai', name: 'OpenAI (ChatGPT)', type: 'openai', baseUrl: 'https://api.openai.com/v1', needsKey: true,
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'] },
  { kind: 'groq', name: 'Groq', type: 'openai', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true,
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen/qwen3-32b'] },
  { kind: 'gemini', name: 'Google Gemini', type: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true,
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'] },
  { kind: 'openrouter', name: 'OpenRouter', type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, models: [] },
  { kind: 'mistral', name: 'Mistral', type: 'openai', baseUrl: 'https://api.mistral.ai/v1', needsKey: true,
    models: ['mistral-large-latest', 'mistral-small-latest'] },
  { kind: 'deepseek', name: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com/v1', needsKey: true,
    models: ['deepseek-chat'] },
  { kind: 'xai', name: 'xAI (Grok)', type: 'openai', baseUrl: 'https://api.x.ai/v1', needsKey: true, models: [] },
  { kind: 'ollama', name: 'Ollama (local)', type: 'openai', baseUrl: 'http://localhost:11434/v1', needsKey: false,
    models: ['llama3.1', 'qwen2.5', 'mistral-nemo'] },
  { kind: 'lmstudio', name: 'LM Studio (local)', type: 'openai', baseUrl: 'http://localhost:1234/v1', needsKey: false, models: [] },
  { kind: 'custom', name: 'Custom (OpenAI-compatible)', type: 'openai', baseUrl: 'http://localhost:8000/v1', needsKey: false, models: [] },
];

const trimSlash = (u) => String(u || '').replace(/\/+$/, '');

async function httpJson(url, options, signal) {
  const res = await fetch(url, { ...options, signal });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || text.slice(0, 400) || res.statusText;
    throw new Error(`${res.status} ${msg}`);
  }
  return body;
}

// ---------- OpenAI-compatible (OpenAI, Groq, Gemini, OpenRouter, Ollama, LM Studio...) ----------

function toOpenAIMessages(system, history) {
  const out = [{ role: 'system', content: system }];
  for (const m of history) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.content || '' };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((c) => ({
          id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
        }));
        if (!m.content) msg.content = null;
      }
      out.push(msg);
    } else if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
  }
  return out;
}

async function chatOpenAI(provider, model, system, history, tools, signal) {
  const headers = { 'Content-Type': 'application/json' };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  if (provider.kind === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/legoissuperdupercool-maker/AiLabs';
    headers['X-Title'] = 'AI Labs Office';
  }
  const body = {
    model,
    messages: toOpenAIMessages(system, history),
  };
  if (tools.length) {
    body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    body.tool_choice = 'auto';
  }
  const data = await httpJson(`${trimSlash(provider.baseUrl)}/chat/completions`,
    { method: 'POST', headers, body: JSON.stringify(body) }, signal);
  const msg = data?.choices?.[0]?.message || {};
  const toolCalls = (msg.tool_calls || []).map((c, i) => ({
    id: c.id || `call_${Date.now()}_${i}`,
    name: c.function?.name,
    args: parseArgs(c.function?.arguments),
  }));
  return {
    text: stripThink(msg.content || ''),
    toolCalls,
    usage: { input: data?.usage?.prompt_tokens || 0, output: data?.usage?.completion_tokens || 0 },
  };
}

function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return { _invalid_json: String(raw) }; }
}

// Reasoning models served locally often inline their chain of thought.
function stripThink(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

async function listModelsOpenAI(provider) {
  const headers = {};
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  const data = await httpJson(`${trimSlash(provider.baseUrl)}/models`, { headers });
  return (data?.data || data?.models || []).map((m) => m.id || m.name).filter(Boolean).sort();
}

// ---------- Anthropic (Claude) ----------

function anthropicClient(provider) {
  return new Anthropic({ apiKey: provider.apiKey, baseURL: trimSlash(provider.baseUrl) || undefined });
}

function toAnthropicMessages(history, providerId) {
  const out = [];
  const push = (role, blocks) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: [...blocks] });
  };
  for (const m of history) {
    if (m.role === 'user') push('user', [{ type: 'text', text: m.content || ' ' }]);
    else if (m.role === 'tool') {
      push('user', [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content || '(empty)', is_error: !!m.isError }]);
    } else if (m.role === 'assistant') {
      // Replay the original content blocks (incl. thinking) unchanged when we produced them.
      if (m.raw && m.rawProvider === providerId) { push('assistant', m.raw); continue; }
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls || []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args || {} });
      if (!blocks.length) blocks.push({ type: 'text', text: '(no response)' });
      push('assistant', blocks);
    }
  }
  return out;
}

async function chatAnthropic(provider, model, system, history, tools, signal) {
  const client = anthropicClient(provider);
  const params = { model, max_tokens: 16000, system, messages: toAnthropicMessages(history, provider.id) };
  if (tools.length) params.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const response = await client.messages.create(params, { signal });

  if (response.stop_reason === 'refusal') {
    return { text: 'I can\'t help with that request.', toolCalls: [], usage: usageOf(response) };
  }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  const toolCalls = response.content.filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, args: b.input || {} }));
  return { text, toolCalls, raw: response.content, usage: usageOf(response) };
}

const usageOf = (r) => ({ input: r.usage?.input_tokens || 0, output: r.usage?.output_tokens || 0 });

async function listModelsAnthropic(provider) {
  const client = anthropicClient(provider);
  const ids = [];
  for await (const m of client.models.list()) ids.push(m.id);
  return ids;
}

// ---------- Public API ----------

async function chat(provider, model, system, history, tools, signal) {
  if (!provider) throw new Error('No AI provider assigned. Open Settings → AI Providers.');
  if (!model) throw new Error('No model selected for this agent.');
  if (provider.type === 'anthropic') return chatAnthropic(provider, model, system, history, tools, signal);
  return chatOpenAI(provider, model, system, history, tools, signal);
}

async function listModels(provider) {
  return provider.type === 'anthropic' ? listModelsAnthropic(provider) : listModelsOpenAI(provider);
}

async function testProvider(provider, model) {
  const res = await chat(provider, model, 'You are a connectivity check. Reply with exactly: OK',
    [{ role: 'user', content: 'ping' }], [], undefined);
  return res.text || '(empty reply)';
}

module.exports = { PRESETS, chat, listModels, testProvider };
