// Wave-E: ESLint flat config (dev-only, 不进 asar; 与 tests/lint-guard.js 规则同源)
// 用法: npx eslint .  (需 npm i -D eslint) / 日常门禁: node tests/lint-guard.js (零依赖)
// 规则来源: 审计报告第四章第1节(无 ESLint/Prettier, static-verify 脆弱) + 历波红线
//   - 安全: no-eval / no-implied-eval / no-new-func (阻断动态代码执行, 呼应 iframe 特权穿透修复)
//   - 稳定: no-unused-vars(warn) / no-undef / no-redeclare (幽灵变量/拼写漂移早暴露)
//   - 风格: 与 .prettierrc.json 同源 (singleQuote, semi, printWidth 120, tabWidth 2)
// 注意: 本文件自身必须通过 lint-guard (CommonJS, 无 emoji, 无 gradient 字符串).
/** @type {import('eslint').Linter.Config[]} */
module.exports = [
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
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'writable',
        exports: 'writable',
        require: 'readonly',
      },
    },
    rules: {
      // P0 安全红线 (error)
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
    // 渲染层经典脚本: 允许 window/document 等浏览器全局
    files: ['js/**/*.js', 'preload.js'],
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
    // 渲染层 ESM 模块: import/export 显式依赖
    files: ['js/store.js', 'js/event-bus.js', 'js/sandbox-agent.js', 'js/utils.js', 'js/main.js'],
    languageOptions: {
      sourceType: 'module',
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'off',
        it: 'off',
      },
    },
    rules: {
      'no-unused-vars': 'off',
    },
  },
];
