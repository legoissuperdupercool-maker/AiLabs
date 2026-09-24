const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const { Office } = require('./office');
const providers = require('./providers');
const tools = require('./tools');

let win = null;
let office = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

app.setAppUserModelId('com.ailabs.office');

function emit(type, payload) {
  if (win && !win.isDestroyed()) win.webContents.send('office:event', { type, payload });
}

function createWindow() {
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0d1020',
    title: 'AI Labs Office',
    // Packaged builds use the icon embedded in the .exe.
    icon: app.isPackaged ? undefined : path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0d1020', symbolColor: '#aab1e6', height: 38 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Links clicked in chat open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
}

// Every handler returns { ok, data } or { ok: false, error } so the UI can show friendly errors.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (err) { return { ok: false, error: err.message || String(err) }; }
  });
}

function registerIpc() {
  handle('office:get', () => ({
    state: office.snapshot(),
    presets: providers.PRESETS,
    tools: tools.DEFINITIONS.map(({ name, risk, description }) => ({ name, risk, description })),
    platform: process.platform,
    version: app.getVersion(),
  }));

  handle('provider:save', (p) => office.saveProvider(p));
  handle('provider:delete', (id) => office.deleteProvider(id));
  handle('provider:models', (p) => providers.listModels(p.id && !p.apiKey ? office.provider(p.id) || p : p));
  handle('provider:test', (p, model) => providers.testProvider(p, model));

  handle('agent:save', (a) => office.saveAgent(a));
  handle('agent:delete', (id) => office.deleteAgent(id));
  handle('agent:history', (id) => office.getHistory(id));
  handle('agent:send', (id, text) => office.send(id, text));
  handle('agent:stop', (id) => office.stop(id));
  handle('agent:clear', (id) => office.clearHistory(id));

  handle('task:save', (t) => office.saveTask(t));
  handle('task:delete', (id) => office.deleteTask(id));
  handle('task:start', (id) => office.startTask(id));

  handle('approval:respond', (id, decision) => office.respondApproval(id, decision));
  handle('settings:save', (s) => office.saveSettings(s));

  handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('shell:open', (target) => (/^https?:/i.test(target) ? shell.openExternal(target) : shell.openPath(target)));
}

app.whenReady().then(() => {
  office = new Office(emit);
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => office?.shutdown());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
