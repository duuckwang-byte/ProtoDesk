const { contextBridge, ipcRenderer } = require('electron');

const aiEventListeners = [];
let aiEventBridged = false;
function onAiEvent(cb) {
  aiEventListeners.push(cb);
  if (!aiEventBridged) {
    aiEventBridged = true;
    ipcRenderer.on('ai:event', (e, data) => {
      for (const c of aiEventListeners.slice()) { try { c(data); } catch (err) {} }
    });
  }
}

contextBridge.exposeInMainWorld('protoAPI', {
  pickTextFile: (opts) => ipcRenderer.invoke('pick-text-file', opts),
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version')
  },
  log: {
    write: (level, tag, msg) => ipcRenderer.invoke('log:write', level, tag, msg)
  },
  snapshot: {
    list: (dir) => ipcRenderer.invoke('snapshot:list', dir),
    restore: (o) => ipcRenderer.invoke('snapshot:restore', o)
  },
  doc: {
    readLatest: (dir) => ipcRenderer.invoke('doc:read-latest', dir),
    writeLatest: (dir, content) => ipcRenderer.invoke('doc:write-latest', dir, content)
  },
  sandbox: {
    list: (project) => ipcRenderer.invoke('sandbox:list', project),
    write: (o) => ipcRenderer.invoke('sandbox:write', o),
    readFile: (o) => ipcRenderer.invoke('sandbox:read-file', o),
    create: (o) => ipcRenderer.invoke('sandbox:create', o),
    adopt: (o) => ipcRenderer.invoke('sandbox:adopt', o),
    rename: (o) => ipcRenderer.invoke('sandbox:rename', o),
    remove: (o) => ipcRenderer.invoke('sandbox:remove', o),
    projects: () => ipcRenderer.invoke('sandbox:projects'),
    createSubPage: (o) => ipcRenderer.invoke('sandbox:create-subpage', o),
    renameSubPage: (o) => ipcRenderer.invoke('sandbox:rename-subpage', o),
    deleteSubPage: (o) => ipcRenderer.invoke('sandbox:delete-subpage', o),
    projectCreate: (o) => ipcRenderer.invoke('project:create', o),
    projectRename: (o) => ipcRenderer.invoke('project:rename', o),
    projectRemove: (o) => ipcRenderer.invoke('project:remove', o)
  },
  ai: {
    checkCli: () => ipcRenderer.invoke('ai:check'),
    getConfig: () => ipcRenderer.invoke('ai:get-config'),
    saveConfig: (cfg) => ipcRenderer.invoke('ai:save-config', cfg),
    testConnection: (cfg) => ipcRenderer.invoke('ai:test-connection', cfg),
    listModels: (hint) => ipcRenderer.invoke('ai:models', hint),
    pickCli: () => ipcRenderer.invoke('ai:pick'),
    ask: (prompt, sessionId, sandboxDir, model, extra) => ipcRenderer.invoke('ai:ask', prompt, sessionId, sandboxDir, model, extra),
    cancel: () => ipcRenderer.invoke('ai:cancel'),
    isBusy: () => ipcRenderer.invoke('ai:is-busy'),
    onEvent: (cb) => onAiEvent(cb)
  },
  links: {
    read: (dir) => ipcRenderer.invoke('links:read', dir),
    write: (dir, data) => ipcRenderer.invoke('links:write', dir, data)
  },
  annotations: {
    read: (dir) => ipcRenderer.invoke('proto:annotations:read', typeof dir === 'object' ? dir : { dir }),
    save: (dir, annotations) => ipcRenderer.invoke('proto:annotations:save', Array.isArray(annotations) ? { dir, annotations } : (typeof dir === 'object' ? dir : { dir, annotations }))
  },
  git: {
    // P0：getConfig 返回已脱敏（无 token 字段，仅 hasToken/tokenMasked）；签名不变
    getConfig: (project) => ipcRenderer.invoke('git:config-get', project),
    saveConfig: (o) => ipcRenderer.invoke('git:config-save', o),
    testConnection: (cfg) => ipcRenderer.invoke('git:test-connection', cfg),
    listBranches: (opts) => ipcRenderer.invoke('git:list-branches', opts),
    getStatus: (projectOrOpts) => ipcRenderer.invoke('git:status', projectOrOpts),
    push: (o) => ipcRenderer.invoke('git:push', o),
    fetchDiff: (projectOrOpts) => ipcRenderer.invoke('git:fetch-diff', projectOrOpts),
    pull: (o) => ipcRenderer.invoke('git:pull', o),
    isBusy: () => ipcRenderer.invoke('git:is-busy'),
    cancel: () => ipcRenderer.invoke('git:cancel'),
    healRepair: (o) => ipcRenderer.invoke('git:heal-repair', o)
  }
});