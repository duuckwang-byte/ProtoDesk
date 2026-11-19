/**
 * src/renderer/lib/ipc.ts — window.protoAPI 薄包装（统一 try/catch + 结果归一化，无业务逻辑）。
 *
 * 旧契约：preload.js 经 contextBridge 暴露 window.protoAPI，各方法内部调用
 * ipcRenderer.invoke(70 冻结通道之一)，resolve 值为 {ok, error?, cancelled?}（见 main/ipc-contract.js）。
 * 本模块不新增通道、不改出入参、不做业务分支；仅做三件事：
 * 1) 网关缺失（纯浏览器预览）时收敛为 {ok:false} 而不是抛错；
 * 2) 预加载 promise 的 resolve 值归一化为 IpcOk（透传原对象，不剥离业务载荷）；
 * 3) 同步抛错/异步 reject 统一收敛为 {ok:false, error}（沿用旧代码错误文案口径）。
 */

import type { IpcOk } from '../types/ipc';

/** 预加载网关上的可调用形态（透传参数，不约束具体签名）。 */
export type ProtoApiFn = (...args: unknown[]) => unknown;

/**
 * 读取渲染层预加载网关。
 * @returns {Record<string, unknown> | null} window.protoAPI；不存在时返回 null
 */
export function getProtoApi(): Record<string, unknown> | null {
  try {
    const w = window as unknown as { protoAPI?: Record<string, unknown> };
    return w && typeof w.protoAPI === 'object' && w.protoAPI !== null ? w.protoAPI : null;
  } catch {
    return null;
  }
}

/**
 * 是否处于 Electron 预加载网关之下。
 * @returns {boolean} 存在 window.protoAPI 时为 true
 */
export function hasProtoApi(): boolean {
  return getProtoApi() !== null;
}

/**
 * 把一次预加载调用的 resolve 值归一化为 IpcOk（透传原对象，不剥离业务载荷）。
 * undefined 视为 fire-and-forget 发送成功（如 ai:scope-confirm 走 ipcRenderer.send，本就没有返回值）。
 * @param {unknown} value 预加载 promise 的 resolve 值
 * @returns {IpcOk} 归一化结果；非对象值视为契约破坏，收敛为 ok:false
 */
export function normalizeIpcResult(value: unknown): IpcOk {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value === 'object') {
    const raw = value as Partial<IpcOk>;
    if (typeof raw.ok === 'boolean') return value as IpcOk;
  }
  return { ok: false, error: 'bad-ipc-result' };
}

/**
 * 从未知抛值提取错误文案（沿用旧代码 `(e && e.message) || e` 口径）。
 * @param {unknown} err 捕获到的抛值
 * @returns {string} 错误文案
 */
export function ipcErrorText(err: unknown): string {
  try {
    if (err instanceof Error && err.message) return err.message;
    if (typeof err === 'string' && err) return err;
    if (err && typeof (err as { message?: unknown }).message === 'string') {
      return (err as { message: string }).message;
    }
    return String(err);
  } catch {
    return 'unknown-error';
  }
}

/**
 * 安全调用一个预加载函数：统一 try/catch，同步抛错与异步 reject 都收敛为 {ok:false, error}。
 * @param {ProtoApiFn} fn window.protoAPI 下的某个方法
 * @param {unknown[]} args 透传给预加载方法的参数
 * @returns {Promise<IpcOk>} 归一化后的调用结果
 */
export async function safeInvoke(fn: ProtoApiFn, ...args: unknown[]): Promise<IpcOk> {
  try {
    const settled = await fn(...args);
    return normalizeIpcResult(settled);
  } catch (err) {
    return { ok: false, error: ipcErrorText(err) };
  }
}

/**
 * 按命名空间 + 方法名调用 window.protoAPI（保持接收者为该命名空间对象）。
 * @param {string} namespace window.protoAPI 下的一级命名空间（如 sandbox）
 * @param {string} method 命名空间下的方法名（如 list）
 * @param {unknown[]} args 透传给预加载方法的参数
 * @returns {Promise<IpcOk>} 归一化结果；网关或方法缺失时返回 ok:false，不抛错
 */
export async function invokeProtoMethod(
  namespace: string,
  method: string,
  ...args: unknown[]
): Promise<IpcOk> {
  const api = getProtoApi();
  const space: unknown = api ? api[namespace] : undefined;
  const fn: unknown =
    space && typeof space === 'object'
      ? (space as Record<string, unknown>)[method]
      : undefined;
  if (typeof fn !== 'function') {
    return { ok: false, error: 'missing protoAPI: ' + String(namespace) + '.' + String(method) };
  }
  try {
    const settled = await (fn as ProtoApiFn).apply(space, args);
    return normalizeIpcResult(settled);
  } catch (err) {
    return { ok: false, error: ipcErrorText(err) };
  }
}
