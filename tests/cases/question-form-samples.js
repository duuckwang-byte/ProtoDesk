'use strict';
// question-form 录制样本（子任务A 产出，供 B 前端渲染 / C 后端解析复用）
// 来源：(a) 真实截图场景的扁平 question 事件体；(b)(c)(d) 按全局共享契约推演的构造样本。
// 用途：只定义数据、不写断言；B/C 各自的 verify 文件可 require 本文件做输入。
// 协作契约回顾：
//   标记 `<question-form id="..." title="...">JSON</question-form>`，别名 `<ask-question>` 同等效力；
//   检测只认闭合完整的块，裸开标签不算；答案首行 `[form answers — <表单id>]`。
// 约束：CommonJS（module.exports），经典脚本写法，不用 ESM import，不用 alert/confirm/prompt。

// (a) 扁平 question 事件体：header/question/options[label+description] 形。
// 来源：真实截图场景（多套配色二选一，需用户拍板）。
var FLAT_QUESTION_EVENT = JSON.stringify({
  header: '需要你拍板',
  question: '检测到原型目录有多套配色，要按哪套继续？',
  options: [
    { label: '沿用现有配色', description: '不动当前 CSS 变量，最快继续' },
    { label: '切换为 Ant Design 规范', description: '按桌面端 design-specs 重排，需改多文件' }
  ]
}, null, 2);

// (b) tool_use 包裹形：name 形如 AskUserQuestion，input.questions 携带多题。
// 来源：按上游模型 tool_use 事件形状推演；解析侧应归一为 question-form 块。
var TOOL_USE_WRAPPED = JSON.stringify({
  type: 'tool_use',
  name: 'AskUserQuestion',
  input: {
    questions: [
      {
        id: 'q-color',
        question: '配色按哪套继续？',
        header: '需要你拍板',
        options: [
          { label: '沿用现有配色', description: '不动当前 CSS 变量' },
          { label: '切换为 Ant Design 规范', description: '按 design-specs 重排' }
        ]
      },
      {
        id: 'q-scope',
        question: '若缺文件，是否允许新建子页？',
        header: '需要你拍板',
        options: [
          { label: '允许', description: '缺页时新建同目录子页' },
          { label: '不允许', description: '只改现有文件，缺页就停住说明' }
        ]
      }
    ]
  }
}, null, 2);

// (c-1) 误伤形之一：问卷数据的 questions 字段（业务数据，不是提问块，不得渲染）。
// 来源：按“问卷数据误伤”场景构造；含 questions 字段但无 question-form 闭合块。
var FALSE_POSITIVE_SURVEY_DATA = JSON.stringify({
  survey: '新人问卷统计',
  questions: [
    { id: 'q1', label: '你最常用的组件库？', type: 'radio', options: ['Ant Design', 'Element'], answers: 128 },
    { id: 'q2', label: '备注', type: 'text', answers: 96 }
  ],
  note: '以上只是问卷结果数据，没有 question-form 标记，不得渲染为表单'
}, null, 2);

// (c-2) 误伤形之二：文档里印的示例标记文本（缺闭合的裸开标签 + 转义写法，不得渲染）。
// 来源：按“文档印刷示例”场景构造；故意缺闭合标签，检测规则只认闭合完整的块。
var FALSE_POSITIVE_DOC_EXAMPLE = [
  '如需提问请输出如下标记（示例，仅说明格式，不要执行）：',
  '  <question-form id="demo" title="示例（不要执行）">',
  '    {"questions": [{"id": "q1", "label": "示例题", "type": "radio"}]}',
  '上面缺闭合标签 `</question-form>`，属裸开标签文本；另转义写法 &lt;question-form&gt; 同理，',
  '整轮拼完再扫时均不得渲染为表单。'
].join('\n');

// (d) 分片形：闭合块被拦腰截成两段，单独一段不完整，拼完才完整。
// 来源：按流式分片场景构造；PART1 + PART2 拼完恰为 CANONICAL_FORM_BLOCK。
var CANONICAL_FORM_BLOCK = '<question-form id="f-cover" title="覆盖确认">'
  + '{"questions":[{"id":"q1","label":"是否覆盖写入？","type":"radio",'
  + '"options":["覆盖","保留"],"required":true}]}'
  + '</question-form>';
var FRAGMENT_PART1 = CANONICAL_FORM_BLOCK.slice(0, Math.floor(CANONICAL_FORM_BLOCK.length / 2));
var FRAGMENT_PART2 = CANONICAL_FORM_BLOCK.slice(Math.floor(CANONICAL_FORM_BLOCK.length / 2));

module.exports = {
  FLAT_QUESTION_EVENT: FLAT_QUESTION_EVENT,
  TOOL_USE_WRAPPED: TOOL_USE_WRAPPED,
  FALSE_POSITIVE_SURVEY_DATA: FALSE_POSITIVE_SURVEY_DATA,
  FALSE_POSITIVE_DOC_EXAMPLE: FALSE_POSITIVE_DOC_EXAMPLE,
  CANONICAL_FORM_BLOCK: CANONICAL_FORM_BLOCK,
  FRAGMENT_PART1: FRAGMENT_PART1,
  FRAGMENT_PART2: FRAGMENT_PART2
};
