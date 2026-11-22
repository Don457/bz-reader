/* ============================================================
 * bz-reader · 漫画排版面板（engine/manga/panel.ts）
 *
 * 2026-11-22 二轮真机反馈：第一版的缩放 / 跳页 / 阅读方式被做成画面里的
 * 悬浮工具条，作者要求「像 PDF 和 EPUB 一样单独做一个排版的界面，其他
 * 功能放右上角图标里」。所以这些控件现在只在头栏「排版」图标弹出的
 * 卡片里，画面里一个浮层都不留。
 *
 * 这里是那张卡片的行序与选项顺序的唯一真源：视图按它渲染，测试按它断言。
 * 与 PDF 的 `engine/pdf/panel.ts` 同一分工（那张是浮条 + 面板，这张只有面板）。
 * ============================================================ */
import type { MangaFit } from './layout';
import type { MangaFlow } from './settings';

/** 面板的行：先「画面」（缩放 / 适配 / 辅助），后「阅读」（方向 / 页面 / 翻页） */
export type MangaPanelRow = 'zoom' | 'fit' | 'assist' | 'direction' | 'pages' | 'flow';

export const MANGA_PANEL_ROWS: readonly MangaPanelRow[] = [
  'zoom',
  'fit',
  'assist',
  'direction',
  'pages',
  'flow',
];

/**
 * 「辅助」那一行的三颗：逐格导览 / 自动裁边 / 一键调色。
 *
 * 2026-11-22 真机第二轮：三项各占一行时卡片要 649px，手机 62vh 只有 520，
 * 最后两行必须滚动才看得见。并成一行之后整张卡 340 上下，一屏能看全，
 * 而且这三项本来就都是「让画面更清楚」的开关，放一起也不违和。
 */
export type MangaAssistItem = 'panels' | 'crop' | 'tone';

export const MANGA_ASSIST_ITEMS: readonly MangaAssistItem[] = ['panels', 'crop', 'tone'];

/**
 * 适配六档。`smart` 排第一：它是默认值，也是唯一会替长条图改判的档
 * （见 layout.ts 的 effectiveFit）。
 */
export const MANGA_FIT_OPTIONS: readonly MangaFit[] = [
  'smart',
  'screen',
  'width',
  'height',
  'fill',
  'original',
];

/** 翻页四档：分页 / 连续向下 / 连续横向 / 条漫长图 */
export const MANGA_FLOW_OPTIONS: readonly MangaFlow[] = [
  'paged',
  'vertical',
  'horizontal',
  'webtoon',
];

/** 阅读方向两档（面板里不出现 auto：按书已经定下来了，再给一档只会让人猜） */
export const MANGA_DIRECTION_OPTIONS: ReadonlyArray<'rtl' | 'ltr'> = ['rtl', 'ltr'];

/**
 * 这一次要渲染哪些行。
 *
 * 「单页 / 跨页」只在分页模式成立：连续向下 / 横向 / 条漫里所有页都在
 * 一条流上，点了也不会有任何变化，留着就是一行点不动的控件。
 */
export function mangaPanelRows(flow: MangaFlow): MangaPanelRow[] {
  return MANGA_PANEL_ROWS.filter((row) => row !== 'pages' || flow === 'paged');
}

/** 缩放百分比：和 PDF 浮条同一个口径（整数 + %） */
export function mangaZoomLabel(zoom: number): string {
  const v = Number.isFinite(zoom) ? zoom : 1;
  return `${Math.round(v * 100)}%`;
}
