#!/usr/bin/env node
/**
 * e2e/wave4/seed.mjs — Wave4 Phase 0 隔离 seed 构建/分发脚本。
 *
 * 设计口径（对应 docs/wave4-smoke-plan.md §2.2 / docs/test-isolation.md）：
 * 1. 只读 `.devdata`，绝不修改源目录；构建前后用文件指纹比对，源被改动即失败。
 * 2. 只复制最小测试种子：sandbox 项目、specs/uilibs、同项目快照、Local Storage、必要配置。
 * 3. 不复制任何凭据明文或可解密凭据：ai-credentials.json / git-credentials.json 只写空 entries；
 *    是否存在 token 只记录在 `_wave4-seed.json` 的 hasToken 元数据里。
 * 4. git 远程地址（git-config.json 与 sandbox/.git/config）在副本中清空，避免误触网络。
 * 5. seed 模板位于 `%TEMP%/pland-wave4/seed`，只读复用；每个域复制到仓库内
 *    `.devdata-wave4-<domain>`（与 e2e/wave4/harness.ts 的强制目录一致）。
 *
 * 用法：
 *   node e2e/wave4/seed.mjs --dry-run
 *   node e2e/wave4/seed.mjs --rebuild-seed
 *   node e2e/wave4/seed.mjs --domain shell
 *   node e2e/wave4/seed.mjs --domain shell,stage,settings --force
 *   node e2e/wave4/seed.mjs --all --force
 *
 * 约定：
 * - 首次/需要刷新种子时加 `--rebuild-seed`；并行 agent 默认复用已有 seed，避免同时重建。
 * - 覆盖已存在的域目录必须显式加 `--force`，脚本只会删除仓库根下精确匹配
 *   `.devdata-wave4-<domain>` 的目录。
 * - `--dry-run` 不创建任何目录/文件。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const DEFAULT_SOURCE = path.join(ROOT, '.devdata')
const TEMP_ROOT = path.join(os.tmpdir(), 'pland-wave4')
const DEFAULT_SEED = path.join(TEMP_ROOT, 'seed')
const DOMAIN_PREFIX = '.devdata-wave4-'
const MANIFEST_NAME = '_wave4-seed.json'
const DOMAIN_MARKER = '_wave4-domain.json'
const LOCK_NAME = '.seed.lock'
const LOCK_STALE_MS = 30 * 60 * 1000

const ALL_DOMAINS = ['ai', 'pick', 'docs', 'shell', 'stage', 'settings', 'git', 'export']

/** Local Storage 中与 Wave4 用例相关的键（只记录是否存在，不记录值）。 */
const LOCAL_STORAGE_KEYS = [
  'protoLastProject',
  'edit_queue_v1',
  'protoGroups_v1',
  'protoGroupsFold_v1',
  'protoOrder_v1',
  'subPageOrder_v1',
  'ai_model',
  'ai_model_reasoning',
]

const SECRET_KEY_RE = /^(apiKey|api_key|token|accessToken|refreshToken|password|secret|clientSecret)$/i

function fail(message) {
  const err = new Error(message)
  err.wave4Seed = true
  throw err
}

function parseArgs(argv) {
  const out = {
    source: DEFAULT_SOURCE,
    seed: DEFAULT_SEED,
    domains: [],
    dryRun: false,
    force: false,
    rebuildSeed: false,
    localStorage: true,
    git: true,
    json: false,
    allowOutsideTemp: false,
    allowActiveSource: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i]
    const eq = raw.indexOf('=')
    const key = eq >= 0 ? raw.slice(0, eq) : raw
    const inline = eq >= 0 ? raw.slice(eq + 1) : undefined
    const take = () => {
      const value = inline !== undefined ? inline : argv[++i]
      if (!value) fail(`参数 ${key} 缺少值`)
      return value
    }
    switch (key) {
      case '--source':
        out.source = path.resolve(ROOT, take())
        break
      case '--seed':
        out.seed = path.resolve(ROOT, take())
        break
      case '--domain': {
        const list = take()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        if (!list.length) fail('--domain 至少需要一个域名')
        out.domains.push(...list)
        break
      }
      case '--all':
        out.domains.push(...ALL_DOMAINS)
        break
      case '--dry-run':
        out.dryRun = true
        break
      case '--force':
        out.force = true
        break
      case '--rebuild-seed':
        out.rebuildSeed = true
        break
      case '--no-local-storage':
        out.localStorage = false
        break
      case '--no-git':
        out.git = false
        break
      case '--json':
        out.json = true
        break
      case '--allow-outside-temp':
        out.allowOutsideTemp = true
        break
      case '--allow-active-source':
        out.allowActiveSource = true
        break
      case '--help':
      case '-h':
        out.help = true
        break
      default:
        fail(`未知参数：${raw}`)
    }
  }
  out.domains = [...new Set(out.domains)]
  return out
}

