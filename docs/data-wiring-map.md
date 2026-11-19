# React Renderer 数据接线勘察（Wave3 前置）

> 日期：2026-11-12 · 范围：只读勘察 `js/**`、`main/**`、`preload.js`、`src/renderer/**`、`tests/**`
> 结论口径：只回答“React renderer 要变成可用工具，还缺哪些数据接线”，不改源码、不装依赖、不 commit。
> 现状基线：`npx tsc --noEmit` exit 0；`node tests/verify-groups.js` 5/5 PASS；`node tests/verify-ipc.js` 4/4 PASS；`node tests/lint-guard.js` `LINT_PASS`，`E-IPC-FROZEN contract 70, 实际 70`。

---

## 0. 结论（TL;DR）

1. **React 当前只是壳，不是工具。** 启动后 `project/proto/page` 全为空串（`src/renderer/stores/app-store.ts:105-107`），没有任何启动数据请求；`Sidebar` 是静态示例（`components/shell/Sidebar.tsx:100-123`），`Stage` 是占位（`components/shell/Stage.tsx:98-130`）。
2. **70 通道只触达 19 条。** `src/renderer` 下共 19 个 `invokeProtoMethod` 调用点 + 3 个 `protoAPI.ai` 直调（`ask/cancel/confirmScope`）；其中 15 条通道在挂载路径上，4 条只存在于未被任何组件引用的 store（`SnapshotStore`、`LinkBind`、`AnnoStore`）。**51 条通道从未被 React 引用**。
3. **5 个 P0 阻塞：**
   - 无项目/原型列表 → 空白壳（缺 `sandbox:projects` / `sandbox:list` / `enterProject` 等价物）。
   - 无“当前源对象” → 没有 `sandboxDir/mdFile/mainHtmlFile/subPages/kind`，预览、文档、导出、AI 全部拿不到落点。
   - `Stage` 不渲染 `PreviewFrame` → 无 iframe 预览（`PreviewFrame` 全仓无消费者）。
   - 文档读写参数错 → 功能说明没有加载；保存写进工具级 `最新需求.md` 而非原型目录（`docs-store.ts:247-250` + `sandbox-storage-service.js:522-532`）。
   - 导出数据错 → `sources={[]}`（`Topbar.tsx:142`）；文档 PNG/PDF 发送 `content`，主进程要 `html`（`ExportMenu.tsx:328-332` + `doc-export-service.js:40,78`）。
4. **最短可用链路：** 项目列表 → 进入项目 → 原型列表 → 当前源 → Stage iframe → 文档读写 → 导出/AI/浮层。Wave3 必须按这个依赖顺序落地。

---

## 1. 旧渲染层如何加载项目/原型/源码

### 1.1 启动与项目选择

| 步骤 | 旧实现入口 | 关键变量/行为 | protoAPI 调用 |
|---|---|---|---|
| 选择渲染器 | `main.js:41-44,83-87` | `PLAND_RENDERER=react` 才加载 `dist/renderer/index.html`；默认 `legacy` | — |
| 启动引导 | `js/project-ai-export.js:7950-7953` | `loadDefaultPreset()`：导出模式恢复内嵌库，否则 `bootProjectFlow()` | — |
| 拉项目列表 | `js/project-ai-export.js:7961-7971` | 支持 `?project=` 直达；否则弹项目选择器 | `sandbox.projects()` → `sandbox:projects` |
| 记住上次项目 | `js/project-ai-export.js:7969` / `8057` | `localStorage['protoLastProject']` | — |
| 进入项目 | `js/project-ai-export.js:8053-8062` | `currentProject=name`；写 `protoLastProject`；`Store.setCurrentProject`；`loadGroups()`；`loadSandboxSources()` | — |
| 项目选择器 UI | `js/project-ai-export.js:7973-8015` | 项目名 + `protoCount`；默认项目不可删（`7999`、`8030`） | — |

> 命名说明：源码中没有名为 `loadProject` / `listSources` 的函数。项目加载的等价物是 `bootProjectFlow()`（`7961`）+ `enterProject()`（`8053`）；原型列表的等价物是 `loadSandboxSources()`（`8081`）+ `renderSourceList()`（`sandbox-core.js:757`）。

### 1.2 原型列表与 `source` 对象

核心函数：`loadSandboxSources(selName, quiet)`（`js/project-ai-export.js:8081-8194`）。

- 取列表：`window.protoAPI.sandbox.list(currentProject)`（`8103`）→ `sandbox:list`。
- 并行取每个原型的链接：`window.protoAPI.links.read(f.dir)`（`8112`）→ `links:read`。
- 构造源对象（`8125-8127`）：
  ```js
  {
    name: f.htmlFile, displayName: f.name, method: 'srcdoc',
    content: f.html, kind: detectKindByName(f.htmlFile, f.html || ''),
    isPreset: true, sandboxDir: f.dir, mdFile: f.mdFile || null,
    path: f.html || null, mainHtmlFile: f.htmlFile,
    subPages: f.subPages || [], htmlFiles: f.htmlFiles || []
  }
  ```
- 当前源选择：`currentSource = sources[0]` 或按新建名匹配（`8163-8166`）。
- 打开源：`loadSource(currentSource, ...)`（`8180`）。
- 重绘列表：`renderSourceList()`（`8187`，实现 `js/sandbox-core.js:757-774`）。
- 空项目清理：`currentSource=null`、帧 `srcdoc` 摘除、`about:blank`、文档重载（`8151-8162`）。

全局当前源变量：`js/sandbox-core.js:13-15`
```js
var sources = [];
var currentSource = null;
var currentProject = '';
```
源身份：`Store.sourceIdOf(src)` 优先 `src.sandboxDir`（`js/store.js:20-28`）。

### 1.3 切换原型 / 子页面 / 端别

| 动作 | 旧实现 | 行为 |
|---|---|---|
| 切主原型 | `js/sandbox-core.js:87-131` `loadSource(src)` | 写 `currentSource`（103）；`Store.setCurrentSource`（105-106）；`loadSourceDocs`（112）；`AnnotationEngine.loadAnnotations`（113）；`frame.setAttribute('srcdoc', sandboxSecureSrcdoc(...))`（118/121）；`applyKind`（125）；`document.title`（124）；`renderSourceList`（130） |
| 切子页 | `js/sandbox-core.js:461-502` `loadSubPage(s, subFile)` | `s.activeSubFile=subFile`；`sandbox.readFile({dir,file})`（486）；重新 `srcdoc`（490） |
| 端别推断 | `js/sandbox-core.js:28-47` | `detectKind(html)` + `detectKindByName(name,content)`；文件名含“移动”→mobile，含 PC→pc |
| 手动切端别 | `js/sandbox-core.js:79-85` | 改 `currentSource.kind`，`renderSourceList`，`persistLibrary` |
| 页面路由清单 | `js/nav-zoom.js:12-26` `extractPages(content)` | `#page-*` / `switchRoot`、`push`、`showPage('page-x')`，供导航与按页占位 |
| 预览注入 | `js/sandbox-core.js:1373-1379` `sandboxSecureSrcdoc` | `LinkBind.wrapProtoHtml` + `sandboxInjectBridge`；`sandbox` 属性强制 `allow-scripts allow-forms`（`1386`） |

### 1.4 文档（功能说明 / 最新需求）

| 文档 | 旧实现 | 存储路径 |
|---|---|---|
| 功能说明（源 md） | `js/core-docs.js:56-85` `getDocMd/loadSourceDocs`；`js/core-docs.js:1260-1276` `loadDesc()` | 沙箱列表返回的 `f.md`；本地缓存 `protoDoc_v2_<name>_<kind>`（`core-docs.js:43-44`） |
| 功能说明保存 | `js/core-docs.js:112-148` `sandboxMdFile/persistSandboxDoc` | `sandbox.write({dir,file:<name>.md,content})`（130）；保存前 `Store.beginDocSave` + 写回 `Store.guardDocWrite` 防串源（121-145） |
| 最新需求读取 | `js/project-ai-export.js:179-180,229-230` | `protoAPI.doc.readLatest(aiSbxDir())`（`aiSbxDir()` = `currentSource.sandboxDir`，`3808`） |
| 最新需求保存 | `js/project-ai-export.js:242-243,277-278` | `protoAPI.doc.writeLatest(aiSbxDir(), txt)` |
| 草稿 | `js/core-docs.js:178-205` | `protoDocDraft_<sourceDocKey>` / `...__req__` |

### 1.5 导出

- 主入口：`openExportModal()`（`js/project-ai-export.js:7863`）；组装：`buildExportHtml(chosenList)`（`7663-7790`）。
- 取源内容：内存 `src.content`，否则 `fetchText(src.path||src.name)`（`7668`）。
- 取源 md：`src.md` → `src.sandboxDir` 同名 md → `src.mdName`（`7669-7679`）。
- 读样式/脚本：`app.css` + `EXPORT_SCRIPT_FILES`（`7686-7690`）。
- 读需求：`doc.readLatest(dir)` 逐源（`7692-7702`）。
- 读链接：`links.read(dir)` + `filterKept(links, chosen)`（`7704-7718`）。
- 读标注：`annotations.read(dir)`（`7720-7735`）。
- md 图片内联：`inlineMarkdownImages` / `readAssetBase64`（`7738-7744`）。
- 注入契约：`__EXPORT_BOOT__` / `__REQ_MAP__` / `__EXPORT_SOURCES__` / `__EXPORT_LINKS__` / `__ANNO_MAP__`（`7770-7774`）。

