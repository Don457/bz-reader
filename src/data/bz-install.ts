/* ============================================================
 * bz-reader · bz 一键安装（data/bz-install.ts）
 *
 * 2026-11-22：和 bz Review 同一套「后台下载三件套 → 写插件目录 → 启用」。
 * 装 bz 是 bz Reader 的先决条件之一（剪藏本、AI 知识库、复习的向量都靠它），
 * 以前的引导只给一条教程链接，用户还得自己去找 Release 页。
 *
 * 与 review-install 共用 plugin-install.ts：
 *   · GitHub 优先、码云兜底；
 *   · 清单 id 必须是 `bz`，绝不会把 bz Review / bz Reader 的包装进来；
 *   · 只覆盖 main.js / manifest.json / styles.css，不碰 bz 自己的 data.json。
 * ============================================================ */
import type { App } from 'obsidian';
import { BZ_PLUGIN_ID } from './bz-bridge';
import {
  enableInstalledPlugin,
  fetchRelease,
  githubAssets,
  giteeAssets,
  installPlugin,
  isManifestOf,
  type PluginInstallResult,
  type PluginReleaseAssets,
  type PluginReleaseFiles,
  type PluginReleaseSpec,
} from './plugin-install';

const BZ_SPEC: PluginReleaseSpec = {
  id: BZ_PLUGIN_ID,
  github: 'https://github.com/yeshimei/bz/releases/latest/download',
  giteeApi: 'https://gitee.com/api/v5/repos/ntbl/bz/releases/latest',
};

/** GitHub 的 latest 直链：版本随 Release 自动跟进 */
export function bzGithubAssets(): PluginReleaseAssets {
  return githubAssets(BZ_SPEC);
}

/** 从码云的 release JSON 里挑三件套（缺一件就整批不装） */
export function bzGiteeAssets(json: unknown): PluginReleaseAssets | null {
  return giteeAssets(json);
}

/** 下载回来的清单是不是 bz 的：不是就停，别把别的插件装进来 */
export function isBzManifest(text: string): boolean {
  return isManifestOf(text, BZ_PLUGIN_ID);
}

/** 取三件套：GitHub 优先，失败切码云 */
export function fetchBzRelease(): Promise<PluginReleaseFiles | null> {
  return fetchRelease(BZ_SPEC);
}

/** 让宿主认识并启用刚写进去的 bz（设置页「启用」按钮也走它） */
export function enableInstalledBz(app: App): Promise<boolean> {
  return enableInstalledPlugin(app, BZ_PLUGIN_ID);
}

/** 一键安装并启用 */
export function installBz(app: App): Promise<PluginInstallResult> {
  return installPlugin(app, BZ_SPEC);
}