function printHelp() {
  const lines = [
    'Wave4 seed 构建/分发',
    '',
    '  node e2e/wave4/seed.mjs --dry-run              只读勘察，不写文件',
    '  node e2e/wave4/seed.mjs --rebuild-seed         重建 %TEMP%/pland-wave4/seed',
    '  node e2e/wave4/seed.mjs --domain shell         复用 seed，复制到 .devdata-wave4-shell',
    '  node e2e/wave4/seed.mjs --all --force          刷新 8 个域目录',
    '',
    '可选：--source <dir>  --seed <dir>  --no-local-storage  --no-git  --json',
  ]
  console.log(lines.join('\n'))
}

function resolveInside(child, parent, label) {
  const c = path.resolve(child)
  const p = path.resolve(parent)
  const rel = path.relative(p, c)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    fail(`${label} 必须位于 ${p} 内，实际为 ${c}`)
  }
  return c
}

function normalizeDomain(domain) {
  const value = String(domain || '').trim()
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/i.test(value)) {
    fail(`非法域名 "${domain}"（只允许字母/数字/连字符，最长 32）`)
  }
  return value.toLowerCase()
}

function domainDir(domain) {
  const name = DOMAIN_PREFIX + normalizeDomain(domain)
  const target = path.join(ROOT, name)
  if (path.dirname(path.resolve(target)) !== path.resolve(ROOT) || path.basename(target) !== name) {
    fail(`拒绝写入域目录：${target}`)
  }
  return target
}

/** 检测 Electron 进程；复制共享 .devdata 前必须确认没有实例在写。 */
function detectElectronProcesses() {
  try {
    if (process.platform === 'win32') {
      const result = spawnSync('tasklist', ['/FI', 'IMAGENAME eq electron.exe', '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5_000,
      })
      const text = String(result.stdout || '').trim()
      if (!text) return []
      return text
        .split(/\r?\n/)
        .filter((line) => /electron\.exe/i.test(line))
        .map((line) => line.split('","')[1] || line)
    }
    const result = spawnSync('pgrep', ['-fl', 'electron'], { encoding: 'utf8', timeout: 5_000 })
    return String(result.stdout || '')
      .split(/\r?\n/)
      .filter(Boolean)
  } catch {
    return []
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function sha256File(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  } catch {
    return 'unreadable'
  }
}

function walkFiles(root, rel = '') {
  const out = []
  let entries
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true })
  } catch {
    return out
  }
  for (const ent of entries) {
    const childRel = rel ? path.posix.join(rel, ent.name) : ent.name
    const full = path.join(root, childRel)
    if (ent.isDirectory()) out.push(...walkFiles(root, childRel))
    else if (ent.isFile()) {
      try {
        const st = fs.statSync(full)
        out.push({
          rel: childRel,
          size: st.size,
          mtimeMs: Math.round(st.mtimeMs),
          sha256: sha256File(full),
        })
      } catch {
        /* 读取中被删除：交给前后指纹比对报错 */
      }
    }
  }
  return out
}

function fingerprint(paths) {
  const rows = []
  let files = 0
  let bytes = 0
  for (const { abs, label } of paths) {
    if (isFile(abs)) {
      const st = fs.statSync(abs)
      rows.push(`${label}|${st.size}|${Math.round(st.mtimeMs)}|${sha256File(abs)}`)
      files += 1
      bytes += st.size
      continue
    }
    if (!isDir(abs)) continue
    for (const row of walkFiles(abs)) {
      rows.push(`${label}/${row.rel}|${row.size}|${row.mtimeMs}|${row.sha256}`)
      files += 1
      bytes += row.size
    }
  }
  rows.sort()
  const hash = crypto.createHash('sha256').update(rows.join('\n')).digest('hex')
  return { hash, files, bytes }
}

