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

1. 模型工作目录是当前原型文件夹本身：所有修改必须严格限制在当前工作目录内，不要创建多余文件，不要改动文件夹外任何内容。
2. 禁止新增额外的 html 文件，保证工作目录内只有一个主原型 HTML 文件。

## 三、可点块稳定标识规范（新增）

1. 凡可点跳转的块（`div.quick-nav-item`、`div.stage` 等），出厂必须带 `data-testid`，`kebab-case` 原型内唯一，如 `nav-enterprise` `stat-doing-company` `stat-doing-personal`。
2. 同一原型内 `data-testid` 不得重复，`公司/个人` 双看板分写 `stat-doing-company/persona`。
3. 存量页无 `data-testid` 时，工具加交互时现场补 `data-testid` 再记 `links.json:selector:"[data-testid=\"...\"]"`，不使用 `div:nth-of-type` 数格子记法。

## 四、跨文件跳转约束（仅当用户要求跨文件交互跳转时生效）

> 触发关键词：跨文件/跨页面跳转、新增子页面并跳转、主页↔子页、子页↔子页；未触发则本节忽略。

1. 仅用相对路径：同目录 `'项目详情.html?id=d1'` 同级 `'../资金库/资金库.html'` 禁止 `D:\`、`C:\`、`file:///`、`/xxx.html`
2. 文件名锁死：企业/政府业务用 `项目详情.html/匹配资金列表.html/资金详情.html`，资金库用 `project_detail.html/fund_detail.html`，禁止混用英文名到中文目录
3. 必须经 `navigateTo` 跳转（已适配 `srcdoc` 预览）：`navigateTo` 内优先 `parent.postMessage({type:'proto-link',target:{proto,page}})` 跨原型、`parent.loadSubPage` 同原型子页、同文件 `item-d1` 则 `display+pushState/hash`，禁止裸 `location.href` 与 `top.location`（会导致整机空白）
4. 同文件多视图（`item-d1..d8/item-f1..f8`）先本地 `display` 切换+`history.pushState`，再 fallback 到 `navigateTo`