### 1.6 Git / 标注 / 链接 / 快照 / AI（旧入口速查）

| 功能 | 旧入口 | protoAPI |
|---|---|---|
| Git 配置弹窗 | `js/project-ai-export.js:885-915` `openGitConfigModal` | `git.getConfig/saveConfig/testConnection/listBranches` |
| Git 变更树 | `1066`、`1639` `git.getStatus` | `git:status` |
| Git 上传 | `1230` `executeGitPush`；`1536` `gitDoPull` | `git.push` / `git.pull` |
| Git 差异 | `1361` `git.fetchDiff` | `git:fetch-diff` |
| Git 自愈 | `1738` `git.healRepair` | `git:heal-repair` |
| 标注读写 | `js/annotation-core.js:209/249/288` | `annotations.read/save` |
| 链接绑定 | `js/link-bind.js:167/338/1167` | `links.read/write` |
| 快照 | `js/project-ai-export.js:7309-7340` | `snapshot.list/restore` |
| AI 发送 | `js/project-ai-export.js:7075` | `ai.ask(prompt, sessionId, sandboxDir, model, extra)` |
| AI 配置/模型 | `2123-2129`、`2242-2249`、`2817-2819` | `ai.listModels/getConfig/saveConfig` |

---

## 2. 现有 70 通道中与“可用工具”相关的签名与返回结构

冻结表：`main/ipc-contract.js:50-121`（70 条）；网关注册：`preload.js:46-153`。以下只列与本报告相关的通道；未列出的 51 条见 §3.4。

### 2.1 项目 / 原型 / 源码（`sandbox`、`project`、`pick`）

| namespace.method | channel | 入参 | 返回（主进程实现） |
|---|---|---|---|
| `sandbox.projects()` | `sandbox:projects` | 无 | `{root, projects:[{name,protoCount}]}`（`sandbox-storage-service.js:1842-1848`） |
| `sandbox.list(project)` | `sandbox:list` | `project: string` | `{root, project, projects, folders:[{name,project,root,dir,htmlFile,html,mdFile,md,subPages:[{file,name}],htmlFiles}]}`（`1437-1478`；`project` 为空则扫全部项目） |
| `sandbox.readFile({dir,file})` | `sandbox:read-file` | `{dir,file}` | `{ok,content,file,path}`；越界/缺失 `{ok:false,error}`（`1584-1597`） |
| `sandbox.write({dir,file,content})` | `sandbox:write` | `{dir,file,content}` | `{ok,path}`；html 会补 `data-pr-id`（`1568-1581`） |
| `sandbox.create({name,kind,project})` | `sandbox:create` | `{name,kind:'pc' 或 'mobile',project}` | `{ok,name,project,dir,htmlFile,mdFile,kind}`（`1663-1689`） |
| `sandbox.adopt({name,content,srcPath,project})` | `sandbox:adopt` | 同上 | `{ok,name,project,dir,htmlFile,mdFile}`；导出包拆分时 `{split:true,created:[...]}`（`1691-1747`） |
| `sandbox.rename({dir,name})` | `sandbox:rename` | `{dir,name}` | `{ok,dir,name}`（`1780-1823`） |
| `sandbox.remove({dir})` | `sandbox:remove` | `{dir}` | `{ok,dir}`；只允许删项目下二级目录（`1825-1839`） |
| `sandbox.createSubPage({dir,name,kind})` | `sandbox:create-subpage` | `{dir,name,kind}` | `{ok,file,name,path}`（`1600-1625`） |
| `sandbox.renameSubPage({dir,oldFile,newName})` | `sandbox:rename-subpage` | `{dir,oldFile,newName}` | `{ok,oldFile,newFile,name,path}`（`1642-1660`） |
| `sandbox.deleteSubPage({dir,file})` | `sandbox:delete-subpage` | `{dir,file}` | `{ok}`（`1627-1639`） |
| `sandbox.projectCreate({name})` | `project:create` | `{name}` | `{ok,name,dir}`（`1851-1861`） |
| `sandbox.projectRename({oldName,name})` | `project:rename` | `{oldName,name}` | `{ok,dir,name}`（`1864-1879`） |
| `sandbox.projectRemove({name})` | `project:remove` | `{name}` | `{ok,dir}`；默认项目拒绝（`1882-1892`） |
| `protoAPI.pickTextFile(opts)` | `pick-text-file` | `{title,filters,multi?}` | 单选 `{path,name,content,error?}`；取消 `null`；多选 `{files:[...]}`（`2210-2241`） |

### 2.2 文档 / 导出 / 文档窗口

| namespace.method | channel | 入参 | 返回 |
|---|---|---|---|
| `doc.list(o)` | `doc:list` | `dir` 或 `{dir}` | `{ok,docs:[{file,size,mtimeMs}]}`，按 mtime 倒序最多 20（`2244-2274`） |
| `doc.readLatest(a,b)` | `doc:read-latest` | `dir` / `{dir,file}` | `{ok,content}`；无 file 时读 `<dir>/最新需求.md`；dir 空回退工具级（`2278-2300`；`522-532`） |
| `doc.writeLatest(a,b,c)` | `doc:write-latest` | `dir,content` / `{dir,file,content}` | `{ok,path}`（`2303-2325`） |
| `doc.exportLongImage(o)` | `doc:export-long-image` | `{title?,html,width?,scale?}` | `{ok,filePath}` / `{ok:false,cancelled:true}`；**必须 `html`**（`doc-export-service.js:37-72`） |
| `doc.exportPdf(o)` | `doc:export-pdf` | 同上 | `{ok,filePath}` / cancelled；**必须 `html`**（`75-104`） |
| `docwin.open({project?,proto?})` | `docwin:open` | `{project?,proto?}` | `{ok,mode:'win'}`（`window-controller.js:96-103`） |
| `docwin.close()` | `docwin:close` | 无 | `{ok,mode:'panel'}`（`105-111`） |
| `docwin.toggle()` | `docwin:toggle` | 无 | `{ok,mode}`；AI busy 时 `{ok:false,error:'busy'}`（`113-125`） |
| `doc.mirrorPush(msg)` | `doc:mirror-push` | 任意消息 | `{ok}`；无 docwin 时 `{ok:false,nop:true}`（`128-137`） |
| `doc.mirrorBack(msg)` | `doc:mirror-back` | 任意消息 | `{ok}`；发往主窗（`139-145`） |

### 2.3 Git（11 条）

| namespace.method | channel | 入参 | 返回 |
|---|---|---|---|
| `git.getConfig(project)` | `git:config-get` | `project` | `{ok,config}`；token 已脱敏（`git-workflow-service.js:297-302`） |
| `git.saveConfig({project,config})` | `git:config-save` | `{project,config}` | `{ok,config}`；URL 白名单/NEED_HEAL（`303-342`） |
| `git.testConnection(cfg)` | `git:test-connection` | `{project,remoteUrl,...}` | `{ok,latency}` / `{ok:false,error}`（`445-456`） |
| `git.listBranches({project})` | `git:list-branches` | `{project,remoteUrl?}` | `{ok,branches,currentBranch,remoteConfigured}`（`345-427`） |
| `git.getStatus(o)` | `git:status` | `project` 或 `{project,branch}` | `{ok,projects,totalCount,branch}`；`projects[].protos[].files[]`；失败 `{ok:false,code:'NEED_HEAL' / 'GIT_URL_BLOCKED' / ...}`（`462-581`） |
| `git.fetchDiff({project,branch})` | `git:fetch-diff` | `{project,branch}` | `{ok,projects,totalCount,branch}`（`803-917`） |
| `git.push({project,branch,files,message})` | `git:push` | `{project,branch,files[],message}` | `{ok,message,filesCount,branch,forced}`（`584-686`） |
| `git.pull({project,branch,files,backup})` | `git:pull` | 同上 | `{ok,message,filesCount,affectedProjects,failed,backupPath,branch}`（`920-1039`） |
| `git.isBusy()` | `git:is-busy` | 无 | `{busy,currentOp}`（无 `ok` 字段，`git-workflow-service.js:1043-1044`） |
| `git.cancel()` | `git:cancel` | 无 | `{ok,cancelled,op}`（`1049-1055`） |
| `git.healRepair({project})` | `git:heal-repair` | `{project}` | `{ok,backupDir,healed,nested}`（`1135`） |

### 2.4 AI / 设置

