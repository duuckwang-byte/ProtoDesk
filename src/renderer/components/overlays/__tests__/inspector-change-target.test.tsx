/**
 * 检查器「更换目标」回归（b-pick P2-3）。
 *
 * 覆盖：
 * - 已绑定态点击「更换目标」渲染真实下拉/输入（不再只 toast）；
 * - 可选择新目标/子页面并保存；
 * - 取消只丢弃本地选择，不调用保存、不写盘。
 */

import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Inspector } from "../Inspector";

afterEach(cleanup);

const targetOptions = [
  { name: "首页" },
  { name: "我的", pages: [{ value: "我的.html", label: "我的" }, { value: "详情.html", label: "详情" }] },
];

function renderBound(onSaveJump = vi.fn()) {
  render(
    <Inspector
      selector={'[data-pr-id="pr-1"]'}
      page="首页"
      htmlFile="首页.html"
      isBound
      boundTarget="我的"
      boundTargetPage="我的.html"
      targetOptions={targetOptions}
      onSaveJump={onSaveJump}
    />,
  );
  return { onSaveJump };
}

describe("检查器已绑定态「更换目标」（P2-3）", () => {
  it("点击后出现目标下拉并回填已绑定值", () => {
    renderBound();
    expect(screen.queryByTestId("inspector-jump-target-pick")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "更换目标" }));

    const picker = screen.getByTestId("inspector-jump-target-pick") as HTMLSelectElement;
    expect(picker.value).toBe("我的");
    expect((screen.getByTestId("inspector-jump-page-pick") as HTMLSelectElement).value).toBe("我的.html");
    // 删除绑定入口在编辑态仍可用。
    expect(screen.getByTestId("inspector-jump-remove")).toBeTruthy();
  });

  it("可选择新子页面并保存", () => {
    const { onSaveJump } = renderBound();
    fireEvent.click(screen.getByRole("button", { name: "更换目标" }));
    fireEvent.change(screen.getByTestId("inspector-jump-page-pick"), { target: { value: "详情.html" } });
    fireEvent.click(screen.getByTestId("inspector-jump-save"));
    expect(onSaveJump).toHaveBeenCalledTimes(1);
    expect(onSaveJump).toHaveBeenCalledWith("我的", "详情.html");
  });

  it("取消只回填旧值，不调用保存（不写盘）", () => {
    const { onSaveJump } = renderBound();
    fireEvent.click(screen.getByRole("button", { name: "更换目标" }));
    fireEvent.change(screen.getByTestId("inspector-jump-target-pick"), { target: { value: "首页" } });
    fireEvent.click(screen.getByTestId("inspector-jump-cancel"));

    expect(onSaveJump).not.toHaveBeenCalled();
    expect(screen.queryByTestId("inspector-jump-target-pick")).toBeNull();
    expect(screen.getByTestId("inspector-jump-bound-to").textContent).toContain("我的");

    // 再次进入编辑态，选择的仍是已保存值而不是刚才的临时改动。
    fireEvent.click(screen.getByRole("button", { name: "更换目标" }));
    expect((screen.getByTestId("inspector-jump-target-pick") as HTMLSelectElement).value).toBe("我的");
  });
});
