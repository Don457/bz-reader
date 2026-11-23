/**
 * 等插件市场装完（core/plugin-market.ts 的 watchPluginAppear）
 *
 * 这一段是「点完市场按钮、用户自己装完回来」的唯一衔接点：轮询宿主的清单，
 * 认到就重绘一次。三件事要钉住——
 *   1. 只回调一次（重绘会重建卡片，回调两次就是两次重绘）；
 *   2. 超时自己停（不挂常驻轮询）；
 *   3. 返回的取消函数真能停（卡片先被重绘掉时得能收）。
 */
import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { watchPluginAppear } from '../src/core/plugin-market';

function makeApp(plugins: unknown): App {
  return { plugins } as unknown as App;
}

/** 等到谓词成立或超时，避免拿固定的 sleep 猜时序 */
async function until(pred: () => boolean, timeoutMs = 600): Promise<void> {
  const started = Date.now();
  while (!pred() && Date.now() - started < timeoutMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

describe('watchPluginAppear：市场装完自动认到', () => {
  it('清单里出现就回调一次，之后不再回调', async () => {
    const manifests: Record<string, unknown> = {};
    const app = makeApp({ manifests });
    let hits = 0;
    const stop = watchPluginAppear(app, 'bz-review', () => {
      hits += 1;
    }, { intervalMs: 10, timeoutMs: 500 });

    manifests['bz-review'] = { id: 'bz-review', version: '1.0.0' };
    await until(() => hits > 0);
    await new Promise<void>((resolve) => setTimeout(resolve, 60));

    expect(hits).toBe(1);
    stop();
  });

  it('已经启用的插件也算认到（manifests 还没刷新时靠 plugins 表）', async () => {
    const app = makeApp({ plugins: { 'bz-review': {} } });
    let hits = 0;
    watchPluginAppear(app, 'bz-review', () => {
      hits += 1;
    }, { intervalMs: 10, timeoutMs: 500 });

    await until(() => hits > 0);
    expect(hits).toBe(1);
  });

  it('超时后自己停，不再回调', async () => {
    const app = makeApp({ manifests: {} });
    let hits = 0;
    watchPluginAppear(app, 'bz-review', () => {
      hits += 1;
    }, { intervalMs: 10, timeoutMs: 40 });

    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    expect(hits).toBe(0);
  });

  it('取消函数能提前停：卡片先被重绘掉时不留定时器', async () => {
    const manifests: Record<string, unknown> = {};
    const app = makeApp({ manifests });
    let hits = 0;
    const stop = watchPluginAppear(app, 'bz-review', () => {
      hits += 1;
    }, { intervalMs: 10, timeoutMs: 500 });

    stop();
    manifests['bz-review'] = { id: 'bz-review', version: '1.0.0' };
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    expect(hits).toBe(0);
  });
});
