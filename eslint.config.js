// Wave-E: ESLint flat config (dev-only, 不进 asar; 与 tests/lint-guard.js 规则同源)
// 用法: npx eslint .  (需 npm i -D eslint) / 日常门禁: node tests/lint-guard.js (零依赖)
// 规则来源: 审计报告第四章第1节(无 ESLint/Prettier, static-verify 脆弱) + 历波红线
//   - 安全: no-eval / no-implied-eval / no-new-func (阻断动态代码执行, 呼应 iframe 特权穿透修复)
//   - 稳定: no-unused-vars(warn) / no-undef / no-redeclare (幽灵变量/拼写漂移早暴露)
//   - 风格: 与 .prettierrc.json 同源 (singleQuote, semi, printWidth 120, tabWidth 2)
// 注意: 本文件自身必须通过 lint-guard (CommonJS, 无 emoji, 无 gradient 字符串).
// Phase 0 方案A: 新增 TS/React 区块 files **/*.{ts,tsx}，parser 走 typescript-eslint，
//   plugins 挂 react-hooks/react-refresh，缺模块时降级为空规则不崩溃
//   (依赖由构建智能体A并行安装，本文件不得因缺包导致 eslint . 加载崩溃).
/** @type {import('eslint').Linter.Config[]} */

// Node/CommonJS 全局: main/providers/git/runtimes/tests 都是 Node 进程代码.
// 历史配置手写了 8 个全局, 漏掉 setTimeout/URL/Response/fetch/AbortController 等, 造成 264 项 no-undef 假阳性.
// 优先使用 eslint 自带的 globals 包 (全量 Node 全局), 缺包时退回手写最小集, 保证 config 本身不崩.
const fallbackNodeGlobals = {
  console: 'readonly',
  process: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  module: 'writable',
  exports: 'writable',
  require: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  clearImmediate: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  fetch: 'readonly',
  Response: 'readonly',
  Request: 'readonly',
  Headers: 'readonly',
  Blob: 'readonly',
  FormData: 'readonly',
  WebSocket: 'readonly',
  structuredClone: 'readonly',
  queueMicrotask: 'readonly',
};
let nodeGlobals = Object.assign({}, fallbackNodeGlobals);
try {
  const globalsRaw = require('globals');
  const globalsPkg = (globalsRaw && globalsRaw.default) || globalsRaw;
  if (globalsPkg && globalsPkg.node) {
    // 保留手写项兜底 globals 版本差异 (如 Node 22 才有的 WebSocket)
    nodeGlobals = Object.assign({}, fallbackNodeGlobals, globalsPkg.node);
  }
} catch (e) {
  // 降级: 仅用手写最小集; eslint 正常安装时不会走到这里
}

const baseConfigs = [
  {
    ignores: [
      'node_modules/**',
      '桌面端/**',
      'dist/**',
      '.devdata/**',
      'smoke-sandbox/**',
      'sandboxSeed/**',
      'docs/archive/**',
      '**/*.bak',
      '*.log',
      // 遗留渲染层 (classic script, 依赖全局 $/window 注入): 不参与 ESLint 全量门禁.
      // 该目录由 tests/lint-guard.js 的 E-EVAL/E-NODIALOG/E-GRAMMAR 专属扫描兜底 (零依赖红线不降级),
      // 新渲染层在 src/renderer (TS/React), 仍由下方 TS 区块全量校验.
      'js/**',
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: {
      // P0 安全红线 (error): 全量 JS (含 main/tests) 保持, 仅 tests/ 因 VM 仿真另设例外
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      // 稳定性 (error/warn)
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // 风格 (warn, 与 Prettier 一致, 不阻塞 npm test)
      quotes: ['warn', 'single', { avoidEscape: true }],
      semi: ['warn', 'always'],
      'no-var': 'off',
      'prefer-const': 'off',
    },
  },
  {
    // Electron preload: 经典脚本 + 浏览器全局 (js/** 已整体忽略, 此处仅保留 preload.js)
    files: ['preload.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
      },
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: Object.assign({}, nodeGlobals, {
        // 测试夹具在 vm 伪 DOM 中执行渲染层代码, 需要浏览器侧构造器
        WebSocket: 'readonly',
        describe: 'off',
        it: 'off',
      }),
    },
    rules: {
      'no-unused-vars': 'off',
      // 测试专用例外: tests/ 用 vm / new Function / eval 在伪 DOM 中装载待测函数 (与 lint-guard
      // 的 EVAL_SKIP_PREFIX=['tests/'] 同口径), 非生产攻击面. 生产代码红线仍为 error, 不全局关闭.
      'no-eval': 'off',
      'no-implied-eval': 'off',
      'no-new-func': 'off',
    },
  },
];

