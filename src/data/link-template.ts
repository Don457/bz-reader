/* ============================================================
 * bz-reader · 双链模板（data/link-template.ts）
 *
 * 一条划线落到笔记里，有两种形态：
 *   · 导出（整本 / 单条存笔记）：多行 Markdown，可以套 callout 块；
 *   · 复制（单条双链）：`[[书#定位|别名]]` 里那一行显示文字，
 *     只能是一行纯文本——callout 塞不进去，塞进去会把 wikilink 语法撑坏。
 *
 * 两边各有一套**对称的四档模板**（简洁 / 预设 / 预设 / 自定义）：
 *   exportTemplate / exportTemplateCustom 管整本导出，
 *   copyTemplate / copyTemplateCustom 管复制划线；配置独立，互不影响。
 * 模板是**展示层**的枚举与替换，不碰定位、不碰数据：
 * 占位符替换完就交给导出/复制各自的调用方，链接照旧由 wikilink 那层拼。
 * 这样「换模板」和「链接能点回原文」两件事互不牵连。
 * ============================================================ */

/** 导出模板 id，存 settings。custom 用 exportTemplateCustom 的字符串 */
export type ExportTemplateId = 'simple' | 'quote' | 'detail' | 'custom';

const EXPORT_IDS: readonly ExportTemplateId[] = ['simple', 'quote', 'detail', 'custom'];

export function isBuiltinTemplate(v: unknown): v is ExportTemplateId {
  return typeof v === 'string' && (EXPORT_IDS as readonly string[]).includes(v);
}

/** 默认模板：现在的格式，一个字不改——老用户升级后导出长得一模一样 */
export const EXPORT_SIMPLE = '> {双链}\n> ↳ {时间}';

const TEMPLATES: Record<Exclude<ExportTemplateId, 'custom'>, string> = {
  simple: EXPORT_SIMPLE,
  quote: '> [!quote] {书名} · {章节}\n> {双链}\n> ↳ {时间} · {位置}',
  detail: '> [!note] {书名} — {章节} · {位置}\n> {双链}\n> 划线于 {时间}',
};

/** 内置模板正文；custom 返回空串，由调用方读用户字符串 */
export function builtinTemplate(id: ExportTemplateId): string {
  return id === 'custom' ? '' : TEMPLATES[id];
}

/** 别名默认 = 摘录原文，与现在逐字一致 */
export const ALIAS_SIMPLE = '{摘录}';

/**
 * 复制划线的模板 id，存 settings。与导出一样是四档，但内容是单行别名：
 *   simple  摘录原文（= 升级前的行为）
 *   brief   书名 + 章节
 *   detail  书名 + 章节 + 位置 + 时间
 *   custom  用户自定义一行字符串
 */
export type CopyTemplateId = 'simple' | 'brief' | 'detail' | 'custom';

const COPY_IDS: readonly CopyTemplateId[] = ['simple', 'brief', 'detail', 'custom'];

export function isCopyTemplate(v: unknown): v is CopyTemplateId {
  return typeof v === 'string' && (COPY_IDS as readonly string[]).includes(v);
}

/** 复制的简洁档：摘录原文，与升级前逐字一致 */
export const COPY_SIMPLE = ALIAS_SIMPLE;

const COPY_TEMPLATES: Record<Exclude<CopyTemplateId, 'custom'>, string> = {
  simple: COPY_SIMPLE,
  brief: '《{书名}》· {章节}',
  detail: '《{书名}》· {章节} · {位置} · {时间}',
};

/** 内置复制模板正文；custom 返回空串，由调用方读 copyTemplateCustom */
export function builtinCopyTemplate(id: CopyTemplateId): string {
  return id === 'custom' ? '' : COPY_TEMPLATES[id];
}

/** 当前复制模板正文：内置档取模板，自定义档取用户字符串 */
export function copyTemplateText(id: CopyTemplateId, custom: string): string {
  return id === 'custom' ? String(custom ?? '') : builtinCopyTemplate(id);
}

/** 占位符名集中一处，过滤时按名字排，不用记它在数组里的下标 */
const LINK_PLACEHOLDER = '{双链}';

/** 模板可用的占位符（设置页变量按钮按这个顺序展示） */
export const PLACEHOLDERS = ['{书名}', '{作者}', '{章节}', '{位置}', '{时间}', '{摘录}', LINK_PLACEHOLDER] as const;

/** 别名模板可用的占位符：别名嵌在双链里，不能再套一层 {双链} */
export const ALIAS_PLACEHOLDERS = PLACEHOLDERS.filter((p) => p !== LINK_PLACEHOLDER);

/** 模板变量的值：从书 + 划线上下文算出，渲染时按占位符替换 */
export interface TemplateVars {
  title: string;
  author: string;
  chapter: string;
  location: string;
  time: string;
  quote: string;
  link: string;
}