| namespace.method | channel | 入参 | 返回 |
|---|---|---|---|
| `ai.checkCli()` | `ai:check` | 无 | `{found,path,version,agents:[{id,name?,available,path,version,transport,acp:{supported,adapter,...}}]}`（`ai-process-service.js:1016-1057`） |
| `ai.getConfig()` | `ai:get-config` | 无 | 掩码配置：`api/byok/apiConfig.apiKey=''` + `apiKeyMasked/hasApiKey`；含 `engine/mode/agentId/acp/visibleModels*`（`ai-config-store.js:405-429`） |
| `ai.saveConfig(cfg)` | `ai:save-config` | 掩码配置对象 | `{ok,config,persisted,hint}`（`ai-config-store.js:592`） |
| `ai.listModels(hint)` | `ai:models` | `'cli' / 'api'` 或 `{engine,api,byok,probeModel,requestId}` | `{ok,groups,allGroups,default,engine,visibleModels,agentId?,reasoningOptions?}`（API：`1237`；CLI：`1628-1639`） |
| `ai.ask(...)` | `ai:ask` | `(prompt, sessionId, sandboxDir, model, extra)` | 启动成功 `{ok:true,success:true,pid}`；失败 `{ok:false,error}`；流式经 `ai:event`（`1653+`；末尾 `2182`） |
| `ai.cancel()` | `ai:cancel` | 无 | 字符串 `'ok'`（`ai-process-service.js:2185-2207`）；不要用 `invokeProtoMethod` 归一化 |
| `ai.isBusy()` | `ai:is-busy` | 无 | **boolean**（`ai-process-service.js:2210`），不是 `{ok,busy}` |
| `ai.testConnection(cfg)` | `ai:test-connection` | API 配置 | `{ok,success,kind,latency,latencyMs,status,error?,message?}`（`1088-1096`） |
| `ai.pickCli()` | `ai:pick` | 无 | `{path}` / null（`1642-1651`） |
| `ai.openTerminal(dir)` | `ai:open-terminal` | `dir` | `{ok,success,pid?,error?}`（`2263+`） |
| `ai.confirmScope(payload)` | **不是 70 通道** | `{id,decision,optionId?}` | `ipcRenderer.send('ai:scope-confirm')`（`preload.js:110`；`ai-controller.js:56`） |

### 2.5 其余相关通道

| namespace.method | channel | 入参 | 返回 |
|---|---|---|---|
| `links.read(dir)` | `links:read` | `dir` | `{ok,data:{version:1,links:[]} 或 null}`（`sandbox-storage-service.js:2368-2377`） |
| `links.write(dir,{links})` | `links:write` | `dir,{links}` | `{ok}`（`2379-2388`） |
| `annotations.read(dir)` | `proto:annotations:read` | `dir` 或 `{dir}` | `{ok,data:[]}`（`1295-1307`） |
| `annotations.save(dir,list)` | `proto:annotations:save` | `dir,list` 或 `{dir,annotations}` | `{ok}`（`1308-1328`） |
| `snapshot.list(dir)` | `snapshot:list` | `dir` | `{ok,items:[{ts:'YYYYMMDD-HHmmss'}]}`（`2328-2339`） |
| `snapshot.restore({dir,ts})` | `snapshot:restore` | `{dir,ts}` | `{ok}`；**参数名是 `ts`，不是 `id`**（`2341-2362`） |
| `projectBinding.get(o)` | `project:get-binding` | `project` 或 `{project}` | `{ok,binding:{specId,specName,uiLibId,uiLibName,updatedAt}}`（`2127-2137`） |
| `projectBinding.set(o)` | `project:set-binding` | `{project,specId?,uiLibId?}` | `{ok,binding}`（`2140-2207`） |
| `spec.list()` | `spec:list` | 无 | `{ok,items:[{id,name,desc,file,updatedAt}]}`（`1895-1901`） |
| `spec.read({id})` | `spec:read` | `{id}` | `{ok,item,content}` |
| `spec.createFromFile({srcPath,name,desc})` | `spec:create-from-file` | `{srcPath,name?,desc?}` | `{ok,item}`（`1902-1933`） |
| `spec.createFromText({name,content,desc})` | `spec:create-from-text` | `{name,content,desc?}` | `{ok,item}` |
| `spec.update/rename/remove` | `spec:*` | `{id,...}` | `{ok}` |
| `uilib.list()` | `uilib:list` | 无 | `{ok,items}`（`2058-2064`） |
| `uilib.save(o)` | `uilib:save` | `{id?,name,css,js,...}` | `{ok,item}` |
| `uilib.remove({id})` | `uilib:remove` | `{id}` | `{ok}` |
| `sandbox.listAssets({dir})` | `sandbox:list-assets` | `{dir}` | `{ok,items:[{name,relPath,size,mtimeMs}]}`（`2461-2493`） |
| `sandbox.readAssetBase64({dir,relPath})` | `sandbox:read-asset-base64` | `{dir,relPath}` | `{ok,dataUrl}`；只允许 `assets/` 内图片（`2434-2458`） |
| `sandbox.saveAsset({dir,name,dataUrl})` | `sandbox:save-asset` | `{dir,name,dataUrl}` | `{ok,relPath}`（`2390-2431`） |
| `sandbox.deleteAsset({dir,name})` | `sandbox:delete-asset` | `{dir,name}` | `{ok}`（`2496+`） |
| `app.getVersion()` | `app:get-version` | 无 | 版本字符串 |
| `log.write(level,tag,msg)` | `log:write` | `(level,tag,msg)` | `{ok}` |

---

## 3. React 侧现状

### 3.1 全部 `invokeProtoMethod` / `safeInvoke` 调用点

共 19 个 `invokeProtoMethod` 调用点；`safeInvoke` 只有定义（`lib/ipc.ts:77`），**0 个调用点**。另有 `ai-store` 直接调用 `protoAPI.ai.ask/cancel/confirmScope`。

| # | 位置 | 调用 | 通道 | 是否在挂载路径 | 状态 |
|---|---|---|---|---|---|
| 1 | `src/renderer/app/modes/DocWindow.tsx:25` | `doc.mirrorBack` | `doc:mirror-back` | 仅 `?docwin=1` | 可用；但只回 mode，不发 content |
| 2 | `src/renderer/stores/docs-store.ts:247` | `doc.writeLatest` | `doc:write-latest` | 是 | **参数错**：只发 `{content,reqVersion}`，无 `dir/file` |
| 3 | `src/renderer/stores/docs-store.ts:276` | `doc.readLatest` | `doc:read-latest` | 仅在切“最新需求”页签 | **参数错**：发 `{project,proto}`，主进程不识别 |
| 4 | `src/renderer/features/annotations/AnnoStore.ts:190` | `annotations.read` | `proto:annotations:read` | 否（组件未挂载） | 契约正确 |
| 5 | `src/renderer/features/annotations/AnnoStore.ts:204` | `annotations.save` | `proto:annotations:save` | 否 | 契约正确 |
| 6 | `src/renderer/features/links/LinkBind.ts:153` | `links.read` | `links:read` | 否（ExportMenu 另有调用） | 契约正确 |
| 7 | `src/renderer/features/links/LinkBind.ts:170` | `links.write` | `links:write` | 否 | 契约正确 |
| 8 | `src/renderer/features/snapshot/SnapshotStore.ts:77` | `snapshot.list` | `snapshot:list` | 否 | **返回结构错**：主进程回 `items:[{ts}]`，这里读 `list/data` + `id/name` |
| 9 | `src/renderer/features/snapshot/SnapshotStore.ts:86` | `snapshot.restore` | `snapshot:restore` | 否 | **参数名错**：发 `{dir,id}`，主进程要 `{dir,ts}` |
| 10 | `src/renderer/features/export/ExportMenu.tsx:229` | `sandbox.readFile` | `sandbox:read-file` | 是 | 可用（读源 md） |
| 11 | `src/renderer/features/export/ExportMenu.tsx:253` | `doc.readLatest` | `doc:read-latest` | 是 | 可用（`dir,null` 正确） |
| 12 | `src/renderer/features/export/ExportMenu.tsx:270` | `links.read` | `links:read` | 是 | 可用 |
| 13 | `src/renderer/features/export/ExportMenu.tsx:291` | `annotations.read` | `proto:annotations:read` | 是 | 可用 |
| 14 | `src/renderer/features/export/ExportMenu.tsx:328` | `doc.exportLongImage/exportPdf` | `doc:export-*` | 是 | **参数错**：发 `{project,title,content}`，主进程要 `html` |
| 15 | `src/renderer/features/settings/AgentMatrix.tsx:66` | `ai.checkCli` | `ai:check` | 是 | 可用；但 agents 默认是假数据 |
| 16 | `src/renderer/features/git/GitPanel.tsx:115` | `git.getStatus` | `git:status` | 是 | 可用；`project` 来自空 store |
| 17 | `src/renderer/features/git/GitPanel.tsx:182` | `git.push` | `git:push` | 是 | 可用；缺配置/分支前置 |
| 18 | `src/renderer/features/git/GitPanel.tsx:206` | `git.pull` | `git:pull` | 是 | 可用；缺配置/分支前置 |
| 19 | `src/renderer/features/git/GitPanel.tsx:228` | `git.healRepair` | `git:heal-repair` | 是 | 可用 |
| 20 | `src/renderer/stores/ai-store.ts:435` | `ai.ask`（直调） | `ai:ask` | 是 | **上下文缺失**：`sandboxDir=''`、`targetFile=''`、`uiKind='mobile'`、`engine='cli'` 写死 |
| 21 | `src/renderer/stores/ai-store.ts:462` | `ai.cancel`（直调） | `ai:cancel` | 是 | 可用 |
| 22 | `src/renderer/stores/ai-store.ts:495` | `ai.confirmScope`（send） | `ai:scope-confirm` | 是 | 可用（非 70 通道） |

