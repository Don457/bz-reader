/* ============================================================
 * bz-reader · 双链模板（data/link-template.ts）
 *
 * 一条划线落到笔记里，有两种出口：整本导出、单条复制到剪贴板。
 * 两边共用同一套四档模板引擎（简洁 / callout 引文 / callout 详细 / 自定义），
 * 都支持多行 Markdown 与 Obsidian callout，{双链} 照常渲染成可点链接；
 * 只有配置分开：exportTemplate* 管导出，copyTemplate* 管复制。
 *
 * 模板是**展示层**的枚举与替换，不碰定位、不碰数据：
 * 占位符替换完交给各自调用方，链接照旧由 wikilink 那层拼。
 * 这样「换模板」和「链接能点回原文」两件事互不牵连。
 * ============================================================ */

import { t } from '../i18n';

/** 模板 id——导出与复制用的是同一组四档。custom 读各自的 Custom 字符串 */
export type ExportTemplateId = 'simple' | 'quote' | 'detail' | 'custom';
export type CopyTemplateId = ExportTemplateId;

const TEMPLATE_IDS: readonly ExportTemplateId[] = ['simple', 'quote', 'detail', 'custom'];

export function isBuiltinTemplate(v: unknown): v is ExportTemplateId {
  return typeof v === 'string' && (TEMPLATE_IDS as readonly string[]).includes(v);
}

/** 复制档与导出档是同一组 id，校验口径也完全一致 */
export const isCopyTemplate = isBuiltinTemplate;

/** 默认模板：现在的格式，一个字不改——老用户升级后导出长得一模一样 */
export const EXPORT_SIMPLE = '> {双链}\n> ↳ {时间}';

/**
 * 内置模板正文。现取而不是常量表：`划线于` 要跟着界面语言走，
 * 模块加载时就定死的话，切完语言得重启才生效。
 */
function builtinOf(id: Exclude<ExportTemplateId, 'custom'>): string {
  if (id === 'simple') return EXPORT_SIMPLE;
  if (id === 'quote') return '> [!quote] {书名} · {章节}\n> {双链}\n> ↳ {时间} · {位置}';
  return `> [!note] {书名} — {章节} · {位置}\n> {双链}\n> ${t('export.markedAt', { time: '{时间}' })}`;
}

/** 内置模板正文；custom 返回空串，由调用方读用户的自定义字符串 */
export function builtinTemplate(id: ExportTemplateId): string {
  return id === 'custom' ? '' : builtinOf(id);
}

/** 复制侧的内置模板：与导出逐字相同 */
export const builtinCopyTemplate = builtinTemplate;

/** 当前模板正文：内置档取模板，自定义档取用户字符串（可多行） */
export function copyTemplateText(id: CopyTemplateId, custom: string): string {
  return id === 'custom' ? String(custom ?? '') : builtinTemplate(id);
}

/** 模板可用的占位符（设置页变量按钮按这个顺序展示，两边一致） */
export const PLACEHOLDERS = ['{书名}', '{作者}', '{章节}', '{位置}', '{时间}', '{摘录}', '{双链}'] as const;

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

