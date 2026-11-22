/* ============================================================
 * bz-reader · 漫画视图（engine/manga/view.ts）
 *
 * 不用 iframe、不给 blob: 开帧：图片以 objectURL 挂在**宿主 DOM** 的
 * <img> 上（移动端 CSP 只挡 blob 帧，不挡这种图；见 pdf/canvas-budget）。
 * 一屏 = 一张或两张原图，翻页按屏走；进度/书签锚在原图序号上，
 * 拆页、合页、裁边、分格都不改存档。
 *
 * 尺寸模型（2026-11-22 重做，旧版把整块 film 按 fit 缩放，图片却仍按
 * 容器宽铺满，结果整页只剩四成大小）：
 *  · `base` 由 fitScale 算出「整页刚好装进视口」的比例；
 *  · **cell 的布局尺寸就是图片乘 base 后的像素尺寸**，img 填满 cell；
 *  · film 的 transform 只承担用户缩放（zoom）和平移（pan），不再承担 fit。
 * 这样 fit=smart 时整页正好贴边，zoom=1 是「适配后的 100%」。
 *
 * 三条内存纪律：
 *  1. 只解压眼前这一屏 ±1 屏，滚走就 revokeObjectURL；
 *  2. 分格检测把图画到 100×100 的小画布上取像素，绝不用原尺寸画布
 *     （手机上大画布静默白屏，pdf/document.ts 踩过）；
 *  3. 图片尺寸先按猜测占位，加载完再回填宽高并重新组屏，不预扫整本。
 * ============================================================ */
import {
  buildScreens,
  cropInsets,
  detectPanels,
  effectiveFit,
  filterCss,
  fitScale,
  mangaLocator,
  panelOrder,
  screenOfPage,
  turnScreen,
  type MangaDirection,
  type MangaPage,
  type MangaScreen,
  type PanelRect,
  type SpreadOptions,
} from './layout';
import { imageMime, type MangaSource } from './archive';
import { autoTone, type MangaPrefs, type MangaViewState } from './settings';
import { t } from '../../i18n';

export interface MangaViewHooks {
  /** 位置变了：cfi 是 `manga/<原图序号>/<分格序号>` */
  onRelocate(info: {
    percent: number;
    cfi: string;
    page: number;
    total: number;
    screen: number;
    screens: number;
    chapterTitle: string;
    chapterIndex: number;
  }): void;
  /** 视角变了（方向 / 双页 / 模式 / 缩放），按书记住 */
  onViewState(state: MangaViewState): void;
  /** 点按分区翻页（交给宿主统一处理，方向与点击区只在一份规则里） */
  onTurn(dir: 'prev' | 'next'): void;
  onReady(): void;
}

interface Cell {
  page: number;
  half: 'full' | 'left' | 'right';
  img: HTMLImageElement;
  wrap: HTMLElement;
  url: string;
}

const SAMPLE = 100;
/** 尺寸未知时的占位：常见单页漫画 2:3，够算出一个像样的初值 */
const GUESS_W = 1000;
const GUESS_H = 1500;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.25;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = ''): HTMLElementTagNameMap[K] {
  const node = createEl(tag);
  if (cls) node.className = cls;
  return node;
}

/** 从缩略采样图里算出行/列白度投影；任一步失败都返回 null，退回整页 */
function projections(img: HTMLImageElement): {
  row: number[]; col: number[]; mean: number;
} | null {
  try {
    const cv = el('canvas');
    cv.width = SAMPLE;
    cv.height = SAMPLE;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
    const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE);
    const row = new Array<number>(SAMPLE).fill(0);
    const col = new Array<number>(SAMPLE).fill(0);
    let sum = 0;
    for (let y = 0; y < SAMPLE; y += 1) {
      for (let x = 0; x < SAMPLE; x += 1) {
        const i = (y * SAMPLE + x) * 4;
        const luma = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
        sum += luma;
        const white = luma > 0.88 ? 1 : 0;
        row[y] += white;
        col[x] += white;
      }
    }
    return {
      row: row.map((n) => n / SAMPLE),
      col: col.map((n) => n / SAMPLE),
      mean: sum / (SAMPLE * SAMPLE),
    };
  } catch {
    return null;
  }
}

export class MangaView {
  readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly film: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly thumbs: HTMLElement;
  private readonly panelLayer: HTMLElement;
  private readonly archive: MangaSource;
  private readonly hooks: MangaViewHooks;

