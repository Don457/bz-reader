/* ============================================================
 * bz-reader · 漫画视图（engine/manga/view.ts）
 *
 * 不用 iframe、不给 blob: 开帧：图片以 objectURL 挂在**宿主 DOM** 的
 * <img> 上（移动端 CSP 只挡 blob 帧，不挡这种图；见 pdf/canvas-budget）。
 * 一屏 = 一张或两张原图，翻页按屏走；进度/书签锚在原图序号上，
 * 拆页、合页、裁边、分格都不改存档。
 *
 * 三条内存纪律：
 *  1. 只解压眼前这一屏 ±1 屏，滚走就 revokeObjectURL；
 *  2. 分格检测把图画到 100×100 的小画布上取像素，绝不用原尺寸画布
 *     （手机上大画布静默白屏，pdf/document.ts 踩过）；
 *  3. 图片尺寸先按 0 占位，加载完再回填宽高并重新组屏，不预扫整本。
 * ============================================================ */
import {
  buildScreens,
  clampPan,
  cropInsets,
  detectPanels,
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
  private loaded = new Set<number>();
  private urls = new Map<number, string>();
  private pan = { x: 0, y: 0 };
  private dragStart: { x: number; y: number; px: number; py: number } | null = null;
  private thumbUrls = new Set<string>();
  private destroyed = false;
  private awakeLock: WakeLockSentinel | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private gammaSvg: SVGSVGElement | null = null;

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

  /** 图片尺寸是加载完才知道的：回填后重新组屏，但锚在原图序号上不错位 */
  private setPageSize(page: number, width: number, height: number): void {
    const p = this.pages[page];
    if (!p || (p.width === width && p.height === height)) return;
    p.width = width;
    p.height = height;
    if (this.prefs.splitWide) this.rebuild();
  }

  /* ─────────────── 渲染 ─────────────── */

  private async render(): Promise<void> {
    if (this.destroyed) return;
    const flow = this.prefs.flow;
    this.film.replaceChildren();
    this.panelLayer.replaceChildren();
    this.cells.clear();

    if (flow === 'vertical' || flow === 'horizontal' || flow === 'webtoon') {
      await this.renderContinuous(flow);
    } else {
      await this.renderPaged();
    }
    this.updateHud();
    this.emitRelocate();
  }

  private async renderPaged(): Promise<void> {
    const s = this.screens[this.screen];
    if (!s) return;
    this.film.classList.add('is-paged');
    for (const page of s.visual) {
      const half = s.halves[s.pages.indexOf(page)] ?? 'full';
      const cell = await this.makeCell(page, half, s.pages.length > 1);
      if (cell) this.film.append(cell.wrap);
    }
    this.applyZoom();
    if (this.prefs.panels) await this.detectCurrentPanels(s);
    this.prefetch();
  }

  private async renderContinuous(flow: 'vertical' | 'horizontal' | 'webtoon'): Promise<void> {
    this.film.classList.remove('is-paged');
    this.film.classList.toggle('is-row', flow === 'horizontal');
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
    /* 连续模式只加载视口附近的图： IntersectionObserver 到不了再滚就补 */
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
      this.loaded.delete(p);
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
    cell.img.style.margin = `-${top}% -${right}% -${bottom}% -${left}%`;
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
    const scale = Math.min(4, Math.max(1, 1 / Math.max(0.12, Math.max(r.w, r.h))));
    this.film.style.transform = `scale(${scale}) translate(${50 - (r.x + r.w / 2) * 100}%, ${50 - (r.y + r.h / 2) * 100}%)`;
  }

  /* ─────────────── 缩放与平移 ─────────────── */

  private applyZoom(): void {
    if (this.prefs.panels && this.panelRects.length) { this.paintPanel(); return; }
    const cell = this.cells.get(this.currentPage());
    const p = this.pages[this.currentPage()];
    const vw = this.stage.clientWidth || 1;
    const vh = this.stage.clientHeight || 1;
    const base = p.width && p.height ? fitScale(this.prefs.fit, p.width, p.height, vw, vh) : 1;
    const scale = base * this.prefs.zoom;
    this.film.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${scale})`;
    if (cell) {
      const mx = Math.max(0, (p.width * scale - vw) / 2);
      const my = Math.max(0, (p.height * scale - vh) / 2);
      this.pan = clampPan(this.pan.x, this.pan.y, scale, p.width, p.height, vw, vh);
      this.film.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${scale})`;
      void mx; void my;
    }
  }

  zoomBy(factor: number): void {
    this.prefs.zoom = Math.min(8, Math.max(0.25, this.prefs.zoom * factor));
    this.pan = { x: 0, y: 0 };
    void this.render();
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

  private updateHud(): void {
    const total = this.pages.length;
    const page = this.currentPage() + 1;
    this.hud.replaceChildren();
    const label = el('span', 'bzr-manga-count');
    label.textContent = `${page} / ${total}`;
    const input = el('input', 'bzr-manga-goto');
    input.type = 'number';
    input.min = '1';
    input.max = String(total);
    input.placeholder = t('manga.goto');
    input.addEventListener('change', () => {
      const n = Number(input.value);
      if (Number.isFinite(n) && n >= 1) this.goToPage(n - 1);
    });
    const buttons: Array<[string, () => void, boolean]> = [
      [t('manga.dir'), () => this.toggleDirection(), this.direction === 'rtl'],
      [t('manga.spread'), () => this.setPref('spread', !this.prefs.spread), this.prefs.spread],
      [t('manga.webtoon'), () => this.setPref('flow', this.prefs.flow === 'webtoon' ? 'paged' : 'webtoon'), this.prefs.flow === 'webtoon'],
      [t('manga.panels'), () => this.setPref('panels', !this.prefs.panels), this.prefs.panels],
      [t('manga.crop'), () => this.setPref('crop', !this.prefs.crop), this.prefs.crop],
      [t('manga.fit'), () => this.cycleFit(), false],
      [t('manga.tone'), () => this.fixTone(), false],
      [t('manga.thumbs'), () => this.setPref('thumbs', !this.prefs.thumbs), this.prefs.thumbs],
      [t('manga.whole'), () => this.showWholePage(), false],
    ];
    for (const [text, fn, on] of buttons) {
      const b = el('button', `bzr-manga-btn${on ? ' is-on' : ''}`);
      b.textContent = text;
      b.title = text;
      b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
      this.hud.append(b);
    }
    this.hud.append(label, input);
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
      box.title = String(i + 1);
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
    this.rebuild();
    this.emitViewState();
  }

  private showWholePage(): void {
    this.panel = -1;
    this.panelRects = [];
    this.panelLayer.replaceChildren();
    this.film.style.removeProperty('transform');
    void this.render();
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
      transfer.setAttribute('exponent', String(1 / this.prefs.gamma));
      fn.append(transfer);
      filter.append(fn);
    }
    svg.append(filter);
    this.root.append(svg);
    this.gammaSvg = svg;
  }

  private syncGamma(): void {
    const fns = this.gammaSvg?.querySelectorAll('feFuncR, feFuncG, feFuncB');
    fns?.forEach((fn) => fn.setAttribute('exponent', String(1 / this.prefs.gamma)));
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
    this.stage.addEventListener('dblclick', () => this.zoomBy(1.5));
    this.stage.addEventListener('wheel', (ev) => {
      if (this.prefs.flow !== 'paged' || !ev.ctrlKey) return;
      ev.preventDefault();
      this.zoomBy(ev.deltaY < 0 ? 1.15 : 1 / 1.15);
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
      if (Math.abs(dx) > 48 && this.prefs.flow === 'paged' && this.prefs.zoom <= 1) {
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
      this.resizeObserver = new ResizeObserver(() => this.applyZoom());
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
