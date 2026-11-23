/**
 * 启用一个已经装好的插件（data/plugin-enable.ts）
 *
 * 2026-11-23：bz / bz review 去掉「后台下载三件套」之后，这一支只剩一件事：
 * 让已经躺在插件目录里的那个插件被宿主认到并启用。
 *
 * 钉四件宿主差异——它们都是真机上见过的：
 *   1. 新宿主有 `loadManifests` / `enablePluginAndSave`，老宿主只有单条版本；
 *   2. 启用失败要重试一次（刚出现的插件目录有时扫描晚一拍，真机 2026-11-21）；
 *   3. 两次都失败就返回 false，由壳层翻成人话；
 *   4. 没有插件管理器（测试桩 / 未来版本改了形状）不能抛，只能返回 false。
 */
import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { enableInstalledPlugin } from '../src/data/plugin-enable';

interface Calls {
  manifests: number;
  manifestIds: string[];
  saved: string[];
  enabled: string[];
}

/** 只带 app.plugins 的最小壳：这个模块不碰别的 */
function makeApp(plugins: unknown): App {
  return { plugins } as unknown as App;
}

function makeCalls(): Calls {
  return { manifests: 0, manifestIds: [], saved: [], enabled: [] };
}

describe('enableInstalledPlugin：让宿主认到刚装好的插件', () => {
  it('新宿主：先重扫清单，再启用并写进启用名单', async () => {
    const calls = makeCalls();
    const app = makeApp({
      loadManifests: async () => {
        calls.manifests += 1;
      },
      enablePluginAndSave: async (id: string) => {
        calls.saved.push(id);
      },
    });

    expect(await enableInstalledPlugin(app, 'bz-review')).toBe(true);
    expect(calls.manifests).toBe(1);
    expect(calls.saved).toEqual(['bz-review']);
  });

  it('老宿主：退回单条 loadManifest + enablePlugin，同样能启用', async () => {
    const calls = makeCalls();
    const app = makeApp({
      loadManifest: (id: string) => calls.manifestIds.push(id),
      enablePlugin: async (id: string) => {
        calls.enabled.push(id);
      },
    });

    expect(await enableInstalledPlugin(app, 'bz')).toBe(true);
    expect(calls.manifestIds).toEqual(['bz']);
    expect(calls.enabled).toEqual(['bz']);
    expect(calls.saved).toEqual([]);
  });

  it('没有扫描能力也能启用：扫描不是启用的前提', async () => {
    const calls = makeCalls();
    const app = makeApp({
      enablePluginAndSave: async (id: string) => {
        calls.saved.push(id);
      },
    });

    expect(await enableInstalledPlugin(app, 'bz')).toBe(true);
    expect(calls.saved).toEqual(['bz']);
  });

  it('第一次抛错就重试一次：插件目录刚出现时宿主扫描会晚一拍', async () => {
    let tries = 0;
    const app = makeApp({
      enablePluginAndSave: async () => {
        tries += 1;
        if (tries === 1) throw new Error('manifest not found yet');
      },
    });

    expect(await enableInstalledPlugin(app, 'bz')).toBe(true);
    expect(tries).toBe(2);
  });

  it('两次都失败返回 false，不把异常抛给调用方', async () => {
    let tries = 0;
    const app = makeApp({
      enablePluginAndSave: async () => {
        tries += 1;
        throw new Error('nope');
      },
    });

    expect(await enableInstalledPlugin(app, 'bz')).toBe(false);
    expect(tries).toBe(2);
  });

  it('没有插件管理器、或只有扫描没有启用，一律 false 且不抛', async () => {
    expect(await enableInstalledPlugin(makeApp(undefined), 'bz')).toBe(false);
    expect(await enableInstalledPlugin(makeApp({}), 'bz')).toBe(false);
    expect(
      await enableInstalledPlugin(
        makeApp({
          loadManifests: async () => undefined,
        }),
        'bz',
      ),
    ).toBe(false);
  });
});