  private prefs: MangaPrefs;
  private direction: MangaDirection;
  private pages: MangaPage[];
  private screens: MangaScreen[] = [];
  private screen = 0;
  private panel = -1;
  private panelRects: PanelRect[] = [];
  private panelSeq: number[] = [];
  private cells = new Map<number, Cell>();
  private urls = new Map<number, string>();
  private pan = { x: 0, y: 0 };
  private dragStart: { x: number; y: number; px: number; py: number } | null = null;
  private thumbUrls = new Set<string>();
  private destroyed = false;
  private awakeLock: WakeLockSentinel | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private gammaSvg: SVGSVGElement | null = null;
  /** 当前屏按 fit 算出的基准缩放（zoom=1 即此值） */
  private base = 1;

  constructor(container: HTMLElement, archive: MangaSource, prefs: MangaPrefs, hooks: MangaViewHooks) {
    this.archive = archive;
    this.prefs = prefs;
    this.hooks = hooks;
    this.direction = prefs.direction === 'ltr' ? 'ltr' : 'rtl';
    this.pages = archive.pages.map((name) => ({ name, width: 0, height: 0 }));

    this.root = el('div', 'bzr-manga');
    this.stage = el('div', 'bzr-manga-stage');
    this.film = el('div', 'bzr-manga-film');
    this.panelLayer = el('div', 'bzr-manga-panels');
    this.hud = el('div', 'bzr-manga-hud');
    this.thumbs = el('div', 'bzr-manga-thumbs');
    this.stage.append(this.film, this.panelLayer);
    this.root.append(this.stage, this.hud, this.thumbs);
    container.append(this.root);
    this.installGammaFilter();
    this.bind();
    this.rebuild();
    this.hooks.onReady();
  }

  /* ─────────────── 版面 ─────────────── */

  private spreadOptions(): SpreadOptions {
    return {
      direction: this.direction,
      spread: this.prefs.spread && this.prefs.flow === 'paged',
      splitWide: this.prefs.splitWide && this.prefs.flow === 'paged',
      coverAlone: this.prefs.coverAlone,
      offset: this.prefs.offset,
      wideRatio: 1.4,
      webtoon: this.prefs.flow === 'webtoon',
    };
  }

  private rebuild(keepPage = true): void {
    const anchor = keepPage ? this.currentPage() : 0;
    this.screens = buildScreens(this.pages, this.spreadOptions());
    this.screen = keepPage ? screenOfPage(this.screens, anchor) : 0;
    this.root.dataset.flow = this.prefs.flow;
    this.root.dataset.dir = this.direction;
    this.root.dataset.fit = this.prefs.fit;
    this.root.dataset.zoom = String(this.prefs.zoom);
    this.stage.style.background = this.prefs.background || '';
    this.film.style.filter = filterCss(this.prefs.brightness, this.prefs.contrast, this.prefs.gamma);
    this.thumbs.classList.toggle('is-on', this.prefs.thumbs);
    void this.renderThumbs();
    void this.render();
  }

  private currentPage(): number {
    const s = this.screens[this.screen];
    return s?.pages[0] ?? 0;
  }

  /** 图片尺寸是加载完才知道的：回填后重算布局，锚在原图序号上不错位 */
  private setPageSize(page: number, width: number, height: number): void {
    const p = this.pages[page];
    if (!p || (p.width === width && p.height === height)) return;
    p.width = width;
    p.height = height;
    if (this.prefs.flow === 'paged' && this.prefs.splitWide) {
      /* 宽图要不要拆半会改变屏数，必须重新组屏 */
      this.rebuild();
    } else {
      this.layout();
    }
  }

  /* ─────────────── 渲染 ─────────────── */

  private async render(): Promise<void> {
    if (this.destroyed) return;
    const flow = this.prefs.flow;
    this.film.replaceChildren();
    this.panelLayer.replaceChildren();
    this.cells.clear();

    if (flow === 'paged') {
      await this.renderPaged();
    } else {
      await this.renderContinuous(flow);
    }
    this.updateHud();
    this.emitRelocate();
  }

  private async renderPaged(): Promise<void> {
    const s = this.screens[this.screen];
    if (!s) return;
    this.film.classList.add('is-paged');
    this.film.classList.remove('is-row', 'is-column');
    for (const page of s.visual) {
      const half = s.halves[s.pages.indexOf(page)] ?? 'full';
      const cell = await this.makeCell(page, half, s.pages.length > 1);
      if (cell) this.film.append(cell.wrap);
    }
    this.layout();
    if (this.prefs.panels) await this.detectCurrentPanels(s);
    this.prefetch();
  }

