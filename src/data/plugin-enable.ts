/* ============================================================
 * bz-reader · 让宿主启用一个已装插件（data/plugin-enable.ts）
 *
 * 2026-11-23：bz / bz review 的「后台下载三件套 → 写插件目录」整条删掉后，
 * 这里只留最后一步。bz review 在官方插件市场里、bz 走 GitHub 发布页，
 * 下什么、装到哪都交给用户与宿主，本插件不再往插件目录写任何文件。
 *
 * 两条边界：
 *   1. 只读宿主的插件管理器，不碰磁盘；
 *   2. 失败返回 false，由壳层翻成人话，数据层不弹通知。
 * ============================================================ */
import type { App } from 'obsidian';

interface HostPlugins {
  loadManifests?: () => Promise<void>;
  loadManifest?: (id: string) => unknown;
  enablePluginAndSave?: (id: string) => Promise<void>;
  enablePlugin?: (id: string) => Promise<void>;
}

function hostPlugins(app: App): HostPlugins | undefined {
  return (app as unknown as { plugins?: HostPlugins })?.plugins;
}

/**
 * 让宿主认识并启用一个已经装好的插件（设置页「启用」按钮走它）。
 *
 * 顺序不能反：loadManifests 把插件目录扫进 manifest 表，
 * enablePluginAndSave 才找得到它；后者同时把 id 写进 community-plugins.json，
 * 重启后仍启用。老版本没有 loadManifests 时退回 loadManifest（单条）。
 *
 * 失败重试一次：真机（2026-11-21）第一次点「启用」时宿主对「刚出现的插件
 * 目录」的扫描有时晚一拍，手动再点一次就好。停半秒重扫再试，第二次仍失败
 * 才算真失败。
 */
export async function enableInstalledPlugin(app: App, id: string): Promise<boolean> {
  const plugins = hostPlugins(app);
  if (!plugins) return false;
  const run = async (): Promise<boolean> => {
    if (plugins.loadManifests) await plugins.loadManifests();
    else if (plugins.loadManifest) plugins.loadManifest(id);
    if (plugins.enablePluginAndSave) await plugins.enablePluginAndSave(id);
    else if (plugins.enablePlugin) await plugins.enablePlugin(id);
    else return false;
    return true;
  };
  try {
    return await run();
  } catch {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
    try {
      return await run();
    } catch {
      return false;
    }
  }
}
