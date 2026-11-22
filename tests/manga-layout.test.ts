/* ============================================================
 * 漫画模式 · 版面算术（engine/manga/layout.ts 的红灯测试）
 *
 * 全部是纯函数：这一层不碰 DOM / canvas / 图片文件，把「哪几张图组成
 * 一屏」「分格怎么切、按什么顺序读」「缩放到多大」都抽成算术，才能在
 * 没有 jsdom 的 node 测试里钉住真机上最容易错的那些边界。
 * ============================================================ */
import { describe, expect, it } from 'vitest';
import { resolveDirection } from '../src/engine/manga/settings';
import {
  buildScreens,
  clampPan,
  cropInsets,
  detectBands,
  detectPanels,
  effectiveFit,
  filterCss,
  fitScale,
  mangaLocator,
  naturalCompare,
  panelOrder,
  parseMangaLocator,
  readingDirectionFromComicInfo,
  screenOfPage,
  sortPageNames,
  turnScreen,
  type MangaPage,
  type SpreadOptions,
} from '../src/engine/manga/layout';

const OPT: SpreadOptions = {
  direction: 'rtl',
  spread: false,
  splitWide: false,
  coverAlone: true,
  offset: 0,
  wideRatio: 1.4,
  webtoon: false,
};

const pages = (n: number, w = 800, h = 1200): MangaPage[] =>
  Array.from({ length: n }, (_, i) => ({ name: `p${String(i + 1).padStart(3, '0')}.jpg`, width: w, height: h }));

describe('页序：自然排序，不能让 p10 排在 p2 前面', () => {
  it('按数字段比较', () => {
    expect(naturalCompare('p2.jpg', 'p10.jpg')).toBeLessThan(0);
    expect(naturalCompare('p10.jpg', 'p2.jpg')).toBeGreaterThan(0);
    expect(naturalCompare('p2.jpg', 'p2.jpg')).toBe(0);
  });
  it('一整卷按数字排', () => {
    expect(sortPageNames(['p10.jpg', 'p2.jpg', 'p1.jpg', 'p20.jpg', 'p3.jpg'])).toEqual([
      'p1.jpg', 'p2.jpg', 'p3.jpg', 'p10.jpg', 'p20.jpg',
    ]);
  });
});

describe('组屏：单页 / 双页 / 封面单独 / 方向 / 错页校正', () => {
  it('单页：一图一屏，五页五屏', () => {
    expect(buildScreens(pages(5), OPT).map((s) => s.pages)).toEqual([[0], [1], [2], [3], [4]]);
  });
  it('双页：封面单独占一屏，之后 2-3、4-5 成对，不整体错开一页', () => {
    expect(buildScreens(pages(6), { ...OPT, spread: true }).map((s) => s.pages)).toEqual([
      [0], [1, 2], [3, 4], [5],
    ]);
  });
  it('右到左：阅读顺序不变，但显示顺序左右对调（右页在右）', () => {
    const rtl = buildScreens(pages(4), { ...OPT, spread: true })[1];
    const ltr = buildScreens(pages(4), { ...OPT, spread: true, direction: 'ltr' })[1];
    expect(rtl.pages).toEqual([1, 2]);
    expect(rtl.visual).toEqual([2, 1]);
    expect(ltr.visual).toEqual([1, 2]);
  });
  it('封面不单独时第一屏就是 0-1（美漫常见）', () => {
    expect(buildScreens(pages(4), { ...OPT, spread: true, coverAlone: false })[0].pages).toEqual([0, 1]);
  });
  it('错一页校正：移一格后配对回到 0-1、2-3、4-5', () => {
    expect(buildScreens(pages(6), { ...OPT, spread: true, offset: 1 }).map((s) => s.pages)).toEqual([
      [0, 1], [2, 3], [4, 5],
    ]);
  });
  it('条漫：全部页拼成一条，页间没有空隙', () => {
    expect(buildScreens(pages(4), { ...OPT, webtoon: true })).toHaveLength(1);
    expect(buildScreens(pages(4), { ...OPT, webtoon: true })[0].pages).toEqual([0, 1, 2, 3]);
  });
  it('宽图拆半：两半仍锚在同一张原图上，右到左时右半先读', () => {
    const wide: MangaPage[] = [
      { name: 'a.jpg', width: 800, height: 1200 },
      { name: 'b.jpg', width: 2000, height: 1200 },
    ];
    const s = buildScreens(wide, { ...OPT, splitWide: true });
    expect(s.map((x) => x.pages)).toEqual([[0], [1], [1]]);
    expect(s.flatMap((x) => x.halves ?? [])).toEqual(['full', 'right', 'left']);
    expect(buildScreens(wide, { ...OPT, splitWide: true, direction: 'ltr' })[1].halves).toEqual(['left']);
  });
  it('空书不炸', () => {
    expect(buildScreens([], OPT)).toEqual([]);
  });
});