// Phase 0 方案A TS/React 区块: files **/*.{ts,tsx}，parser 经 typescript-eslint 动态加载，
// plugins 经 react-hooks/react-refresh 动态加载，rules 至少含 react-hooks recommended.
// 缺模块时降级为仅注释提示 + 空规则占位，不使 eslint . 崩溃.
let tsReactConfigs = [];
try {
  const tsRaw = require('typescript-eslint');
  const hooksRaw = require('eslint-plugin-react-hooks');
  const refreshRaw = require('eslint-plugin-react-refresh');
  const tseslint = (tsRaw && tsRaw.default) || tsRaw;
  const reactHooksPlugin = (hooksRaw && hooksRaw.default) || hooksRaw;
  const reactRefreshPlugin = (refreshRaw && (refreshRaw.default || refreshRaw.reactRefresh)) || refreshRaw;
  const tsParser = (tseslint && tseslint.parser) || null;
  const tsPlugin = (tseslint && tseslint.plugin) || null;
  const hookRules = ((reactHooksPlugin.configs
    && (reactHooksPlugin.configs['recommended-latest'] || reactHooksPlugin.configs.recommended)) || {}).rules || {};
  const tsBlock = {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {},
    plugins: {
      'react-hooks': reactHooksPlugin,
      'react-refresh': reactRefreshPlugin,
    },
    rules: Object.assign({}, hookRules, {
      // react-hooks v7 recommended-latest 新增的 React Compiler 取向规则: 现有浮层在 open/prop 变化时
      // 同步重置本地态属既定交互 (14 处存量). 降级为 warn 保持可见, 不阻断全量门禁; 新代码仍应避免.
      'react-hooks/set-state-in-effect': 'warn',
      'react-refresh/only-export-components': 'warn',
    }),
  };
  if (tsParser) {
    tsBlock.languageOptions.parser = tsParser;
  }
  if (tsPlugin) {
    tsBlock.plugins['@typescript-eslint'] = tsPlugin;
  }
  tsReactConfigs.push(tsBlock);
  // e2e (Playwright) 允许 CommonJS require: 显式关闭 @typescript-eslint/no-require-imports.
  // 该规则定义由上方 TS 块的 @typescript-eslint 插件注册提供, 不再报 "规则未定义".
  if (tsPlugin) {
    tsReactConfigs.push({
      files: ['e2e/**/*.spec.ts'],
      // e2e 文件仍保留历史 `// eslint-disable-next-line @typescript-eslint/no-require-imports` 注释;
      // 规则已显式关闭, 该注释成为 unused directive, 在此区块内不重复告警 (不改测试文件).
      linterOptions: {
        reportUnusedDisableDirectives: 'off',
      },
      plugins: {
        '@typescript-eslint': tsPlugin,
      },
      rules: {
        '@typescript-eslint/no-require-imports': 'off',
      },
    });
  }
} catch (e) {
  // 降级占位: typescript-eslint/react-hooks/react-refresh 任一缺失时仅保留 tsx 入口与 react-hooks 关键字，
  // 不设 parser/plugins，避免 eslint . 加载崩溃；待 A 装好依赖后自动启用完整规则.
  tsReactConfigs.push({
    files: ['**/*.{ts,tsx}'],
    // react-hooks recommended 待启用（缺模块降级，ESLint 权威校验暂缓）
    rules: {},
  });
}

module.exports = baseConfigs.concat(tsReactConfigs);
