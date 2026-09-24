const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const jsDir = path.join(ROOT, 'js');
const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
const html = fs.readFileSync(path.join(ROOT, '原型+文档.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'app.css'), 'utf8');
const mainJs = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');

const jsMap = {};
jsFiles.forEach(f => {
  jsMap[f] = fs.readFileSync(path.join(jsDir, f), 'utf8');
});

console.log('================================================================');
console.log('                  DEEP CODEBASE AUDIT REPORT                    ');
console.log('================================================================\n');

// 1. Function definition vs usage
console.log('--- 1. FUNCTION DEFINITIONS & CALLS IN JS FILES ---');
const definedFunctions = [];
const funcDefRegex = /function\s+([a-zA-Z0-9_$]+)\s*\(/g;
let m;
for (const [file, content] of Object.entries(jsMap)) {
  while ((m = funcDefRegex.exec(content)) !== null) {
    definedFunctions.push({ name: m[1], file });
  }
}

const allJsJoined = Object.values(jsMap).join('\n') + '\n' + html;

definedFunctions.forEach(({ name, file }) => {
  // count occurrences
  const regex = new RegExp('\\b' + name + '\\b', 'g');
  const count = (allJsJoined.match(regex) || []).length;
  if (count <= 1) {
    console.log(`[Uncalled/Unused function] "${name}" in js/${file} (count: ${count})`);
  }
});

// 2. LinkBind inspection
console.log('\n--- 2. LINK-BIND & LINKS SYSTEM INSPECTION ---');
console.log('Checking LinkBind methods:');
const linkBindCode = jsMap['link-bind.js'];
const returnMatch = linkBindCode.match(/return\s*\{([\s\S]*?)\};/);
if (returnMatch) {
  const exposed = returnMatch[1].split('\n').map(l => l.trim()).filter(Boolean);
  exposed.forEach(exp => {
    console.log('  LinkBind exported:', exp);
  });
}

// 3. Check calls to LinkBind methods in other files
console.log('\nCalls to LinkBind.* across codebase:');
const lbCallRegex = /LinkBind\.([a-zA-Z0-9_$]+)/g;
const lbCalls = new Set();
while ((m = lbCallRegex.exec(allJsJoined)) !== null) {
  lbCalls.add(m[1]);
}
console.log('LinkBind methods called:', [...lbCalls]);

// 4. Check links:read and links:write in main.js and frontend
console.log('\n--- 3. LINKS & ANNOTATIONS DATA FLOW ---');
console.log('links:read / links:write occurrences:');
['js/project-ai-export.js', 'js/sandbox-core.js', 'main.js', 'preload.js'].forEach(f => {
  const c = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const count = (c.match(/links/g) || []).length;
  console.log(`  ${f}: "links" mentions = ${count}`);
});

// 5. Check CSS classes and selectors used in JS vs app.css vs HTML
console.log('\n--- 4. DOM & CSS CLASS CONSISTENCY ---');
const classInJsRegex = /classList\.(?:add|remove|toggle|contains)\(\s*['"]([^'"]+)['"]/g;
const jsClasses = new Set();
while ((m = classInJsRegex.exec(allJsJoined)) !== null) {
  jsClasses.add(m[1]);
}
console.log('Classes manipulated in JS:', [...jsClasses].sort());

// 6. Check main.js handles & IPC parameters
console.log('\n--- 5. IPC HANDLERS & ARGUMENTS ANALYSIS ---');
const handles = [];
const handleSigRegex = /ipcMain\.handle\(\s*['"]([^'"]+)['"]\s*,\s*(?:async\s*)?\(([^)]*)\)/g;
while ((m = handleSigRegex.exec(mainJs)) !== null) {
  handles.push({ channel: m[1], args: m[2].trim() });
}
handles.forEach(h => {
  console.log(`  ipcMain.handle('${h.channel}', (${h.args}))`);
});

// 7. Check if any variables/functions in window are accessed before defined
console.log('\n--- 6. HTML SCRIPT DEPENDENCY & LOAD ORDER ---');
const scriptTags = [...html.matchAll(/<script[^>]*src=['"]([^'"]+)['"]/g)].map(m => m[1]);
console.log('Script tag load order in 原型+文档.html:');
scriptTags.forEach((s, idx) => console.log(`  ${idx + 1}. ${s}`));

const exportScriptsMatch = jsMap['project-ai-export.js'].match(/EXPORT_SCRIPT_FILES\s*=\s*\[([^\]]+)\]/);
if (exportScriptsMatch) {
  console.log('EXPORT_SCRIPT_FILES in project-ai-export.js:');
  console.log(' ', exportScriptsMatch[1].trim());
}

