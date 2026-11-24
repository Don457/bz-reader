/* ============================================================
 * bz-reader · 漫画翻页手势（engine/manga/gesture.ts）
 *
 * 滚轮翻页与点按开关的判断抽成纯函数，DOM 事件只负责喂数据。
 * 与 EPUB/PDF 的宿主滚轮同一套单位折算和阈值手感，但漫画不用
 * iframe，事件挂在自己的舞台上，所以不共用宿主那份实现。
 * ============================================================ */

/**
 * 把滚轮位移折算成像素：deltaMode 1 = 行（Firefox 一格约 3 行 × 32px），
 * 2 = 页。竖向为主取竖向，横向为主取横向（触控板横滑也算翻页）。
 */
export function wheelPixels(deltaY: number, deltaX: number, deltaMode: number): number {
  const unit = deltaMode === 1 ? 32 : deltaMode === 2 ? 800 : 1;
  const dy = deltaY * unit;
  const dx = deltaX * unit;
  return Math.abs(dy) >= Math.abs(dx) ? dy : dx;
}

/**
 * 累计滚轮位移：够阈值才翻一页并清零，不够就留着等下一次。
 * 反向滚动会抵消累计，避免来回蹭两下突然翻页。
 */
export function wheelTurn(
  acc: number,
  delta: number,
  threshold: number,
): { acc: number; dir: 'prev' | 'next' | null } {
  const next = acc + delta;
  if (Math.abs(next) < threshold) return { acc: next, dir: null };
  return { acc: 0, dir: next > 0 ? 'next' : 'prev' };
}

/** 手机上点按永远翻；桌面端只看设置里的「点击翻页」开关（默认关）。 */
export function clickTurns(mobile: boolean, desktopTurn: boolean): boolean {
  return mobile || desktopTurn;
}

/** 刚翻过一页后的冷却：防止一次滚轮连发被记成好几页。 */
export function turnReady(now: number, lastAt: number, cooldown: number): boolean {
  return now - lastAt >= cooldown;
}
