/**
 * 通用 JSONL 结构化事件流解析器（OpenCode / Cursor-Agent / Codex）
 * 接口：push(chunk, handlers) / flush(handlers) / hasEmittedContent()
 * @param {string} [eventParser] 子类别：'opencode' | 'cursor-agent' | 'codex'（行为一致，保留参数区分）
 */
function createJsonEventStreamParser(eventParser) {
  let buffer = '';
  let emitted = false;
  let pendingError = null;
  const subType = eventParser || 'opencode';

  function getText(obj) {
    if (!obj || typeof obj !== 'object') return '';
    if (typeof obj.text === 'string' && obj.text) return obj.text;
    if (typeof obj.content === 'string' && obj.content) return obj.content;
    if (typeof obj.delta === 'string' && obj.delta) return obj.delta;
    if (typeof obj.data === 'string' && obj.data) return obj.data;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (obj.part && typeof obj.part === 'object') {
      if (typeof obj.part.text === 'string' && obj.part.text) return obj.part.text;
      if (typeof obj.part.content === 'string' && obj.part.content) return obj.part.content;
    }
    if (obj.message && typeof obj.message === 'object') {
      if (typeof obj.message.content === 'string' && obj.message.content) return obj.message.content;
      if (typeof obj.message.text === 'string' && obj.message.text) return obj.message.text;
    }
    if (obj.delta && typeof obj.delta === 'object') {
      if (typeof obj.delta.text === 'string' && obj.delta.text) return obj.delta.text;
      if (typeof obj.delta.content === 'string' && obj.delta.content) return obj.delta.content;
    }
    return '';
  }

  function getSessionId(obj) {
    if (!obj || typeof obj !== 'object') return null;
    return obj.sessionID || obj.session_id || obj.sessionId || obj.session || null;
  }

  // question-form 子任务C：未知提问体留痕 + 工具提问通道降级提示（只读识别，不自动转表单，不新增通道）。
  // 判定口径（防问卷业务数据误伤）：
  //   未知体：顶层 type 明确为 question（大小写不敏感，rawType 已小写），
  //     或无明确类型（type 缺失/空）且顶层含非空 questions 数组；
  //     有明确非 question 类型（text/chunk/message 等）而附带 questions 字段的一律放过；
  //     tool_use/tool_call 包裹形走降级分支，不进未知体分支。
  //   工具包裹形：tool 形事件且 tool 名匹配提问类（askuserquestion/question，大小写不敏感），
  //     且其 input/args 含非空 questions 数组；非提问类工具即使 input 含 questions 也一律放过。
  // 通道：未知体经 onQuestion（结构化，原样附 raw）+ onTrace（{tag:'QUESTION'} 摘要截断 500 字），
  //   二者缺失即 no-op；工具包裹形仍走正常 onToolCall（时间线不丢行），另附一条 onChunk 人话降级提示。
  // 判定语义：question 到达不置 emitted（不改变成功/失败判定），不记 pendingError，不抛错不断链。
  // @param {Object} obj 单行解析出的事件对象
  // @param {number} [maxLen] 摘要截断长度，缺省 500
  // @returns {string} 摘要文本
  function summarizeJsonForTrace(obj, maxLen) {
    try {
      const lim = (typeof maxLen === 'number' && isFinite(maxLen) && maxLen > 0) ? Math.floor(maxLen) : 500;
      let s = '';
      try { s = JSON.stringify(obj == null ? null : obj); } catch (_) { s = ''; }
      if (!s) {
        try { s = String(obj); } catch (_) { s = ''; }
      }
      if (s.length > lim) return s.slice(0, lim) + '…（截断）';
      return s;
    } catch (_) {
      return '';
    }
  }

  // 非空 questions 数组才认（空数组视为无提问内容）。
  // @param {*} v 待判定值
  // @returns {Array|null} 非空数组或 null
  function asNonEmptyQuestionsArray(v) {
    try {
      if (Array.isArray(v) && v.length > 0) return v;
    } catch (_) {}
    return null;
  }

  // 未知体分支只认顶层 questions（input/args 内嵌的不算，由工具分支判定）。
  // @param {Object} obj 事件对象
  // @returns {Array|null} 非空数组或 null
  function topLevelQuestions(obj) {
    if (!obj || typeof obj !== 'object') return null;
    return asNonEmptyQuestionsArray(obj.questions);
  }

  // tool 名归一化：去非字母后比对；'question(s)' 相等或含 'askuserquestion' 即提问类工具
  // （覆盖 AskUserQuestion / ask_user_question / question，大小写不敏感；questionnaire 类不命中）。
  // @param {*} name tool 名
  // @returns {boolean} 是否提问类工具
  function isQuestionToolName(name) {
    try {
      const norm = String(name == null ? '' : name).toLowerCase().replace(/[^a-z]/g, '');
      if (!norm) return false;
      if (norm === 'question' || norm === 'questions') return true;
      if (norm.indexOf('askuserquestion') >= 0) return true;
      return false;
    } catch (_) {
      return false;
    }
  }

  // 工具包裹形 input/args 中取 questions（直挂 input.questions，兼容嵌套一层 args/input）。
  // @param {*} input 工具输入
  // @returns {Array|null} 非空数组或 null
  function questionsInToolInput(input) {
    if (!input || typeof input !== 'object') return null;
    const direct = asNonEmptyQuestionsArray(input.questions);
    if (direct) return direct;
    try {
      const n1 = input.args && asNonEmptyQuestionsArray(input.args.questions);
      if (n1) return n1;
    } catch (_) {}
    try {
      const n2 = input.input && asNonEmptyQuestionsArray(input.input.questions);
      if (n2) return n2;
    } catch (_) {}
    return null;
  }

  // 工具提问通道降级提示文案（经现有 onChunk 通道发出，人话一句，不自动转表单）。
  var QUESTION_TOOL_FALLBACK_HINT_PREFIX = '【提问通道提示】模型刚才走了工具提问通道（AskUserQuestion / question 类），'
    + '本轮不会自动转成表单';
  var QUESTION_TOOL_FALLBACK_HINT_SUFFIX = '；请用一句话重述你的需求，或等模型输出文本表单（<question-form>）后再作答。';
  // @param {number} n 题目数
  // @returns {string} 完整提示文案
  function buildQuestionToolFallbackHint(n) {
    try {
      const c = (typeof n === 'number' && isFinite(n) && n > 0) ? Math.floor(n) : 0;
      return QUESTION_TOOL_FALLBACK_HINT_PREFIX + '（共' + c + '题）' + QUESTION_TOOL_FALLBACK_HINT_SUFFIX;
    } catch (_) {
      return QUESTION_TOOL_FALLBACK_HINT_PREFIX + QUESTION_TOOL_FALLBACK_HINT_SUFFIX;
    }
  }

  function dispatch(obj, handlers) {
    if (!obj || typeof obj !== 'object') return;
    const rawType = String(obj.type || obj.event || obj.kind || '').toLowerCase();
    const sessionId = getSessionId(obj);
    // session 优先识别（部分事件同时带 session 与内容时两者都派发）
    if (sessionId && (rawType.includes('session') || sessionId)) {
      // 仅当类型含 session 或顶层确有 session 字段且无其他内容时也派发；
      // 为兼容各 CLI，这里只要出现 session 字段即派发一次
      try { handlers.onSession && handlers.onSession({ id: String(sessionId) }); } catch (_) {}
    }

    // error 缓存，待 close 处理，不立即派发
    if (rawType.includes('error') || obj.error) {
      pendingError = obj.error || obj;
      return;
    }

    // tool_use / tool_call / function_call（opencode 实测：{type:"tool_use", part:{type:"tool", tool, state:{input}}}）
    const _part = (obj.part && typeof obj.part === 'object') ? obj.part : null;
    const _isPartTool = _part && String(_part.type || '').toLowerCase() === 'tool';
    // reasoning / thinking（含嵌套 part/message/delta.type：opencode 把思考放在 part.type === 'reasoning' 里，顶层 type 仍是 message/text，不看嵌套就会漏进回答）
    const _nestedType = String(
      ((_part && _part.type) || '') + ' '
      + ((obj.message && typeof obj.message === 'object' && obj.message.type) || '') + ' '
      + ((obj.delta && typeof obj.delta === 'object' && obj.delta.type) || '')
    ).toLowerCase();
    if (rawType.includes('reason') || rawType.includes('think') || _nestedType.includes('reason') || _nestedType.includes('think')) {
      const text = getText(obj);
      if (text) {
        emitted = true;
        try { handlers.onThinking && handlers.onThinking({ text }); } catch (_) {}
      } else if (subType) {
        // 空 thinking 事件忽略
      }
      return;
    }
    if (rawType.includes('tool') || rawType.includes('function_call') || obj.tool_use || obj.tool_call || _isPartTool) {
      emitted = true;
      // question-form 降级前置判定（只读：提问类工具名 + input/args.questions 非空；问卷数据等非提问类工具一律放过）
      let _questionCount = 0;
      try {
        const _stPre = (_part && _part.state && typeof _part.state === 'object') ? _part.state : null;
        const _inpPre = (_stPre && _stPre.input != null) ? _stPre.input : (obj.input != null ? obj.input : obj.args);
        const _nmPre = obj.tool || obj.name || obj.toolName || obj.call || (_part && _part.tool) || '';
        const _qsPre = isQuestionToolName(_nmPre) ? questionsInToolInput(_inpPre) : null;
        if (_qsPre) _questionCount = _qsPre.length;
      } catch (_) { _questionCount = 0; }
      try {
        const norm = { ...obj };
        try {
          const st = (_part && _part.state && typeof _part.state === 'object') ? _part.state : null;
          const inp = st && st.input != null ? st.input : (obj.input != null ? obj.input : obj.args);
          if (norm.tool == null && norm.name == null && _part && _part.tool) norm.tool = String(_part.tool);
          if ((norm.path == null && norm.file == null) && inp && typeof inp === 'object' && (inp.path || inp.file || inp.filename || inp.filePath || inp.pattern)) {
            norm.path = String(inp.path || inp.file || inp.filename || inp.filePath || inp.pattern);
          }
          if (norm.command == null && norm.cmd == null && inp && typeof inp === 'object' && (inp.command || inp.cmd)) {
            norm.command = String(inp.command || inp.cmd);
          }
          if (norm.args == null && norm.input == null && inp != null) norm.args = inp;
        } catch (_) {}
        handlers.onToolCall && handlers.onToolCall(norm);
      } catch (_) {}
      // 工具包裹形降级提示：工具行已正常派发（时间线不丢行），另附一条 onChunk 人话提示，不自动转表单
      if (_questionCount > 0) {
        try { handlers.onChunk && handlers.onChunk({ text: buildQuestionToolFallbackHint(_questionCount) }); } catch (_) {}
      }
      return;
    }

    // question-form 未知提问体留痕：type 明确为 question，或无明确类型且顶层含非空 questions 数组。
    // 有明确非 question 类型而附带 questions 字段的（如问卷原型业务数据）一律放过；tool 包裹形已在上文处理。
    // 留痕即止：不进 text 兜底复读，不置 emitted（不改变成功/失败判定），不记 pendingError，不抛错不断链。
    {
      let _unknownQs = null;
      try { _unknownQs = topLevelQuestions(obj); } catch (_) { _unknownQs = null; }
      const _isQuestionType = (rawType === 'question' || rawType === 'questions');
      let _isUnknownQuestion = false;
      try {
        if (_isQuestionType) _isUnknownQuestion = true;
        else if (rawType === '' && _unknownQs) _isUnknownQuestion = true;
      } catch (_) { _isUnknownQuestion = false; }
      if (_isUnknownQuestion) {
        try { handlers.onQuestion && handlers.onQuestion({ questions: _unknownQs || [], raw: obj }); } catch (_) {}
        try {
          if (handlers.onTrace) {
            handlers.onTrace({ tag: 'QUESTION', level: 'info', text: summarizeJsonForTrace(obj, 500) });
          }
        } catch (_) {}
        return;
      }
    }

    // text / chunk / delta / message / content / output
    if (
      rawType.includes('text') ||
      rawType.includes('chunk') ||
      rawType.includes('delta') ||
      rawType.includes('message') ||
      rawType.includes('content') ||
      rawType.includes('output') ||
      rawType.includes('item') ||
      rawType === ''
    ) {
      // 空类型时尝试按内容字段兜底
      const text = getText(obj);
      if (text) {
        emitted = true;
        try { handlers.onChunk && handlers.onChunk({ text }); } catch (_) {}
        return;
      }
      // 纯 session 事件（无文本）已在上文派发，此处直接返回
      if (sessionId && !text) return;
      // 未知结构但非空对象：忽略，避免噪声
      return;
    }

    // 其他未知 type：若带可提取文本则透传
    const fallbackText = getText(obj);
    if (fallbackText) {
      emitted = true;
      try { handlers.onChunk && handlers.onChunk({ text: fallbackText }); } catch (_) {}
    }
  }

  function handleLine(line, handlers) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let obj = null;
    try {
      obj = JSON.parse(trimmed);
    } catch (_) {
      // 容错：非 JSON 行按 plain 透传给 onChunk
      emitted = true;
      try { handlers.onChunk && handlers.onChunk({ text: line + '\n' }); } catch (_) {}
      return;
    }
    dispatch(obj, handlers);
  }

  function push(chunk, handlers) {
    const h = handlers || {};
    buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) {
      handleLine(line, h);
    }
  }

  function flush(handlers) {
    const h = handlers || {};
    if (buffer && buffer.trim()) {
      handleLine(buffer, h);
    }
    buffer = '';
    // pendingError 缓存待 close 处理：此处不主动派发 onError，
    // 由 engine 在 hasEmittedContent() 为 false 时统一诊断，避免重复报错。
  }

  function hasEmittedContent() {
    return emitted;
  }

  function getPendingError() {
    return pendingError;
  }

  return { push, flush, hasEmittedContent, getPendingError, eventParser: subType };
}

module.exports = {
  createJsonEventStreamParser,
  createParser: createJsonEventStreamParser
};
