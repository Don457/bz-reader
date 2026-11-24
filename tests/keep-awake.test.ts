import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_PREFS, normalizePrefs } from '../src/data/prefs';
import { DEFAULT_MANGA_PREFS, normalizeMangaPrefs } from '../src/engine/manga/settings';
import { PLAN_TABLE } from '../src/data/entitlement';
import { planNameZh } from '../src/i18n/plan';
import { createWakeLock, type WakeLockLike } from '../src/core/wake-lock';

/**
 * 阅读时屏幕常亮（2026-11-24 通用化）：从 manga 偏好抽到通用 prefs 顶层。
 * 1) 老数据 manga.keepAwake=true 升级后照样亮；2) 新键只认显式 bool；
 * 3) wake lock 切后台释放、回前台重申请，不支持时安静降级。
 */

describe('常亮偏好 · 归一化与迁移', () => {
  it('顶层 keepAwake 默认关，老版本没有这一项也是关', () => {
    expect(DEFAULT_PREFS.keepAwake).toBe(false);
    expect(normalizePrefs({}).keepAwake).toBe(false);
  });

  it('顶层只认显式 true，脏值当关', () => {
    expect(normalizePrefs({ keepAwake: true }).keepAwake).toBe(true);
    expect(normalizePrefs({ keepAwake: '1' } as unknown as Record<string, unknown>).keepAwake).toBe(false);
    expect(normalizePrefs({ keepAwake: 1 } as unknown as Record<string, unknown>).keepAwake).toBe(false);
  });

  it('老数据 manga.keepAwake=true 搬到顶层；顶层显式值优先', () => {
    expect(normalizePrefs({ manga: { keepAwake: true } }).keepAwake).toBe(true);
    expect(normalizePrefs({ keepAwake: false, manga: { keepAwake: true } }).keepAwake).toBe(false);
  });

  it('漫画偏好里不再有 keepAwake：归一化后不保留这个字段', () => {
    expect('keepAwake' in DEFAULT_MANGA_PREFS).toBe(false);
    expect('keepAwake' in normalizeMangaPrefs({ keepAwake: true })).toBe(false);
  });
});

describe('常亮开关 · 渲染与动作接线', () => {
  /* 真机曾发现：开关渲染出来了却点不动——preftoggle 是逐 key 白名单，
     渲染用了 prefToggle 但动作分支漏了 keepAwake。两处必须成对存在。 */
  it('设置页用 prefToggle 渲染 keepAwake，动作白名单里有对应分支', () => {
    const render = readFileSync(resolve(__dirname, '../src/shell/render/settings.ts'), 'utf8');
    const actions = readFileSync(resolve(__dirname, '../src/shell/actions.ts'), 'utf8');
    expect(render).toContain("prefToggle('keepAwake'");
    const preftoggle = actions.slice(actions.indexOf("case 'preftoggle'"));
    expect(preftoggle.slice(0, preftoggle.indexOf('case ', 10))).toContain("d.k === 'keepAwake'");
  });
});

describe('对照表 · 常亮给基础版', () => {
  it('有一行「阅读时屏幕常亮」，基础版与高级版都打勾，不挂能力位', () => {
    const row = PLAN_TABLE.find((r) => r.key === 'keepAwake');
    expect(row, 'PLAN_TABLE 里应有 keepAwake 行').toBeDefined();
    expect(row!.name).toBe(planNameZh('keepAwake'));
    expect(row!.free).toBe('yes');
    expect(row!.pro).toBe('yes');
    expect(row!.cap).toBeUndefined();
  });
});

class FakeLock implements WakeLockLike {
  released = 0;
  async release(): Promise<void> { this.released += 1; }
}

function fakeNav(): { wakeLock: { request: (t: string) => Promise<WakeLockLike> }; requests: string[]; locks: FakeLock[] } {
  const requests: string[] = [];
  const locks: FakeLock[] = [];
  return {
    requests,
    locks,
    wakeLock: {
      request: async (t: string) => {
        requests.push(t);
        const l = new FakeLock();
        locks.push(l);
        return l;
      },
    },
  };
}

describe('wake lock 控制器', () => {
  it('enable 申请 screen 锁，disable 释放；不重复申请', async () => {
    const nav = fakeNav();
    const w = createWakeLock(nav as never);
    await w.enable();
    await w.enable();
    expect(nav.requests).toEqual(['screen']);
    await w.disable();
    expect(nav.locks[0].released).toBe(1);
    expect(w.active).toBe(false);
  });

  it('不支持 wakeLock 的环境里 enable / disable 都不抛', async () => {
    const w = createWakeLock({} as never);
    await expect(w.enable()).resolves.toBeUndefined();
    await expect(w.disable()).resolves.toBeUndefined();
    expect(w.active).toBe(false);
  });

  it('request 抛错时安静降级，不阻断阅读', async () => {
    const nav = { wakeLock: { request: async () => { throw new Error('denied'); } } };
    const w = createWakeLock(nav as never);
    await expect(w.enable()).resolves.toBeUndefined();
    expect(w.active).toBe(false);
  });

  it('切到后台释放、回前台重申请（仍保持 enable 意图）', async () => {
    const nav = fakeNav();
    const w = createWakeLock(nav as never);
    await w.enable();
    expect(nav.requests).toEqual(['screen']);
    w.onVisibilityChange(false);
    expect(nav.locks[0].released).toBe(1);
    expect(w.active).toBe(false);
    w.onVisibilityChange(true);
    expect(nav.requests).toEqual(['screen', 'screen']);
    expect(w.active).toBe(true);
  });

  it('disable 之后回前台不再重申请', async () => {
    const nav = fakeNav();
    const w = createWakeLock(nav as never);
    await w.enable();
    await w.disable();
    w.onVisibilityChange(false);
    w.onVisibilityChange(true);
    expect(nav.requests).toEqual(['screen']);
  });
});
