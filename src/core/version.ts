/* ============================================================
 * bz-reader · 版本号比较（core/version.ts）
 *
 * 两处要用：
 *   · 更新日志判断「这一版看过没有」（shell/changelog）；
 *   · 更新提醒与试用码判断「是不是最新版」（data/plugin-update、data/entitlement）。
 *
 * 数据层不能反向依赖界面层，所以实现放 core，两边都从这里取——
 * 一份实现两处用，避免哪天一边改了比较口径、另一边还按老规矩判。
 *
 * 为什么不能按字符串比：`0.1.10` 会被判成比 `0.1.9` 旧，于是升级永远
 * 等不到弹窗（反而更难查：界面一切正常，只是「更新日志不见了」）。
 * ============================================================ */

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