function fingerprintRoots(plan) {
  const source = plan.source
  return [
    ...plan.projects.map((p) => ({ abs: path.join(source, 'sandbox', p), label: `sandbox/${p}` })),
    { abs: path.join(source, 'sandbox', '.context'), label: 'sandbox/.context' },
    { abs: path.join(source, 'sandbox', '.git'), label: 'sandbox/.git' },
    { abs: path.join(source, 'sandbox', '.gitignore'), label: 'sandbox/.gitignore' },
    { abs: path.join(source, 'specs'), label: 'specs' },
    { abs: path.join(source, 'uilibs'), label: 'uilibs' },
    { abs: path.join(source, 'snapshots'), label: 'snapshots' },
    { abs: path.join(source, 'projects-normalized-v1'), label: 'projects-normalized-v1' },
    { abs: path.join(source, 'ai-config.json'), label: 'ai-config.json' },
    { abs: path.join(source, 'ai-credentials.json'), label: 'ai-credentials.json' },
    { abs: path.join(source, 'git-config.json'), label: 'git-config.json' },
    { abs: path.join(source, 'git-credentials.json'), label: 'git-credentials.json' },
    { abs: path.join(source, 'Local Storage', 'leveldb'), label: 'Local Storage/leveldb' },
  ].filter((x) => isFile(x.abs) || isDir(x.abs))
}

/* ------------------------------------------------------------------ */
/* 复制与脱敏                                                          */
/* ------------------------------------------------------------------ */

const IGNORED_NAMES = new Set(['node_modules', '.DS_Store', 'Thumbs.db', 'desktop.ini'])

function createFilter({ git = false, localStorage = false } = {}) {
  return (rel, ent) => {
    const name = ent.name
    if (IGNORED_NAMES.has(name)) return false
    if (/\.tmp$/i.test(name)) return false
    if (git) {
      if (rel === 'logs' || rel.startsWith('logs/')) return false
      if (rel === 'FETCH_HEAD' || rel === 'ORIG_HEAD' || rel === 'index.lock') return false
      if (rel === 'refs/remotes' || rel.startsWith('refs/remotes/')) return false
    }
    if (localStorage) {
      if (name === 'LOCK' || name === 'LOG' || name === 'LOG.old') return false
    }
    return true
  }
}

function copyTree(src, dst, stats, options = {}) {
  let st
  try {
    st = fs.lstatSync(src)
  } catch {
    stats.excluded.push(`${options.label || src}（不存在）`)
    return
  }
  if (st.isSymbolicLink()) {
    stats.excluded.push(`${options.label || src}（符号链接，跳过）`)
    return
  }
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true })
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
      const rel = options.rel ? path.posix.join(options.rel, ent.name) : ent.name
      if (options.filter && !options.filter(rel, ent)) {
        stats.excluded.push(`${options.label || ''}/${rel}`.replace(/^\/+/, ''))
        continue
      }
      copyTree(path.join(src, ent.name), path.join(dst, ent.name), stats, {
        ...options,
        rel,
        label: options.label || path.basename(src),
      })
    }
    return
  }
  if (!st.isFile()) {
    stats.excluded.push(`${options.label || src}（非普通文件，跳过）`)
    return
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
  try {
    fs.utimesSync(dst, st.atime, st.mtime)
  } catch {
    /* 时间戳失败不影响内容 */
  }
  stats.files += 1
  stats.bytes += st.size
}

function stripUrlCredentials(raw) {
  try {
    const url = new URL(String(raw))
    let changed = false
    if (url.username || url.password) {
      url.username = ''
      url.password = ''
      changed = true
    }
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|secret|password/i.test(key)) {
        url.searchParams.set(key, 'REDACTED')
        changed = true
      }
    }
    return { value: url.toString(), changed, host: url.host }
  } catch {
    return { value: String(raw), changed: false, host: '' }
  }
}

function sanitizeAiConfig(raw) {
  const redacted = []
  const urlsWithCredentials = []
  const sourceCredentialFlags = {}
  const walk = (value, prefix) => {
    if (Array.isArray(value)) return value.map((item, index) => walk(item, `${prefix}[${index}]`))
    if (!value || typeof value !== 'object') return value
    const out = {}
    for (const [key, val] of Object.entries(value)) {
      const p = prefix ? `${prefix}.${key}` : key
      if (SECRET_KEY_RE.test(key)) {
        if (typeof val === 'string' && val.trim()) redacted.push(p)
        out[key] = ''
        continue
      }
      if (/^has[A-Z]/.test(key)) {
        if (typeof val === 'boolean' && val) sourceCredentialFlags[p] = true
        out[key] = false
        continue
      }
      if (/Masked$/i.test(key)) {
        if (typeof val === 'string' && val.trim()) sourceCredentialFlags[p] = 'masked'
        out[key] = ''
        continue
      }
      if (typeof val === 'string' && /^https?:\/\//i.test(val)) {
        const stripped = stripUrlCredentials(val)
        if (stripped.changed) urlsWithCredentials.push(p)
        out[key] = stripped.value
        continue
      }
      out[key] = walk(val, p)
    }
    return out
  }
  return { value: walk(raw, ''), redacted, urlsWithCredentials, sourceCredentialFlags }
}

