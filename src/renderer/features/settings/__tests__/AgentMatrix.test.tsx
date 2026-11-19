/**
 * AgentMatrix.test.tsx — Agent 矩阵卡片布局契约。
 *
 * 覆盖：2 列响应式卡片网格、可用状态点、当前 Agent 标识、版本/路径 title、
 * 32px 卡片操作区、主力切换只写 onSelectAgent、空态不编造卡片。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AgentMatrix } from '../AgentMatrix';
import type { SettingsAgent } from '@/stores/settings-store';

const AGENTS: SettingsAgent[] = [
  {
    id: 'opencode',
    name: 'OpenCode CLI',
    available: true,
    enabled: true,
    path: 'C:/bin/opencode',
    version: '2.0.16',
    transport: 'acp',
    acp: { supported: true },
  },
  {
    id: 'legacy',
    name: 'Legacy CLI',
    available: true,
    enabled: false,
    path: 'C:/bin/legacy',
    version: '1.0.0',
    transport: 'cli',
    acp: { supported: false },
  },
  {
    id: 'missing',
    name: 'Missing CLI',
    available: false,
    enabled: false,
    transport: 'cli',
    acp: { supported: false },
  },
];

afterEach(cleanup);

describe('AgentMatrix 卡片网格', () => {
  it('使用 1 列 / 宽屏 2 列响应式卡片网格，并声明等高行', () => {
    render(React.createElement(AgentMatrix, { agents: AGENTS }));

    const grid = screen.getByTestId('agent-card-grid');
    expect(grid.className).toContain('grid-cols-1');
    expect(grid.className).toContain('@min-[500px]:grid-cols-2');
    expect(grid.className).toContain('auto-rows-fr');
    expect(grid.querySelectorAll('[data-testid^="agent-row-"]')).toHaveLength(2);
  });

  it('卡片含状态点、当前标识、transport/ACP 徽章、路径 title 与 32px 操作区', () => {
    render(React.createElement(AgentMatrix, { agents: AGENTS }));

    const card = screen.getByTestId('agent-row-opencode');
    const actions = screen.getByTestId('agent-card-actions-opencode');

    expect(card.getAttribute('data-current')).toBe('true');
    expect(within(card).getByLabelText('可用')).toBeTruthy();
    expect(within(card).getByText('当前')).toBeTruthy();
    expect(within(card).getAllByText('ACP')).toHaveLength(1);
    expect(within(card).getByTitle('C:/bin/opencode')).toBeTruthy();
    expect(within(card).getByText('C:/bin/opencode').className).toContain('truncate');
    expect(actions.className).toContain('h-8');
    expect(within(actions).getByText('当前主力')).toBeTruthy();
    expect(within(actions).getByText('v2.0.16')).toBeTruthy();

    const legacyCard = screen.getByTestId('agent-row-legacy');
    expect(within(legacyCard).getByText('cli')).toBeTruthy();
    expect(within(legacyCard).queryByText('ACP')).toBeNull();

    const missingCard = screen.getByTestId('agent-row-missing');
    expect(within(missingCard).getByLabelText('未安装')).toBeTruthy();
    expect(within(missingCard).getByText('未检测到安装路径')).toBeTruthy();
  });

  it('开关启用只调用 onSelectAgent；未安装卡片不可操作', () => {
    const onSelectAgent = vi.fn();
    render(React.createElement(AgentMatrix, { agents: AGENTS, onSelectAgent }));

    const legacySwitch = within(screen.getByTestId('agent-row-legacy')).getByRole('switch');
    fireEvent.click(legacySwitch);
    expect(onSelectAgent).toHaveBeenCalledWith('legacy');

    const missingSwitch = within(screen.getByTestId('agent-row-missing')).getByRole('switch') as HTMLButtonElement;
    expect(missingSwitch.disabled).toBe(true);
  });

  it('无 Agent 时显示空态，不渲染占位卡片', () => {
    render(React.createElement(AgentMatrix, { agents: [] }));

    expect(screen.getByTestId('agent-empty').textContent).toContain('未探测到本地 Agent CLI');
    expect(screen.queryByTestId('agent-card-grid')).toBeNull();
  });

  it('ACP 开关与权限模式仍在全局卡片内，权限模式显示中文短标签', () => {
    render(
      React.createElement(AgentMatrix, {
        agents: AGENTS,
        acpEnabled: true,
        permissionMode: 'approve-reads',
      })
    );

    expect(screen.getByLabelText('ACP 开关')).toBeTruthy();
    const permission = screen.getByLabelText('权限模式');
    expect(permission.textContent).toContain('仅批准读取');
  });

  it('权限模式下拉 portal 到 body，三项都渲染且取值语义不变（RETEST-B-SET-P2-1）', () => {
    const onPermissionChange = vi.fn();
    render(
      React.createElement(
        'div',
        { style: { overflow: 'hidden', height: 40 } },
        React.createElement(AgentMatrix, {
          agents: AGENTS,
          acpEnabled: true,
          permissionMode: 'approve-reads',
          onPermissionChange,
        })
      )
    );

    fireEvent.click(screen.getByLabelText('权限模式'));
    const listbox = screen.getByRole('listbox');
    expect(listbox.parentElement).toBe(document.body);

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options.map((option) => option.getAttribute('data-value'))).toEqual([
      'approve-all',
      'approve-reads',
      'deny-all',
    ]);

    // 真实鼠标路径：mousedown 不得卸载浮层，click 提交原值。
    const deny = screen.getByRole('option', { name: /全部拒绝/ });
    fireEvent.mouseDown(deny);
    fireEvent.mouseUp(deny);
    fireEvent.click(deny);
    expect(onPermissionChange).toHaveBeenCalledWith('deny-all');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