### 3.2 关键组件逐个结论

| 组件 | 结论 | 证据 |
|---|---|---|
| `Sidebar` | **没有真实数据**。文件不 import 任何 store；分组/原型/子页/选中态均为硬编码示例 | `components/shell/Sidebar.tsx:10-14` 无 store import；`100-123` “示例分组/示例原型/子页面一/未选中原型”；`127` “底部操作由业务线接入” |
| `Stage` | **不渲染 `PreviewFrame`**。仅布局 + 占位；PC/移动两分支都是“预览 iframe 由 Wave2-H 接入” | `components/shell/Stage.tsx:9-14` 无 PreviewFrame import；`98-130` 占位；`118/127` 文案 |
| `PreviewFrame` | 组件本身完整，但**全仓无消费者**；且拾取 `selector` 恒为 `''`；`sandbox` 属性与旧渲染器不一致 | `features/preview/PreviewFrame.tsx:99-264`；`158/178` `selector:''`；`261` `sandbox="allow-scripts allow-same-origin"`（旧为 `allow-scripts allow-forms`，`sandbox-core.js:1386`）。注意：当前拾取依赖 `contentDocument`（`59-66,130-218`），若只把属性改成旧值而不移植帧桥，拾取会直接失效 |
| `Topbar` | 面包屑读 app-store，但 app-store 永远空；“导出”直挂 `ExportMenu` 且 `sources={[]}` | `components/shell/Topbar.tsx:28-30`；`140-146` |
| `ExportMenu` | 菜单/模板/资源加载在，但 `sources` 恒空 → 源码包恒 toast “当前没有可导出的原型”；文档 PNG/PDF payload 错 | `ExportMenu.tsx:167-174,177-181`；`328-332` |
| `SettingsDialog` | **无数据源**：`MainWindow` 只传 open/tab；`modelGroups=[]`、`agents=undefined`、`sandbox=undefined`、`shortcuts=undefined`；设计规范 Tab 是本地 state | `MainWindow.tsx:111-118`；`SettingsDialog.tsx:71-81,85-86,190-193` |
| `DocsPanel` / `DocsPanelHost` | 面板能开合；标题旁 Badge 仍写“占位”；功能说明正文从不加载；“最新需求”只在切 Tab 时请求且参数错 | `DocsPanelHost.tsx:24`；`DocsPanel.tsx:31,46-52`；`docs-store.ts:276` |
| `DocEditor` | 微改只改内存 `docContent`，不落盘；保存走 `docs-store.save`（参数错） | `DocEditor.tsx:46-63`；`docs-store.ts:243-273` |
| `GitPanel` | `status/push/pull/heal` 已接；**缺** `config-get/save`、`list-branches`、`fetch-diff`、`is-busy/cancel`；`project` 来自空 app-store | `GitPanel.tsx:99,112-137,178-239`；`MainWindow.tsx:131` |
| `AiDialog` | 只订阅事件；模型列表由 `modelId` 单元素伪造；打开时不拉 `ai.check/getConfig/models` | `AiDialog.tsx:55-67`；`ai-store.ts:399-435` |
| `AgentMatrix` | `ai.checkCli` 已接，但 `DEFAULT_AGENTS` 是硬编码假数据；无 `ai.getConfig/saveConfig` | `AgentMatrix.tsx:31-36,66` |
| `ModelManager` / `ModelFetchModal` | 纯受控组件；父级传 `modelGroups=[]`，从未调用 `ai.models` | `SettingsDialog.tsx:71,136-144`；`ModelManager.tsx:170-190` |
| `AboutTab` | 版本号写死 `v1.2.0`，未用 `app:get-version` | `AboutTab.tsx:18` |
| `MiniDock` | 可用（纯 UI） | `components/shell/MiniDock.tsx:11-30` |

### 3.3 未被任何组件引用的“孤儿”文件

以下文件在全仓 `src/renderer` 没有任何 import（只被彼此引用）：

- `components/overlays/AnnoPanel.tsx`
- `components/overlays/SnapshotPanel.tsx`
- `components/overlays/Inspector.tsx`
- `components/overlays/MultiEditBar.tsx`
- `features/preview/InlineEdit.tsx`
- `features/preview/MultiSelect.tsx`
- `features/preview/PickOverlay.tsx`
- `features/annotations/AnnoStore.ts`
- `features/snapshot/SnapshotStore.ts`
- `features/links/LinkBind.ts`

也就是说：标注、快照、检查器、多选、待提交、就地改、链接绑定——**全部只有零件，没有装配**。

### 3.4 通道覆盖统计

- React 引用到的通道：**19 条**
  - 挂载路径 15 条：`doc:write-latest`、`doc:read-latest`、`sandbox:read-file`、`links:read`、`proto:annotations:read`、`doc:export-long-image`、`doc:export-pdf`、`git:status`、`git:push`、`git:pull`、`git:heal-repair`、`ai:check`、`ai:ask`、`ai:cancel`、`doc:mirror-back`
  - 仅孤儿 store 4 条：`snapshot:list`、`snapshot:restore`、`links:write`、`proto:annotations:save`
- **从未被 React 引用：51 条**，主要包括：
  - 项目/原型 CRUD：`project:create/rename/remove`、`sandbox:create/adopt/rename/remove`、`sandbox:create-subpage/rename-subpage/delete-subpage`、`sandbox:projects`、`sandbox:list`、`sandbox:write`
  - 文档窗口：`docwin:open/close/toggle`、`doc:mirror-push`、`doc:list`
  - Git：`git:config-get/save-config/test-connection/list-branches/fetch-diff/is-busy/cancel`
  - AI：`ai:get-config/save-config/models/is-busy/open-terminal/pick/test-connection`
  - 设置：`spec:*`（7）、`uilib:*`（3）、`project:get-binding/set-binding`
  - 资产：`sandbox:list-assets/read-asset-base64/save-asset/delete-asset`
  - 其他：`pick-text-file`、`app:get-version`、`log:write`

---

## 4. React 与主进程的契约错配（按严重度）

| ID | React 调用 | 主进程契约 | 症状 | 归属 |
|---|---|---|---|---|
| **C1** | `docs-store.ts:247-250` `doc.writeLatest({content,reqVersion})` | `sandbox-storage-service.js:2303-2325` 需要 `dir`（+可选 `file`）；无 dir 走 `reqFileFor('')` → `paths.REQ_FALLBACK_FILE`（`522-532`） | 功能说明保存写到**工具级** `最新需求.md`，不是原型目录；`reqVersion` 完全被忽略 | W3-03 |
| **C2** | `docs-store.ts:276` `doc.readLatest({project,proto})` | `parseDocReadArgs`（`547-560`）只认 `dir`/`{dir,file}`；`{project,proto}` → `dir=''` | “最新需求”读的是全局回退文件，不是当前原型 | W3-03 |
| **C3** | `ExportMenu.tsx:328-332` `doc.exportLongImage/exportPdf({project,title,content})` | `doc-export-service.js:40,78` 只读 `o.html`，空则 `{ok:false,error:'缺少导出内容'}` | 文档 PNG/PDF **必失败** | W3-04 |
| **C4** | `SnapshotStore.ts:21-39` 读 `r.list ?? r.data`，条目取 `id/name` | `snapshot:list` 返回 `{ok,items:[{ts}]}`（`2334-2338`） | 快照列表**恒空** | W3-08 |
| **C5** | `SnapshotStore.ts:86` `snapshot.restore({dir,id})` | 主进程要 `{dir,ts}`（`2348-2352`） | 恢复恒报“非法快照标识” | W3-08 |
| **C6** | `PreviewFrame.tsx:158,178` `selector:''` | 标注/链接/就地改都以 `selector` 为键（`AnnoStore.ts:46-48`、`LinkBind.ts:37-48`、`js/edit-entry.js:612` `generateSelector`） | 保存的标注/绑定无法定位元素 | W3-02 |
| **C7** | `PreviewFrame.tsx:261` `sandbox="allow-scripts allow-same-origin"` | 旧渲染器强制 `allow-scripts allow-forms`（`sandbox-core.js:1386`），并注入 `sandboxSecureSrcdoc`（`118`） | 安全姿态回退；链接/标注/AI 帧桥全部没有注入 | W3-02 |
| **C8** | `ai-store.ts:435` `ask(content, sessionId, '', model, extra)` | `aiWorkDir('')` 回退 `SANDBOX_ROOT`（`ai-process-service.js:721-729`） | AI 在**整个沙箱根**工作，不是当前原型目录 | W3-07 |
| **C9** | `Topbar.tsx:142` `sources={[]}` | 旧导出需要 `chosenList`（`project-ai-export.js:7663-7665`） | 源码包/独立 HTML 恒无内容 | W3-04 |
| **C10** | `ExportMenu.tsx:221-241` 只内联 content/md | 旧导出还会把 md 图片经 `readAssetBase64` 内联（`project-ai-export.js:7738-7744`） | 导出文档图片在离线打开时丢失 | W3-04 |
| **C11** | `docs-store.ts` 无 `mirrorPush` | 旧 `mirrorPush('content',...)` 在主窗保存后推送（`core-docs.js:4658,4725`） | `?docwin=1` 只收不发，主窗内容不会同步到文档窗 | W3-03 |
| **C12** | `storage-keys.ts:6-9` 明确不做老→新迁移 | 旧 `loadGroups` 会把裸键 `protoGroups_v1` 一次性迁入并删除（`sandbox-core.js:144-149`） | 老用户首次进 React，分组为空（旧数据还在裸键里） | W3-01 |
| **C13** | `storage-keys.ts` 无 `protoLastProject` | 旧 `enterProject` 写、启动读（`project-ai-export.js:8057,7969`） | React 每次启动都回到空壳 | W3-01 |
| **C14** | `ai-store.ts` 会话只在内存 | 旧用 `ai_hist_*` / `ai_sessions_v2_*`（`project-ai-export.js:3400,3809`；`storage-keys.ts:56-99`） | 刷新/重启丢会话与历史 | W3-07 |
| **C15** | `app-store.ts:81-85` clamp `0.1..3` | 旧 `clampZoom` 为 `0.2..3`（`nav-zoom.js:40`） | 极端缩放下限不一致（小问题） | W3-01 |