function inspectAiCredentials(file) {
  if (!isFile(file)) return { present: false, entryKeys: [], hasApiKey: false, hasProfiles: false }
  let raw = null
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return { present: true, entryKeys: [], hasApiKey: false, hasProfiles: false, parseError: true }
  }
  const entries = (raw && raw.entries) || {}
  const values = Object.values(entries).filter((v) => v && typeof v === 'object')
  const hasApiKey = values.some((v) => Boolean(v.apiEnc || v.byokEnc || v.apiConfigEnc))
  const hasProfiles = values.some((v) => v.profilesEnc && Object.keys(v.profilesEnc).length > 0)
  return { present: true, entryKeys: Object.keys(entries), hasApiKey, hasProfiles }
}

function inspectGitCredentials(file) {
  if (!isFile(file)) return { present: false, entryKeys: [], hasToken: false, hasUsername: false }
  let raw = null
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return { present: true, entryKeys: [], hasToken: false, hasUsername: false, parseError: true }
  }
  const entries = (raw && raw.entries) || {}
  const values = Object.values(entries).filter((v) => v && typeof v === 'object')
  return {
    present: true,
    entryKeys: Object.keys(entries),
    hasToken: values.some((v) => Boolean(v.tokenEnc)),
    hasUsername: values.some((v) => Boolean(v.usernameEnc)),
  }
}

function sanitizeGitConfig(raw) {
  const value = JSON.parse(JSON.stringify(raw && typeof raw === 'object' ? raw : {}))
  const remoteHosts = []
  const strip = (cfg) => {
    if (!cfg || typeof cfg !== 'object') return
    if (typeof cfg.remoteUrl === 'string' && cfg.remoteUrl.trim()) {
      const stripped = stripUrlCredentials(cfg.remoteUrl)
      if (stripped.host) remoteHosts.push(stripped.host)
      cfg.remoteUrl = ''
    }
  }
  strip(value.defaultConfig)
  for (const cfg of Object.values(value.projects || {})) strip(cfg)
  return {
    value,
    remoteHosts: [...new Set(remoteHosts)],
    projectKeys: Object.keys((raw && raw.projects) || {}),
  }
}

/** 移除 sandbox/.git/config 中所有 [remote "..."] 段，并兜底清理 url 里的 userinfo。 */
function sanitizeGitRepoConfig(file) {
  if (!isFile(file)) return { present: false, removedRemoteSections: 0, remoteHosts: [] }
  const original = fs.readFileSync(file, 'utf8')
  const hosts = []
  for (const match of original.matchAll(/url\s*=\s*([^\s]+)/g)) {
    const stripped = stripUrlCredentials(match[1])
    if (stripped.host) hosts.push(stripped.host)
  }
  let removed = 0
  const cleaned = original
    .replace(/\[remote\s+"[^"]+"\][\s\S]*?(?=\n\[|$)/g, () => {
      removed += 1
      return ''
    })
    .replace(/(url\s*=\s*)([^\s]+)/g, (_m, prefix, url) => prefix + stripUrlCredentials(url).value)
    .replace(/\n{3,}/g, '\n\n')
  fs.writeFileSync(file, cleaned, 'utf8')
  return { present: true, removedRemoteSections: removed, remoteHosts: [...new Set(hosts)] }
}

function scanLocalStorageKeys(dir) {
  const found = new Set()
  if (!isDir(dir)) return []
  for (const file of walkFiles(dir)) {
    let buf
    try {
      buf = fs.readFileSync(path.join(dir, file.rel))
    } catch {
      continue
    }
    const text = buf.toString('latin1')
    for (const key of LOCAL_STORAGE_KEYS) {
      if (text.includes(key)) found.add(key)
    }
  }
  return LOCAL_STORAGE_KEYS.filter((k) => found.has(k))
}

/* ------------------------------------------------------------------ */
/* 构建计划                                                            */
/* ------------------------------------------------------------------ */

