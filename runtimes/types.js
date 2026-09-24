/**
 * @typedef {Object} RuntimeModelOption
 * @property {string} id - 模型标识符
 * @property {string} label - 展示标签
 * @property {boolean} [default] - 是否默认
 */

/**
 * @typedef {Object} RuntimeAgentDef
 * @property {string} id - 唯一标识，如 'claude', 'opencode'
 * @property {string} name - 界面展示名称
 * @property {string} bin - 默认探测的可执行文件名
 * @property {string[]} [fallbackBins] - 备选可执行文件名列表
 * @property {string[]} versionArgs - 版本探测参数，如 ['--version']
 * @property {RuntimeModelOption[]} fallbackModels - 静态备选模型列表
 * @property {(prompt: string, images?: string[], extraDirs?: string[], opts?: any, ctx?: any) => string[]} buildArgs - 命令行参数构造纯函数
 * @property {string} streamFormat - 输出格式: 'claude-stream-json' | 'json-event-stream' | 'plain'
 * @property {string} [eventParser] - 事件解析子类别: 'opencode' | 'cursor-agent' | 'codex'
 * @property {boolean} promptViaStdin - 是否通过标准输入写入 Prompt (强制为 true)
 * @property {number} [maxPromptArgBytes] - 命令行 argv 模式下的最大安全预算
 * @property {{ args: string[], timeoutMs?: number, parse: (stdout: string) => RuntimeModelOption[] }} [listModels] - 动态模型拉取声明
 * @property {string} [needsProtocol] - 特殊协议标记（如 acp-json-rpc），存在时引擎仅探测展示不执行
 */

module.exports = {};