/** 划线的时间戳 → 本地 `YYYY-MM-DD HH:mm`（与现有导出的 stamp 同口径） */
function stamp(ts: number): string {
  /* 0 / 缺省 = 这条划线没有时间（老数据、未落标注的选区）。不能让
     new Date(0) 变成「1970-01-01 08:00」——那是凭空编出来的假时间。 */
  if (!ts) return '';
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '';
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 多行压平、连续空白收一个；摘录来自书页，可能带换行与制表符 */
function oneLine(v: string): string {
  return String(v ?? '').replace(/[ \t]*\n[ \t]*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
}

/** 值按占位符替换。未知占位符原样保留，不吞整条 */
function substitute(tpl: string, vars: TemplateVars, opts: { keepLink: boolean }): string {
  const map: Record<string, string> = {
    '{书名}': oneLine(vars.title),
    '{作者}': oneLine(vars.author),
    '{章节}': oneLine(vars.chapter),
    '{位置}': oneLine(vars.location),
    '{时间}': oneLine(vars.time),
    '{摘录}': oneLine(vars.quote),
    /* 别名本身嵌在 wikilink 里，不能再套一层 `[[...]]`：
       别名模板里出现的 {双链} 直接丢掉，不留方括号。 */
    '{双链}': opts.keepLink ? String(vars.link ?? '').trim() : '',
  };
  return tpl.replace(/\{[^{}]+\}/g, (m) => (m in map ? map[m] : m));
}

/**
 * 导出一条划线。模板为空/全空白 → 回退默认，不导出空行。
 * 保留 {双链}：导出的是完整链接，点文字跳回原文。
 */
export function renderExportItem(template: string, vars: TemplateVars): string {
  const tpl = String(template ?? '');
  if (!tpl.trim()) {
    /* 回退简洁模板：老路径是「有时间才写时间行」，无时间（老划线/选区）
       只写双链一行。回退也必须逐字等价，不能多出一行「> ↳ 」。 */
    return vars.time ? substitute(EXPORT_SIMPLE, vars, { keepLink: true })
      : substitute('> {双链}', vars, { keepLink: true });
  }
  return substitute(tpl, vars, { keepLink: true });
}

/**
 * 渲染一条复制模板（四档里当前那一档的正文字串）。
 * `{双链}` 被丢弃（不能嵌），并把会破坏 wikilink 语法的方括号清掉：
 * `[[书#定位|A|B]]` 里的别名带 `]` 会提前闭合，带换行会断成两段。
 * 空模板回退简洁档——链接显示文字不能是空的。
 */
export function renderCopyItem(template: string, vars: TemplateVars): string {
  const tpl = String(template ?? '').trim() ? String(template) : COPY_SIMPLE;
  const out = substitute(tpl, vars, { keepLink: false })
    .replace(/\[/g, '')
    .replace(/\]/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
  return out || oneLine(vars.quote) || '摘录';
}

/** 旧调用名沿用：复制别名就是当前复制模板渲染出来的那一行 */
export function renderAlias(template: string, vars: TemplateVars): string {
  return renderCopyItem(template, vars);
}

/**
 * 从书 + 划线上下文算出模板变量。
 *
 * 「位置」这一格：PDF 有真实页码，由调用方传 page；EPUB 没有页码，
 * 退回章节名——不编一个假百分比糊弄用户。传了 page 就是 `第 N 页`。
 */
export function templateVarsOf(input: {
  book: { meta: { title: string; author?: string } };
  chapter: string;
  quote: string;
  link: string;
  createdAt?: number;
  page?: number;
}): TemplateVars {
  const { book } = input;
  const chapter = oneLine(input.chapter || '');
  const location = typeof input.page === 'number' && Number.isFinite(input.page)
    ? `第 ${Math.max(1, Math.round(input.page))} 页`
    : chapter;
  return {
    title: oneLine(book.meta.title || ''),
    author: oneLine(book.meta.author || ''),
    chapter,
    location,
    time: stamp(input.createdAt || 0),
    quote: oneLine(input.quote),
    link: String(input.link || ''),
  };
}

/**
 * 设置页预览用的一组固定示例变量。稳定不随时间变——预览不该每次打开
 * 设置就换个时间；真正的导出走 templateVarsOf，读真实划线数据。
 */
export function previewVars(): TemplateVars {
  return {
    title: '示例书名',
    author: '示例作者',
    chapter: '第三章 · 一个示例章节',
    location: '第 118 页',
    time: '2026-11-23 14:05',
    quote: '这是原文里的一段摘录，点一下双链就能跳回书中的这一句。',
    link: '[[示例书名.epub#bzr-cfi=epubcfi(/6/12)|这是原文里的一段摘录]]',
  };
}

/**
 * 单条复制划线时，算出要传给 wikilink 的 display（别名显示文字）。
 *
 * 模板为空 → 返回空串：调用方把它当「没有覆盖」，wikilink 照旧用摘录原文
 * 当别名，行为与升级前逐字一致。有模板 → 渲染成一行别名。
 * `link` 传空即可——别名里 {双链} 会被丢弃，本来也用不上。
 */
export function aliasForCopy(
  template: string,
  book: { meta: { title: string; author?: string } },
  ctx: { chapter: string; quote: string; createdAt?: number; page?: number },
): string {
  if (!String(template ?? '').trim()) return '';
  const vars = templateVarsOf({
    book,
    chapter: ctx.chapter,
    quote: ctx.quote,
    link: '',
    createdAt: ctx.createdAt,
    page: ctx.page,
  });
  return renderAlias(template, vars);
}
