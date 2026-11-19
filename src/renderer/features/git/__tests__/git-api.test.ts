import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as git from "../git-api";
import { GIT_API_METHODS } from "../git-api";
import { gitRemoteUrlMsg } from "../GitConfigDialog";

/** 读取同仓源码，用于静态 UI 契约断言；不启动 Electron / 不渲染组件。 */
function readSource(relativeUrl: string): string {
  return readFileSync(fileURLToPath(new URL(relativeUrl, import.meta.url)), "utf8");
}

type GitHandler = (...args: unknown[]) => unknown;

function installGit(methods: Record<string, GitHandler>) {
  (window as unknown as { protoAPI?: unknown }).protoAPI = { git: methods };
}

function removeGit() {
  delete (window as unknown as { protoAPI?: unknown }).protoAPI;
}

afterEach(() => {
  removeGit();
  vi.restoreAllMocks();
});

describe("git-api: 11 条通道方法表", () => {
  it("对外正好暴露 11 个方法，且无 ipcRenderer 直连", () => {
    expect(GIT_API_METHODS).toHaveLength(11);
    expect([...GIT_API_METHODS].sort()).toEqual(
      [
        "cancel",
        "configGet",
        "fetchDiff",
        "healRepair",
        "isBusy",
        "listBranches",
        "pull",
        "push",
        "saveConfig",
        "status",
        "testConnection",
      ].sort(),
    );
    for (const name of GIT_API_METHODS) {
      expect(typeof (git as unknown as Record<string, unknown>)[name]).toBe("function");
    }
  });
});

