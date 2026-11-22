/* ============================================================
 * bz-reader · 版本号比较与区间（core/version.ts）
 *
 * 两处要用：
 *   · 更新日志判断「这一版看过没有」（shell/changelog）；
 *   · 试用码判断「这枚码适用于哪个版本」（data/license）。
 *
 * 数据层不能反向依赖界面层，所以实现放 core，两边都从这里取——
 * 一份实现两处用，避免哪天一边改了比较口径、另一边还按老规矩判。
 *
 * 为什么不能按字符串比：`0.1.10` 会被判成比 `0.1.9` 旧，于是升级永远
 * 等不到弹窗（反而更难查：界面一切正常，只是「更新日志不见了」）。
 * ============================================================ */

/** 试用码允许的版本区间：下界含端点，上界不含端点 */
export interface VersionRange {
  /** 最低版本（含），缺省 = 不设下限 */
  min?: string;
  /** 上限版本（不含），缺省 = 不设上限 */
  before?: string;
}

export function normalizeVersion(v: string | null | undefined): string {
  return String(v ?? '')
    .trim()
    .replace(/^v/i, '')
    .trim();
}

function segments(v: string): number[] {
  const out: number[] = [];
  for (const part of v.split(/[.\-+]/)) {
    const n = Number(part);
    if (Number.isFinite(n) && part.trim() !== '') out.push(n);
  }
  return out;
}

export function compareVersions(a: string, b: string): number {
  const pa = segments(normalizeVersion(a));
  const pb = segments(normalizeVersion(b));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * 当前版本在不在区间内。
 *
 * **空版本只有空区间能通过**：调用方拿不到插件版本时（开发构建、测试）
 * 必须自己决定「不判版本」，不能把空串当成「什么区间都满足」——那等于
 * 悄悄放行一枚本该被版本挡住的试用码。
 */
export function inVersionRange(version: string, range: VersionRange): boolean {
  const v = normalizeVersion(version);
  const min = normalizeVersion(range.min);
  const before = normalizeVersion(range.before);
  if (!v) return !min && !before;
  if (min && compareVersions(v, min) < 0) return false;
  if (before && compareVersions(v, before) >= 0) return false;
  return true;
}

/**
 * 区间的人话。整段主次版本压成 `1.4.x`（群里发码最多的情况），
 * 其余照写上下界，让用户能对着版本号自己核对。
 */
export function versionRangeText(range: VersionRange): string {
  const min = normalizeVersion(range.min);
  const before = normalizeVersion(range.before);
  if (!min && !before) return '';
  if (min && before) {
    const a = segments(min);
    const b = segments(before);
    const wholeMinor =
      a.length >= 2 &&
      b.length >= 2 &&
      a[0] === b[0] &&
      (a[1] ?? 0) + 1 === (b[1] ?? 0) &&
      (a[2] ?? 0) === 0 &&
      (b[2] ?? 0) === 0;
    if (wholeMinor) return `${a[0]}.${a[1]}.x`;
    return `≥${min} <${before}`;
  }
  return min ? `≥${min}` : `<${before}`;
}