  private async renderContinuous(flow: 'vertical' | 'horizontal' | 'webtoon'): Promise<void> {
    this.film.classList.remove('is-paged');
    this.film.classList.toggle('is-row', flow === 'horizontal');
    this.film.classList.toggle('is-column', flow !== 'horizontal');
    /* 连续模式不缩放：把上一页留下的 transform 清掉，否则整块被缩到看不见 */
    this.film.style.transform = '';
    const list = flow === 'webtoon'
      ? [{ pages: this.pages.map((_, i) => i), visual: this.pages.map((_, i) => i), halves: this.pages.map(() => 'full' as const) }]
      : this.screens;
    for (const s of list) {
      const box = el('div', 'bzr-manga-screen');
      for (const page of s.visual) {
        const half = s.halves[s.pages.indexOf(page)] ?? 'full';
        const cell = await this.makeCell(page, half, s.pages.length > 1);
        if (cell) box.append(cell.wrap);
      }
      this.film.append(box);
    }
    this.layout();
    /* 连续模式只加载视口附近的图：滚到哪补到哪 */
    this.loadVisible();
  }

  private async makeCell(page: number, half: Cell['half'], paired: boolean): Promise<Cell | null> {
    const wrap = el('div', 'bzr-manga-cell');
    wrap.dataset.half = half;
    wrap.classList.toggle('is-paired', paired);
    const img = el('img', 'bzr-manga-img');
    img.alt = '';
    img.draggable = false;
    wrap.append(img);
    const cell: Cell = { page, half, img, wrap, url: '' };
    this.cells.set(page, cell);
    img.addEventListener('load', () => {
      if (!img.naturalWidth) return;
      this.setPageSize(page, img.naturalWidth, img.naturalHeight);
      if (this.prefs.crop) this.applyCrop(cell);
    });
    const url = await this.urlFor(page);
    if (this.destroyed) return null;
    if (url) {
      cell.url = url;
      img.src = url;
    } else {
      wrap.classList.add('is-broken');
      wrap.textContent = String(page + 1);
    }
    return cell;
  }

  /** 只解压眼前 ±1 屏，其余滚走就释放；同一张图只解一次 */
  private async urlFor(page: number): Promise<string | null> {
    const cached = this.urls.get(page);
    if (cached) return cached;
    const name = this.pages[page]?.name;
    if (!name) return null;
    const blob = await this.archive.blob(name);
    if (this.destroyed || !blob) return null;
    const url = URL.createObjectURL(new Blob([blob], { type: imageMime(name) }));
    this.urls.set(page, url);
    return url;
  }

  private prefetch(): void {
    const near = new Set<number>();
    for (let d = -1; d <= 1; d += 1) {
      const s = this.screens[this.screen + d];
      if (s) for (const p of s.pages) near.add(p);
    }
    for (const p of near) void this.urlFor(p);
    for (const [p, url] of this.urls) {
      if (near.has(p) || this.prefs.thumbs) continue;
      URL.revokeObjectURL(url);
      this.urls.delete(p);
    }
  }

  private loadVisible(): void {
    const boxes = Array.from(this.film.querySelectorAll<HTMLElement>('.bzr-manga-screen'));
    const r = this.stage.getBoundingClientRect();
    const near = new Set<number>();
    boxes.forEach((box, i) => {
      const b = box.getBoundingClientRect();
      if (b.bottom < r.top - r.height || b.top > r.bottom + r.height) return;
      for (let d = -1; d <= 1; d += 1) {
        const s = this.screens[i + d];
        if (s) for (const p of s.pages) near.add(p);
      }
    });
    if (!near.size) for (const p of this.screens[0]?.pages ?? []) near.add(p);
    for (const p of near) {
      const cell = this.cells.get(p);
      if (!cell || cell.img.src) continue;
      void this.urlFor(p).then((url) => { if (url && !this.destroyed) cell.img.src = url; });
    }
  }

  /* ─────────────── 尺寸 ─────────────── */

  /**
   * 核心：把「适配后的像素尺寸」写到 cell 上。
   *
   * 旧版把 fit 乘进 film 的 transform，而 img 仍按容器宽铺满——fit 与
   * 实际渲染尺寸各算各的，整页永远只有该有的大小的四成。现在 cell 的
   * 宽高就是最终尺寸，film 只负责 zoom / pan。
   */
  private layout(): void {
    if (this.destroyed) return;
    const flow = this.prefs.flow;
    const vw = Math.max(1, this.stage.clientWidth);
    const vh = Math.max(1, this.stage.clientHeight);
    if (flow === 'paged') {
      this.layoutPaged(vw, vh);
    } else {
      this.layoutContinuous(flow, vw, vh);
    }
  }