---

## 5. 本地持久化键对照

| 键 | 旧实现 | React 侧 | 结论 |
|---|---|---|---|
| `protoGroups_v1__<encodeURIComponent(project)>` | `js/sandbox-core.js:136-138` | `lib/storage-keys.ts:12-29` `groupsKey()` | **逐字一致**（含 `_default`、`__` 分隔） |
| `protoGroupsFold_v1__<...>` | `js/sandbox-core.js:138` | `storage-keys.ts:15-42` `groupsFoldKey()` | **逐字一致** |
| `contentZoom` | `js/nav-zoom.js:39,53`；fallback `0.85`，clamp `0.2..3` | `storage-keys.ts:45-48,248-257`；fallback `0.85`；`app-store.ts:81-85` clamp `0.1..3` | 键/回退一致；**下限不一致**（0.1 vs 0.2） |
| `protoGroups_v1`（裸键） | `loadGroups` 一次性迁移并删除（`sandbox-core.js:144-149`） | 明确不迁移（`storage-keys.ts:6-9`） | **缺迁移**；老数据不会被 React 读到 |
| `protoOrder_v1` | `sandbox-core.js:163-183` | `storage-keys.ts:50-51` 常量；**无读写代码** | 拖拽排序未接 |
| `subPageOrder_v1` | `sandbox-core.js:163-198` | `storage-keys.ts:53-54` 常量；**无读写代码** | 子页排序未接 |
| `protoDoc_v2_<name>_<kind>` | `core-docs.js:43-44,98-110` | `storage-keys.ts:101-112` `sourceDocKey()`；**无调用** | 文档缓存未接 |
| `protoDocDraft_<scope>[__req__]` | `core-docs.js:178-205` | `storage-keys.ts:114-130` `docDraftKey()`；**无调用** | 草稿未接 |
| `ai_hist_<dir>` / `ai_sessions_v2_<dir>` | `project-ai-export.js:3400,3809` | `storage-keys.ts:56-99`；**无调用** | AI 会话未持久化 |
| `protoLastProject` | `project-ai-export.js:8057,7969` | **无** | 缺键/缺启动恢复 |
| `ai_model` / `ai_model_reasoning` | `project-ai-export.js:5697-5698` | **无** | 模型/思考选择不持久化 |
| `proto_anno_visible` | `annotation-core.js:1007` | **无** | 标注显隐不持久化 |
| `linkInspFold_v1` | `link-bind.js:900` | **无** | 链接检查器折叠态不持久化 |
| `edit_queue_v1` / `edit_queue_backup` | `store.js:83`、`edit-entry.js:2347` | **无** | 待提交队列不持久化 |
| `docWinReopen` | `core-docs.js:4589` | **无** | 文档窗重开标记未接 |

**直接回答：**分组键、折叠键、`contentZoom` 三个键名与编码规则**一致**；但 React 缺 `protoLastProject`、AI 模型/思考、标注显隐、链接折叠、待提交队列、文档窗重开等键，且没有旧裸键的一次性迁移。`verify-groups.js` 只验证旧 `js/sandbox-core.js`，不覆盖 React 的 `storage-keys.ts`（`tests/verify-groups.js:30-34,61-71,84-89`）。

---

## 6. 功能 → 旧实现入口 → IPC → React 现状 → 改文件建议

> 图例：**空缺** = 无数据/无调用；**部分** = 有代码但参数/数据源/挂载不全；**已接** = 可跑通。

