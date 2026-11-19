/**
 * secure-srcdoc 单测（W3-02 方案 B）。
 * 覆盖：sandbox 属性、脚本转义、注入位置/幂等、帧桥白名单/nonce/大小上限、来源校验、最小桩构造器。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  SANDBOX_ALLOWED_FROM_FRAME,
  SANDBOX_ALLOWED_TO_FRAME,
  SANDBOX_ATTR,
  SANDBOX_BRIDGE_ATTR,
  SANDBOX_MAX_BYTES,
  buildAnnoRectsMessage,
  buildDisarmMessage,
  buildFrameMessage,
  buildNavJumpMessage,
  buildPickRequestMessage,
  buildProtoModeMessage,
  buildStampMessage,
  injectSandboxBridge,
  isAllowedFromFrame,
  isAllowedToFrame,
  isBridgeMessage,
  isTrustedFrameEvent,
  isValidBridgeNonce,
  makeBridgeNonce,
  postToFrame,
  sandboxAgentSource,
  sandboxSafeScript,
  secureSrcdoc,
} from '../lib/secure-srcdoc';

describe('sandbox 属性与脚本转义', function () {
  it('sandbox 属性为 allow-scripts allow-forms，不含 allow-same-origin', function () {
    expect(SANDBOX_ATTR).toBe('allow-scripts allow-forms');
    expect(SANDBOX_ATTR).not.toContain('allow-same-origin');
  });

  it('sandboxSafeScript 转义 </script（大小写不敏感）', function () {
    expect(sandboxSafeScript('var a="</script>";')).toBe('var a="<\\/script>";');
    expect(sandboxSafeScript('x</SCRIPT>y')).toBe('x<\\/script>y');
  });

  it('sandboxAgentSource 自包含选择器且不含裸 </script', function () {
    const src = sandboxAgentSource();
    expect(src).toContain('generateSelector');
    expect(src).toContain('PICK_RESULT');
    expect(src.toLowerCase()).not.toContain('</script');
    expect(src).toContain('data-pr-id');
  });

  it('PICK_RESULT 回传 ctrlKey/metaKey/shiftKey，且 Ctrl 按住时保持武装可连续点选', function () {
    const src = sandboxAgentSource();
    expect(src).toContain('snap.ctrlKey = ctrl');
    expect(src).toContain('snap.metaKey = meta');
    expect(src).toContain('snap.shiftKey = shift');
    expect(src).toContain('if(ctrl || meta){ armed = true; setCrosshair(true); }');
  });

  it('拾取快照带 pickIndex：按同 selector 命中列表序号定位', function () {
    const src = sandboxAgentSource();
    expect(src).toContain('function pickIndexOf(el, selector)');
    expect(src).toContain('document.querySelectorAll(selector)');
    expect(src).toContain('if(all[i] === el) return i;');
    expect(src).toContain('pickIndex: pickIndexOf(el, selector)');
  });
});

describe('injectSandboxBridge / secureSrcdoc', function () {
  it('优先插入 <head>', function () {
    const out = injectSandboxBridge('<html><head><title>x</title></head><body>y</body></html>');
    expect(out).toContain('<head><script ' + SANDBOX_BRIDGE_ATTR);
    expect(out).toContain('</body>');
  });

  it('无 head 时插入 <html> 后；无 html 时插入 </body> 前', function () {
    const withHtml = injectSandboxBridge('<html><body>y</body></html>');
    expect(withHtml).toContain('<html><head><script ' + SANDBOX_BRIDGE_ATTR);
    const bare = injectSandboxBridge('<div>y</div></body>');
    expect(bare.indexOf('<script ' + SANDBOX_BRIDGE_ATTR)).toBeLessThan(bare.indexOf('</body>'));
  });

  it('裸片段前置注入，且原文保留', function () {
    const out = injectSandboxBridge('<p>hello</p>');
    expect(out.startsWith('<script ' + SANDBOX_BRIDGE_ATTR)).toBe(true);
    expect(out).toContain('<p>hello</p>');
  });

  it('幂等：已注入的 HTML 不再重复注入', function () {
    const once = injectSandboxBridge('<html><head></head><body>x</body></html>');
    const twice = injectSandboxBridge(once);
    expect(twice).toBe(once);
    expect(twice.split(SANDBOX_BRIDGE_ATTR).length - 1).toBe(1);
  });

  it('secureSrcdoc 注入 Agent；injectBridge=false 时原样返回', function () {
    expect(secureSrcdoc('<p>x</p>')).toContain(SANDBOX_BRIDGE_ATTR);
    expect(secureSrcdoc('<p>x</p>', { injectBridge: false })).toBe('<p>x</p>');
    expect(secureSrcdoc('')).toContain(SANDBOX_BRIDGE_ATTR);
  });
});

describe('帧桥协议', function () {
  it('白名单包含链接/标注/AI 帧桥最小类型', function () {
    expect(SANDBOX_ALLOWED_TO_FRAME.PICK_REQUEST).toBe(true);
    expect(SANDBOX_ALLOWED_TO_FRAME.ANNO_RECTS).toBe(true);
    expect(SANDBOX_ALLOWED_TO_FRAME.STAMP_SET).toBe(true);
    expect(SANDBOX_ALLOWED_TO_FRAME['proto-mode']).toBe(true);
    expect(SANDBOX_ALLOWED_FROM_FRAME.PICK_RESULT).toBe(true);
    expect(SANDBOX_ALLOWED_FROM_FRAME.HOVER).toBe(true);
    expect(SANDBOX_ALLOWED_FROM_FRAME['proto-link']).toBe(true);
    expect(isAllowedFromFrame('PICK_RESULT')).toBe(true);
    expect(isAllowedFromFrame('EVIL')).toBe(false);
    expect(isAllowedToFrame('DISARM')).toBe(true);
    expect(isAllowedToFrame('EVIL')).toBe(false);
  });

  it('nonce 合法且 buildFrameMessage 拒绝非白名单', function () {
    const n = makeBridgeNonce();
    expect(isValidBridgeNonce(n)).toBe(true);
    expect(isValidBridgeNonce('short')).toBe(false);
    expect(buildFrameMessage('EVIL', {})).toBeNull();
    const msg = buildPickRequestMessage();
    expect(msg).not.toBeNull();
    expect(msg && msg.source).toBe('host');
    expect(msg && isValidBridgeNonce(msg.nonce)).toBe(true);
    expect(buildDisarmMessage()?.type).toBe('DISARM');
  });

  it('1MB 上限拒绝超大载荷', function () {
    const big = 'x'.repeat(SANDBOX_MAX_BYTES);
    expect(buildFrameMessage('NAV_JUMP', { page: big })).toBeNull();
  });

  it('链接/标注/AI 最小桩构造器字段正确', function () {
    expect(buildNavJumpMessage('page-chat')?.payload.page).toBe('page-chat');
    const stamp = buildStampMessage('pl-1', 'button#ok', 'page-home');
    expect(stamp?.type).toBe('STAMP_SET');
    expect(stamp?.payload.plid).toBe('pl-1');
    expect(buildStampMessage('', 'button', '')).toBeNull();
    const anno = buildAnnoRectsMessage([
      { key: 'a', selector: '#a' },
      { key: '', selector: '#b' },
      { key: 'c', selector: '' },
    ]);
    expect(anno?.type).toBe('ANNO_RECTS');
    expect((anno?.payload.items as unknown[]).length).toBe(1);
    expect(buildAnnoRectsMessage([])).toBeNull();
    expect(buildProtoModeMessage(true)?.payload.edit).toBe(true);
  });

  it('isBridgeMessage 宽校验', function () {
    expect(isBridgeMessage({ type: 'HOVER', source: 'frame', nonce: 'x', payload: {} })).toBe(true);
    expect(isBridgeMessage({ type: 1, source: 'frame' })).toBe(false);
    expect(isBridgeMessage(null)).toBe(false);
  });
});

describe('来源校验与投递', function () {
  it('isTrustedFrameEvent 只信 contentWindow source，允许 opaque origin', function () {
    const win = {} as Window;
    const base = { source: win, origin: 'null' } as MessageEvent;
    expect(isTrustedFrameEvent(base, win)).toBe(true);
    expect(isTrustedFrameEvent({ source: {}, origin: 'null' } as unknown as MessageEvent, win)).toBe(false);
    expect(isTrustedFrameEvent(base, null)).toBe(false);
    const cross = { source: win, origin: 'https://evil.example' } as MessageEvent;
    expect(isTrustedFrameEvent(cross, win)).toBe(false);
  });

  it('postToFrame 只调用 contentWindow.postMessage', function () {
    const postMessage = vi.fn();
    const frame = { contentWindow: { postMessage } } as unknown as HTMLIFrameElement;
    const msg = buildPickRequestMessage();
    expect(postToFrame(frame, msg)).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][1]).toBe('*');
    expect(postToFrame(null, msg)).toBe(false);
    expect(postToFrame(frame, null)).toBe(false);
  });
});