  private dimsOf(page: number): { w: number; h: number } {
    const p = this.pages[page];
    if (!p || !p.width || !p.height) return { w: GUESS_W, h: GUESS_H };
    return { w: p.width, h: p.height };
  }

  private layoutPaged(vw: number, vh: number): void {
    const s = this.screens[this.screen];
    if (!s) return;
    const count = Math.max(1, s.visual.length);
    const slotW = vw / count;
    /* 每张图各算各的：双页时两页比例可能不同 */
    let maxH = 0;
    for (const page of s.visual) {
      const cell = this.cells.get(page);
      if (!cell) continue;
      const half = cell.wrap.dataset.half as Cell['half'];
      const d = this.dimsOf(page);
      const imgW = half === 'full' ? d.w : d.w / 2;
      /* 长条图（高度是宽度 6 倍以上）在 smart 下按宽度铺，否则会被压成一条线 */
      const fit = effectiveFit(this.prefs.fit, d.w, d.h);
      const base = fitScale(fit, imgW, d.h, slotW, vh);
      const cellW = half === 'full' ? d.w * base : (d.w * base) / 2;
      const cellH = d.h * base;
      cell.wrap.style.width = `${cellW}px`;
      cell.wrap.style.height = `${cellH}px`;
      /* 拆半：图片按整页宽画，cell 裁掉另一半（宽度 200% 用 CSS） */
      cell.img.style.width = half === 'full' ? '100%' : '200%';
      cell.img.style.height = '100%';
      cell.img.style.maxWidth = 'none';
      cell.img.style.maxHeight = 'none';
      this.base = base;
      maxH = Math.max(maxH, cellH);
    }
    /* 长条图比视口高：从顶部开始显示、靠拖动往下看；普通单页居中 */
    this.film.style.alignItems = maxH > vh ? 'flex-start' : 'center';
    this.applyTransform(vw, vh, vw, maxH);
  }

  private layoutContinuous(flow: string, vw: number, vh: number): void {
    for (const cell of this.cells.values()) {
      const d = this.dimsOf(cell.page);
      if (flow === 'horizontal') {
        const h = vh;
        const w = d.h > 0 ? (d.w / d.h) * h : vw;
        cell.wrap.style.width = `${w}px`;
        cell.wrap.style.height = `${h}px`;
      } else {
        /* 连续向下 / 条漫长图：按视口宽度铺，高度按图片比例 */
        const w = vw;
        const h = d.w > 0 ? (d.h / d.w) * w : vh;
        cell.wrap.style.width = `${w}px`;
        cell.wrap.style.height = `${h}px`;
      }
      cell.img.style.width = '100%';
      cell.img.style.height = '100%';
      cell.img.style.maxWidth = 'none';
      cell.img.style.maxHeight = 'none';
    }
    this.film.style.transform = '';
    this.pan = { x: 0, y: 0 };
  }

