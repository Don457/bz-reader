/* ============================================================
 * bz-reader · 漫画版面算术（engine/manga/layout.ts）
 *
 * 这一层全是纯函数：不碰 DOM、不读图片文件、不算像素坐标。
 * 「哪几张图组成一屏」「分格怎么切、按什么顺序读」「缩放到多大」
 * 都在这里定，视图层只负责把结果画出来。
 *
 * 两条口径，改代码前先看清：
 *  1. `pages` 是**阅读顺序**（先读哪张），`visual` 是**显示顺序**
 *     （从左到右摆哪张）。日漫右到左时两者相反；进度、书签、定位
 *     一律锚在 `pages` 与原图序号上，拆页/合页不改存档。
 *  2. 分格认不准就返回空数组，让视图退回整页——错格比没有更糟
 *     （AGENTS.md 里离线时间轴那次踩过同一个坑）。
 * ============================================================ */

export type MangaDirection = 'rtl' | 'ltr';

/** 一屏里的一格：拆出来的半页仍锚在同一张原图上 */
export type MangaHalf = 'full' | 'left' | 'right';

export interface MangaPage {
  name: string;
  width: number;
  height: number;
}

export interface MangaScreen {
  /** 阅读顺序：这批图里先读哪张（原图序号） */
  pages: number[];
  /** 显示顺序：从左到右摆哪张 */
  visual: number[];
  /** 与 pages 一一对应：这一屏里的每张图是整幅还是半幅 */
  halves: MangaHalf[];
  /**
   * 与 visual 一一对应的显示单元（2026-11-22）。
   *
   * 宽跨页图拆成两半之后，同一张原图会在**一屏里出现两次**（左右各一格）。
   * 视图层原来靠 `pages.indexOf(page)` 反查 half，重复时永远拿到第一个，
   * 两个格子都按「右半」画；`cells` 又按 page 索引，后一格把前一格覆盖掉，
   * 落单的那格按原图 1200px 撑爆视口（真机双页截图）。带着这个数组走，
   * 一半一格，谁也不覆盖谁。
   */
  units: Array<{ page: number; half: MangaHalf }>;
}

export interface SpreadOptions {
  direction: MangaDirection;
  /** 双页合页 */
  spread: boolean;
  /** 宽的跨页扫描图自动拆成两个半页 */
  splitWide: boolean;
  /** 封面单独占一屏，保证 2-3、4-5 不错开一页 */
  coverAlone: boolean;
  /** 配对错开时手动移一格 */
  offset: number;
  /** 宽高比超过它就当跨页图（默认 1.4） */
  wideRatio: number;
  /** 条漫：全卷拼成一条，页间不留空隙 */
  webtoon: boolean;
}

export const DEFAULT_SPREAD: SpreadOptions = {
  direction: 'rtl',
  spread: false,
  splitWide: true,
  coverAlone: true,
  offset: 0,
  wideRatio: 1.4,
  webtoon: false,
};

/** 归一化矩形（0..1，相对原图） */
export interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * 自然序比较：把字符串拆成「数字段 / 非数字段」，数字按数值比。
 * 直接字符串排序会把 p10.jpg 排到 p2.jpg 前面，一整卷顺序全乱。
 */
