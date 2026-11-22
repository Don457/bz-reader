/* ============================================================
 * bz-reader · PDF / 漫画头栏动作（view/pdf-actions.ts）
 *
 * 只解决一件事：**动作要在点击时现取引擎视图，不能在建按钮时取。**
 *
 * 头栏按钮比引擎早出生：阅读视图先按 EPUB 的形态把那排图标建好，PDF
 * 引擎 mount 完才有 `host.pdfUi`。而且按钮会被复用（`ensureHeaderActions`
 * 只在找不到同名按钮时才新建），复用时不会重挂 click 监听——当初闭包里
 * 抓到的 `undefined` 就跟着这颗按钮一辈子，四颗 PDF 图标连同「排版」
 * 全都点了没反应。真机上唯一的表现是「图标在、点了没动静」。
 *
 * 所以这里收的是一个 `getPdf()` 而不是一个 `PdfUi`；调用方（头栏 / ⋮）
 * 都传 `() => this.host.pdfUi`。漫画同理，传 `() => this.host.mangaUi`。
 *
 * 2026-11-22：漫画也接进来——「排版」打开漫画自己的面板，「缩略图」
 * 用同一个入口。两者在引擎层是互斥的，先问漫画再问 PDF，谁在就谁接。
 * ============================================================ */
import type { MangaUi, PdfUi } from '../engine/reader-engine';

export type PdfCopyAnchor = { right: number; bottom: number } | null;

/**
 * 触发按钮的视口矩形：排版浮层贴着它下沿弹。
 *
 * 没有（命令面板 / 快捷键 / ⋮ 菜单）时传 null，浮层回 CSS 兜底位置——
 * 硬算一个旧坐标比不贴更糟。
 */
export type PanelAnchor = { left: number; top: number; width: number; height: number } | null;

export interface PdfActionRun {
  /** 排版：PDF 打开缩放/旋转/单双页/翻页面板；漫画打开缩放/适配/方向/翻页面板；EPUB 走字号行距面板 */
  type(anchor?: PanelAnchor): void;
  thumb(): void;
  copy(anchor?: PdfCopyAnchor): void;
  export(): void;
}

/**
 * @param getPdf   点击时现取，没有 PDF 视图就返回 undefined（安静退出）
 * @param typography 非 PDF / 非漫画时的「排版」去处（EPUB 的字号行距）
 * @param getManga 漫画视图，可选：没有就不考虑这条分支
 *
 * 「回到上一处」不在这里（2026-11-10）：EPUB 也有这条历史了，视图层直接走
 * `host.historyUi`，不再借 PDF 的壳。
 */
export function pdfActionRun(
  getPdf: () => PdfUi | undefined,
  typography: (anchor?: PanelAnchor) => void,
  getManga?: () => MangaUi | undefined,
): PdfActionRun {
  return {
    type: (anchor) => {
      const manga = getManga?.();
      if (manga) {
        manga.toggleLayout(anchor ?? null);
        return;
      }
      const ui = getPdf();
      if (ui) ui.toggleLayout(anchor ?? null);
      else typography(anchor ?? null);
    },
    thumb: () => {
      const pdf = getPdf();
      if (pdf) {
        pdf.toggleThumbs();
        return;
      }
      getManga?.()?.toggleThumbs();
    },
    copy: (anchor) => getPdf()?.openCopyMenu(anchor),
    export: () => getPdf()?.exportPage(),
  };
}
