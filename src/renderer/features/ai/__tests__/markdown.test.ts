import { describe, expect, it } from 'vitest';
import { escapeHtml, renderInlineMarkdown, renderMarkdownToHtml } from '../markdown';

describe('markdown：AI 回复渲染（B-AI-P2-2）', () => {
  it('渲染标题 / 列表 / 粗体 / 行内代码', () => {
    const html = renderMarkdownToHtml('# 冒烟\n\n- 通过\n- **重点**\n\n这是 `npm test`。');
    expect(html).toContain('<h1 class=');
    expect(html).toContain('冒烟');
    expect(html).toContain('<ul class=');
    expect(html).toContain('<li>通过</li>');
    expect(html).toContain('<li><strong>重点</strong></li>');
    expect(html).toContain('<code class=');
    expect(html).toContain('npm test');
  });

  it('渲染表格（表头 / 单元格 / 对齐）', () => {
    const html = renderMarkdownToHtml(
      '| 名称 | 值 |\n| --- | ---: |\n| A | 1 |\n| B | 2 |',
    );
    expect(html).toContain('<table class=');
    expect(html).toContain('<thead>');
    expect(html).toContain('<th class=');
    expect(html).toContain('名称');
    expect(html).toContain('text-right');
    expect(html).toContain('<td class=');
    expect(html).toContain('A');
    expect(html).toContain('2');
  });

  it('围栏代码块输出 pre/code，并去除 fence 标记', () => {
    const html = renderMarkdownToHtml('```js\nconsole.log(1)\n```');
    expect(html).toContain('<pre class=');
    expect(html).toContain('<code class="language-js');
    expect(html).toContain('console.log(1)');
    expect(html).not.toContain('```');
  });

  it('真实回复形态：标题 + 围栏 + 列表一次渲染', () => {
    const html = renderMarkdownToHtml('# 冒烟\n```js\nconsole.log(1)\n```\n- 通过');
    expect((html.match(/<pre class=/g) || []).length).toBe(1);
    expect((html.match(/<code class=/g) || []).length).toBe(1);
    expect(html).toContain('<h1 class=');
    expect(html).toContain('<li>通过</li>');
    expect(html).not.toContain('```');
  });

  it('流式未闭合围栏仍可读（内容不丢、按代码块渲染）', () => {
    const html = renderMarkdownToHtml('说明\n\n```ts\nconst a = 1;\nlet b = 2;');
    expect(html).toContain('<pre class=');
    expect(html).toContain('<code class="language-ts');
    expect(html).toContain('const a = 1;');
    expect(html).toContain('let b = 2;');
    expect(html).not.toContain('```');
  });

  it('先转义 HTML：script / img / 事件属性不会变成真实标签', () => {
    const html = renderMarkdownToHtml(
      '<img src=x onerror="alert(1)">\n\n<script>alert(1)</script>\n\n`<b>x</b>`',
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror="');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<code class=');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('危险链接协议只保留文字，正常 https 链接保留', () => {
    const html = renderMarkdownToHtml('[点我](javascript:alert(1)) [官网](https://example.com/a?b=1)');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('点我');
    expect(html).toContain('href="https://example.com/a?b=1"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('链接 URL 里的 __ / ** 不会被粗体规则改写', () => {
    const html = renderMarkdownToHtml('[x](https://example.com/a__b__c/**d**)');
    expect(html).toContain('href="https://example.com/a__b__c/**d**"');
    expect(html).not.toContain('<strong>b</strong>');
    expect(html).not.toContain('<strong>d</strong>');
  });

  it('行内代码里的 Markdown 标记不被二次解释', () => {
    expect(renderInlineMarkdown('`a **b**`')).toBe(
      '<code class="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px] break-words">a **b**</code>',
    );
  });

  it('escapeHtml 覆盖五个特殊字符', () => {
    expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
  });
});
