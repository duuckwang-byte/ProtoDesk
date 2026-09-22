const { contextBridge, ipcRenderer } = require('electron');

/**
 * preload.js — Wave-E 预加载安全网关契约 (contextBridge.exposeInMainWorld)
 * 72 通道冻结 (去重后与 main/ipc-contract.js 一致, 详见该文件 IPC_CHANNELS).
 * 安全: 仅暴露 invoke 白名单, 永不透传 AI 明文 (ai:get-config 返掩码) 与 Git token (返 hasToken).
 * @typedef {Object} ProtoAPINamespace 预加载命名空间 (app/log/snapshot/doc/docwin/aiwin/sandbox/ai/links/annotations/spec/uilib/projectBinding/git)
 * @typedef {Object} IpcInvokeResult 各通道返回 {ok, error?, cancelled?} (见 main/ipc-contract.js IpcOk)
 * @param {string} channel IPC 通道名 (72 冻结之一)
 * @param {...*} args 通道载荷 (对象传参, 1MB 上限由主进程 Service 侧校验)
 * @returns {Promise<IpcInvokeResult>} 主进程处理结果
 */

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

/* 独立文档窗口镜像：复用 onAiEvent 多播写法，监听去重 + 返回解绑函数 */
const docMirrorListeners = [];
let docMirrorBridged = false;
function onDocMirror(cb) {
  if (typeof cb !== 'function') return function () {};
  if (docMirrorListeners.indexOf(cb) < 0) docMirrorListeners.push(cb);
  if (!docMirrorBridged) {
    docMirrorBridged = true;
    ipcRenderer.on('doc:mirror', (_, m) => {
      for (const c of docMirrorListeners.slice()) { try { c(m); } catch (err) {} }
    });
  }
  return function () {
    try {
      var i = docMirrorListeners.indexOf(cb);
      if (i >= 0) docMirrorListeners.splice(i, 1);
    } catch (e) {}
  };
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
    list: (o) => ipcRenderer.invoke('doc:list', o),
    readLatest: (a, b) => ipcRenderer.invoke('doc:read-latest', a, b),
    writeLatest: (a, b) => ipcRenderer.invoke('doc:write-latest', a, b),
    exportLongImage: (o) => ipcRenderer.invoke('doc:export-long-image', o),
    exportPdf: (o) => ipcRenderer.invoke('doc:export-pdf', o),
    mirrorPush: (o) => ipcRenderer.invoke('doc:mirror-push', o),
    mirrorBack: (o) => ipcRenderer.invoke('doc:mirror-back', o),
    onMirror: (cb) => onDocMirror(cb)
  },
  docwin: {
    open: (o) => ipcRenderer.invoke('docwin:open', o),
    close: () => ipcRenderer.invoke('docwin:close'),
    toggle: () => ipcRenderer.invoke('docwin:toggle'),
    mirrorPush: (o) => ipcRenderer.invoke('doc:mirror-push', o),
    mirrorBack: (o) => ipcRenderer.invoke('doc:mirror-back', o),
    onMirror: (cb) => onDocMirror(cb)
  },
  aiwin: {
    open: (o) => ipcRenderer.invoke('aiwin:open', o),
    close: () => ipcRenderer.invoke('aiwin:close'),
    toggle: () => ipcRenderer.invoke('aiwin:toggle'),
    mirrorPush: (o) => ipcRenderer.invoke('doc:mirror-push', o),
    mirrorBack: (o) => ipcRenderer.invoke('doc:mirror-back', o),
    onMirror: (cb) => onDocMirror(cb)
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
    projectRemove: (o) => ipcRenderer.invoke('project:remove', o),
    saveAsset: (o) => ipcRenderer.invoke('sandbox:save-asset', o),
    readAssetBase64: (o) => ipcRenderer.invoke('sandbox:read-asset-base64', o),
    listAssets: (o) => ipcRenderer.invoke('sandbox:list-assets', o),
    deleteAsset: (o) => ipcRenderer.invoke('sandbox:delete-asset', o)
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
    remoteSend: (o) => ipcRenderer.invoke('ai:remote-send', o),
    openTerminal: (dir) => ipcRenderer.invoke('ai:open-terminal', dir),
    /* S5 范围确认回复：渲染层确认弹窗点选后经此回执主进程（事件投递，对应 ai-controller 的 ipcMain.on）。
     * @param {Object} payload {id:string, decision:'allow-once'|'allow-always'|'deny'} 确认回复
     * @returns {void} */
    confirmScope: (payload) => ipcRenderer.send('ai:scope-confirm', payload),
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
  spec: {
    list: () => ipcRenderer.invoke('spec:list'),
    createFromFile: (o) => ipcRenderer.invoke('spec:create-from-file', o),
    createFromText: (o) => ipcRenderer.invoke('spec:create-from-text', o),
    update: (o) => ipcRenderer.invoke('spec:update', o),
    rename: (o) => ipcRenderer.invoke('spec:rename', o),
    remove: (o) => ipcRenderer.invoke('spec:remove', o),
    read: (o) => ipcRenderer.invoke('spec:read', o)
  },
  uilib: {
    list: () => ipcRenderer.invoke('uilib:list'),
    save: (o) => ipcRenderer.invoke('uilib:save', o),
    remove: (o) => ipcRenderer.invoke('uilib:remove', o)
  },
  projectBinding: {
    get: (o) => ipcRenderer.invoke('project:get-binding', (typeof o === 'string') ? { project: o } : o),
    set: (o) => ipcRenderer.invoke('project:set-binding', o)
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