export function naturalCompare(a: string, b: string): number {
  const re = /(\d+|\D+)/g;
  const x = String(a).match(re) ?? [];
  const y = String(b).match(re) ?? [];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i += 1) {
    const ax = x[i];
    const by = y[i];
    const an = /^\d+$/.test(ax);
    const bn = /^\d+$/.test(by);
    if (an && bn) {
      const d = Number(ax) - Number(by);
      if (d) return d < 0 ? -1 : 1;
    } else if (ax !== by) {
      return ax < by ? -1 : 1;
    }
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

export function sortPageNames(names: readonly string[]): string[] {
  return [...names].sort(naturalCompare);
}

interface Unit {
  page: number;
  half: MangaHalf;
}

/**
 * 把原图序列拆成「显示单元」：一张图一格，跨页宽图拆成左右两格。
 * 右到左时右半先读——与 prose-reader 的 RTL 跨页拆分同口径。
 */
function unitsOf(pages: readonly MangaPage[], o: SpreadOptions): Unit[] {
  const out: Unit[] = [];
  pages.forEach((p, i) => {
    const wide = o.splitWide && p.height > 0 && p.width / p.height >= o.wideRatio;
    if (!wide) {
      out.push({ page: i, half: 'full' });
      return;
    }
    if (o.direction === 'rtl') {
      out.push({ page: i, half: 'right' }, { page: i, half: 'left' });
    } else {
      out.push({ page: i, half: 'left' }, { page: i, half: 'right' });
    }
  });
  return out;
}

function screenOf(units: readonly Unit[], direction: MangaDirection): MangaScreen {
  const pages = units.map((u) => u.page);
  const halves = units.map((u) => u.half);
  /* 只有双页合页才需要对调显示顺序；单页与拆出来的半页不涉及左右关系 */
  const shown = direction === 'rtl' && units.length > 1 ? [...units].reverse() : [...units];
  return {
    pages,
    visual: shown.map((u) => u.page),
    halves,
    units: shown.map((u) => ({ page: u.page, half: u.half })),
  };
}

/**
 * 组屏。三条真机教训写进规则里（与 engine/pdf/layout.ts 同一套）：
 *  · 封面单独占一屏，否则跨页扫描件从第 2 页起整本错开一页；
 *  · 翻页按屏跳，双页一次跳两格，不能把另一页当场跳过；
 *  · 配对错了可以移一格校正，不用重排整本。
 */
export function buildScreens(pages: readonly MangaPage[], o: SpreadOptions): MangaScreen[] {
  if (!pages.length) return [];
  const units = unitsOf(pages, o);
  if (o.webtoon) return [screenOf(units, o.direction)];
  if (!o.spread) return units.map((u) => screenOf([u], o.direction));

  /* 配对相位：封面单独算一格，offset 让用户手动移一格 */
  const phase = ((o.coverAlone ? 1 : 0) + Math.trunc(o.offset)) % 2;
  const lead = phase === 1 ? 1 : 0;
  const out: MangaScreen[] = [];
  let i = 0;
  while (i < lead && i < units.length) {
    out.push(screenOf([units[i]], o.direction));
    i += 1;
  }
  while (i < units.length) {
    const rest = units.slice(i, i + 2);
    out.push(screenOf(rest, o.direction));
    i += rest.length;
  }
  return out;
}

/** 原图序号落在第几屏（0 基）；拆半页时取第一次出现的那一屏 */
export function screenOfPage(screens: readonly MangaScreen[], page: number): number {
  const at = screens.findIndex((s) => s.pages.includes(page));
  return at < 0 ? 0 : at;
}

export function turnScreen(cur: number, total: number, dir: 1 | -1): number {
  const last = Math.max(1, Math.floor(total));
  return clamp(Math.floor(cur) + dir, 0, last - 1);
}

/**
 * 连续白行（或白列）切成「内容带」。
 * whiteness[i] 是第 i 行/列里接近纯白的像素占比，阈值以上算白沟；
 * 短于 minGap 的白带只是网点/网点噪点，不能当分格边界。
 */
export function detectBands(
  whiteness: readonly number[],
  threshold = 0.9,
  minGap = 3,
): Array<[number, number]> {
  const bands: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < whiteness.length; i += 1) {
    const white = whiteness[i] >= threshold;
    if (!white && start < 0) start = i;
    if (!white || i < whiteness.length - 1) continue;
    /* 到了内容段末尾：收带 */
    bands.push([start, i + 1]);
    start = -1;
  }
  /* 上面只处理「末尾即数组末尾」的情况，统一在这里按白带切更稳 */
  bands.length = 0;
  let inkStart = -1;
  let gapStart = -1;
  for (let i = 0; i <= whiteness.length; i += 1) {
    const white = i < whiteness.length && whiteness[i] >= threshold;
    if (white) {
      if (gapStart < 0) gapStart = i;
      continue;
    }
    if (gapStart >= 0) {
      const gapLen = i - gapStart;
      if (gapLen >= minGap && inkStart >= 0) {
        bands.push([inkStart, gapStart]);
        inkStart = -1;
      }
      gapStart = -1;
    }
    if (i >= whiteness.length) break;
    if (inkStart < 0) inkStart = i;
  }
  if (inkStart >= 0) bands.push([inkStart, whiteness.length]);
  return bands;
}

const MAX_BANDS = 12;
const MAX_PANELS = 24;

/**
 * 轻量分格检测：先按横向白沟分行，再在每一行里按竖向白沟分格。
 *
 * 输入是采样后的白度投影（视图层用 canvas 缩到 100×100 再统计），
 * 不是整张高清图——手机上大画布会静默白屏（见 pdf/document.ts）。
 * 切出太多格、或整页没有内容，一律返回空：视图退回整页模式。
 */
export function detectPanels(
  rowWhite: readonly number[],
  colWhite: readonly number[],
  w: number,
  h: number,
  threshold = 0.9,
): PanelRect[] {
  const rows = detectBands(rowWhite, threshold, 1);
  if (!rows.length || rows.length > MAX_BANDS) return [];
  const out: PanelRect[] = [];
  for (const [y0, y1] of rows) {
    const cols = detectBands(colWhite, threshold, 1);
    if (!cols.length || cols.length > MAX_BANDS) return [];
    for (const [x0, x1] of cols) {
      if (x1 - x0 < 2 || y1 - y0 < 2) return [];
      out.push({
        x: x0 / Math.max(1, w),
        y: y0 / Math.max(1, h),
        w: (x1 - x0) / Math.max(1, w),
        h: (y1 - y0) / Math.max(1, h),
      });
    }
  }
  if (!out.length || out.length > MAX_PANELS) return [];
  return out;
}

