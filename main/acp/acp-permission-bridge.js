'use strict';
/**
 * main/acp/acp-permission-bridge.js — ACP 权限请求等待桥（Phase 0）
 * 只维护 id → Promise 的等待表；事件广播、窗口路由与 UI 卡片由调用方负责，
 * 本模块不依赖 Electron，可在纯 Node 单测中直接实例化。
 */
const { randomUUID } = require('node:crypto');

const DEFAULT_PERMISSION_TIMEOUT_MS = 120000;

const DECISION_ALIASES = {
  allow: 'allow_once',
  'allow-once': 'allow_once',
  allow_once: 'allow_once',
  'allow-always': 'allow_always',
  allow_always: 'allow_always',
  deny: 'reject_once',
  reject: 'reject_once',
  'reject-once': 'reject_once',
  reject_once: 'reject_once',
  'reject-always': 'reject_always',
  reject_always: 'reject_always',
  cancel: 'cancel'
};

/**
 * 归一化 UI 决策：对象原样透传（支持 {outcome:'selected', optionId}），
 * 字符串别名转为 acpx 的 outcome 结构。
 * @param {*} decision UI 回传决策
 * @returns {Object} acpx 决策对象
 */
function normalizeDecision(decision) {
  if (decision && typeof decision === 'object') return decision;
  const key = String(decision == null ? 'cancel' : decision).trim().toLowerCase();
  return { outcome: DECISION_ALIASES[key] || key || 'cancel' };
}

class AcpPermissionBridge {
  /**
   * @param {{defaultTimeoutMs?:number}} [options] 可覆盖默认 120 秒超时
   */
  constructor(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const ms = Number(opts.defaultTimeoutMs);
    this.defaultTimeoutMs = Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_PERMISSION_TIMEOUT_MS;
    /** @type {Map<string, Object>} 待决权限请求 */
    this.pending = new Map();
    this.statsState = {
      total: 0,
      resolved: 0,
      timedOut: 0,
      cancelled: 0,
      allowed: 0,
      denied: 0
    };
  }

  /**
   * 登记一次权限请求，返回等待 UI 决策的 Promise。
   * payload 若无 id 会自动生成并回写到 payload.id（冻结对象则只挂在 Promise.id 上）。
   * @param {Object} payload 权限请求负载（至少含 agentId / sessionId / uiSessionId / title 等）
   * @param {number} [timeoutMs] 超时毫秒，缺省 120000；超时返回 {outcome:'cancel'}
   * @returns {Promise<Object>} 决策对象，附 .id 便于调用方广播
   */
  request(payload, timeoutMs) {
    const data = payload && typeof payload === 'object' ? payload : {};
    let id = data.id != null ? String(data.id).trim() : '';
    if (!id || this.pending.has(id)) {
      id = randomUUID();
      try { data.id = id; } catch (_) {}
    }

    const n = Number(timeoutMs);
    const ms = Number.isFinite(n) && n >= 0 ? n : this.defaultTimeoutMs;
    const agentId = data.agentId != null ? String(data.agentId) : '';
    const sessionId = data.sessionId != null ? String(data.sessionId) : '';
    const uiSessionId = data.uiSessionId != null ? String(data.uiSessionId) : '';

    const promise = new Promise((resolve) => {
      let timer = null;
      timer = setTimeout(() => {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        this.statsState.timedOut += 1;
        resolve({ outcome: 'cancel' });
      }, ms);
      this.pending.set(id, {
        id,
        agentId,
        payload: data,
        sessionId,
        uiSessionId,
        timer,
        resolve
      });
    });

    this.statsState.total += 1;
    promise.id = id;
    return promise;
  }

  /**
   * UI 回传决策，唤醒对应等待者。
   * @param {string} id 权限请求 id
   * @param {Object|string} decision 决策对象或字符串别名
   * @returns {boolean} 是否命中待决请求
   */
  resolve(id, decision) {
    const key = id != null ? String(id) : '';
    const entry = this.pending.get(key);
    if (!entry) return false;
    this.pending.delete(key);
    clearTimeout(entry.timer);

    const d = normalizeDecision(decision);
    const outcome = String((d && d.outcome) || '').toLowerCase();
    this.statsState.resolved += 1;
    if (outcome.startsWith('allow') || outcome === 'selected' || outcome === 'accept') {
      this.statsState.allowed += 1;
    } else if (outcome.startsWith('reject') || outcome === 'deny' || outcome === 'decline') {
      this.statsState.denied += 1;
    } else if (outcome === 'cancel') {
      this.statsState.cancelled += 1;
    }
    entry.resolve(d);
    return true;
  }

  /**
   * 取消单个待决请求，等待者收到 {outcome:'cancel'}。
   * @param {string} id 权限请求 id
   * @returns {boolean} 是否命中待决请求
   */
  cancel(id) {
    const key = id != null ? String(id) : '';
    const entry = this.pending.get(key);
    if (!entry) return false;
    this.pending.delete(key);
    clearTimeout(entry.timer);
    this.statsState.cancelled += 1;
    entry.resolve({ outcome: 'cancel' });
    return true;
  }

  /**
   * 取消某个会话下待决请求（匹配 payload.sessionId 或 uiSessionId）。
   * 传 agentId 时叠加 Agent 复合键，只取消同 Agent 的请求；
   * 不传（或空串）保持旧行为，避免破坏既有调用。
   * @param {string} sessionId ACP 会话 id 或 UI 会话 id
   * @param {string} [agentId] Agent id，传入时按 agentId + sessionId 复合匹配
   * @returns {number} 取消数量
   */
  cancelSession(sessionId, agentId) {
    const sid = sessionId != null ? String(sessionId) : '';
    if (!sid) return 0;
    const aid = agentId != null ? String(agentId) : '';
    const ids = [];
    for (const [id, entry] of this.pending) {
      if (aid && entry.agentId !== aid) continue;
      if (entry.sessionId === sid || entry.uiSessionId === sid) ids.push(id);
    }
    let count = 0;
    for (const id of ids) {
      if (this.cancel(id)) count += 1;
    }
    return count;
  }

  /**
   * 取消某个 Agent 的待决请求；传 sessionId 时再按会话收窄。
   * 仅供多 Agent 切换 / 单 Agent 兜底收尾使用。
   * @param {string} agentId Agent id
   * @param {string} [sessionId] ACP 会话 id 或 UI 会话 id
   * @returns {number} 取消数量
   */
  cancelAgent(agentId, sessionId) {
    const aid = agentId != null ? String(agentId) : '';
    if (!aid) return 0;
    const sid = sessionId != null ? String(sessionId) : '';
    const ids = [];
    for (const [id, entry] of this.pending) {
      if (entry.agentId !== aid) continue;
      if (sid && entry.sessionId !== sid && entry.uiSessionId !== sid) continue;
      ids.push(id);
    }
    let count = 0;
    for (const id of ids) {
      if (this.cancel(id)) count += 1;
    }
    return count;
  }

  /**
   * 全局统计快照（供 done 事件 / 诊断展示）。
   * @returns {{total:number, pending:number, resolved:number,
   *   timedOut:number, cancelled:number, allowed:number, denied:number}}
   */
  stats() {
    return {
      total: this.statsState.total,
      pending: this.pending.size,
      resolved: this.statsState.resolved,
      timedOut: this.statsState.timedOut,
      cancelled: this.statsState.cancelled,
      allowed: this.statsState.allowed,
      denied: this.statsState.denied
    };
  }
}

module.exports = {
  AcpPermissionBridge,
  DEFAULT_PERMISSION_TIMEOUT_MS,
  normalizeDecision
};
