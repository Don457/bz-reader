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

interface ParsedVersion {
  nums: number[];
  /** 预发布标记（beta.1 / rc2），空串 = 正式版 */
  pre: string;
}

/**
 * 版本号拆成「数字段 + 预发布标记」。
 *
 * 不能把 `-beta.1` 当成多出来的一段数字：那样 `1.7.0-beta.1` 会比 `1.7.0`
 * 大，试用码判定会把升级到正式版的用户锁在门外，更新检查还会催人升到
 * 更旧的 beta。预发布标记只影响同号之间的大小：正式版更大。
 */
function parseVersion(v: string): ParsedVersion {
  const s = normalizeVersion(v).split('+')[0];
  const m = s.match(/^(\d+(?:\.\d+)*)(?:[-.](.*))?$/);
  if (!m) return { nums: segments(s), pre: '' };
  return {
    nums: m[1].split('.').map((n) => Number(n)),
    pre: (m[2] ?? '').trim().toLowerCase(),
  };
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre > pb.pre ? 1 : -1;
}
