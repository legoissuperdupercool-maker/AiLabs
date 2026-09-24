const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('office', {
  get: call('office:get'),
  saveProvider: call('provider:save'),
  deleteProvider: call('provider:delete'),
  listModels: call('provider:models'),
  testProvider: call('provider:test'),
  saveAgent: call('agent:save'),
  deleteAgent: call('agent:delete'),
  history: call('agent:history'),
  send: call('agent:send'),
  stop: call('agent:stop'),
  clear: call('agent:clear'),
  saveTask: call('task:save'),
  deleteTask: call('task:delete'),
  startTask: call('task:start'),
  respondApproval: call('approval:respond'),
  saveSettings: call('settings:save'),
  pickFolder: call('dialog:folder'),
  open: call('shell:open'),
  onEvent: (fn) => {
    const listener = (_e, msg) => fn(msg);
    ipcRenderer.on('office:event', listener);
    return () => ipcRenderer.removeListener('office:event', listener);
  },
});