  /** film 只管 zoom / pan：内容是 fit 后的尺寸，zoom=1 即「适配」 */
  private applyTransform(vw: number, vh: number, contentW: number, contentH: number): void {
    const zoom = this.prefs.zoom;
    const w = contentW * zoom;
    const h = contentH * zoom;
    const mx = Math.max(0, (w - vw) / 2);
    const my = Math.max(0, (h - vh) / 2);
    this.pan = {
      x: Math.min(mx, Math.max(-mx, this.pan.x)),
      y: Math.min(my, Math.max(-my, this.pan.y)),
    };
    this.film.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${zoom})`;
  }

  /* ─────────────── 自动裁白边 ─────────────── */

  private applyCrop(cell: Cell): void {
    const p = projections(cell.img);
    if (!p) return;
    const inset = cropInsets(p.row, p.col);
    if (!inset.top && !inset.bottom && !inset.left && !inset.right) return;
    const top = (inset.top / SAMPLE) * 100;
    const bottom = (inset.bottom / SAMPLE) * 100;
    const left = (inset.left / SAMPLE) * 100;
    const right = (inset.right / SAMPLE) * 100;
    cell.img.style.clipPath = `inset(${top}% ${right}% ${bottom}% ${left}%)`;
  }

  /* ─────────────── 分格导览 ─────────────── */

  private async detectCurrentPanels(s: MangaScreen): Promise<void> {
    const page = s.pages[0];
    const cell = this.cells.get(page);
    if (!cell) return;
    const p = projections(cell.img);
    if (!p) { this.panelRects = []; return; }
    const rects = detectPanels(p.row, p.col, SAMPLE, SAMPLE);
    if (!rects.length) { this.panelRects = []; return; }
    this.panelRects = rects;
    this.panelSeq = panelOrder(rects, this.direction);
    if (this.panel < 0) this.panel = 0;
    this.paintPanel();
  }

  /** 只亮当前格，其余盖住：防剧透比「整页都看得见但顺序对」更要紧 */
  private paintPanel(): void {
    this.panelLayer.replaceChildren();
    if (!this.prefs.panels || !this.panelRects.length || this.panel < 0) return;
    const idx = this.panelSeq[this.panel];
    const r = this.panelRects[idx];
    if (!r) return;
    const x = r.x * 100;
    const y = r.y * 100;
    const w = r.w * 100;
    const h = r.h * 100;
    const areas: Array<[number, number, number, number]> = [
      [0, 0, 100, y],
      [0, y + h, 100, 100 - y - h],
      [0, y, x, h],
      [x + w, y, 100 - x - w, h],
    ];
    for (const [l, tp, ww, hh] of areas) {
      if (ww <= 0 || hh <= 0) continue;
      const shade = el('div', 'bzr-manga-shade');
      shade.style.cssText = `left:${l}%;top:${tp}%;width:${ww}%;height:${hh}%`;
      this.panelLayer.append(shade);
    }
    const frame = el('div', 'bzr-manga-frame');
    frame.style.cssText = `left:${x}%;top:${y}%;width:${w}%;height:${h}%`;
    this.panelLayer.append(frame);
    /* 当前格放大到眼前：用整屏 transform，不搬坐标 */
    const vw = Math.max(1, this.stage.clientWidth);
    const vh = Math.max(1, this.stage.clientHeight);
    const cell = this.cells.get(this.currentPage());
    const boxW = cell ? cell.wrap.offsetWidth : vw;
    const boxH = cell ? cell.wrap.offsetHeight : vh;
    const zoom = Math.min(6, Math.max(1, Math.min(vw / (boxW * r.w), vh / (boxH * r.h))));
    const cx = (r.x + r.w / 2 - 0.5) * boxW;
    const cy = (r.y + r.h / 2 - 0.5) * boxH;
    this.film.style.transform = `scale(${zoom}) translate(${-cx}px, ${-cy}px)`;
  }

  /* ─────────────── 缩放与平移 ─────────────── */

  private applyZoom(): void {
    if (this.prefs.flow !== 'paged') return;
    const vw = Math.max(1, this.stage.clientWidth);
    const vh = Math.max(1, this.stage.clientHeight);
    const s = this.screens[this.screen];
    if (!s) return;
    let contentW = 0;
    let contentH = 0;
    for (const page of s.visual) {
      const cell = this.cells.get(page);
      if (!cell) continue;
      contentW += cell.wrap.offsetWidth;
      contentH = Math.max(contentH, cell.wrap.offsetHeight);
    }
    this.applyTransform(vw, vh, contentW || vw, contentH || vh);
  }

  /** 相对当前缩放再放大 / 缩小；点百分比复位到「适配」 */
  zoomBy(factor: number): void {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.prefs.zoom * factor));
    if (Math.abs(next - this.prefs.zoom) < 0.001) return;
    this.prefs.zoom = next;
    this.pan = { x: 0, y: 0 };
    this.applyZoom();
    this.updateHud();
    this.emitViewState();
  }

  private resetZoom(): void {
    this.prefs.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.applyZoom();
    this.updateHud();
    this.emitViewState();
  }

  /* ─────────────── 导航 ─────────────── */

  turn(dir: 1 | -1): void {
    /* 右到左时「下一屏」在左边，但内部的屏序永远按阅读顺序递增 */
    if (this.prefs.panels && this.panelRects.length && dir === 1 && this.panel < this.panelSeq.length - 1) {
      this.panel += 1;
      this.paintPanel();
      this.emitRelocate();
      return;
    }
    if (this.prefs.panels && this.panelRects.length && dir === -1 && this.panel > 0) {
      this.panel -= 1;
      this.paintPanel();
      this.emitRelocate();
      return;
    }
    const next = turnScreen(this.screen, this.screens.length, dir);
    if (next === this.screen) { this.emitRelocate(); return; }
    this.screen = next;
    this.panel = -1;
    this.panelRects = [];
    this.pan = { x: 0, y: 0 };
    void this.render();
  }

  goToPage(page: number, panel = -1): void {
    const p = Math.min(this.pages.length - 1, Math.max(0, Math.floor(page)));
    this.screen = screenOfPage(this.screens, p);
    this.panel = panel;
    this.pan = { x: 0, y: 0 };
    void this.render();
    this.scrollToCurrent();
  }

  goToPercent(fraction: number): void {
    const f = Math.min(1, Math.max(0, Number(fraction) || 0));
    this.goToPage(Math.round(f * Math.max(0, this.pages.length - 1)));
  }

  private scrollToCurrent(): void {
    const boxes = this.film.querySelectorAll<HTMLElement>('.bzr-manga-screen');
    const box = boxes[this.screen];
    if (box) box.scrollIntoView({ block: 'start' });
  }

  /* ─────────────── HUD / 缩略图 ─────────────── */

  /**
   * 悬浮工具条在右上角（2026-11-22 按作者要求从底部横条改过来）：
   * 桌面端把阅读区整块让给图片，手机上折行也不压底部的导航栏。
   */
  private updateHud(): void {
    const total = this.pages.length;
    const s = this.screens[this.screen];
    const from = (s?.pages[0] ?? 0) + 1;
    const to = (s?.pages[s.pages.length - 1] ?? from - 1) + 1;
    this.hud.replaceChildren();

    const group = (cls: string): HTMLElement => {
      const g = el('div', `bzr-manga-hud-grp${cls ? ` ${cls}` : ''}`);
      this.hud.append(g);
      return g;
    };
    const push = (box: HTMLElement, text: string, fn: () => void, on = false, sr?: string): HTMLElement => {
      const b = el('button', `bzr-manga-btn${on ? ' is-on' : ''}`);
      b.type = 'button';
      b.textContent = text;
      if (sr) {
        const srn = el('span', 'bzs-sr-only');
        srn.textContent = sr;
        b.append(srn);
      }
      b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
      box.append(b);
      return b;
    };

    /* 缩放组：和 PDF 一样「− 100% +」，百分比点一下回到适配 */
    const zoomBox = group('is-zoom');
    push(zoomBox, '−', () => this.zoomBy(1 / ZOOM_STEP), false, t('manga.zoomOut'));
    const pct = push(
      zoomBox,
      `${Math.round(this.prefs.zoom * 100)}%`,
      () => this.resetZoom(),
      this.prefs.zoom !== 1,
      t('manga.zoomReset'),
    );
    pct.classList.add('bzr-manga-pct');
    push(zoomBox, '+', () => this.zoomBy(ZOOM_STEP), false, t('manga.zoomIn'));

    /* 页码 / 跳页：和缩放同在第一行，靠右 */
    const navBox = group('is-nav');
    const label = el('span', 'bzr-manga-count');
    label.textContent = from === to ? `${from} / ${total}` : `${from}–${to} / ${total}`;
    const input = el('input', 'bzr-manga-goto');
    input.type = 'number';
    input.min = '1';
    input.max = String(total);
    input.placeholder = t('manga.goto');
    input.addEventListener('change', () => {
      const n = Number(input.value);
      if (Number.isFinite(n) && n >= 1) this.goToPage(n - 1);
    });
    input.addEventListener('click', (ev) => ev.stopPropagation());
    navBox.append(label, input);

    /* 阅读方式组：独占第二行（手机上按钮多，允许组内再折行） */
    const modeBox = group('is-modes');
    push(modeBox, t('manga.fit'), () => this.cycleFit(), false, t('manga.fitName', { fit: this.fitName() }));
    push(modeBox, t('manga.dir'), () => this.toggleDirection(), this.direction === 'rtl');
    push(modeBox, t('manga.spread'), () => this.setPref('spread', !this.prefs.spread), this.prefs.spread);
    push(modeBox, t('manga.webtoon'), () => this.setPref('flow', this.prefs.flow === 'webtoon' ? 'paged' : 'webtoon'), this.prefs.flow === 'webtoon');
    push(modeBox, t('manga.panels'), () => this.setPref('panels', !this.prefs.panels), this.prefs.panels);
    push(modeBox, t('manga.crop'), () => this.setPref('crop', !this.prefs.crop), this.prefs.crop);
    push(modeBox, t('manga.tone'), () => this.fixTone());
    push(modeBox, t('manga.thumbs'), () => this.setPref('thumbs', !this.prefs.thumbs), this.prefs.thumbs);
    push(modeBox, t('manga.whole'), () => this.showWholePage());
  }

  private fitName(): string {
    const key = {
      smart: 'settings.manga.fit.smart',
      screen: 'settings.manga.fit.screen',
      width: 'settings.manga.fit.width',
      height: 'settings.manga.fit.height',
      fill: 'settings.manga.fit.fill',
      original: 'settings.manga.fit.original',
    } as const;
    return t(key[this.prefs.fit] ?? 'settings.manga.fit.smart');
  }

  private async renderThumbs(): Promise<void> {
    if (!this.prefs.thumbs) {
      for (const u of this.thumbUrls) URL.revokeObjectURL(u);
      this.thumbUrls.clear();
      this.thumbs.replaceChildren();
      return;
    }
    this.thumbs.replaceChildren();
    for (let i = 0; i < this.pages.length; i += 1) {
      const box = el('button', `bzr-manga-thumb${i === this.currentPage() ? ' is-cur' : ''}`);
      box.type = 'button';
      const img = el('img');
      img.alt = '';
      box.append(img);
      box.addEventListener('click', (ev) => { ev.stopPropagation(); this.goToPage(i); });
      this.thumbs.append(box);
      /* 缩略图用同一张已解压的图；没解压到的等视野靠近再补，不预扫整本 */
      const url = this.urls.get(i);
      if (url) img.src = url;
      else if (Math.abs(i - this.currentPage()) <= 3) {
        void this.urlFor(i).then((u) => { if (u && !this.destroyed) img.src = u; });
      }
    }
  }

  /* ─────────────── 设置动作 ─────────────── */

  private setPref<K extends keyof MangaPrefs>(key: K, value: MangaPrefs[K]): void {
    (this.prefs as Mutable<MangaPrefs>)[key] = value;
    if (key === 'flow') this.pan = { x: 0, y: 0 };
    this.rebuild();
    this.emitViewState();
  }

  private toggleDirection(): void {
    this.direction = this.direction === 'rtl' ? 'ltr' : 'rtl';
    this.prefs.direction = this.direction;
    this.rebuild();
    this.emitViewState();
  }

  private cycleFit(): void {
    const order: MangaPrefs['fit'][] = ['smart', 'screen', 'width', 'height', 'fill', 'original'];
    const at = order.indexOf(this.prefs.fit);
    this.setPref('fit', order[(at + 1) % order.length]);
  }

  private fixTone(): void {
    const cell = this.cells.get(this.currentPage());
    if (!cell) return;
    const p = projections(cell.img);
    if (!p) return;
    const tone = autoTone(p.mean);
    this.prefs.brightness = tone.brightness;
    this.prefs.contrast = tone.contrast;
    this.prefs.gamma = tone.gamma;
    this.syncGamma();
    this.rebuild();
    this.emitViewState();
  }

  private showWholePage(): void {
    this.panel = -1;
    this.panelRects = [];
    this.panelLayer.replaceChildren();
    this.pan = { x: 0, y: 0 };
    this.layout();
  }

  /** 设置页改了全局偏好：只覆盖用户没在本里单独调过的项 */
  applyPrefs(next: MangaPrefs): void {
    this.prefs = next;
    this.direction = next.direction === 'ltr' ? 'ltr' : 'rtl';
    this.rebuild();
  }

  setDirection(direction: MangaDirection): void {
    this.direction = direction;
    this.rebuild();
  }

  /* ─────────────── 回调 ─────────────── */

  private emitRelocate(): void {
    const total = Math.max(1, this.pages.length);
    const page = this.currentPage();
    const g = [...this.archive.groups].reverse().find((x: { label: string; page: number }) => x.page <= page);
    this.hooks.onRelocate({
      percent: page / total,
      cfi: mangaLocator(page, this.panel >= 0 ? this.panel : undefined),
      page,
      total: this.pages.length,
      screen: this.screen,
      screens: this.screens.length,
      chapterTitle: g ? g.label : '',
      chapterIndex: g ? this.archive.groups.indexOf(g) : 0,
    });
  }

  private emitViewState(): void {
    this.hooks.onViewState({
      direction: this.prefs.direction,
      spread: this.prefs.spread,
      flow: this.prefs.flow,
      fit: this.prefs.fit,
      zoom: this.prefs.zoom,
      offset: this.prefs.offset,
      page: this.currentPage(),
      panel: this.panel,
    });
  }

  /* ─────────────── gamma 滤镜 ─────────────── */

  private installGammaFilter(): void {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('class', 'bzr-manga-defs');
    const filter = document.createElementNS(ns, 'filter');
    filter.setAttribute('id', 'bzr-manga-gamma');
    for (const channel of ['R', 'G', 'B']) {
      const fn = document.createElementNS(ns, 'feComponentTransfer');
      const transfer = document.createElementNS(ns, `feFunc${channel}`);
      transfer.setAttribute('type', 'gamma');
      transfer.setAttribute('exponent', String(1 / Math.max(0.1, this.prefs.gamma)));
      fn.append(transfer);
      filter.append(fn);
    }
    svg.append(filter);
    this.root.append(svg);
    this.gammaSvg = svg;
  }

  private syncGamma(): void {
    const fns = this.gammaSvg?.querySelectorAll('feFuncR, feFuncG, feFuncB');
    fns?.forEach((fn) => fn.setAttribute('exponent', String(1 / Math.max(0.1, this.prefs.gamma))));
  }

  /* ─────────────── 输入 ─────────────── */

  private bind(): void {
    this.stage.addEventListener('click', (ev) => {
      if (this.dragStart) return;
      const r = this.stage.getBoundingClientRect();
      const x = (ev.clientX - r.left) / Math.max(1, r.width);
      const left = x < 0.33;
      const right = x > 0.67;
      if (!left && !right) return;
      /* 右到左书：点左边是下一屏；再让用户手动反转一次 */
      const rtl = this.direction === 'rtl';
      let dir: 'prev' | 'next' = left ? 'prev' : 'next';
      if (rtl) dir = dir === 'prev' ? 'next' : 'prev';
      if (this.prefs.tapReverse) dir = dir === 'prev' ? 'next' : 'prev';
      this.hooks.onTurn(dir);
    });
    this.stage.addEventListener('dblclick', () => this.zoomBy(ZOOM_STEP));
    this.stage.addEventListener('wheel', (ev) => {
      if (this.prefs.flow !== 'paged' || !ev.ctrlKey) return;
      ev.preventDefault();
      this.zoomBy(ev.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    }, { passive: false });
    this.stage.addEventListener('pointerdown', (ev) => {
      this.dragStart = { x: ev.clientX, y: ev.clientY, px: this.pan.x, py: this.pan.y };
    });
    this.stage.addEventListener('pointerup', (ev) => {
      const d = this.dragStart;
      this.dragStart = null;
      if (!d) return;
      const dx = ev.clientX - d.x;
      const dy = ev.clientY - d.y;
      /* 未放大时横向滑动 = 翻页；放大后 = 拖动看图 */
      if (Math.abs(dx) > 48 && this.prefs.flow === 'paged' && this.prefs.zoom <= 1.001) {
        const rtl = this.direction === 'rtl';
        const dir = (dx < 0 ? 'next' : 'prev') === 'next' ? (rtl ? 'prev' : 'next') : (rtl ? 'next' : 'prev');
        this.hooks.onTurn(dir);
        return;
      }
      if (Math.abs(dx) + Math.abs(dy) > 6) {
        this.pan = { x: d.px + dx, y: d.py + dy };
        this.applyZoom();
      }
    });
    this.stage.addEventListener('scroll', () => {
      if (this.prefs.flow !== 'paged') {
        this.loadVisible();
        const boxes = this.film.querySelectorAll('.bzr-manga-screen');
        if (boxes.length) {
          const r = this.stage.getBoundingClientRect();
          let best = 0;
          let min = Infinity;
          boxes.forEach((box, i) => {
            const d = Math.abs(box.getBoundingClientRect().top - r.top);
            if (d < min) { min = d; best = i; }
          });
          if (best !== this.screen) { this.screen = best; this.updateHud(); this.emitRelocate(); }
        }
      }
    }, { passive: true });
    /* 长按：偷看整页，松手回到当前格 */
    let hold: number | null = null;
    this.stage.addEventListener('pointerdown', () => {
      hold = window.setTimeout(() => this.showWholePage(), 450);
    });
    this.stage.addEventListener('pointerup', () => { if (hold !== null) window.clearTimeout(hold); });
    this.stage.addEventListener('pointerleave', () => { if (hold !== null) window.clearTimeout(hold); });

    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(() => this.layout());
      this.resizeObserver.observe(this.stage);
    }
    void this.setAwake(this.prefs.keepAwake);
  }

  private async setAwake(on: boolean): Promise<void> {
    try {
      if (on && !this.awakeLock && 'wakeLock' in navigator) {
        this.awakeLock = await navigator.wakeLock.request('screen');
      } else if (!on && this.awakeLock) {
        await this.awakeLock.release();
        this.awakeLock = null;
      }
    } catch { /* 不支持就算了，不该因为常亮失败挡住看书 */ }
  }

  /* ─────────────── 生命周期 ─────────────── */

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    try { await this.awakeLock?.release(); } catch { /* ignore */ }
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    for (const url of this.thumbUrls) URL.revokeObjectURL(url);
    this.urls.clear();
    this.thumbUrls.clear();
    this.root.remove();
  }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
