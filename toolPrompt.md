# 原型工具 · 工具内置提示词（每次任务必读）

> 本文件由原型工具内置（toolPrompt.md）。每次大模型对话开始时，无论是否调用系统 Skill，
> 必须先阅读并遵守本提示词，再执行用户需求。

## 一、工作规范与独立性原则（强制要求）

1. **原型与文档完全独立，互不联动**：
   - 当用户要求修改/生成**原型页面**时：仅修改工作目录下的原型 HTML 文件（`<文件夹名>.html`），**严禁擅自创建、修改或向任何 Markdown 文档（`.md`）写入内容**。
   - 当用户明确要求修改**功能说明文档**时：仅修改对应的文档文件（`<文件夹名>.md`），**严禁改动原型 HTML 文件**。
   - 用户没有明确要求修改文档时，绝对不要触碰任何 `.md` 文件。

2. **技能调用规范**：
   - 修改原型时：使用 prototype-ui skill
   - 修改文档时：使用 PRDskill

## 二、工作目录约定与禁止事项

1. 模型工作目录是当前原型文件夹本身：所有修改必须严格限制在当前工作目录内，不要创建多余文件，不要改动文件夹外任何内容；沙箱外文件只读，严禁写入或修改，仅当前工作目录可写，违例视为任务失败。
2. 一原型文件夹可含多 HTML：主页为同名 `<文件夹名>.html`，子页为同目录其他 `*.html`；待提交清单会逐条注明 `所属文件`，只改该文件对应片段，严禁全写进主页，严禁跨文件夹；无明确新增子页需求时禁止新增 html 文件。
3. 沙箱外文件只读、仅当前工作目录可写：除按指针按需读取 `.context/` 内快照外，不得越界读写其他原型目录；任何跨文件夹写入、把子页内容全写进主页、或擅自触碰沙箱外文件，均视为任务失败。

## 三、可点块稳定标识规范（新增）

1. 凡可点跳转的块（`div.quick-nav-item`、`div.stage` 等），出厂必须带 `data-testid`，`kebab-case` 原型内唯一，如 `nav-enterprise` `stat-doing-company` `stat-doing-personal`。
2. 同一原型内 `data-testid` 不得重复，`公司/个人` 双看板分写 `stat-doing-company/stat-doing-personal`（与第 1 条示例统一）。
3. 存量页无 `data-testid` 时优先现场补 `data-testid` 再记 `links.json:selector:"[data-testid=\"...\"]"`；仅当元素无稳定 `data-testid/id/class` 且补写不可行时，允许按 `generateSelector` 兜底生成逐级 `tag:nth-of-type` 全路径保证唯一可定位（与代码现实对齐）。

## 四、跨文件跳转约束（仅当用户要求跨文件交互跳转时生效）

> 触发关键词：跨文件/跨页面跳转、新增子页面并跳转、主页↔子页、子页↔子页；未触发则本节忽略。

1. 仅用相对路径：同目录 `'项目详情.html?id=d1'` 同级 `'../资金库/资金库.html'` 禁止 `D:\`、`C:\`、`file:///`、`/xxx.html`
2. 文件名锁死：企业/政府业务用 `项目详情.html/匹配资金列表.html/资金详情.html`，资金库用 `project_detail.html/fund_detail.html`，禁止混用英文名到中文目录
3. 统一跳转（代码未提供全局 `navigateTo` 前按此执行）：跨原型用 `parent.postMessage({type:'proto-link',target:{proto,page}},'*')`（见 `link-bind.js` 注入与监听），同原型子页用 `parent.loadSubPage(proto,subFile)`；禁止裸 `location.href` 与 `top.location`（会导致整机空白）。`navigateTo` 薄封装待代码补齐后恢复（跨原型/同原型子页/同文件多视图 `display+pushState/hash` 三分支，`srcdoc` 适配）
4. 同文件多视图（`item-d1..d8/item-f1..f8`）先本地 `display` 切换+`history.pushState`，再 fallback 到 `navigateTo`