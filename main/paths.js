'use strict';
/**
 * main/paths.js — 主进程路径常量（Wave-B 解耦）
 * 注意：须在 main.js 完成 app.setPath/setName 之后再 require 本模块，
 * 否则 userData 路径为正式环境而非 .devdata（开发隔离）。
 */
const path = require('path');
const fs = require('fs');

function _userData() {
  try {
    const el = require('electron');
    if (el && el.app && typeof el.app.getPath === 'function') return el.app.getPath('userData');
  } catch (e) {}
  return process.cwd();
}

const _base = _userData();
const SANDBOX_ROOT = path.join(_base, 'sandbox');
let realSandboxRoot = SANDBOX_ROOT;
try { realSandboxRoot = fs.realpathSync(SANDBOX_ROOT); }
catch (e) { try { realSandboxRoot = path.resolve(SANDBOX_ROOT); } catch (ee) {} }

const SPECS_ROOT = path.join(_base, 'specs');
const UILIBS_ROOT = path.join(_base, 'uilibs');
const SPECS_INDEX_FILE = path.join(SPECS_ROOT, 'index.json');
const UILIBS_INDEX_FILE = path.join(UILIBS_ROOT, 'index.json');
const SPEC_MAX_BYTES = 200 * 1024;
const REQ_FALLBACK_FILE = path.join(_base, '最新需求.md');
const NORMALIZE_FLAG = 'projects-normalized-v1';
const DEFAULT_PROJECT = '默认项目';
const SNAP_KEEP = 10;

let pkgDir = '';
try { pkgDir = path.dirname(require('electron').app.getPath('exe')); } catch (e) { pkgDir = process.cwd(); }

module.exports = {
  SANDBOX_ROOT,
  realSandboxRoot,
  SPECS_ROOT,
  UILIBS_ROOT,
  SPECS_INDEX_FILE,
  UILIBS_INDEX_FILE,
  SPEC_MAX_BYTES,
  REQ_FALLBACK_FILE,
  NORMALIZE_FLAG,
  DEFAULT_PROJECT,
  SNAP_KEEP,
  pkgDir,
};
