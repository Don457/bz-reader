/* ============================================================
 * bz-reader · 阅读时屏幕常亮（core/wake-lock.ts）
 *
 * 只是一个薄薄的开关：拿到 navigator.wakeLock 就申请 screen 锁，用户关掉
 * 或切到后台就释放。所有书共用——EPUB / PDF / 漫画 / 剪藏走同一个实例，
 * 所以从 manga 偏好里抽出来放在这里，而不是挂在某个引擎上。
 *
 * 为什么自己包一层而不是各处直接 request：
 *   1. 切后台浏览器会自动释放，回前台要重新申请（Wake Lock 规范如此），
 *      这段「记住 enable 意图 + visibility 重申请」的逻辑只写一次；
 *   2. iOS / 老内核没有 wakeLock，enable / disable 都必须安静降级——
 *      不能因为常亮失败就挡住看书；
 *   3. 注入式 navigator，测试不必碰真实浏览器。
 * ============================================================ */

export interface WakeLockLike {
  release(): Promise<void>;
}

export interface WakeLockNav {
  wakeLock?: {
    request(type: 'screen'): Promise<WakeLockLike>;
  };
}

export interface WakeLockController {
  readonly active: boolean;
  enable(): Promise<void>;
  disable(): Promise<void>;
  onVisibilityChange(visible: boolean): void;
}

export function createWakeLock(nav: WakeLockNav): WakeLockController {
  const supported = !!(nav && nav.wakeLock && typeof nav.wakeLock.request === 'function');
  let enabled = false;
  let sentinel: WakeLockLike | null = null;
  /* pending：request 异步，但 active 要在意图成立的那一刻就为真 */
  let pending = false;

  const acquire = async (): Promise<void> => {
    if (!supported || !enabled || sentinel || pending) return;
    pending = true;
    try {
      sentinel = await nav.wakeLock!.request('screen');
    } catch {
      sentinel = null;
    } finally {
      pending = false;
    }
  };

  const release = async (): Promise<void> => {
    const cur = sentinel;
    sentinel = null;
    if (!cur) return;
    try { await cur.release(); } catch { /* ignore */ }
  };

  return {
    get active(): boolean { return enabled && (sentinel !== null || pending); },
    async enable(): Promise<void> { enabled = true; await acquire(); },
    async disable(): Promise<void> { enabled = false; await release(); },
    onVisibilityChange(visible: boolean): void {
      if (!visible) { void release(); return; }
      if (enabled) void acquire();
    },
  };
}
