# ProtoDesk · 原型设计协作工具

桌面端原型预览与 AI 协作修改工具（Electron）。把 HTML 原型、功能说明文档、修改需求管在一起：预览原型时可直接点选页面元素，用一句话告诉大模型改哪里，生成完成后自动刷新预览。

## 下载

Windows 64 位安装包（v1.0.1）：

- [ProtoDesk-Setup-1.0.1.exe](https://github.com/duuckwang-byte/ProtoDesk/releases/download/v1.0.1/ProtoDesk-Setup-1.0.1.exe)
- 其他版本见 [Releases](https://github.com/duuckwang-byte/ProtoDesk/releases/latest) 页面

## 功能一览

- **原型 + 文档同屏**：左侧切原型，右侧看功能说明；支持移动 / PC 端别切换与缩放
- **点选即改**：按住 Ctrl 点击页面元素，写一句话需求，提交给大模型修改
- **本地 CLI 驱动**：AI 任务交给本机 CLI（含 opencode），可用自己的模型、插件与 MCP
- **快照回滚**：每次 AI 修改前自动备份，一键恢复任意版本
- **跳转绑定与标注**：给元素配置页面跳转、加需求标注，存 sidecar 文件零污染原型
- **Git 协同**：上传发布 / 拉取同步，覆盖前二次确认
- **导入导出**：多原型合并导出为单个离线 HTML

> AI 修改功能需要本机安装对应的 CLI（如 opencode）；仅预览、标注、绑定功能开箱即用。

## 常用快捷键

| 场景 | 快捷键 | 说明 |
|---|---|---|
| 拾取元素 | 按住 Ctrl + 单击 | 多选；再点已选项反选；松开 Ctrl 弹出底部输入条 |
| 改代码 | Ctrl + Shift + 单击 | 打开代码编辑抽屉（HTML+CSS）或就地改浮层 |


## 从源码运行

```bash
npm install
npx electron .      # 开发模式启动
npm run build       # 打包 Windows 安装版，产物在 桌面端/
npm test            # 回归门禁
```

## License

Apache-2.0，见 [LICENSE](LICENSE)。
