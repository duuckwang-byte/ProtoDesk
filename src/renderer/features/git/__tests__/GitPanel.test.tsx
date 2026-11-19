/**
 * src/renderer/features/git/__tests__/GitPanel.test.tsx — B6 P2 回归。
 *
 * 覆盖 docs/wave4/reports/b-git-export.md §8 的两条 Git 缺陷：
 * - b-ge-P2-status-empty：状态筛选无结果时不得渲染「已选 0/0」空项目卡，
 *   必须显示统一空态，计数跟随可见结果（0 处变更）；
 * - b-ge-P2-esc-nested-git：仓库设置 Dialog 打开时 Esc 只关自身一层，
 *   不冒泡到 MainWindow 的 closeTopmost，因此不会连带关闭 Git 主面板；
 *   X / 遮罩仍只关配置弹窗。
 */

import * as React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeTopmostOverlay } from "@/stores/ui-store";
import { GitPanel } from "../GitPanel";
import type { GitProjectTree } from "../git-api";

type Handler = (...args: unknown[]) => unknown;

function installGit(methods: Record<string, Handler>): void {
  (window as unknown as { protoAPI?: unknown }).protoAPI = { git: methods };
}

function removeGit(): void {
  delete (window as unknown as { protoAPI?: unknown }).protoAPI;
}

const PROJECTS: GitProjectTree[] = [
  {
    project: "测试1",
    isCurrent: true,
    protos: [
      {
        proto: "首页",
        files: [
          {
            path: "测试1/首页/首页.html",
            project: "测试1",
            proto: "首页",
            subPath: "首页.html",
            code: "add",
            label: "新增",
          },
        ],
      },
    ],
  },
  {
    project: "测绘1",
    protos: [
      {
        proto: "默认项目",
        files: [
          {
            path: "测绘1/默认项目/默认.html",
            project: "测绘1",
            proto: "默认项目",
            subPath: "默认.html",
            code: "mod",
            label: "修改",
          },
        ],
      },
    ],
  },
];

const GIT_METHODS: Record<string, Handler> = {
  getConfig: async () => ({
    ok: true,
    config: { remoteUrl: "https://gitee.com/u/r.git", branch: "main", authorName: "设计", authorEmail: "d@local" },
  }),
  listBranches: async () => ({ ok: true, branches: ["main"], currentBranch: "main", remoteConfigured: true }),
  getStatus: async () => ({ ok: true, projects: PROJECTS, totalCount: 2, branch: "main" }),
  fetchDiff: async () => ({ ok: true, projects: [], totalCount: 0, branch: "main" }),
  isBusy: async () => false,
};

function renderPanel(): void {
  render(<GitPanel project="测试1" />);
}

afterEach(() => {
  cleanup();
  removeGit();
  vi.restoreAllMocks();
});

describe("GitPanel 状态筛选空态", () => {
  it("筛选无结果时不渲染空项目卡，显示统一空态且计数为 0", async () => {
    installGit(GIT_METHODS);
    renderPanel();
    expect(await screen.findAllByTestId("git-project-card")).toHaveLength(2);
    expect(screen.getByTestId("git-total").textContent).toContain("2 处变更");

    fireEvent.change(screen.getByTestId("git-status-filter"), { target: { value: "conflict" } });

    expect(screen.queryAllByTestId("git-project-card")).toHaveLength(0);
    expect(screen.getByTestId("git-empty").textContent).toContain("没有匹配的变更");
    expect(screen.getByTestId("git-total").textContent).toContain("0 处变更");

    // 清空筛选恢复完整树与总数。
    fireEvent.change(screen.getByTestId("git-status-filter"), { target: { value: "" } });
    expect(screen.getAllByTestId("git-project-card")).toHaveLength(2);
    expect(screen.getByTestId("git-total").textContent).toContain("2 处变更");
  });

  it("有命中的筛选只保留非空项目卡，计数跟随可见结果", async () => {
    installGit(GIT_METHODS);
    renderPanel();
    await screen.findAllByTestId("git-project-card");

    fireEvent.change(screen.getByTestId("git-status-filter"), { target: { value: "add" } });
    const cards = screen.getAllByTestId("git-project-card");
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain("测试1");
    expect(screen.getByTestId("git-total").textContent).toContain("1 处变更");

    // 路径搜索同样剔除无命中项目，避免空卡残影。
    fireEvent.change(screen.getByTestId("git-status-filter"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("git-filter"), { target: { value: "不存在" } });
    expect(screen.queryAllByTestId("git-project-card")).toHaveLength(0);
    expect(screen.getByTestId("git-empty").textContent).toContain("没有匹配的变更");
    expect(screen.getByTestId("git-total").textContent).toContain("0 处变更");
  });
});

describe("GitConfigDialog Esc 单层", () => {
  async function openConfig(): Promise<HTMLElement> {
    installGit(GIT_METHODS);
    renderPanel();
    await screen.findAllByTestId("git-project-card");
    fireEvent.click(screen.getByTestId("git-config-open"));
    return screen.findByTestId("git-config-dialog");
  }

  it("Esc 只关仓库设置，不触发全局 Esc 栈（Git 面板仍在）", async () => {
    const dialog = await openConfig();
    expect(dialog).toBeTruthy();
    const globalEsc = vi.fn();
    window.addEventListener("keydown", globalEsc);

    try {
      fireEvent.keyDown(screen.getByTestId("git-config-remote"), { key: "Escape", code: "Escape" });

      expect(screen.queryByTestId("git-config-dialog")).toBeNull();
      expect(screen.getByTestId("git-panel")).toBeTruthy();
      expect(globalEsc, "嵌套 Dialog 消费 Esc 后不得冒泡到 MainWindow").not.toHaveBeenCalled();
      expect(closeTopmostOverlay(), "配置弹窗关闭后应注销自己的 overlay 层").toBeNull();

      // 配置关闭后，Esc 恢复为全局单层关闭（模拟 MainWindow 的入口）。
      fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
      expect(globalEsc).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", globalEsc);
    }
  });

  it("X 只关配置弹窗，不影响 Git 面板与全局 Esc 栈", async () => {
    const dialog = await openConfig();
    const globalEsc = vi.fn();
    window.addEventListener("keydown", globalEsc);

    try {
      fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
      expect(screen.queryByTestId("git-config-dialog")).toBeNull();
      expect(screen.getByTestId("git-panel")).toBeTruthy();
      expect(globalEsc).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", globalEsc);
    }
  });

  it("遮罩只关配置弹窗，不影响 Git 面板与全局 Esc 栈", async () => {
    await openConfig();
    const overlay = document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement;
    expect(overlay).toBeTruthy();
    const globalEsc = vi.fn();
    window.addEventListener("keydown", globalEsc);

    try {
      fireEvent.click(overlay);
      expect(screen.queryByTestId("git-config-dialog")).toBeNull();
      expect(screen.getByTestId("git-panel")).toBeTruthy();
      expect(globalEsc).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", globalEsc);
    }
  });
});
