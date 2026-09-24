// Tiny JSON-file persistence in the user's app-data folder.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX_HISTORY = 200;

function dataDir() {
  const dir = path.join(app.getPath('userData'), 'office');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir(), file), 'utf8'));
  } catch {
    return fallback;
  }
}

// Write atomically so a crash mid-save can't corrupt the office.
function writeJson(file, value) {
  const target = path.join(dataDir(), file);
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, target);
}

function defaultState() {
  return {
    version: 1,
    providers: [],
    agents: [],
    tasks: [],
    feed: [],
    settings: {
      workspace: path.join(app.getPath('documents'), 'AI Labs Workspace'),
      maxSteps: 25,
      officeName: 'AI Labs HQ',
      sound: true,
    },
  };
}

function loadState() {
  const base = defaultState();
  const saved = readJson('state.json', null);
  if (!saved) return base;
  return { ...base, ...saved, settings: { ...base.settings, ...(saved.settings || {}) } };
}

let saveTimer = null;
function saveState(state) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJson('state.json', state), 150);
}

function flushState(state) {
  clearTimeout(saveTimer);
  writeJson('state.json', state);
}

function loadHistory(agentId) {
  return readJson(`history-${agentId}.json`, []);
}

function saveHistory(agentId, history) {
  writeJson(`history-${agentId}.json`, trimHistory(history));
}

function deleteHistory(agentId) {
  try { fs.unlinkSync(path.join(dataDir(), `history-${agentId}.json`)); } catch {}
}

// Drop the oldest turns, but never start the history on a dangling tool result.
function trimHistory(history) {
  if (history.length <= MAX_HISTORY) return history;
  let start = history.length - MAX_HISTORY;
  while (start < history.length && history[start].role !== 'user') start++;
  return history.slice(start);
}

module.exports = { loadState, saveState, flushState, loadHistory, saveHistory, deleteHistory, trimHistory, dataDir };