| 功能 | 旧实现入口（file:line） | IPC 通道 | React 现状 | 需要改的文件建议 |
|---|---|---|---|---|
| 启动 / 项目选择 | `js/project-ai-export.js:7961-7971`；`8053-8062` | `sandbox:projects`、`project:create/rename/remove` | **空缺**：app-store 初值空串（`app-store.ts:105-107`），无 boot 请求 | 新增 `stores/sources-store.ts`、`features/projects/ProjectPicker.tsx`；改 `app-store.ts`、`storage-keys.ts`、`MainWindow.tsx` |
| 项目 CRUD | `js/project-ai-export.js:8017-8051` | `project:create/rename/remove` | **空缺**：React 无项目弹窗/操作 | `features/projects/ProjectPicker.tsx`、`sources-store.ts` |
| 原型列表 / 分组 / 折叠 | `js/project-ai-export.js:8081-8194`；`js/sandbox-core.js:730-774` | `sandbox:list`、`links:read` | **空缺**：Sidebar 全为示例（`Sidebar.tsx:100-123`） | `components/shell/Sidebar.tsx`、`stores/sources-store.ts`、`app-store.ts`（readGroups/readFold 消费） |
| 原型 CRUD / 导入 | `js/project-ai-export.js:304-321`；`js/ai/ai-domain.js:51-57,84-92`；`js/sandbox-core.js:796-850` | `pick-text-file`、`sandbox:create/adopt/rename/remove` | **空缺**：Sidebar 底部仅占位文案（`Sidebar.tsx:127`） | `Sidebar.tsx`、新增 `features/projects/proto-actions.ts`、`sources-store.ts` |
| 子页面 CRUD / 切换 | `js/sandbox-core.js:342-459,461-502` | `sandbox:create-subpage/rename-subpage/delete-subpage`、`sandbox:read-file` | **空缺**：Sidebar 子页是写死的“子页面一/二”（`Sidebar.tsx:116-117`） | `Sidebar.tsx`、`sources-store.ts`、`Stage.tsx` |
| 当前源 / 端别 / 页面 | `js/sandbox-core.js:13-15,28-47,79-85,103-130`；`js/nav-zoom.js:12-26` | 无（列表数据派生） | **空缺**：app-store 只有 `project/proto/page/kind` 字符串，无 `sandboxDir/mdFile/mainHtmlFile/subPages` | `stores/sources-store.ts`（新建 `SourceRef`）、`app-store.ts`、`Topbar.tsx`（只读消费） |
| 源码读取 | `js/project-ai-export.js:8103,8125-8127`；`js/sandbox-core.js:118-122,485-490` | `sandbox:list`（含 html）、`sandbox:read-file`（子页） | **空缺**：无 `SourceRef`，Stage/导出都拿不到内容 | `sources-store.ts`、`Stage.tsx` |
| 预览舞台 | `js/sandbox-core.js:87-131`；`1373-1391` | 无（本地 srcdoc） | **空缺**：`Stage` 占位（`Stage.tsx:98-130`），`PreviewFrame` 无消费者 | `components/shell/Stage.tsx`、`features/preview/PreviewFrame.tsx`、新 `features/preview/lib/secure-srcdoc.ts` |
| 拾取 / 选择器 | `js/edit-entry.js:612` `generateSelector`；`js/sandbox-core.js:1373-1391` | 无 | **部分**：`PreviewFrame` 有拾取监听，但 `selector:''`（`158/178`），未挂载 | `PreviewFrame.tsx`、`features/preview/lib/iframe-pick.ts`、`Stage.tsx` |
| 就地编辑 / 多选 / 检查器 / 待提交 | `js/edit-entry.js`；`js/link-bind.js:338` | 无 | **空缺（孤儿）**：`InlineEdit/MultiSelect/Inspector/MultiEditBar/PickOverlay` 无 import | 上述组件 + 新 `features/preview/PreviewOverlaysHost.tsx`（由 Stage 挂载） |
| 功能说明文档 | `js/core-docs.js:56-85,112-148,1260-1276` | `sandbox:write`（保存）；`sandbox:list` 的 `md`（读取） | **部分**：`docs-store` 只走 `doc:*`，功能说明从未加载；保存参数错（C1） | `stores/docs-store.ts`、`features/docs/DocsPanel.tsx`、`DocEditor.tsx` |
| 最新需求 | `js/project-ai-export.js:179-180,242-243,277-278` | `doc:read-latest`、`doc:write-latest` | **部分**：只在切 Tab 时读，参数错（C2）；保存参数错（C1） | `stores/docs-store.ts`、`features/docs/DocsPanel.tsx` |
| 文档窗口 / mirror | `js/core-docs.js:3674-3695,3890,3988-4031,4658-4725` | `docwin:open/close/toggle`、`doc:mirror-push/back` | **部分**：`DocWindow` 只收 `doc:mirror`（`DocWindow.tsx:48-65`），从不 `mirrorPush`；React 顶栏只开面板不开窗 | `app/modes/DocWindow.tsx`、`stores/docs-store.ts`；Topbar 按钮由 W3-04 统一接 |
| 导出源码 / 独立 HTML | `js/project-ai-export.js:7663-7790,7863` | `sandbox:read-file`、`doc:read-latest`、`links:read`、`annotations:read` | **部分**：`ExportMenu` 实现完整但 `sources=[]`（`Topbar.tsx:142`），源码包恒 toast | `components/shell/Topbar.tsx`、`features/export/ExportMenu.tsx`、`sources-store.ts` |
| 文档 PNG/PDF/MD | 旧 `doc:export-*` 需先 `renderMd` 成 HTML | `doc:export-long-image`、`doc:export-pdf` | **部分**：PNG/PDF payload 错（C3）；MD 可下载但只取 `docContent` | `ExportMenu.tsx`、`stores/docs-store.ts`（`renderDocPreview` 已存在）、新增 `features/export/export-assets.ts` |
| Git | `js/project-ai-export.js:885-915,1066,1230,1536,1639,1738` | `git:config-get/save-config/test-connection/list-branches/status/fetch-diff/push/pull/is-busy/cancel/heal-repair` | **部分**：`status/push/pull/heal` 已接（`GitPanel.tsx:115-228`），缺配置/分支/差异/取消；`project` 为空 | `features/git/GitPanel.tsx`、新 `features/git/GitConfigDialog.tsx`、`features/git/git-api.ts` |
| AI 对话 | `js/project-ai-export.js:7075`；`2123-2129,2242-2249,2817-2819` | `ai:ask/cancel/is-busy/check/get-config/save-config/models/pick/open-terminal/test-connection` | **部分**：事件/发送/取消/权限已接；`sandboxDir=''`（C8）；模型清单伪造（`AiDialog.tsx:64-67`）；设置无数据 | `stores/ai-store.ts`、`features/ai/AiDialog.tsx`、`features/settings/*` |
| 设置 Agent / 模型 | `js/project-ai-export.js:7504-7524`；`buildModelManagerHtml` 相关 | `ai:check/get-config/save-config/models/pick/test-connection` | **部分**：`AgentMatrix` 只 `ai.checkCli`（`66`），默认假数据（`31-36`）；`ModelManager` 空数组 | `features/settings/SettingsDialog.tsx`、`AgentMatrix.tsx`、`features/models/ModelManager.tsx`、`ModelFetchModal.tsx`、新 `stores/settings-store.ts` |
| 设计规范 / UI 库 / 绑定 | `js/project-ai-export.js:2901-3056` | `spec:list/read/create-from-file/create-from-text/update/rename/remove`、`uilib:list/save/remove`、`project:get-binding/set-binding` | **空缺**：设计规范 Tab 是本地 `useState`（`SettingsDialog.tsx:85-86,147-188`），10 条 spec/uilib 通道全未用 | `features/settings/SettingsDialog.tsx`、新 `features/settings/DesignSpecTab.tsx`、`stores/settings-store.ts` |
| 标注 / 链接 / 快照 / 资产 | `js/annotation-core.js:209,249,288`；`js/link-bind.js:167,338,1167`；`js/project-ai-export.js:7309-7340` | `proto:annotations:read/save`、`links:read/write`、`snapshot:list/restore`、`sandbox:*asset` | **空缺（孤儿）**：store/面板无 import；快照另有 C4/C5；资产 4 通道全未用 | `features/annotations/AnnoStore.ts`、`components/overlays/AnnoPanel.tsx`、`features/snapshot/SnapshotStore.ts`、`SnapshotPanel.tsx`、`Inspector.tsx`、`MultiEditBar.tsx`、`features/links/LinkBind.ts`、`features/preview/PreviewOverlaysHost.tsx` |
| 沙箱设置 / 快捷键 / 关于 | 旧设置面板；`js/project-ai-export.js:2001` 显示 `sandbox.root` | `sandbox:list`（root）、`app:get-version` | **空缺**：`SandboxTab` 默认值（`SandboxTab.tsx:33`）、`ShortcutTab` 默认值（`ShortcutTab.tsx:43`）、`AboutTab` 写死版本（`18`） | `features/settings/SandboxTab.tsx`、`ShortcutTab.tsx`、`AboutTab.tsx`、`stores/settings-store.ts` |

---

## 7. Wave3 任务包建议（9 包，按依赖排序）

### 7.1 依赖图

```
                 ┌─ W3-02 预览舞台 ── W3-08 浮层/标注/快照
W3-01 数据底座 ──┼─ W3-03 文档闭环 ── W3-04 导出闭环
                 ├─ W3-05 Git 全量（可在 W3-01 后并行）
                 └─ W3-07 AI 上下文（依赖 W3-06 + W3-01）

W3-06 设置/模型 ── W3-07
W3-09 默认渲染器切换与门禁（最后）
```

### 7.2 W3-01 数据底座：项目 / 原型 / 当前源

**目标**：启动拉项目列表 → 选/建项目 → 拉原型列表 → 建 `SourceRef` → 侧栏真实三层树 + 分组/折叠/排序持久化。

**独占文件**
- `src/renderer/stores/sources-store.ts`（新建）
- `src/renderer/stores/app-store.ts`
- `src/renderer/lib/storage-keys.ts`（一次性补齐 `PROTO_LAST_PROJECT`、`AI_MODEL_KEY`、`AI_REASONING_KEY`、`PROTO_ANNO_VISIBLE`、`LINK_INSP_FOLD`、`EDIT_QUEUE_KEY`、`DOC_WIN_REOPEN`；后续包只读）
- `src/renderer/features/projects/ProjectPicker.tsx`（新建）
- `src/renderer/features/projects/proto-actions.ts`（新建，create/adopt/rename/remove/subpage）
- `src/renderer/components/shell/Sidebar.tsx`
- `src/renderer/app/modes/MainWindow.tsx`（只挂 ProjectPicker）

**实现要点**
- `SourceRef` 逐字对齐 `project-ai-export.js:8125-8127`：`name/displayName/kind/sandboxDir/mainHtmlFile/mdFile/subPages/htmlFiles/content/md/pages`；另加 `__ver`（文档保存守卫用，对应 `js/store.js:49-56`）。
- `sandbox:list(project)` 一次拿 `html/md`；分组来自 `app-store.readGroups/readFold`（目前定义了但无消费者）；排序来自 `ORDER_KEY/SUB_ORDER_KEY`（`storage-keys.ts:50-54`）。
- 端口旧 `detectKind` / `detectKindByName`（`sandbox-core.js:28-47`）与 `extractPages`（`nav-zoom.js:12-26`）。
- 启动恢复 `protoLastProject`；一次性裸键迁移单独放 `lib/legacy-migrate.ts`，不污染 `storage-keys.ts` 的“不迁移”契约。
- 侧栏底部补“新建设计 / 导入原型”入口，对应 `sandbox:create/adopt/pick-text-file`。

**验收命令**
```bash
npx tsc --noEmit
node tests/verify-groups.js
node tests/verify-project-switch.js
npx vitest run src/renderer/stores/__tests__/sources-store.test.ts   # 新增后
npx playwright test e2e/shell.spec.ts
```

**依赖/冲突**：所有其他包的前置。`app-store.ts` / `storage-keys.ts` / `MainWindow.tsx` 只归本包，后续包不得再改。

---

### 7.3 W3-02 预览舞台：Stage / PreviewFrame / 拾取

**目标**：Stage 渲染真实 iframe（srcDoc），支持 PC/移动 375×780、缩放、子页、拾取、`PickOverlay` 定位。

**独占文件**
- `src/renderer/components/shell/Stage.tsx`
- `src/renderer/features/preview/PreviewFrame.tsx`
- `src/renderer/features/preview/lib/iframe-pick.ts`
- `src/renderer/features/preview/lib/secure-srcdoc.ts`（新建）
- `src/renderer/features/preview/PickOverlay.tsx`
- `src/renderer/features/preview/PreviewOverlaysHost.tsx`（新建，先返回 `null`；W3-08 只填此文件）

