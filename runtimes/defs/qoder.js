'use strict';
/* Wave-D/G: 工厂委托薄垫片（等价原文案，真相源 manifest.json + factory.js；registry接口不变） */
const _qoderBase = require('./factory').create('qoder');

module.exports = {
  ..._qoderBase,
  buildArgs: (prompt, images, extra, options, ctx) => {
    // permissionMode 档位约定（缺省即现状）：仅当 options.permissionMode 为非空字符串时，
    // 透传为 `--permission-mode <值>`（追加；默认 --yolo/-w/--model 装配不动）；不配即逐字保持现状。
    // 注：已读 opendesign/apps/daemon/src/runtimes/defs/qoder.ts，其注释仅确认 --yolo 为文档化非交互旗，
    // 未确认 --permission-mode 原生参数名；此处参数名/取值（default/accept_edits/dont_ask/auto）
    // 依据 docs/CLI权限矩阵.md，待实测。
    const args = _qoderBase.buildArgs(prompt, images, extra, options, ctx);
    const o = (options && typeof options === 'object') ? options : {};
    const pm = (typeof o.permissionMode === 'string' && o.permissionMode.trim()) ? o.permissionMode.trim() : '';
    if (pm) args.push('--permission-mode', pm);
    return args;
  },
};