function buildPlan(opts) {
  const source = path.resolve(opts.source)
  if (!isDir(source)) fail(`源目录不存在：${source}`)
  if (!isDir(path.join(source, 'sandbox'))) fail(`源目录缺少 sandbox/：${source}`)

  const sandbox = path.join(source, 'sandbox')
  const projects = fs
    .readdirSync(sandbox, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
  if (!projects.length) fail('sandbox/ 下没有项目目录，拒绝猜测 seed 内容')

  const entries = []
  const excluded = []
  for (const project of projects) {
    entries.push({ from: path.join('sandbox', project), to: path.join('sandbox', project), label: `sandbox/${project}` })
  }
  if (isDir(path.join(sandbox, '.context'))) {
    entries.push({ from: path.join('sandbox', '.context'), to: path.join('sandbox', '.context'), label: 'sandbox/.context' })
  }
  if (isFile(path.join(sandbox, '.gitignore'))) {
    entries.push({ from: path.join('sandbox', '.gitignore'), to: path.join('sandbox', '.gitignore'), label: 'sandbox/.gitignore' })
  }
  if (opts.git && isDir(path.join(sandbox, '.git'))) {
    entries.push({
      from: path.join('sandbox', '.git'),
      to: path.join('sandbox', '.git'),
      label: 'sandbox/.git',
      git: true,
    })
  } else if (isDir(path.join(sandbox, '.git'))) {
    excluded.push('sandbox/.git（--no-git）')
  }
  if (isDir(path.join(sandbox, '.heal-backup'))) excluded.push('sandbox/.heal-backup')

  for (const dir of ['specs', 'uilibs']) {
    if (isDir(path.join(source, dir))) entries.push({ from: dir, to: dir, label: dir })
  }

  const snapshots = path.join(source, 'snapshots')
  if (isDir(snapshots)) {
    const snapshotProjects = fs
      .readdirSync(snapshots, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
    for (const project of snapshotProjects) {
      if (projects.includes(project)) {
        entries.push({
          from: path.join('snapshots', project),
          to: path.join('snapshots', project),
          label: `snapshots/${project}`,
        })
      } else {
        excluded.push(`snapshots/${project}（无同名 sandbox 项目）`)
      }
    }
  }

  if (isFile(path.join(source, 'projects-normalized-v1'))) {
    entries.push({ from: 'projects-normalized-v1', to: 'projects-normalized-v1', label: 'projects-normalized-v1' })
  }

  const localStorageDir = path.join('Local Storage', 'leveldb')
  if (opts.localStorage && isDir(path.join(source, localStorageDir))) {
    entries.push({
      from: localStorageDir,
      to: localStorageDir,
      label: 'Local Storage/leveldb',
      localStorage: true,
    })
  } else if (isDir(path.join(source, localStorageDir))) {
    excluded.push('Local Storage/leveldb（--no-local-storage）')
  }

  for (const name of fs.readdirSync(source)) {
    if (
      ![
        'sandbox',
        'specs',
        'uilibs',
        'snapshots',
        'projects-normalized-v1',
        'Local Storage',
        'ai-config.json',
        'ai-credentials.json',
        'git-config.json',
        'git-credentials.json',
      ].includes(name)
    ) {
      excluded.push(`${name}（未在白名单，忽略）`)
    }
  }

  const aiConfigPath = path.join(source, 'ai-config.json')
  let aiConfig = { present: false }
  if (isFile(aiConfigPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(aiConfigPath, 'utf8'))
      const sanitized = sanitizeAiConfig(raw)
      aiConfig = { present: true, ...sanitized }
    } catch {
      aiConfig = { present: true, parseError: true }
    }
  }

  const gitConfigPath = path.join(source, 'git-config.json')
  let gitConfig = { present: false }
  if (isFile(gitConfigPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(gitConfigPath, 'utf8'))
      gitConfig = { present: true, ...sanitizeGitConfig(raw) }
    } catch {
      gitConfig = { present: true, parseError: true }
    }
  }

  return {
    source,
    seed: path.resolve(opts.seed),
    projects,
    entries,
    excluded,
    localStorageKeys: opts.localStorage ? scanLocalStorageKeys(path.join(source, localStorageDir)) : [],
    aiConfig,
    gitConfig,
    aiCredentials: inspectAiCredentials(path.join(source, 'ai-credentials.json')),
    gitCredentials: inspectGitCredentials(path.join(source, 'git-credentials.json')),
    fingerprint: fingerprint(fingerprintRoots({ source, projects })),
  }
}

function measureEntries(plan) {
  return plan.entries.map((entry) => {
    const abs = path.join(plan.source, entry.from)
    const stat = isFile(abs) ? { files: 1, bytes: fs.statSync(abs).size } : fingerprint([{ abs, label: entry.label }])
    return { ...entry, files: stat.files, bytes: stat.bytes }
  })
}

/* ------------------------------------------------------------------ */
/* 写入                                                                */
/* ------------------------------------------------------------------ */