/** 多行压平、连续空白收一个；书名 / 章节这类单行字段用它 */
function oneLine(v: string): string {
  return String(v ?? '').replace(/[ \t]*\n[ \t]*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * 清掉空值留下的残迹：值空掉后连着两个分隔符（`↳  · 第三章`）、
 * 行尾多余分隔符、整行只剩「↳」前缀。
 *
 * 只处理这几种明确的空值形态，不碰用户正文。内置档的「位置与章节同值」
 * 由 builtinVariant 从模板层解决——事后按章节名全局删会误伤标题。
 */
function tidy(rendered: string): string {
  return rendered
    .split('\n')
    .map((line) => line
      .replace(/[ \t]*[·—][ \t]*(?=[·—]|$)/g, '')
      .replace(/[ \t]+$/g, ''))
    .filter((line) => !/^>?\s*↳\s*$/.test(line))
    .join('\n');
}

/** 值按占位符替换。未知占位符原样保留，不吞整条 */
function substitute(tpl: string, vars: TemplateVars): string {
  const map: Record<string, string> = {
    '{书名}': oneLine(vars.title),
    '{作者}': oneLine(vars.author),
    '{章节}': oneLine(vars.chapter),
    /* EPUB 没有真实页码，退回章节名——不编一个假百分比糊弄用户 */
    '{位置}': oneLine(vars.location),
    '{时间}': oneLine(vars.time),
    /* 默认压平；引用块里的那一行在下面换成续好 `>` 的多行版 */
    '{摘录}': oneLine(vars.quote),
    '{双链}': String(vars.link ?? '').trim(),
  };
  /* {摘录} 按它所在那一行决定：在引用块里就续上 `>` 保住结构，
     不在引用块里压成一行（自定义模板要放多行原文的前提是不破坏 Markdown） */
  const quoted = String(vars.quote ?? '').trim().replace(/\n/g, '\n> ');
  const rendered = tpl
    .split('\n')
    .map((line) => {
      const local = /^\s*>/.test(line) ? { ...map, '{摘录}': quoted } : map;
      return line.replace(/\{[^{}]+\}/g, (m) => (m in local ? local[m] : m));
    })
    .join('\n');
  return tidy(rendered);
}

/**
 * 渲染一条划线。模板为空/全空白 → 回退默认，不导出空行。
 * {双链} 照常替换成完整链接，多行与 callout 原样保留——两边完全同一口径。
 */
export function renderExportItem(template: string, vars: TemplateVars): string {
  const raw = String(template ?? '');
  const id = builtinIdOf(raw);
  if (id) return substitute(builtinVariant(id, vars), vars);
  if (!raw.trim()) {
    /* 回退简洁模板：老路径是「有时间才写时间行」，无时间（老划线/选区）
       只写双链一行。回退也必须逐字等价，不能多出一行「> ↳ 」。 */
    return vars.time ? substitute(EXPORT_SIMPLE, vars)
      : substitute('> {双链}', vars);
  }
  return substitute(raw, vars);
}

/** 这段模板是不是某个内置档的原文（自定义档不参与） */
function builtinIdOf(text: string): Exclude<ExportTemplateId, 'custom'> | null {
  for (const id of ['simple', 'quote', 'detail'] as const) {
    if (builtinOf(id) === text) return id;
  }
  return null;
}

/**
 * 内置档按这条划线的实际情况取变体。
 *
 * 两处只在有值时才写：老划线没有时间、EPUB 没有页码（位置退回章节名，
 * 和标题里的章节名重复）。拼成一段固定文案再事后删，删不干净还会误伤标题。
 */
function builtinVariant(
  id: Exclude<ExportTemplateId, 'custom'>,
  vars: TemplateVars,
): string {
  if (id === 'simple') return EXPORT_SIMPLE;
  const hasTime = !!vars.time;
  const hasLoc = !!vars.location && vars.location !== vars.chapter;
  const tail = [hasTime ? '{时间}' : '', hasLoc ? '{位置}' : ''].filter(Boolean).join(' · ');
  if (id === 'quote') {
    return [
      '> [!quote] {书名} · {章节}',
      '> {双链}',
      ...(tail ? [`> ↳ ${tail}`] : []),
    ].join('\n');
  }
  return [
    `> [!note] {书名} — {章节}${hasLoc ? ' · {位置}' : ''}`,
    '> {双链}',
    ...(hasTime ? [`> ${t('export.markedAt', { time: '{时间}' })}`] : []),
  ].join('\n');
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
    ? t('export.page', { n: Math.max(1, Math.round(input.page)) })
    : chapter;
  return {
    title: oneLine(book.meta.title || ''),
    author: oneLine(book.meta.author || ''),
    chapter,
    location,
    time: stamp(input.createdAt || 0),
    quote: String(input.quote ?? '').trim(),
    link: String(input.link || ''),
  };
}

/**
 * 设置页预览用的一组固定示例变量。稳定不随时间变——预览不该每次打开
 * 设置就换个时间；真正的渲染走 templateVarsOf，读真实划线数据。
 */
export function previewVars(): TemplateVars {
  const title = t('export.previewTitle');
  const chapter = t('export.previewChapter');
  const quote = t('export.previewQuote');
  return {
    title,
    author: t('export.previewAuthor'),
    chapter,
    location: t('export.page', { n: 118 }),
    time: '2026-11-23 14:05',
    quote,
    link: `[[${title}.epub#bzr-cfi=epubcfi(/6/12)|${quote}]]`,
  };
}