**实现要点**
- `Stage` 从 `sources-store` 取 `currentSource.content`，渲染 `<PreviewFrame html=... />`；移动端继续用 `scaleBoxScale`（`iframe-pick.ts:112`）。
- `PreviewFrame` 补 `selector` 生成：移植 `js/edit-entry.js:612 generateSelector` 或按 `buildSelectorFromSegments`（`iframe-pick.ts:128`）组装真实路径段；悬停/点选 rect 经 `scaleRectToPage`（`iframe-pick.ts:81`）换算。
- `sandbox` 属性二选一，不能只改属性：A) 保留 `allow-same-origin`，继续用 `contentDocument` 绑定拾取（当前实现，需安全评审；注意 srcdoc 同源可访问父文档）；B) 移植 `sandboxSecureSrcdoc`/postMessage 帧桥（`sandbox-core.js:1373-1391`）并改回 `allow-scripts allow-forms`，拾取改走帧内 Agent 上报。若选 B，链接/标注/AI 帧桥才能与旧渲染器对齐。
- 子页切换走 `sandbox:read-file`，主页走列表里的 `content`。

**验收命令**
```bash
npx tsc --noEmit
npx vitest run src/renderer/features/preview/__tests__/iframe-pick.test.ts
npx vitest run src/renderer/features/preview/__tests__/secure-srcdoc.test.ts  # 新增后
npx playwright test e2e/preview.spec.ts
```

**依赖/冲突**：依赖 W3-01 的 `SourceRef`。与 W3-08 串行：`Stage.tsx` 归本包，W3-08 只改 `PreviewOverlaysHost.tsx`。

---

### 7.4 W3-03 文档闭环：功能说明 / 最新需求 / mirror

**目标**：功能说明从 `sandbox:list` 的 `md` 或 `sandbox:read-file` 加载；保存走 `sandbox:write`（`<name>.md`）；最新需求走 `doc:read-latest/write-latest`（带 `dir`）；保存后 `doc:mirror-push` 同步文档窗。

**独占文件**
- `src/renderer/stores/docs-store.ts`
- `src/renderer/features/docs/DocsPanel.tsx`
- `src/renderer/features/docs/DocEditor.tsx`
- `src/renderer/features/docs/DocToc.tsx`
- `src/renderer/components/shell/DocsPanelHost.tsx`
- `src/renderer/app/modes/DocWindow.tsx`

**实现要点**
- `docs-store` 增加 `loadDesc(source)`：优先 `source.md`，否则 `sandbox.readFile({dir,file:mdFile})`；`save` 按 Tab 分流：
  - `desc` → `sandbox.write({dir,file:mdFile,content})`（对应 `core-docs.js:112-148`）；
  - `latest` → `doc.writeLatest({dir,file:'最新需求.md',content})`（对应 `project-ai-export.js:242-243`）。
- 增加 `sourceId + __ver` 保存守卫（移植 `js/store.js:20-28,181-223`），防切换原型后异步写串目录。
- 保存成功/内容变更后 `doc.mirrorPush({kind:'content',payload:{content}})`；`DocWindow` 继续监听 `doc:mirror`。
- `DocsPanel` 挂载时加载一次功能说明（不再只在切 Tab 时读）；`DocsPanelHost` 去掉“占位”Badge。
- 顶栏“文档”按钮的语义要与旧版对齐（面板 / `docwin.toggle` 二选一，不能只开面板，`core-docs.js:3988-4031`）；把 `docwin.toggle/open/close` 封装为 `useDocWindow()` 或 ui-store action，Topbar 的按钮改动由 W3-04 统一接（故 W3-03 必须先于 W3-04，见 §7.11）。

**验收命令**
```bash
npx tsc --noEmit
npx vitest run src/renderer/stores/__tests__/docs-store.test.ts   # 新增后
npx playwright test e2e/docs.spec.ts
node tests/verify-doc-edit.js
node tests/verify-docwin.js
```

**依赖/冲突**：依赖 W3-01 的 `SourceRef.sandboxDir/mdFile`。`docs-store.ts` 归本包；W3-04 只读其导出的 `renderDocPreview`。`Topbar.tsx` 归 W3-04，因此本包必须先于 W3-04（或至少先冻结 `useDocWindow()` 接口）。

---

### 7.5 W3-04 导出闭环：sources / 独立 HTML / PNG / PDF

**目标**：把真实 `sources` 传给 `ExportMenu`；源码包/独立 HTML 有内容；文档 PNG/PDF 发送正确 `html`；md 图片内联。

**独占文件**
- `src/renderer/features/export/ExportMenu.tsx`
- `src/renderer/components/shell/Topbar.tsx`
- `src/renderer/features/export/export-assets.ts`（新建）
- `e2e/export.spec.ts`（新建）

**实现要点**
- `Topbar` 从 `sources-store` 取 `sources`（字段对齐 `ExportMenuProps.ExportSourceItem`，`ExportMenu.tsx:29-39`），替换 `sources={[]}`。
- `ExportMenu` 文档导出前用 `renderDocPreview(docContent)`（`docs-store.ts:150`）生成 HTML，再发 `{title,html,width}`；不要发 `content`。
- 独立 HTML 增加 md 图片内联：`sandbox:list-assets` 取 `relPath`，再 `sandbox:read-asset-base64({dir,relPath})` 转 `dataUrl`（对应旧 `project-ai-export.js:7738-7744`）。
- 保持 `__EXPORT_BOOT__/__EXPORT_SOURCES__/__REQ_MAP__/__EXPORT_LINKS__/__ANNO_MAP__` 契约不变（`ExportMenu.tsx:134-149`）。

**验收命令**
```bash
npx tsc --noEmit
npx playwright test e2e/git-export.spec.ts
npx playwright test e2e/export.spec.ts        # 新增后
npm run build:renderer
node tests/check-pack.js
```

**依赖/冲突**：依赖 W3-01（sources）与 W3-03（`renderDocPreview`）。`Topbar.tsx` 只归本包；`e2e/git-export.spec.ts` 归 W3-05 修改，本包只读。

---

### 7.6 W3-05 Git 全量：配置 / 分支 / 差异 / 取消

**目标**：补齐 `git:config-get/save-config/test-connection/list-branches/fetch-diff/is-busy/cancel`，让 Git 面板从“只看变更”变成可配置、可切分支、可预览差异、可取消。

**独占文件**
- `src/renderer/features/git/GitPanel.tsx`
- `src/renderer/features/git/GitConfigDialog.tsx`（新建）
- `src/renderer/features/git/git-api.ts`（新建，薄封装）
- `e2e/git-export.spec.ts`

**实现要点**
- 配置弹窗字段对齐 `git:config-get` 返回的 `config`（`remoteUrl/branch/authorName/authorEmail/hasToken/tokenMasked`）；保存发 `{project,config}`。
- 分支下拉：`git:list-branches` → `branches/currentBranch/remoteConfigured`；`remoteConfigured=false` 时提示先配置。
- 差异预览：`git:fetch-diff` 与 `git:status` 同结构，展示未推送变更。
- 操作期间 `git:is-busy` 轮询或按钮禁用；取消走 `git:cancel`。
- `project` 从 `sources-store` 读；不要再用空 `app-store.project` 直接传。

**验收命令**
```bash
npx tsc --noEmit
node tests/verify-git-security.js
npx playwright test e2e/git-export.spec.ts
```

**依赖/冲突**：依赖 W3-01 提供项目名；可与 W3-02/W3-03 并行。与 W3-04 只在 `e2e/git-export.spec.ts` 有测试文件归属冲突——该文件归本包。

---

### 7.7 W3-06 设置与模型数据源

**目标**：6 个设置 Tab 全部有真实数据：Agent 矩阵（`ai:check` + `ai:get-config/save-config`）、模型管理（`ai:models` + `ai:save-config`）、设计规范（`spec:*` + `project:*binding`）、沙箱（`sandbox:list root`）、快捷键、关于（`app:get-version`）。

**独占文件**
- `src/renderer/features/settings/SettingsDialog.tsx`
- `src/renderer/features/settings/AgentMatrix.tsx`
- `src/renderer/features/settings/SandboxTab.tsx`
- `src/renderer/features/settings/ShortcutTab.tsx`
- `src/renderer/features/settings/AboutTab.tsx`
- `src/renderer/features/models/ModelManager.tsx`
- `src/renderer/features/models/ModelFetchModal.tsx`
- `src/renderer/stores/settings-store.ts`（新建）

**实现要点**
- `settings-store` 启动拉 `ai.check` + `ai.get-config`；Agent 行不再用 `DEFAULT_AGENTS`（`AgentMatrix.tsx:31-36`）。
- 模型：`ai.models` 返回 `groups/allGroups/default/visibleModels`；`ModelManager` 用 `groups`，`ModelFetchModal` 用 `allGroups`；保存 `visibleModels` 走 `ai.save-config`。
- 设计规范：`spec:list/read/create-from-file/update/remove`；项目绑定 `project:get-binding/set-binding`（`choose spec` 后写项目 `design-spec.md`）。
- 沙箱：`sandbox:list()` 取 `root` 展示；不要把 `SandboxSettings` 默认空目录当真实值（`SandboxTab.tsx:33`）。
- 关于：`app:get-version` 替代写死 `v1.2.0`（`AboutTab.tsx:18`）。

**验收命令**
```bash
npx tsc --noEmit
npx vitest run src/renderer/features/models/__tests__/fallback.test.ts
npx vitest run src/renderer/features/settings/__tests__/settings-store.test.ts  # 新增后
npx playwright test e2e/settings-models.spec.ts
```