describe('屏与页互查、翻屏', () => {
  const s = buildScreens(pages(6), { ...OPT, spread: true });
  it('拆半后的每一半都能查回自己所在的屏', () => {
    expect(screenOfPage(s, 0)).toBe(0);
    expect(screenOfPage(s, 1)).toBe(1);
    expect(screenOfPage(s, 2)).toBe(1);
    expect(screenOfPage(s, 5)).toBe(3);
  });
  it('翻屏按屏走，到头夹住不越界', () => {
    expect(turnScreen(0, 4, 1)).toBe(1);
    expect(turnScreen(3, 4, 1)).toBe(3);
    expect(turnScreen(0, 4, -1)).toBe(0);
    expect(turnScreen(2, 4, -1)).toBe(1);
  });
});

describe('分格：按白沟切、按阅读方向排、认不准退回整页', () => {
  const gap = (n: number) => Array.from({ length: n }, () => 1);
  const ink = (n: number) => Array.from({ length: n }, () => 0);
  it('连续白行切成带，短于最小间隔的噪点不算', () => {
    expect(detectBands([...ink(10), ...gap(4), ...ink(10)], 0.9, 3)).toEqual([[0, 10], [14, 24]]);
    expect(detectBands([...ink(10), 1, ...ink(10)], 0.9, 3)).toEqual([[0, 21]]);
  });
  it('两行两列：日漫从右上开始，美漫从左上开始', () => {
    const rects = [
      { x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ];
    expect(panelOrder(rects, 'rtl')).toEqual([1, 0, 3, 2]);
    expect(panelOrder(rects, 'ltr')).toEqual([0, 1, 2, 3]);
  });
  it('跨行的大格跟着它所在的行走，不按 x 硬排', () => {
    const rects = [
      { x: 0, y: 0, w: 1, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ];
    expect(panelOrder(rects, 'rtl')).toEqual([0, 2, 1]);
  });
  it('整页几乎全白（没有白沟）时返回空数组，交给视图退回整页', () => {
    expect(detectPanels(gap(20), gap(20), 20, 20)).toEqual([]);
  });
  it('一条竖白沟把页面切成左右两格', () => {
    const out = detectPanels(ink(20), [...ink(8), ...gap(3), ...ink(9)], 20, 20);
    expect(out).toHaveLength(2);
    expect(out[0].x).toBeLessThan(out[1].x);
  });
  it('分格数离谱时认输，返回空', () => {
    const alt = Array.from({ length: 100 }, (_, i) => (i % 2 ? 1 : 0));
    expect(detectPanels(alt, alt, 100, 100)).toEqual([]);
  });
});

describe('自动裁白边：只裁四周整体留白，不碰页内白格', () => {
  it('上下左右各两格白边', () => {
    expect(cropInsets([1, 1, 0, 0, 0, 1, 1], [1, 1, 0, 0, 1, 1])).toEqual({
      top: 2, bottom: 2, left: 2, right: 2,
    });
  });
  it('没有白边时四边都是 0', () => {
    expect(cropInsets([0, 0, 0], [0, 0, 0])).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });
});

describe('缩放适配、平移边界、画质滤镜', () => {
  it('适应屏幕取较小的比例，铺满取较大', () => {
    expect(fitScale('screen', 1000, 2000, 500, 500)).toBeCloseTo(0.25);
    expect(fitScale('width', 1000, 2000, 500, 500)).toBeCloseTo(0.5);
    expect(fitScale('height', 1000, 2000, 500, 500)).toBeCloseTo(0.25);
    expect(fitScale('fill', 1000, 2000, 500, 500)).toBeCloseTo(0.5);
    expect(fitScale('original', 1000, 2000, 500, 500)).toBe(1);
  });
  it('智能适配：宽图按宽度，小图不放大糊掉', () => {
    expect(fitScale('smart', 2000, 500, 500, 500)).toBeCloseTo(0.25);
    expect(fitScale('smart', 400, 200, 500, 500)).toBeCloseTo(1);
  });
  it('平移夹在「图片放大后能露出的范围」里，不会拖出空白', () => {
    expect(clampPan(999, -999, 2, 1000, 1000, 500, 500)).toEqual({ x: 750, y: -750 });
    expect(clampPan(0, 0, 0.5, 1000, 1000, 500, 500)).toEqual({ x: 0, y: 0 });
  });
  it('滤镜带 gamma 时走 SVG 滤镜引用，不带时纯 CSS', () => {
    expect(filterCss(1.2, 1.1, 1)).toContain('brightness');
    expect(filterCss(1, 1, 1)).toBe('');
    expect(filterCss(1, 1, 1.2)).toContain('url(');
  });
});

describe('定位串：锚在原图序号上，拆页 / 分格都不改存档', () => {
  it('页与格往返', () => {
    expect(parseMangaLocator(mangaLocator(17, 3))).toEqual({ page: 17, panel: 3 });
    expect(parseMangaLocator(mangaLocator(0))).toEqual({ page: 0, panel: -1 });
  });
  it('不认别处的定位串，也不认负数', () => {
    expect(parseMangaLocator('pdf/3/1-2')).toBeNull();
    expect(parseMangaLocator('manga/-1')).toBeNull();
    expect(parseMangaLocator('manga/abc')).toBeNull();
  });
});

describe('ComicInfo.xml 的 Manga 字段决定方向', () => {
  it('YesAndRightToLeft 是日漫右到左', () => {
    expect(readingDirectionFromComicInfo('<ComicInfo><Manga>YesAndRightToLeft</Manga></ComicInfo>')).toBe('rtl');
  });
  it('Yes / No 按左到右，缺失返回 null 交给默认值', () => {
    expect(readingDirectionFromComicInfo('<ComicInfo><Manga>Yes</Manga></ComicInfo>')).toBe('ltr');
    expect(readingDirectionFromComicInfo('<ComicInfo><Manga>No</Manga></ComicInfo>')).toBe('ltr');
    expect(readingDirectionFromComicInfo('<ComicInfo/>')).toBeNull();
    expect(readingDirectionFromComicInfo('')).toBeNull();
  });
});

describe('长条图与方向优先级（2026-11-22 真机回归）', () => {
  it('整话一张的竖长图在 smart 下改按宽度，不再压成一条线', () => {
    /* 700×50000 的条漫：按高度装进视口只剩 9px 宽，肉眼就是一条线 */
    expect(effectiveFit('smart', 700, 50000)).toBe('width');
    expect(fitScale('width', 700, 50000, 680, 681)).toBeCloseTo(680 / 700, 4);
  });

  it('普通单页与宽图保持 smart，不误伤', () => {
    expect(effectiveFit('smart', 1200, 1660)).toBe('smart');
    expect(effectiveFit('smart', 2400, 1660)).toBe('smart');
    /* 用户明确指定的档位一律不改 */
    expect(effectiveFit('screen', 700, 50000)).toBe('screen');
    expect(effectiveFit('original', 700, 50000)).toBe('original');
  });

  it('ComicInfo 的方向只在「跟随文件」时生效，用户手选优先', () => {
    expect(resolveDirection('auto', 'ltr')).toBe('ltr');
    expect(resolveDirection('auto', null)).toBe('rtl');
    /* 用户把方向定成右到左：文件写左到左也不改 */
    expect(resolveDirection('rtl', 'ltr')).toBe('rtl');
    expect(resolveDirection('ltr', 'rtl')).toBe('ltr');
  });
});
