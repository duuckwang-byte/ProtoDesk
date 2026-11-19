/**
 * src/renderer/features/ai/markdown.ts — 零依赖 Markdown → 安全 HTML（AI 气泡专用）。
 *
 * 约束（B-AI-P2-2）：
 * - 不引入任何新依赖，纯字符串函数；
 * - **先转义 HTML，再生成标签**：用户内容里的 `<script>` / `onerror` 等只会变成实体文本，
 *   输出中出现的标签全部由本文件生成（XSS 防线）；
 * - 覆盖标题 / 有序·无序列表 / 表格 / 粗体 / 行内代码 / 围栏代码块 / 引用 / 分隔线；
 * - 流式未闭合围栏（只收到 ` ```js ` 与正文、还没收到收尾 ```）也按代码块渲染，
 *   避免流式过程中把代码原样吐成纯文本或吞掉后半段；
 * - 非法/危险链接协议（javascript: / vbscript: / data:）只保留链接文字，不生成 href。
 *
 * 说明：真正的 Markdown 全量解析不在本包范围内；这里只做聊天回复需要的块级子集，
 * 所有输入都按纯文本处理（不做 HTML 透传），宁可少渲染一种语法，也不放宽 XSS 边界。
 */

/** HTML 转义（渲染前第一步；生成标签只发生在本文件内部）。 */
export function escapeHtml(text: unknown): string {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const H_CLASS: Record<number, string> = {
  1: 'mb-1.5 mt-3 text-base font-semibold leading-snug first:mt-0',
  2: 'mb-1.5 mt-3 text-[14px] font-semibold leading-snug first:mt-0',
  3: 'mb-1 mt-2.5 text-[13px] font-semibold leading-snug first:mt-0',
  4: 'mb-1 mt-2.5 text-[12.5px] font-semibold leading-snug first:mt-0',
  5: 'mb-1 mt-2 text-[12px] font-semibold leading-snug first:mt-0',
  6: 'mb-1 mt-2 text-[11.5px] font-semibold leading-snug text-muted-foreground first:mt-0',
};

const P_CLASS = 'my-1 whitespace-pre-wrap break-words leading-relaxed';
const UL_CLASS = 'my-1.5 list-disc space-y-0.5 pl-5';
const OL_CLASS = 'my-1.5 list-decimal space-y-0.5 pl-5';
const PRE_CLASS =
  'my-2 overflow-x-auto rounded-md border border-border bg-muted p-2 text-[11.5px] leading-relaxed';
const CODE_INLINE_CLASS =
  'rounded bg-muted px-1 py-0.5 font-mono text-[11.5px] break-words';
const TABLE_WRAP_CLASS = 'my-2 max-w-full overflow-x-auto';
const TABLE_CLASS = 'w-full border-collapse text-[11.5px]';
const TH_CLASS = 'border border-border bg-muted px-2 py-1 text-left font-medium';
const TD_CLASS = 'border border-border px-2 py-1 align-top';
const QUOTE_CLASS = 'my-2 border-l-2 border-border pl-3 text-muted-foreground';

const LINK_CLASS = 'text-[var(--cobalt)] underline underline-offset-2';

/** 行内代码占位符（\u0000 在输入端已被移除，不会与用户正文冲突）。 */
const SLOT_RE = /\u0000(\d+)\u0000/g;

interface InlineSlot {
  body: string;
}

/**
 * 保护行内代码：先抽出反引号片段，避免其中的 `**` / `[]()` 被当成 Markdown。
 * 未闭合的反引号保持原样（流式期间不猜测）。
 */
function protectInlineCode(raw: string, slots: InlineSlot[]): string {
  return raw.replace(/(`+)([^\n]*?)\1/g, (match, _ticks: string, body: string) => {
    // 反引号片段本身可以跨多个反引号（``a`b``），body 原样保留，渲染时再转义。
    if (body === '') return match;
    slots.push({ body });
    return '\u0000' + String(slots.length - 1) + '\u0000';
  });
}

/** 危险协议探测：去掉空白/不可见字符后再看 scheme，实体只用于探测、不进入输出。 */
function safeHref(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  // 输入已整体转义；引号实体一律拒绝，避免属性截断类构造。
  if (/&quot;|&#39;|"/.test(value)) return '';
  const probe = value
    .replace(/&amp;/gi, '&')
    .replace(/[\u0000-\u0020\u007f]+/g, '')
    .toLowerCase();
  if (/^(?:javascript|vbscript|data):/.test(probe)) return '';
  if (/^(?:https?:\/\/|mailto:|\/(?!\/)|#|\.{1,2}\/)/.test(probe)) return value;
  return '';
}

/**
 * 行内 Markdown（标题/列表/表格单元格共用）。
 * 顺序：保护代码 → 转义 HTML → 链接 → 粗体/删除线 → 还原代码。
 */
export function renderInlineMarkdown(text: string): string {
  const raw = String(text == null ? '' : text).replace(/[\u0000\u0001]/g, '');
  if (!raw) return '';
  const slots: InlineSlot[] = [];
  const hrefSlots: string[] = [];
  const protectedText = protectInlineCode(raw, slots);
  let html = escapeHtml(protectedText);

  // 链接：图片语法（![...]）不渲染，保持原文字。
  // href 先换成占位符，避免 URL 里的 `__`/`**` 被后面的粗体规则改写。
  html = html.replace(/(!?)\[([^\]\n]*)\]\(([^)\s]+)\)/g, (match, bang: string, label: string, href: string) => {
    if (bang) return match;
    const target = safeHref(href);
    if (!target) return label;
    hrefSlots.push(target);
    return (
      '<a class="' +
      LINK_CLASS +
      '" href="\u0001' +
      String(hrefSlots.length - 1) +
      '\u0001" target="_blank" rel="noopener noreferrer">' +
      label +
      '</a>'
    );
  });

  // 粗体 / 删除线（代码片段已抽成占位符，不会被误伤）。
  html = html.replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, '<strong>$2</strong>');
  html = html.replace(/~~(?=\S)([^\n]*?\S)~~/g, '<del>$1</del>');

  html = html.replace(/\u0001(\d+)\u0001/g, (_m, idx: string) => hrefSlots[Number(idx)] || '');
  html = html.replace(SLOT_RE, (_m, idx: string) => {
    const slot = slots[Number(idx)];
    if (!slot) return '';
    return '<code class="' + CODE_INLINE_CLASS + '">' + escapeHtml(slot.body) + '</code>';
  });

  return html;
}

function splitTableRow(row: string): string[] {
  let value = String(row || '').trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|')) value = value.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '\\' && value[i + 1] === '|') {
      cur += '|';
      i += 1;
      continue;
    }
    if (ch === '`') {
      inCode = !inCode;
      cur += ch;
      continue;
    }
    if (ch === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function isTableDelimiter(row: string): boolean {
  const cells = splitTableRow(row);
  if (!cells.length) return false;
  return cells.every((c) => /^:?-{1,}:?$/.test(c));
}

function isTableStart(lines: string[], i: number): boolean {
  const head = lines[i];
  const next = lines[i + 1];
  if (!head || next === undefined) return false;
  if (head.indexOf('|') < 0) return false;
  if (!isTableDelimiter(next)) return false;
  return splitTableRow(next).length === splitTableRow(head).length;
}

function isListItem(line: string): boolean {
  return /^\s{0,6}[-*+]\s+\S/.test(line) || /^\s{0,6}\d{1,9}[.)]\s+\S/.test(line);
}

function isBlockStart(lines: string[], i: number): boolean {
  const line = lines[i];
  if (!line || !line.trim()) return false;
  if (/^ {0,3}#{1,6}\s+/.test(line)) return true;
  if (/^ {0,3}(`{3,}|~{3,})/.test(line)) return true;
  if (/^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) return true;
  if (isListItem(line)) return true;
  if (/^ {0,3}>\s?/.test(line)) return true;
  return isTableStart(lines, i);
}

function renderList(lines: string[], start: number, ordered: boolean): { html: string; next: number } {
  const items: string[] = [];
  let i = start;
  let startNumber = 1;
  if (ordered) {
    const m = /^\s{0,6}(\d{1,9})[.)]\s+/.exec(lines[i] || '');
    if (m) startNumber = Math.max(1, Number(m[1]) || 1);
  }
  while (i < lines.length) {
    const line = lines[i];
    const m = ordered
      ? /^\s{0,6}\d{1,9}[.)]\s+(.*)$/.exec(line)
      : /^\s{0,6}[-*+]\s+(.*)$/.exec(line);
    if (!m) break;
    items.push(renderInlineMarkdown(m[1] || ''));
    i += 1;
    // 列表项续行（缩进两格以上且不是新块）并入当前项，保持聊天里的换行可读。
    while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !isListItem(lines[i])) {
      items[items.length - 1] += '<br />' + renderInlineMarkdown(lines[i].trim());
      i += 1;
    }
  }
  const tag = ordered ? 'ol' : 'ul';
  const cls = ordered ? OL_CLASS : UL_CLASS;
  const startAttr = ordered && startNumber !== 1 ? ' start="' + String(startNumber) + '"' : '';
  return {
    html:
      '<' +
      tag +
      ' class="' +
      cls +
      '"' +
      startAttr +
      '>' +
      items.map((item) => '<li>' + item + '</li>').join('') +
      '</' +
      tag +
      '>',
    next: i,
  };
}

function renderTable(lines: string[], start: number): { html: string; next: number } {
  const head = splitTableRow(lines[start]);
  const delimiters = splitTableRow(lines[start + 1]);
  const align = delimiters.map((c) => {
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  });
  const pad = (cells: string[], count: number): string[] => {
    const out = cells.slice(0, count);
    while (out.length < count) out.push('');
    return out;
  };
  const alignClass = (idx: number): string => {
    const a = align[idx] || '';
    return a ? ' text-' + a : '';
  };
  const headHtml = pad(head, delimiters.length)
    .map((cell, idx) => '<th class="' + TH_CLASS + alignClass(idx) + '">' + renderInlineMarkdown(cell) + '</th>')
    .join('');
  const rows: string[] = [];
  let i = start + 2;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.indexOf('|') < 0) break;
    const cells = pad(splitTableRow(line), delimiters.length);
    rows.push(
      '<tr>' +
        cells.map((cell, idx) => '<td class="' + TD_CLASS + alignClass(idx) + '">' + renderInlineMarkdown(cell) + '</td>').join('') +
        '</tr>',
    );
    i += 1;
  }
  return {
    html:
      '<div class="' +
      TABLE_WRAP_CLASS +
      '"><table class="' +
      TABLE_CLASS +
      '"><thead><tr>' +
      headHtml +
      '</tr></thead><tbody>' +
      rows.join('') +
      '</tbody></table></div>',
    next: i,
  };
}

/** Markdown → 安全 HTML（聊天气泡用；空输入返回空串）。 */
export function renderMarkdownToHtml(markdown: unknown): string {
  const src = String(markdown == null ? '' : markdown)
    .replace(/\r\n?/g, '\n')
    // 占位符使用 \u0000 / \u0001：输入端的同名控制字符先剔除，避免伪造占位符。
    .replace(/[\u0000\u0001]/g, '');
  if (!src.trim()) return '';
  const lines = src.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行：块分隔。
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // 围栏代码块：支持 ``` / ~~~ 与语言标记；未闭合（流式）照常输出到末尾。
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence && !(fence[1][0] === '`' && fence[2].indexOf('`') >= 0)) {
      const marker = fence[1][0];
      const fenceLen = fence[1].length;
      const info = String(fence[2] || '').trim().split(/\s+/)[0] || '';
      const lang = info.replace(/[^A-Za-z0-9_+.#-]/g, '');
      const closeRe = new RegExp('^ {0,3}' + marker + '{' + String(fenceLen) + ',}\\s*$');
      const body: string[] = [];
      i += 1;
      while (i < lines.length) {
        if (closeRe.test(lines[i])) {
          i += 1;
          break;
        }
        body.push(lines[i]);
        i += 1;
      }
      const codeClass = lang ? ' class="language-' + lang + ' font-mono"' : ' class="font-mono"';
      out.push('<pre class="' + PRE_CLASS + '"><code' + codeClass + '>' + escapeHtml(body.join('\n')) + '</code></pre>');
      continue;
    }

    // 标题。
    const heading = /^ {0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].replace(/\s+#+\s*$/, '').trim();
      out.push('<h' + String(level) + ' class="' + H_CLASS[level] + '">' + renderInlineMarkdown(text) + '</h' + String(level) + '>');
      i += 1;
      continue;
    }

    // 分隔线（必须在列表之前判断，否则 --- 会被当成列表项）。
    if (/^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      out.push('<hr class="my-3 border-border" />');
      i += 1;
      continue;
    }

    // 表格。
    if (isTableStart(lines, i)) {
      const table = renderTable(lines, i);
      out.push(table.html);
      i = table.next;
      continue;
    }

    // 引用。
    if (/^ {0,3}>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^ {0,3}>\s?/.test(lines[i])) {
        quote.push(renderInlineMarkdown(lines[i].replace(/^ {0,3}>\s?/, '')));
        i += 1;
      }
      out.push('<blockquote class="' + QUOTE_CLASS + '">' + quote.join('<br />') + '</blockquote>');
      continue;
    }

    // 列表。
    if (isListItem(line)) {
      const ordered = /^\s{0,6}\d{1,9}[.)]\s+/.test(line);
      const list = renderList(lines, i, ordered);
      out.push(list.html);
      i = list.next;
      continue;
    }

    // 段落：连续非空行，遇到新块开始处断开；保留单个换行。
    const para: string[] = [];
    while (i < lines.length && lines[i].trim()) {
      if (para.length > 0 && isBlockStart(lines, i)) break;
      para.push(renderInlineMarkdown(lines[i]));
      i += 1;
    }
    out.push('<p class="' + P_CLASS + '">' + para.join('<br />') + '</p>');
  }

  return out.join('');
}

export default renderMarkdownToHtml;