function acquireLock() {
  fs.mkdirSync(TEMP_ROOT, { recursive: true })
  const lock = path.join(TEMP_ROOT, LOCK_NAME)
  const write = () => fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: 'wx' })
  try {
    write()
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      let stale = false
      try {
        stale = Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS
      } catch {
        stale = true
      }
      if (!stale) fail(`seed 正被其他进程构建（锁：${lock}）；30 分钟后自动视为 stale`)
      fs.rmSync(lock, { force: true })
      write()
    } else {
      throw err
    }
  }
  return () => fs.rmSync(lock, { force: true })
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

function buildSeed(plan, opts) {
  const seed = plan.seed
  if (!opts.dryRun) {
    if (!opts.allowOutsideTemp) resolveInside(seed, TEMP_ROOT, 'seed 目录')
    if (path.resolve(seed) === path.resolve(plan.source)) fail('seed 目录不能等于源 .devdata')
    if (fs.existsSync(seed)) fs.rmSync(seed, { recursive: true, force: true })
    fs.mkdirSync(seed, { recursive: true })
  }

  const stats = { files: 0, bytes: 0, excluded: [] }
  const filterCache = new Map()
  const getFilter = (entry) => {
    const key = `${Boolean(entry.git)}:${Boolean(entry.localStorage)}`
    if (!filterCache.has(key)) filterCache.set(key, createFilter(entry))
    return filterCache.get(key)
  }

  for (const entry of plan.entries) {
    if (opts.dryRun) {
      const measured = measureEntries(plan).find((x) => x.from === entry.from)
      stats.files += measured ? measured.files : 0
      stats.bytes += measured ? measured.bytes : 0
      continue
    }
    copyTree(path.join(plan.source, entry.from), path.join(seed, entry.to), stats, {
      label: entry.label,
      filter: getFilter(entry),
    })
  }

  if (!opts.dryRun) {
    // 配置脱敏落盘：先确认父目录存在。
    fs.mkdirSync(seed, { recursive: true })

    if (plan.aiConfig.present && !plan.aiConfig.parseError) {
      writeJson(path.join(seed, 'ai-config.json'), plan.aiConfig.value)
    }
    if (plan.aiCredentials.present) {
      writeJson(path.join(seed, 'ai-credentials.json'), { version: 1, entries: {} })
    }
    if (plan.gitConfig.present && !plan.gitConfig.parseError) {
      writeJson(path.join(seed, 'git-config.json'), plan.gitConfig.value)
    }
    if (plan.gitCredentials.present) {
      writeJson(path.join(seed, 'git-credentials.json'), { version: 1, entries: {} })
    }

    if (opts.git) {
      const repoConfig = path.join(seed, 'sandbox', '.git', 'config')
      plan.sandboxGit = sanitizeGitRepoConfig(repoConfig)
    }
  }

  return stats
}

function writeManifest(plan, opts, stats) {
  const manifest = {
    schema: 'wave4-seed/v1',
    createdAt: new Date().toISOString(),
    source: {
      devdata: plan.source,
      fingerprint: plan.fingerprint.hash,
      files: plan.fingerprint.files,
      bytes: plan.fingerprint.bytes,
      projects: plan.projects,
      modified: false,
    },
    seed: {
      path: plan.seed,
      files: stats.files,
      bytes: stats.bytes,
      localStorage: opts.localStorage,
      git: opts.git,
    },
    included: plan.entries.map((e) => e.from),
    excluded: [...plan.excluded, ...stats.excluded],
    localStorageKeys: plan.localStorageKeys,
    sanitized: {
      aiConfig: {
        present: plan.aiConfig.present,
        parseError: Boolean(plan.aiConfig.parseError),
        redactedPaths: plan.aiConfig.redacted || [],
        urlsWithCredentials: plan.aiConfig.urlsWithCredentials || [],
        sourceCredentialFlags: plan.aiConfig.sourceCredentialFlags || {},
      },
      aiCredentials: {
        ...plan.aiCredentials,
        copied: false,
        action: 'entries stripped to {}; hasApiKey kept as metadata only',
      },
      gitConfig: {
        present: plan.gitConfig.present,
        parseError: Boolean(plan.gitConfig.parseError),
        projectKeys: plan.gitConfig.projectKeys || [],
        remoteHosts: plan.gitConfig.remoteHosts || [],
        remoteUrlNeutralized: true,
      },
      gitCredentials: {
        ...plan.gitCredentials,
        copied: false,
        action: 'entries stripped to {}; hasToken kept as metadata only',
      },
      sandboxGit: plan.sandboxGit || { present: false },
    },
    notes: [
      '本 seed 不含任何凭据明文或可解密凭据；AI 真实发送前由协调者在隔离副本中单独注入凭据。',
      'git-config.json 的 remoteUrl 与 sandbox/.git/config 的 remote 段已清空，默认不触网。',
      'Local Storage 原样复制，可能包含旧 edit_queue_v1 / AI 历史键；域 spec 需自行清理。',
      'snapshots 只复制与 sandbox 项目同名的目录。',
    ],
  }
  const manifestPath = path.join(plan.seed, MANIFEST_NAME)
  writeJson(manifestPath, manifest)
  // 首次写入后回算 seed 的真实文件数/字节数（包含脱敏配置与本 manifest 本身）。
  for (let i = 0; i < 3; i += 1) {
    const actual = fingerprint([{ abs: plan.seed, label: 'seed' }])
    if (manifest.seed.files === actual.files && manifest.seed.bytes === actual.bytes) break
    manifest.seed.files = actual.files
    manifest.seed.bytes = actual.bytes
    writeJson(manifestPath, manifest)
  }
  return manifest
}

