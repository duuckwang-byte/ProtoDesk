/**
 * iframe-pick 纯函数用例（Wave 2-H 名下）。
 * 只覆盖 src/renderer/features/preview/lib/iframe-pick.ts，不碰 DOM/iframe。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  CROSSHAIR_STYLE_ID,
  CROSSHAIR_CSS,
  MOBILE_VIEWPORT_W,
  MOBILE_VIEWPORT_H,
  buildCrosshairStyleTag,
  buildSelectorFromSegments,
  frameScaleFromWidths,
  generateSelector,
  isFocusInFrame,
  isPickableTag,
  isPickDisabled,
  pagePointToFrame,
  scaleBoxScale,
  scaleRectToPage,
} from '../lib/iframe-pick';

afterEach(function () {
  document.body.innerHTML = '';
});

describe('iframe-pick 纯函数', function () {
  it('准星样式字符串沿用旧 id 与正文', function () {
    expect(CROSSHAIR_STYLE_ID).toBe('ctrlPickCrosshairStyle');
    expect(CROSSHAIR_CSS).toBe('*{cursor:crosshair!important}');
    var tag = buildCrosshairStyleTag();
    expect(tag).toContain(CROSSHAIR_STYLE_ID);
    expect(tag).toContain(CROSSHAIR_CSS);
  });

  it('html/body 不可拾取，其余标签可拾取', function () {
    expect(isPickableTag('html')).toBe(false);
    expect(isPickableTag('BODY')).toBe(false);
    expect(isPickableTag('button')).toBe(true);
    expect(isPickableTag('div')).toBe(true);
    expect(isPickableTag('')).toBe(false);
    expect(isPickableTag(null)).toBe(false);
  });

  it('scaleRectToPage 沿用 editRectToPage 口径', function () {
    var out = scaleRectToPage(
      { left: 10, top: 20, width: 100, height: 50 },
      { left: 5, top: 7, width: 375, height: 780 },
      2,
    );
    expect(out).toEqual({ left: 25, top: 47, width: 200, height: 100 });
  });

  it('pagePointToFrame 为 scaleRectToPage 的逆运算', function () {
    var frame = { left: 5, top: 7, width: 375, height: 780 };
    var pt = pagePointToFrame(25, 47, frame, 2);
    expect(pt.x).toBeCloseTo(10);
    expect(pt.y).toBeCloseTo(20);
  });

  it('移动端缩放盒按 375 逻辑宽换算', function () {
    expect(MOBILE_VIEWPORT_W).toBe(375);
    expect(MOBILE_VIEWPORT_H).toBe(780);
    expect(scaleBoxScale(750)).toBeCloseTo(2);
    expect(scaleBoxScale(0)).toBe(1);
  });

  it('frameScale 非法输入回 1', function () {
    expect(frameScaleFromWidths(750, 375)).toBeCloseTo(2);
    expect(frameScaleFromWidths(100, 0)).toBe(1);
    expect(frameScaleFromWidths(NaN, 375)).toBe(1);
  });

  it('选择器拼接过滤空段', function () {
    expect(buildSelectorFromSegments(['div.main', '', 'button#ok'])).toBe('div.main > button#ok');
    expect(buildSelectorFromSegments([])).toBe('');
  });

  it('导出态/就地改打开时禁用拾取', function () {
    expect(isPickDisabled({ exportBoot: true, inlineOpen: false })).toBe(true);
    expect(isPickDisabled({ exportBoot: false, inlineOpen: true })).toBe(true);
    expect(isPickDisabled({ exportBoot: false, inlineOpen: false })).toBe(false);
  });

  it('看门狗：activeElement===frame 即帧内', function () {
    var frame = {};
    expect(isFocusInFrame(frame, frame)).toBe(true);
    expect(isFocusInFrame({}, frame)).toBe(false);
    expect(isFocusInFrame(null, null)).toBe(false);
  });
});

describe('generateSelector（移植 edit-entry.js:612）', function () {
  it('优先唯一 data-pr-id', function () {
    document.body.innerHTML =
      '<div><button data-pr-id="pr-1">A</button><button data-pr-id="pr-2">B</button></div>';
    var el = document.querySelector('[data-pr-id="pr-1"]');
    expect(generateSelector(el)).toBe('[data-pr-id="pr-1"]');
  });

  it('data-pr-id 重复时回退唯一 data-testid', function () {
    document.body.innerHTML =
      '<div><button data-pr-id="dup">A</button><button data-pr-id="dup" data-testid="ok">B</button></div>';
    var el = document.querySelector('[data-testid="ok"]');
    expect(generateSelector(el)).toBe('[data-testid="ok"]');
  });

  it('唯一 id 直接返回 #id（特殊字符转义）', function () {
    document.body.innerHTML = '<div><button id="a.b">A</button></div>';
    var el = document.getElementById('a.b');
    expect(generateSelector(el)).toBe('#a\\.b');
  });

  it('无稳定属性时取最短唯 class 路径', function () {
    document.body.innerHTML = '<div class="card"><span class="x">t</span></div>';
    var el = document.querySelector('span.x');
    expect(generateSelector(el)).toBe('span.x');
  });

  it('兜底 nth-of-type 全路径', function () {
    document.body.innerHTML = '<div><span>1</span><span>2</span></div>';
    var el = document.querySelectorAll('span')[1];
    expect(generateSelector(el)).toBe('div:nth-of-type(1) > span:nth-of-type(2)');
  });

  it('null / body 返回空串', function () {
    expect(generateSelector(null)).toBe('');
    expect(generateSelector(document.body)).toBe('');
  });
});
