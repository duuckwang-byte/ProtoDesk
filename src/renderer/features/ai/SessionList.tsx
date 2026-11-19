/**
 * SessionList：已停用（保留文件，避免历史引用断裂）。
 *
 * 需求简化后，AI 对话框只保留单一对话区，不再渲染会话列表、新建会话或会话切换入口。
 * 会话仍由 ai-store 持久化，打开对话框时恢复最近一次 active session。
 * 这里保留空实现：即使被误引用，也不会再产生会话栏 UI。
 */
export function SessionList(): null {
  return null;
}

export default SessionList;