describe("git-api: 配置/连接/分支", () => {
  it("configGet 透传 project 并保留脱敏 config", async () => {
    const getConfig = vi.fn(async () => ({
      ok: true,
      config: {
        remoteUrl: "https://gitee.com/u/r.git",
        branch: "main",
        authorName: "设计",
        authorEmail: "d@local",
        hasToken: true,
        tokenMasked: "****abcd",
      },
    }));
    installGit({ getConfig });
    const r = await git.configGet("P1");
    expect(getConfig).toHaveBeenCalledWith("P1");
    expect(r.ok).toBe(true);
    expect(r.config?.tokenMasked).toBe("****abcd");
    expect(r.config?.remoteUrl).toBe("https://gitee.com/u/r.git");
  });

  it("saveConfig 只发 {project,config}，并回传主进程脱敏视图", async () => {
    const saveConfig = vi.fn(async () => ({
      ok: true,
      config: { remoteUrl: "https://gitee.com/u/r.git", branch: "dev", hasToken: false, tokenMasked: "" },
    }));
    installGit({ saveConfig });
    const input = { project: "P1", config: { remoteUrl: "https://gitee.com/u/r.git", branch: "dev", authorName: "", authorEmail: "" } };
    const r = await git.saveConfig(input);
    expect(saveConfig).toHaveBeenCalledWith(input);
    expect(r.ok).toBe(true);
    expect(r.config?.branch).toBe("dev");
  });

  it("testConnection 保留 latency", async () => {
    const testConnection = vi.fn(async () => ({ ok: true, latency: 42 }));
    installGit({ testConnection });
    const r = await git.testConnection({ project: "P1", remoteUrl: "https://gitee.com/u/r.git" });
    expect(r.ok).toBe(true);
    expect(r.latency).toBe(42);
  });

  it("testConnection 失败时保留 code 并补齐 error", async () => {
    installGit({ testConnection: async () => ({ ok: false, code: "GIT_URL_BLOCKED" }) });
    const r = await git.testConnection({ project: "P1", remoteUrl: "http://x/y.git" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("GIT_URL_BLOCKED");
    expect(r.error).toBe("GIT_URL_BLOCKED");
  });

  it("listBranches 返回 branches/currentBranch/remoteConfigured", async () => {
    const listBranches = vi.fn(async () => ({
      ok: true,
      branches: ["main", "dev"],
      currentBranch: "dev",
      remoteConfigured: false,
    }));
    installGit({ listBranches });
    const r = await git.listBranches({ project: "P1" });
    expect(listBranches).toHaveBeenCalledWith({ project: "P1" });
    expect(r.branches).toEqual(["main", "dev"]);
    expect(r.currentBranch).toBe("dev");
    expect(r.remoteConfigured).toBe(false);
  });
});

describe("git-api: status / fetchDiff 同结构", () => {
  const tree = {
    projects: [
      {
        project: "P1",
        isCurrent: true,
        protos: [{ proto: "首页", files: [{ path: "P1/首页/index.html", project: "P1", proto: "首页", subPath: "index.html", code: "mod", label: "修改" }] }],
      },
    ],
    totalCount: 1,
    branch: "main",
  };

  it("status 透传 {project,branch} 并保留树结构", async () => {
    const getStatus = vi.fn(async () => ({ ok: true, ...tree }));
    installGit({ getStatus });
    const r = await git.status("P1", "main");
    expect(getStatus).toHaveBeenCalledWith({ project: "P1", branch: "main" });
    expect(r.ok).toBe(true);
    expect(r.totalCount).toBe(1);
    expect(r.projects?.[0]?.protos[0]?.files[0]?.code).toBe("mod");
  });

  it("fetchDiff 与 status 同结构（未推送变更）", async () => {
    const fetchDiff = vi.fn(async () => ({ ok: true, ...tree, totalCount: 2 }));
    installGit({ fetchDiff });
    const r = await git.fetchDiff("P1", "dev");
    expect(fetchDiff).toHaveBeenCalledWith({ project: "P1", branch: "dev" });
    expect(r.ok).toBe(true);
    expect(r.totalCount).toBe(2);
    expect(r.projects?.[0]?.project).toBe("P1");
  });
});

describe("git-api: push / pull / cancel / heal", () => {
  it("push 透传 files/message 并保留 filesCount/forced", async () => {
    const push = vi.fn(async () => ({ ok: true, message: "ok", filesCount: 2, branch: "main", forced: false }));
    installGit({ push });
    const input = { project: "P1", branch: "main", files: ["a", "b"], message: "m" };
    const r = await git.push(input);
    expect(push).toHaveBeenCalledWith(input);
    expect(r.filesCount).toBe(2);
    expect(r.forced).toBe(false);
  });

  it("pull 透传 files/backup 并保留 backupPath/failed", async () => {
    const pull = vi.fn(async () => ({ ok: true, filesCount: 1, backupPath: "C:/bak", failed: [], branch: "main" }));
    installGit({ pull });
    const input = { project: "P1", branch: "main", files: null, backup: true };
    const r = await git.pull(input);
    expect(pull).toHaveBeenCalledWith(input);
    expect(r.backupPath).toBe("C:/bak");
    expect(r.failed).toEqual([]);
  });

  it("cancel 保留 cancelled/op", async () => {
    installGit({ cancel: async () => ({ ok: true, cancelled: true, op: "push" }) });
    const r = await git.cancel();
    expect(r.ok).toBe(true);
    expect(r.cancelled).toBe(true);
    expect(r.op).toBe("push");
  });

  it("healRepair 只发 {project} 并保留 backupDir/healed/nested", async () => {
    const healRepair = vi.fn(async () => ({ ok: true, backupDir: "C:/bak", healed: ["a"], nested: [] }));
    installGit({ healRepair });
    const r = await git.healRepair("P1");
    expect(healRepair).toHaveBeenCalledWith({ project: "P1" });
    expect(r.backupDir).toBe("C:/bak");
    expect(r.healed).toEqual(["a"]);
    expect(r.nested).toEqual([]);
  });
});

describe("git-api: isBusy 不按 {ok,busy} 归一", () => {
  it("主进程 {busy:true,currentOp} → true（不因缺 ok 变成失败对象）", async () => {
    installGit({ isBusy: async () => ({ busy: true, currentOp: "push" }) });
    await expect(git.isBusy()).resolves.toBe(true);
  });

  it("{busy:false} → false", async () => {
    installGit({ isBusy: async () => ({ busy: false, currentOp: null }) });
    await expect(git.isBusy()).resolves.toBe(false);
  });

  it("兼容裸 boolean", async () => {
    installGit({ isBusy: async () => true });
    await expect(git.isBusy()).resolves.toBe(true);
  });

  it("网关缺失/抛错一律 false，不抛异常", async () => {
    removeGit();
    await expect(git.isBusy()).resolves.toBe(false);
    installGit({
      isBusy: async () => {
        throw new Error("boom");
      },
    });
    await expect(git.isBusy()).resolves.toBe(false);
  });
});

describe("git-api: 统一 {ok,error} 归一", () => {
  it("网关缺失返回 ok:false + missing protoAPI", async () => {
    const r = await git.status("P1", "main");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("missing protoAPI: git.getStatus");
  });

  it("同步抛错收敛为 ok:false + message", async () => {
    installGit({
      push: () => {
        throw new Error("network down");
      },
    });
    const r = await git.push({ project: "P1", branch: "main", files: ["a"] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("network down");
  });

  it("非对象返回值按契约破坏处理", async () => {
    installGit({ cancel: async () => "ok" });
    const r = await git.cancel();
    expect(r.ok).toBe(false);
    expect(r.error).toBe("bad-ipc-result");
  });

  it("失败但无 error 时用 method 兜底文案", async () => {
    installGit({ fetchDiff: async () => ({ ok: false }) });
    const r = await git.fetchDiff("P1", "main");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("git fetchDiff 调用失败");
  });
});

describe("Git 远端地址前端预检：https + 开发态 file:///，其余拒绝", () => {
  it("https 放行", () => {
    expect(gitRemoteUrlMsg("https://gitee.com/user/repo.git")).toBe("");
    expect(gitRemoteUrlMsg("  https://codeup.aliyun.com/u/r.git  ")).toBe("");
  });

  it("file:/// 绝对 bare 路径语法放行（真实安全由主进程判定）", () => {
    expect(gitRemoteUrlMsg("file:///C:/Temp/pland-fixture/repo.git")).toBe("");
    expect(gitRemoteUrlMsg("file:///C:/Temp/pland fixture/repo.git".replace(/ /g, "%20"))).toBe("");
    expect(gitRemoteUrlMsg("file:///tmp/pland-fixture/repo.git")).toBe("");
  });

  it("http / ssh / scp / 裸本地路径仍前端拒绝", () => {
    for (const url of [
      "http://example.com/repo.git",
      "ssh://git@example.com/repo.git",
      "git@example.com:repo.git",
      "git://example.com/repo.git",
      "C:\\repo.git",
      "C:/repo.git",
      "\\\\server\\share\\repo.git",
      "/home/u/repo.git",
      "repo.git",
      "ext::sh -c whoami",
    ]) {
      expect(gitRemoteUrlMsg(url), url).not.toBe("");
    }
  });

  it("file:// 仅接受三斜杠绝对路径，拒绝主机/UNC/点段/编码斜杠/查询串", () => {
    for (const url of [
      "file://server/share/repo.git",
      "file://C:/repo.git",
      "file:////server/share/repo.git",
      "file:///C:/Temp/../repo.git",
      "file:///C:/Temp/./repo.git",
      "file:///C:/Temp%2Frepo.git",
      "file:///C:\\Temp\\repo.git",
      "file:///C:/Temp/repo.git?x=1",
      "file:///C:/Temp/repo.git#main",
      "file:///",
      "file:///C:repo.git",
    ]) {
      expect(gitRemoteUrlMsg(url), url).not.toBe("");
    }
  });

  it("https 带用户名/口令仍拒绝", () => {
    expect(gitRemoteUrlMsg("https://user:pass@example.com/repo.git")).not.toBe("");
    expect(gitRemoteUrlMsg("https://token@example.com/repo.git")).not.toBe("");
  });

  it("空值/超长/换行/空格拒绝", () => {
    expect(gitRemoteUrlMsg("")).not.toBe("");
    expect(gitRemoteUrlMsg(`https://example.com/${"a".repeat(500)}`)).not.toBe("");
    expect(gitRemoteUrlMsg("https://example.com/a.git\nrm -rf /")).not.toBe("");
    expect(gitRemoteUrlMsg("https://example.com/a b.git")).not.toBe("");
  });

  it("后端 GIT_URL_BLOCKED 文案由 git-api 原样保留（生产无 env 的 file:///）", async () => {
    const backend =
      "不支持的仓库地址协议：默认不支持 file:// 本地路径（仅未打包开发态且 PLAND_GIT_ALLOW_LOCAL=1 时允许本地 bare 夹具）";
    installGit({
      saveConfig: async () => ({ ok: false, code: "GIT_URL_BLOCKED", error: backend }),
      testConnection: async () => ({ ok: false, code: "GIT_URL_BLOCKED", error: backend }),
    });
    const saved = await git.saveConfig({
      project: "P1",
      config: { remoteUrl: "file:///C:/Temp/pland-fixture/repo.git", branch: "main", authorName: "", authorEmail: "" },
    });
    expect(saved.ok).toBe(false);
    expect(saved.code).toBe("GIT_URL_BLOCKED");
    expect(saved.error).toBe(backend);
    const tested = await git.testConnection({ project: "P1", remoteUrl: "file:///C:/Temp/pland-fixture/repo.git" });
    expect(tested.code).toBe("GIT_URL_BLOCKED");
    expect(tested.error).toBe(backend);
  });
});

describe("Git UI 契约：660px 居中 Dialog / amber 状态 / 图标 / 已选总数", () => {
  const mainWindow = readSource("../../../app/modes/MainWindow.tsx");
  const gitPanel = readSource("../GitPanel.tsx");
  const gitConfigDialog = readSource("../GitConfigDialog.tsx");

  it("MainWindow 用 660px × 80vh 居中 Dialog 挂载 Git，不再使用 440px 右侧 Sheet", () => {
    expect(mainWindow).toMatch(/<Dialog\s+open=\{gitOpen\}/);
    expect(mainWindow).toContain("<DialogContent");
    expect(mainWindow).toContain("max-w-[660px]");
    expect(mainWindow).toContain("h-[80vh]");
    expect(mainWindow).toContain("Git 协同");
    expect(mainWindow).toContain("closeTopmost()");
    expect(mainWindow).not.toContain("w-[440px]");
    expect(mainWindow).not.toContain('side="right"');
  });

  it("修改状态 badge 使用 amber，GitPanel 不再引用 cobalt", () => {
    expect(gitPanel).toContain('if (code === "mod") return "bg-amber-500 text-white";');
    expect(gitPanel).not.toContain("var(--cobalt)");
  });

  it("文件行带 FileText、原型分组带 Folder 图标", () => {
    expect(gitPanel).toContain('FileText, Folder, GitBranch');
    expect(gitPanel).toContain("<FileText");
    expect(gitPanel).toContain("<Folder");
    expect(gitPanel).toContain('data-testid="git-file-row"');
    expect(gitPanel).toContain('data-testid="git-proto-group"');
  });

  it("项目头显示已选/总数，顶部工具区按三行且不换行", () => {
    expect(gitPanel).toContain("已选 {selCount}/{allPaths.length}");
    expect(gitPanel).toContain('data-selected={selCount}');
    expect(gitPanel).toContain('data-total={allPaths.length}');
    for (const row of ["git-toolbar", "git-filterbar", "git-actionbar"]) {
      expect(gitPanel).toContain(`data-testid="${row}"`);
    }
    expect(gitPanel).toContain("flex-nowrap");
  });

  it("Git 设置弹窗测试/保存均走前端预检，并标注开发态夹具开关与假 token", () => {
    expect((gitConfigDialog.match(/gitRemoteUrlMsg\(url\)/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(gitConfigDialog).toContain("PLAND_GIT_ALLOW_LOCAL");
    expect(gitConfigDialog).toContain("file:///");
    expect(gitConfigDialog).toContain('data-testid="git-config-local-fixture-hint"');
    expect(gitConfigDialog).toContain('data-testid="git-config-local-token-hint"');
    expect(gitConfigDialog).toContain("假 token");
    expect(gitConfigDialog).toContain("GIT_URL_BLOCKED");
  });
});
