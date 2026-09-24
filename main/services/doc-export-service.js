'use strict';
/**
 * main/services/doc-export-service.js — DocExportService（Wave-B）
 * 职责：HTML 逆向解析装配（buildExportHtml）+ 长图无头渲染（capturePage）+ PDF 打印（printToPDF）。
 * 由 DocController（doc:export-long-image / doc:export-pdf）调用。
 *
 * Wave-E 契约补记 (只加注释, 实现不变):
 * @typedef {Object} ExportArgs {title?:string, html:string, width?:number, scale?:number}
 * @typedef {Object} ExportResult {ok:boolean, filePath?:string, error?:string, cancelled?:boolean}
 * @param {ExportArgs} o 导出载荷 (html 必需, title 经 sanitizeExportTitle 清洗)
 * @returns {Promise<ExportResult>} 导出结果 (无头窗口用后即毁, 不留后台窗口)
 */
const path = require('path');
const fs = require('fs');
const { BrowserWindow, dialog } = require('electron');
const shared = require('../state');
const paths = require('../paths');

function sanitizeExportTitle(raw) {
  const s = String(raw == null ? '' : raw).trim() || '文档';
  const clean = s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60);
  return clean || '文档';
}
/* P4 专业交付：导出 HTML 封装（最小白底 body 样式，离线无头渲染用） */
function buildExportHtml(inner) {
  const body = String(inner == null ? '' : inner);
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>html,body{margin:0;padding:0;background:#fff;}'
    + 'body{padding:28px;background:#fff;color:#1f2937;font-family:-apple-system,"Microsoft YaHei",sans-serif;font-size:15px;line-height:1.75;word-break:break-word;}'
    + 'img{max-width:100%;height:auto;}table{border-collapse:collapse;width:100%;margin:12px 0;}'
    + 'th,td{border:1px solid #e5e7eb;padding:8px 10px;text-align:left;}pre{white-space:pre-wrap;word-break:break-all;background:#f8fafc;padding:12px;border-radius:6px;}'
    + 'code{font-family:Consolas,monospace;}blockquote{margin:12px 0;padding:8px 14px;border-left:4px solid #e5e7eb;color:#4b5563;background:#f9fafb;}</style>'
    + '</head><body>' + body + '</body></html>';
}
/* P4 专业交付：doc:export-long-image（隐藏窗口载 data URL，全页 capturePage 写 PNG） */
async function docExportLongImageImpl(ev, o) {
  const o2 = (o && typeof o === 'object') ? o : {};
  const title = sanitizeExportTitle(o2.title);
  const html = String(o2.html == null ? '' : o2.html);
  if (!html) return { ok: false, error: '缺少导出内容' };
  const width = (Number(o2.width) > 0) ? Math.min(2400, Math.max(600, Math.floor(Number(o2.width)))) : 1200;
  const scale = (Number(o2.scale) > 0) ? Math.min(3, Math.max(1, Number(o2.scale))) : 2;
  const parent = BrowserWindow.getFocusedWindow();
  let save = null;
  try {
    const opts = { title: '导出长图', defaultPath: title + '-长图.png', filters: [{ name: 'PNG 图片', extensions: ['png'] }] };
    save = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  if (!save || save.canceled || !save.filePath) return { ok: false, cancelled: true };
  let expWin = null;
  try {
    expWin = new BrowserWindow({
      show: false, width: width, height: 800,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    const full = buildExportHtml(html);
    await expWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(full));
    let contentH = 0;
    try { contentH = await expWin.webContents.executeJavaScript('Math.max(document.body?document.body.scrollHeight:0,document.documentElement?document.documentElement.scrollHeight:0)'); } catch (e) { contentH = 0; }
    contentH = Math.max(200, Math.min(12000, Number(contentH) || 800));
    try { expWin.setSize(width, Math.min(9000, contentH + 40)); } catch (e) {}
    try { expWin.webContents.setZoomFactor(scale); } catch (e) {}
    await new Promise((r) => setTimeout(r, 250));
    const image = await expWin.webContents.capturePage();
    try {
      if (image && typeof image.saveToPNG === 'function') await image.saveToPNG(save.filePath);
      else fs.writeFileSync(save.filePath, image.toPNG());
    } catch (e) { return { ok: false, error: '写入文件失败：' + String(e && e.message || e) }; }
    return { ok: true, filePath: save.filePath };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  finally { try { if (expWin && !expWin.isDestroyed()) expWin.close(); } catch (e) {} expWin = null; }

}
async function docExportPdfImpl(ev, o) {
  const o2 = (o && typeof o === 'object') ? o : {};
  const title = sanitizeExportTitle(o2.title);
  const html = String(o2.html == null ? '' : o2.html);
  if (!html) return { ok: false, error: '缺少导出内容' };
  const parent = BrowserWindow.getFocusedWindow();
  let save = null;
  try {
    const opts = { title: '导出 PDF', defaultPath: title + '.pdf', filters: [{ name: 'PDF 文档', extensions: ['pdf'] }] };
    save = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  if (!save || save.canceled || !save.filePath) return { ok: false, cancelled: true };
  let expWin = null;
  try {
    expWin = new BrowserWindow({
      show: false, width: 1200, height: 800,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    const full = buildExportHtml(html);
    await expWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(full));
    await new Promise((r) => setTimeout(r, 250));
    let pdfData = null;
    try {
      pdfData = await expWin.webContents.printToPDF({ pageSize: 'A4', margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }, printBackground: true });
    } catch (e) { return { ok: false, error: '生成 PDF 失败：' + String(e && e.message || e) }; }
    try { fs.writeFileSync(save.filePath, pdfData); } catch (e) { return { ok: false, error: '写入文件失败：' + String(e && e.message || e) }; }
    return { ok: true, filePath: save.filePath };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  finally { try { if (expWin && !expWin.isDestroyed()) expWin.close(); } catch (e) {} expWin = null; }

}
module.exports = {
  sanitizeExportTitle,
  buildExportHtml,
  docExportLongImageImpl,
  docExportPdfImpl,
};
