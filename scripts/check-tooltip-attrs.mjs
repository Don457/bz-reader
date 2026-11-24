/* ============================================================
 * 禁止悬停气泡属性（scripts/check-tooltip-attrs.mjs）
 *
 * Obsidian 会把 aria-label / title / setTooltip 变成悬停气泡——指针一移入就冒，
 * 用户看着像「莫名其妙的小弹窗」。本脚本扫 src/ 下所有 TS，发现这些属性写到
 * DOM 上就报错退出；读屏名字一律改用视觉隐藏文本（srText / .bzrv-sr-only）。
 *
 * 数据对象的 .title 字段（book.title / meta.title 等）不算，只拦 DOM 写法：
 *   · 模板字符串里的 aria-label="..." / title="..."
 *   · el.setAttribute('aria-label'|'title', ...)
 *   · el.title = ... / el.setAttribute('title', ...)
 *   · .setTooltip(...)
 *
 * 2026-11-24 起唯一例外：src/view/header-tooltip.ts 是头栏图标气泡的合法入口，
 * 只在该文件里放行 setTooltip（aria-label / title 仍照拦）。
 * 放行按「文件 + 写法」两道判据，避免一处开口变成整仓免检。
 * 用法：node scripts/check-tooltip-attrs.mjs   （退出码 0=干净，1=有违规）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'src');
/** 唯一允许调用 setTooltip 的文件（相对仓库根，正斜杠） */
const SET_TOOLTIP_ALLOW = 'src/view/header-tooltip.ts';

/**
 * 给定源码文本，返回违规行号与命中片段。纯函数，供测试直接调用。
 * @param code 源码文本
 * @param file 相对仓库根的文件路径；仅 SET_TOOLTIP_ALLOW 会放行 setTooltip
 */
export function findTooltipAttrs(code, file = '') {
  const hits = [];
  const normalized = String(file).replace(/\\/g, '/');
  const allowSetTooltip = normalized === SET_TOOLTIP_ALLOW;
  const lines = code.split('\n');
  // DOM 元素变量命名习惯：以 el / btn / node / input / title 等结尾的接收者。
  // 为避免误伤 book.title / meta.title 等数据字段，只在明确的 DOM 写法上下手。
  const rules = [
    { re: /\bsetAttribute\(\s*['"](?:aria-label|title)['"]\s*,/, why: 'setAttribute tooltip attr' },
    /* setTooltip 两种写法都拦：obsidian 全局函数 setTooltip(el, t) 与组件方法
       btn.setTooltip(t)。放行文件里两种都放行。 */
    { re: /(?<![\w])setTooltip\s*\(/, why: 'setTooltip', skip: allowSetTooltip },
    { re: /['"]aria-label['"]\s*:/, why: 'aria-label object key' },
    // 前面不是点号/连字符，且等号后紧跟引号：只认 HTML 属性写法，
    // 避免误伤 book.title = 'x' 和 data-title="..." 这类数据字段。
    { re: /(?<![\w-])(?:aria-label|title)=["'`]/, why: 'HTML tooltip attr' },
    // DOM 元素的 .title = value（如 mark.title = annot.contents）。
    // 只认常见元素变量名，避免误伤 book.meta.title / prev.title 等数据字段。
    { re: /\b(?:el|node|mark|btn|button|div|span|input|element|anchor|img|label|titleEl)\.title\s*=/, why: 'DOM .title assignment' },
  ];
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    for (const r of rules) {
      if (r.skip) continue;
      if (r.re.test(line)) hits.push({ line: idx + 1, why: r.why, text: trimmed });
    }
  });
  return hits;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const violations = [];
for (const f of walk(SRC)) {
  const rel = path.relative(process.cwd(), f).replace(/\\/g, '/');
  const hits = findTooltipAttrs(fs.readFileSync(f, 'utf8'), rel);
  for (const h of hits) violations.push({ file: rel, ...h });
}

if (violations.length) {
  console.error(`发现 ${violations.length} 处悬停气泡属性（aria-label / title / setTooltip）：`);
  for (const v of violations) console.error(`  ${v.file}:${v.line}  [${v.why}]  ${v.text}`);
  console.error('气泡只有 src/view/header-tooltip.ts 一处合法入口；其余改用视觉隐藏文本（srText / .bzrv-sr-only）。');
  process.exit(1);
}
console.log('悬停气泡属性检查通过：除 src/view/header-tooltip.ts 外，src/ 下无 aria-label / title / setTooltip 的 DOM 写法。');