function copySeedToDomains(plan, opts) {
  const results = opts.domains.map((rawDomain) => {
    const domain = normalizeDomain(rawDomain)
    const target = domainDir(domain)
    const exists = fs.existsSync(target)
    return { domain, target, action: !exists ? 'create' : opts.force ? 'replace' : 'conflict' }
  })

  // 先整体预检，避免部分域已复制、后面因 conflict 失败留下半成品。
  const conflicts = results.filter((r) => r.action === 'conflict')
  if (!opts.dryRun && conflicts.length) {
    fail(`域目录已存在，未覆盖：${conflicts.map((r) => r.target).join(', ')}；确认后加 --force 重新复制`)
  }

  for (const result of results) {
    if (opts.dryRun) continue
    if (result.action === 'replace') fs.rmSync(result.target, { recursive: true, force: true })
    fs.cpSync(plan.seed, result.target, { recursive: true })
    writeJson(path.join(result.target, DOMAIN_MARKER), {
      schema: 'wave4-domain/v1',
      domain: result.domain,
      copiedAt: new Date().toISOString(),
      seed: plan.seed,
      seedManifest: path.join(plan.seed, MANIFEST_NAME),
      note: '本目录可随时删除重建；不要在此目录之外写测试数据。',
    })
  }
  return results
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    printHelp()
    return
  }

  resolveInside(opts.source, ROOT, 'source')
  if (!opts.allowOutsideTemp) resolveInside(opts.seed, TEMP_ROOT, 'seed 目录')
  if (path.resolve(opts.seed) === path.resolve(opts.source)) fail('seed 目录不能等于源 .devdata')

  const plan = buildPlan(opts)
  const measured = measureEntries(plan)
  const seedManifest = path.join(plan.seed, MANIFEST_NAME)
  const seedExists = isFile(seedManifest)
  const willBuildSeed = opts.rebuildSeed || !seedExists
  const activeElectron = detectElectronProcesses()

  for (const domain of opts.domains) normalizeDomain(domain)

  if (!opts.dryRun && willBuildSeed && activeElectron.length && !opts.allowActiveSource) {
    fail(
      `检测到 ${activeElectron.length} 个 Electron 进程（${activeElectron.join(', ')}）。` +
        '复制共享 .devdata 前必须关闭所有 Electron/开发实例；确认无风险可加 --allow-active-source。',
    )
  }
  if (!opts.dryRun && willBuildSeed && activeElectron.length && opts.allowActiveSource) {
    console.warn(`[seed] 警告：检测到 Electron 进程但仍继续（--allow-active-source）：${activeElectron.join(', ')}`)
  }

  if (opts.dryRun) {
    const domainPlan = opts.domains.map((raw) => {
      const domain = normalizeDomain(raw)
      const target = domainDir(domain)
      return {
        domain,
        target,
        action: !fs.existsSync(target) ? 'create' : opts.force ? 'replace' : 'conflict',
      }
    })
    const output = {
      dryRun: true,
      source: plan.source,
      seed: plan.seed,
      seedExists,
      seedAction: willBuildSeed ? (seedExists ? 'rebuild' : 'create') : 'reuse',
      sourceFingerprint: plan.fingerprint.hash,
      activeElectronPids: activeElectron,
      projects: plan.projects,
      entries: measured.map((e) => ({ from: e.from, to: e.to, files: e.files, bytes: e.bytes })),
      excluded: plan.excluded,
      localStorageKeys: plan.localStorageKeys,
      credentials: {
        ai: {
          present: plan.aiCredentials.present,
          entryKeys: plan.aiCredentials.entryKeys,
          hasApiKey: plan.aiCredentials.hasApiKey,
          copied: false,
        },
        git: {
          present: plan.gitCredentials.present,
          entryKeys: plan.gitCredentials.entryKeys,
          hasToken: plan.gitCredentials.hasToken,
          copied: false,
        },
      },
      gitRemoteHosts: plan.gitConfig.remoteHosts || [],
      domains: domainPlan,
      writes: [],
    }
    if (opts.json) console.log(JSON.stringify(output, null, 2))
    else {
      console.log(`[dry-run] source=${plan.source}`)
      console.log(`[dry-run] seed=${plan.seed} action=${output.seedAction}`)
      console.log(`[dry-run] projects=${plan.projects.join(', ')}`)
      console.log(`[dry-run] entries=${output.entries.map((e) => `${e.from}(${e.files}f/${e.bytes}B)`).join(', ')}`)
      console.log(`[dry-run] localStorage keys=${plan.localStorageKeys.join(',') || '-'}`)
      console.log(`[dry-run] ai credentials present=${plan.aiCredentials.present} hasApiKey=${plan.aiCredentials.hasApiKey} copied=false`)
      console.log(`[dry-run] git credentials present=${plan.gitCredentials.present} hasToken=${plan.gitCredentials.hasToken} copied=false`)
      for (const d of output.domains) console.log(`[dry-run] domain ${d.domain}: ${d.action} -> ${d.target} (no writes)`)
    }
    return
  }

  let stats = { files: 0, bytes: 0, excluded: [] }
  if (willBuildSeed) {
    const release = acquireLock()
    try {
      stats = buildSeed(plan, opts)
      const after = fingerprint(fingerprintRoots(plan))
      if (after.hash !== plan.fingerprint.hash) {
        fail(`源 .devdata 在复制期间发生变化（before=${plan.fingerprint.hash.slice(0, 12)} after=${after.hash.slice(0, 12)}）`)
      }
      const manifest = writeManifest(plan, opts, stats)
      stats = { files: manifest.seed.files, bytes: manifest.seed.bytes, excluded: stats.excluded }
      console.log(`[seed] built ${plan.seed} files=${stats.files} bytes=${stats.bytes} sourceUnchanged=true`)
    } finally {
      release()
    }
  } else {
    const manifest = JSON.parse(fs.readFileSync(seedManifest, 'utf8'))
    const sourceFingerprint = plan.fingerprint.hash
    if (manifest && manifest.source && manifest.source.fingerprint && manifest.source.fingerprint !== sourceFingerprint) {
      console.warn(
        `[seed] 警告：seed 指纹与当前 .devdata 不一致（seed=${String(manifest.source.fingerprint).slice(0, 12)} now=${sourceFingerprint.slice(0, 12)}）；需要刷新请加 --rebuild-seed`,
      )
    }
    stats = {
      files: Number(manifest && manifest.seed && manifest.seed.files) || 0,
      bytes: Number(manifest && manifest.seed && manifest.seed.bytes) || 0,
      excluded: [],
    }
    console.log(`[seed] reuse ${plan.seed}（--rebuild-seed 可重建）`)
  }

  const domains = copySeedToDomains(plan, opts)
  const conflicts = domains.filter((d) => d.action === 'conflict')
  if (conflicts.length) {
    fail(
      `域目录已存在，未覆盖：${conflicts.map((d) => d.target).join(', ')}；确认后加 --force 重新复制`,
    )
  }

  const output = {
    ok: true,
    source: plan.source,
    seed: plan.seed,
    seedAction: willBuildSeed ? 'built' : 'reused',
    sourceFingerprint: plan.fingerprint.hash,
    seedFiles: stats.files,
    seedBytes: stats.bytes,
    projects: plan.projects,
    localStorageKeys: plan.localStorageKeys,
    domains,
  }
  if (opts.json) console.log(JSON.stringify(output, null, 2))
  else {
    console.log(`[seed] source=${plan.source}`)
    console.log(`[seed] projects=${plan.projects.join(', ')}`)
    console.log(`[seed] localStorage keys=${plan.localStorageKeys.join(',') || '-'}`)
    for (const d of domains) console.log(`[domain] ${d.domain}: ${d.action} -> ${d.target}`)
  }
}

try {
  main()
} catch (err) {
  console.error(`[wave4-seed] ${err && err.message ? err.message : String(err)}`)
  process.exitCode = 1
}
