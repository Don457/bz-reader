import { describe, expect, it } from 'vitest';
import {
  MANGA_ASSIST_ITEMS,
  MANGA_FIT_OPTIONS,
  MANGA_FLOW_OPTIONS,
  MANGA_PANEL_ROWS,
  mangaPanelRows,
  mangaZoomLabel,
} from '../src/engine/manga/panel';

/**
 * 漫画的「排版」面板（2026-11-22 二轮真机反馈）。
 *
 * 第一轮把缩放 / 跳页 / 阅读方式做成画面里的悬浮工具条，作者的原话是
 * 「不要界面当中的工具条，要和 PDF、EPUB 一样单独做一个排版的界面」。
 * 所以这些项现在只活在头栏「排版」图标弹出的面板里：
 *   · 上半是画面（缩放 / 适配 / 辅助）；
 *   · 下半是阅读（方向 / 单双页 / 翻页方式）。
 * 「单页 / 跨页」只在分页模式成立——连续滚动时那两档点了没有效果，
 * 所以按 flow 过滤掉，不留一个点了不动的行。
 *
 * 「逐格 / 裁边 / 调色」三项并成一行：各占一行时卡片 649px，手机 62vh
 * 只有 520，最后两行必须滚动才看得见（第二轮真机截图）。
 */
describe('漫画排版面板的行', () => {
  it('先画面后阅读，顺序就是视觉顺序', () => {
    expect(MANGA_PANEL_ROWS).toEqual(['zoom', 'fit', 'assist', 'direction', 'pages', 'flow']);
  });

  it('分页模式才有「单页 / 跨页」；连续模式把它去掉', () => {
    expect(mangaPanelRows('paged')).toEqual(MANGA_PANEL_ROWS);
    for (const flow of ['vertical', 'horizontal', 'webtoon'] as const) {
      expect(mangaPanelRows(flow)).not.toContain('pages');
    }
  });

  it('「辅助」一行三颗：逐格 / 裁边 / 调色', () => {
    expect(MANGA_ASSIST_ITEMS).toEqual(['panels', 'crop', 'tone']);
  });

  it('适配六档：智能排第一（默认），原始大小最后', () => {
    expect(MANGA_FIT_OPTIONS).toEqual(['smart', 'screen', 'width', 'height', 'fill', 'original']);
  });

  it('翻页四档：一屏一页 / 连续向下 / 连续横向 / 条漫', () => {
    expect(MANGA_FLOW_OPTIONS).toEqual(['paged', 'vertical', 'horizontal', 'webtoon']);
  });
});

describe('缩放百分比', () => {
  it('四舍五入到整数，和 PDF 那条浮条一个口径', () => {
    expect(mangaZoomLabel(1)).toBe('100%');
    expect(mangaZoomLabel(1.25)).toBe('125%');
    expect(mangaZoomLabel(0.333)).toBe('33%');
  });

  it('坏值不写出 NaN：退回 100%', () => {
    expect(mangaZoomLabel(Number.NaN)).toBe('100%');
  });
});
