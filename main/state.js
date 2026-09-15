'use strict';
/**
 * main/state.js — 主进程共享单例（Wave-B 解耦）
 * 纯对象共享：各模块 require 后经 shared.xxx 直接读写同一引用（Node 缓存保证单例）。
 * 收敛原 main.js 7处手写 pad/p2 为唯一 pad2。
 */

function pad2(n) { return String(n).padStart(2, '0'); }

const cliModelsCache = new Map();
const CLI_MODELS_CACHE_TTL = 10 * 60 * 1000;

const gitState = { busy: null };

module.exports = {
  // 窗口句柄
  mainWin: null,
  docWin: null,
  aiWin: null,
  // AI 执行与事件归属
  activeExecution: null,
  aiEventTarget: null,
  aiTransferToMain: false,
  aiWinForceClose: false,
  // Git 并发与子进程句柄（对象引用共享，禁止整体重赋）
  gitState,
  gitCurrentChild: null,
  // CLI 模型缓存（Map 引用共享）
  cliModelsCache,
  CLI_MODELS_CACHE_TTL,
  // 唯一补零
  pad2,
};
