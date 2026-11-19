/**
 * Sheet 焦点陷阱回归（b-pick P2-2）。
 *
 * 覆盖：
 * - 打开后焦点进入浮层首个可聚焦元素；
 * - Tab / Shift+Tab 在浮层内循环，不回到背景 toolbar；
 * - Esc 仍由全局 overlay 栈单入口关闭，关闭后焦点回归触发按钮。
 */

import * as React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Sheet, SheetContent, SheetTitle } from "../sheet";
import { closeTopmostOverlay } from "@/stores/ui-store";

afterEach(cleanup);

function Host() {
  const [open, setOpen] = React.useState(false);
  return (
    <div>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
        打开检查器
      </button>
      <button type="button" data-testid="background">
        背景按钮
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent data-testid="sheet">
          <SheetTitle>测试面板</SheetTitle>
          <button type="button" data-testid="first">
            第一个
          </button>
          <button type="button" data-testid="last">
            最后一个
          </button>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function openSheet(): { opener: HTMLElement } {
  render(<Host />);
  const opener = screen.getByTestId("opener");
  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByTestId("sheet")).toBeTruthy();
  return { opener };
}

describe("Sheet 焦点陷阱（P2-2）", () => {
  it("打开后焦点进入浮层首个可聚焦元素", () => {
    openSheet();
    expect(document.activeElement).toBe(screen.getByTestId("first"));
    expect(document.activeElement).not.toBe(screen.getByTestId("background"));
  });

  it("Tab 从末项回到首项，Shift+Tab 从首项回到末项", () => {
    openSheet();
    const first = screen.getByTestId("first");
    const last = screen.getByTestId("last");
    const close = screen.getByRole("button", { name: "关闭" });

    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(close, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("全局 Esc 栈关闭后焦点回归触发按钮，且只关一层", () => {
    const { opener } = openSheet();
    expect(document.activeElement).not.toBe(opener);

    act(() => {
      const closed = closeTopmostOverlay();
      expect(closed).toBeTruthy();
    });

    expect(screen.queryByTestId("sheet")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