**依赖/冲突**：可独立启动；W3-07 依赖本包的 `settings-store` 模型/配置接口。`SettingsDialog.tsx` 归本包，W3-07 不改。

---

### 7.8 W3-07 AI 上下文与持久化

**目标**：AI 发送带当前原型 `sandboxDir/targetFile/uiKind/activePage`；模型/思考从配置来；会话/历史持久化；不再写死 `engine='cli'`。

**独占文件**
- `src/renderer/stores/ai-store.ts`
- `src/renderer/features/ai/AiDialog.tsx`
- `src/renderer/features/ai/adapters.ts`
- `src/renderer/features/ai/SessionList.tsx`

**实现要点**
- `sendMessage` 从 `sources-store` 取 `currentSource.sandboxDir`、`mainHtmlFile/activeSubFile`、`kind`；`activePage` 从 `extractPages`（W3-01 端口）取当前 hash/页；`targetFile` 用 `curHtmlFile` 等价物。
- `engine` 从 `ai.get-config` 的 `engine/mode` 派生，不再写死 `'cli'`（`ai-store.ts:427`）。
- 模型清单：从 `settings-store`/`ai.models` 取 `groups` 喂 `ModelSelector`，不再用 `modelId` 单元素（`AiDialog.tsx:64-67`）。
- 持久化：用 `storage-keys.aiHistKey/sessStoreKey`（`storage-keys.ts:56-99`）保存会话；用 `AI_MODEL_KEY/AI_REASONING_KEY` 保存选择。
- 流式事件已接 `bindAiEvents`（`ai-store.ts:544-554`），保持不变。

**验收命令**
```bash
npx tsc --noEmit
npx vitest run src/renderer/features/ai/__tests__/adapters.test.ts
npx vitest run src/renderer/stores/__tests__/ai-store.test.ts   # 新增后
node tests/verify-event-pipeline.js
node tests/verify-acp-ui-wiring.js
```

**依赖/冲突**：依赖 W3-01（源上下文）与 W3-06（模型/配置接口）。与 W3-06 串行：先冻结 `settings-store` 接口，再改 `ai-store`。

---

### 7.9 W3-08 标注 / 快照 / 就地编辑 / 多选 / 链接

**目标**：把孤儿零件装配到预览舞台：标注面板/角标、快照列表/恢复、就地编辑、多选批量、检查器、待提交条、链接绑定。

**独占文件**
- `src/renderer/features/annotations/AnnoStore.ts`
- `src/renderer/features/snapshot/SnapshotStore.ts`
- `src/renderer/components/overlays/AnnoPanel.tsx`
- `src/renderer/components/overlays/SnapshotPanel.tsx`
- `src/renderer/components/overlays/Inspector.tsx`
- `src/renderer/components/overlays/MultiEditBar.tsx`
- `src/renderer/features/preview/InlineEdit.tsx`
- `src/renderer/features/preview/MultiSelect.tsx`
- `src/renderer/features/links/LinkBind.ts`
- `src/renderer/features/preview/PreviewOverlaysHost.tsx`（填 W3-02 的空壳）

**实现要点**
- 快照修 C4/C5：读 `items`，用 `ts` 而非 `id`；恢复 `{dir,ts}`。
- 标注/链接读写在 `currentSource.sandboxDir` 上；保存前用 `selector`（W3-02）与 `page/htmlFile` 三键。
- `PreviewOverlaysHost` 接收 Stage 的 hover/pick/rect 回调，渲染 `PickOverlay`、`InlineEdit`、`MultiSelect`、`Inspector`、`MultiEditBar`、`AnnoPanel`、`SnapshotPanel`。
- 资产：若标注/原型含图片，补 `sandbox:list-assets/read-asset-base64/save-asset/delete-asset`（依赖 W3-02 的 srcdoc 资产路径）。

**验收命令**
```bash
npx tsc --noEmit
node tests/verify-snapshot-restore.js
node tests/verify-inline-edit.js
node tests/verify-link-stamp.js
npx vitest run src/renderer/features/snapshot/__tests__/snapshot-store.test.ts  # 新增后
npx playwright test e2e/preview.spec.ts
```

**依赖/冲突**：依赖 W3-02（拾取/iframe）与 W3-01（sandboxDir）。**必须串行在 W3-02 之后**；只改 `PreviewOverlaysHost.tsx`，不改 `Stage.tsx`。

---

### 7.10 W3-09 默认渲染器切换与打包门禁

**目标**：React renderer 成为默认入口，legacy 保留 fallback；打包/门禁/离线验证闭环。

**独占文件**
- `main.js`
- `main/controllers/window-controller.js`
- `package.json`（scripts/build 字段）
- `README.md`

**实现要点**
- `getRendererMode()` 默认改为 `react`（`main.js:41-44`；`window-controller.js:14-19`），保留 `?renderer=legacy` / `PLAND_RENDERER=legacy` 强制回退。
- 确认 `dist/renderer/**` 在 `build.files`（`package.json:85`）；`dev:renderer` / `build:renderer` 脚本可用。
- 文档窗 `?docwin=1` 在 React 下走 `dist/renderer/index.html`（`window-controller.js:20-25`）。
- README 更新“从源码运行”的 React 模式说明（`README.md:41-48`）。

**验收命令**
```bash
npm run build:renderer
node tests/check-pack.js
node tests/lint-guard.js
node tests/static-verify.js
$env:PLAND_RENDERER='react'; npx electron .   # Windows PowerShell
```

**依赖/冲突**：最后执行；只改启动/打包文件，不碰 `src/renderer/**`。

---

### 7.11 冲突 / 串行矩阵

| 包对 | 共享文件或接口 | 规则 |
|---|---|---|
| W3-01 × 所有包 | `stores/sources-store.ts` 的 `SourceRef` 类型、`app-store`、`storage-keys` | **W3-01 先冻结接口**；其他包只读，不编辑这三个文件 |
| W3-02 × W3-08 | `Stage.tsx`、`PreviewOverlaysHost.tsx` | **串行**：W3-02 交付 `PreviewOverlaysHost` 空壳，W3-08 只填该文件；W3-08 不改 `Stage.tsx` |
| W3-03 × W3-04 | `docs-store.ts`（`renderDocPreview`）、`Topbar.tsx`（文档按钮 / sources） | **串行 W3-03 → W3-04**：W3-04 独占 `Topbar.tsx`，同时接 W3-03 交付的 `useDocWindow()` 与 sources；W3-04 只读 `docs-store.ts`，不改 |
| W3-06 × W3-07 | `settings-store` 的模型/配置接口 | **串行**：先 W3-06 冻结 `groups/visibleModels/engine/acp` 接口，再 W3-07 消费 |
| W3-04 × W3-05 | `e2e/git-export.spec.ts` | 测试文件归 W3-05；W3-04 新增 `e2e/export.spec.ts`，不编辑前者 |
| W3-09 × 所有包 | `main.js` / `package.json` | 只有 W3-09 改；必须最后执行 |

**推荐并行车道**
- Lane A：W3-01 → W3-02 → W3-08
- Lane B：W3-03 → W3-04（W3-03 在 W3-01 的 `SourceRef` 接口冻结后启动；W3-04 等 W3-01 + W3-03）
- Lane C：W3-05（W3-01 后可并行）
- Lane D：W3-06 → W3-07（W3-07 另等 W3-01）
- Gate：W3-09

---

## 8. 建议的 Wave3 完成定义（DoD）

1. 冷启动 → 项目选择器出现（有项目/原型计数），选项目后侧栏出现真实分组/原型/子页。
2. 点原型 → Stage 出现 iframe，PC/移动切换、缩放、子页切换可用；Ctrl 拾取能拿到非空 selector。
3. 文档面板打开即显示功能说明；编辑保存后磁盘 `<sandboxDir>/<name>.md` 变化；最新需求读写落到当前原型目录。
4. 导出源码包/独立 HTML 含当前原型内容；文档 PNG/PDF 成功落盘；离线打开 `__EXPORT_BOOT__===true`。
5. Git 面板能看到变更树、配置远端/分支、上传/拉取/差异/取消。
6. 设置 6 Tab 有真实数据；模型勾选能保存；设计规范能绑定到项目。
7. AI 发送落入当前原型目录；模型/思考来自配置；会话刷新不丢。
8. 标注/链接/快照/就地改/多选至少各有一条完整“创建→保存→重开→回显”链路。
9. `npx tsc --noEmit`、`node tests/lint-guard.js`、`node tests/check-pack.js`、`node tests/static-verify.js`、`npx vitest run`、`npx playwright test` 全绿。

---

## 9. 附：本次勘察的基线命令结果

```text
npx tsc --noEmit                         -> exit 0
node tests/verify-groups.js              -> SUMMARY passed=5 failed=0
node tests/verify-ipc.js                 -> SUMMARY passed=4 failed=0
node tests/lint-guard.js                 -> LINT_PASS；E-IPC-FROZEN contract 70, 实际 70
```

> 注：以上只读命令用于确认“旧契约/旧门禁未坏”，不代表 React 接线已通过；React 侧目前没有对应的组合/集成测试。