/**
 * 分格阅读顺序：按 y 聚成行，行内日漫从右往左、美漫从左往右。
 * 同一行里跨行的大格不按 x 硬插到别的行，避免把下一行提前剧透。
 */
export function panelOrder(rects: readonly PanelRect[], direction: MangaDirection): number[] {
  const idx = rects.map((_, i) => i);
  const minH = rects.reduce((m, r) => Math.min(m, r.h), 1);
  const tol = Math.max(0.02, minH * 0.4);
  const sorted = [...idx].sort((a, b) => rects[a].y - rects[b].y || rects[a].x - rects[b].x);
  const rows: number[][] = [];
  let rowY = Number.NaN;
  for (const i of sorted) {
    if (!rows.length || Math.abs(rects[i].y - rowY) > tol) {
      rows.push([i]);
      rowY = rects[i].y;
    } else {
      rows[rows.length - 1].push(i);
    }
  }
  const out: number[] = [];
  for (const row of rows) {
    row.sort((a, b) => (direction === 'rtl' ? rects[b].x - rects[a].x : rects[a].x - rects[b].x));
    out.push(...row);
  }
  return out;
}

/** 四周整体白边（单位是采样格）；页内的白格不算，只裁外圈 */
export function cropInsets(
  rowWhite: readonly number[],
  colWhite: readonly number[],
  threshold = 0.9,
): { top: number; bottom: number; left: number; right: number } {
  const edge = (arr: readonly number[]): [number, number] => {
    let a = 0;
    let b = 0;
    while (a < arr.length && arr[a] >= threshold) a += 1;
    while (b < arr.length - a && arr[arr.length - 1 - b] >= threshold) b += 1;
    return [a, b];
  };
  const [top, bottom] = edge(rowWhite);
  const [left, right] = edge(colWhite);
  return { top, bottom, left, right };
}

export type MangaFit = 'screen' | 'width' | 'height' | 'fill' | 'original' | 'smart';

export function fitScale(fit: MangaFit, imgW: number, imgH: number, viewW: number, viewH: number): number {
  const w = Math.max(1, imgW);
  const h = Math.max(1, imgH);
  const byW = viewW / w;
  const byH = viewH / h;
  switch (fit) {
    case 'width': return byW;
    case 'height': return byH;
    case 'fill': return Math.max(byW, byH);
    case 'original': return 1;
    case 'smart': return Math.min(1, Math.min(byW, byH));
    case 'screen':
    default: return Math.min(byW, byH);
  }
}

/**
 * 长条图（整话一张 700×50000 的竖图）在 smart 下会被「整页装进视口」
 * 压成一条几像素宽的线。这类图按宽度铺、交给拖动看下半截，才是能读的。
 */
export function effectiveFit(fit: MangaFit, imgW: number, imgH: number): MangaFit {
  if (fit !== 'smart') return fit;
  if (!(imgW > 0) || !(imgH > 0)) return fit;
  return imgW / imgH < 1 / 6 ? 'width' : fit;
}

/** 放大后能拖动的边界：图片比视口小的时候不许拖出空白 */
export function clampPan(
  x: number, y: number, scale: number,
  imgW: number, imgH: number, viewW: number, viewH: number,
): { x: number; y: number } {
  const mx = Math.max(0, (imgW * scale - viewW) / 2);
  const my = Math.max(0, (imgH * scale - viewH) / 2);
  return { x: clamp(x, -mx, mx), y: clamp(y, -my, my) };
}

/** 亮度 / 对比度走 CSS，gamma 走注入到书页文档的 SVG 滤镜 */
export function filterCss(brightness: number, contrast: number, gamma: number): string {
  const parts: string[] = [];
  if (brightness !== 1) parts.push(`brightness(${brightness})`);
  if (contrast !== 1) parts.push(`contrast(${contrast})`);
  if (gamma !== 1) parts.push('url(#bzr-manga-gamma)');
  return parts.join(' ');
}

/** 定位串：`manga/<原图序号>[/<分格序号>]` */
export function mangaLocator(page: number, panel?: number): string {
  const p = Math.max(0, Math.floor(page));
  return typeof panel === 'number' && panel >= 0 ? `manga/${p}/${Math.floor(panel)}` : `manga/${p}`;
}

export function parseMangaLocator(loc: string): { page: number; panel: number } | null {
  const m = /^manga\/(\d+)(?:\/(\d+))?$/.exec(String(loc ?? ''));
  if (!m) return null;
  return { page: Number(m[1]), panel: m[2] === undefined ? -1 : Number(m[2]) };
}

/** ComicInfo.xml 的 Manga 字段：YesAndRightToLeft 才是日漫方向 */
export function readingDirectionFromComicInfo(xml: string): MangaDirection | null {
  const m = /<Manga>\s*([^<]*?)\s*<\/Manga>/i.exec(String(xml ?? ''));
  if (!m) return null;
  const v = m[1].trim().toLowerCase();
  if (v === 'yesandrighttoleft') return 'rtl';
  if (v === 'yes' || v === 'no') return 'ltr';
  return null;
}
