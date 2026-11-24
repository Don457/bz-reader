/* ============================================================
 * bz-reader · 漫画偏好（engine/manga/settings.ts）
 *
 * 全局一份默认值，按书覆盖的那部分存在 ReaderBook.mangaView。
 * 这里只做「夹范围 + 认白名单」：设置页拖出来的值、手改坏的 JSON、
 * 旧版本缺字段，都要先过这一层才能进渲染，否则一个 NaN 就能让整屏空白。
 * ============================================================ */
import type { MangaDirection, MangaFit } from './layout';

/** auto = 先看压缩包里的 ComicInfo.xml，没有就按日漫右到左 */
export type MangaDirectionPref = 'auto' | MangaDirection;
export type MangaFlow = 'paged' | 'vertical' | 'horizontal' | 'webtoon';

export interface MangaPrefs {
  direction: MangaDirectionPref;
  spread: boolean;
  splitWide: boolean;
  coverAlone: boolean;
  /** 双页配对错开时手动移一格 */
  offset: number;
  flow: MangaFlow;
  fit: MangaFit;
  /** 逐格导览 */
  panels: boolean;
  /** 自动裁白边 */
  crop: boolean;
  /** 手动放大倍数，1 = 适配档算出来的大小 */
  zoom: number;
  brightness: number;
  contrast: number;
  gamma: number;
  /** 空串 = 跟随宿主主题；否则是一段 CSS 颜色 */
  background: string;
  /** 点按分区左右翻转（有人习惯点左边往后） */
  tapReverse: boolean;
  /** 缩略图带 */
  thumbs: boolean;
}

export const DEFAULT_MANGA_PREFS: MangaPrefs = {
  direction: 'auto',
  spread: false,
  splitWide: true,
  coverAlone: true,
  offset: 0,
  flow: 'paged',
  fit: 'smart',
  panels: false,
  crop: false,
  zoom: 1,
  brightness: 1,
  contrast: 1,
  gamma: 1,
  background: '',
  tapReverse: false,
  thumbs: false,
};

/** 按书记住的那部分：只记「这本书跟全局不一样」的几项 */
export interface MangaViewState {
  direction?: MangaDirectionPref;
  spread?: boolean;
  flow?: MangaFlow;
  fit?: MangaFit;
  zoom?: number;
  /** 上次读到第几张原图（0 基） */
  page?: number;
  /** 逐格导览读到第几格；-1 = 整页 */
  panel?: number;
  /** 双页配对手动校正 */
  offset?: number;
}

const FITS: MangaFit[] = ['screen', 'width', 'height', 'fill', 'original', 'smart'];
const FLOWS: MangaFlow[] = ['paged', 'vertical', 'horizontal', 'webtoon'];
const DIRS: MangaDirectionPref[] = ['auto', 'rtl', 'ltr'];

function finite(n: unknown, fallback: number, lo: number, hi: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

export function normalizeMangaPrefs(raw: unknown): MangaPrefs {
  const p = (raw ?? {}) as Partial<MangaPrefs>;
  const d = DEFAULT_MANGA_PREFS;
  return {
    direction: DIRS.includes(p.direction as MangaDirectionPref) ? (p.direction as MangaDirectionPref) : d.direction,
    spread: p.spread === true,
    splitWide: p.splitWide !== false,
    coverAlone: p.coverAlone !== false,
    offset: Math.round(finite(p.offset, 0, -1, 1)),
    flow: FLOWS.includes(p.flow as MangaFlow) ? (p.flow as MangaFlow) : d.flow,
    fit: FITS.includes(p.fit as MangaFit) ? (p.fit as MangaFit) : d.fit,
    panels: p.panels === true,
    crop: p.crop === true,
    zoom: finite(p.zoom, 1, 0.25, 8),
    brightness: finite(p.brightness, 1, 0.2, 2.5),
    contrast: finite(p.contrast, 1, 0.2, 2.5),
    gamma: finite(p.gamma, 1, 0.3, 3),
    background: typeof p.background === 'string' ? p.background.slice(0, 40) : '',
    tapReverse: p.tapReverse === true,
    thumbs: p.thumbs === true,
  };
}

export function normalizeMangaView(raw: unknown): MangaViewState {
  const v = (raw ?? {}) as Partial<MangaViewState>;
  const out: MangaViewState = {};
  if (DIRS.includes(v.direction as MangaDirectionPref)) out.direction = v.direction;
  if (typeof v.spread === 'boolean') out.spread = v.spread;
  if (FLOWS.includes(v.flow as MangaFlow)) out.flow = v.flow;
  if (FITS.includes(v.fit as MangaFit)) out.fit = v.fit;
  if (v.zoom !== undefined) out.zoom = finite(v.zoom, 1, 0.25, 8);
  if (v.offset !== undefined) out.offset = Math.round(finite(v.offset, 0, -1, 1));
  if (v.page !== undefined) out.page = Math.max(0, Math.round(finite(v.page, 0, 0, 100000)));
  if (v.panel !== undefined) out.panel = Math.round(finite(v.panel, -1, -1, 200));
  return out;
}

/** 合并：按书覆盖的几项盖住全局默认 */
export function mangaSettingsOf(base: MangaPrefs, view?: MangaViewState | null): MangaPrefs {
  if (!view) return base;
  return { ...base, ...view };
}

/**
 * 老扫描件「一键修复」：按整页平均亮度反推 gamma 与亮度。
 * 纯函数，输入是 0..1 的平均亮度（0 全黑、1 全白）。
 */
export function autoTone(meanLuma: number): { brightness: number; contrast: number; gamma: number } {
  const m = Math.min(0.95, Math.max(0.05, Number(meanLuma) || 0.5));
  const gamma = Math.min(2.2, Math.max(0.5, Math.log(0.5) / Math.log(m)));
  return {
    brightness: Math.min(1.4, Math.max(0.8, 0.5 / m)),
    contrast: m > 0.75 ? 1.2 : 1.1,
    gamma: Number(gamma.toFixed(2)),
  };
}

/** 方向最终取值：auto 时听 ComicInfo 的，没有就按日漫右到左 */
export function resolveDirection(
  pref: MangaDirectionPref,
  comicInfo: MangaDirection | null,
): MangaDirection {
  if (pref !== 'auto') return pref;
  return comicInfo ?? 'rtl';
}
