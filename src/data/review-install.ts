/* ============================================================
 * bz-reader · bz review 一键安装（data/review-install.ts）
 *
 * 2026-11-21 起「下载安装」不再跳浏览器：点一下就在后台把三件套写到
 * `<配置目录>/plugins/bz-review/` 并让宿主启用。用户不用自己找下载页、
 * 解压、建目录、重启。
 *
 * 2026-11-22：下载 / 写盘 / 启用的通用逻辑抽进 plugin-install.ts（bz 也用
 * 同一套），这里只留 bz review 的地址与 id。对外签名不变，调用方与测试
 * 不用跟着改。
 * ============================================================ */
import type { App } from 'obsidian';
import { REVIEW_PLUGIN_ID } from './review-bridge';
import {
  enableInstalledPlugin,
  fetchRelease,
  githubAssets,
  giteeAssets,
  installPlugin,
  isManifestOf,
  type PluginInstallError,
  type PluginInstallResult,
  type PluginReleaseAssets,
  type PluginReleaseFiles,
  type PluginReleaseSpec,
} from './plugin-install';

/** 三件套的下载地址 */
export type ReviewReleaseAssets = PluginReleaseAssets;
/** 下载并校验过的三件套 */
export type ReviewReleaseFiles = PluginReleaseFiles;
export type ReviewInstallError = PluginInstallError;
export type ReviewInstallResult = PluginInstallResult;

const REVIEW_SPEC: PluginReleaseSpec = {
  id: REVIEW_PLUGIN_ID,
  github: 'https://github.com/yeshimei/bz-review/releases/latest/download',
  giteeApi: 'https://gitee.com/api/v5/repos/ntbl/bz-review/releases/latest',
};

/** GitHub 的 latest 直链：版本随 Release 自动跟进 */
export function reviewGithubAssets(): ReviewReleaseAssets {
  return githubAssets(REVIEW_SPEC);
}

/** 从码云的 release JSON 里挑三件套（缺一件就整批不装） */
export function reviewGiteeAssets(json: unknown): ReviewReleaseAssets | null {
  return giteeAssets(json);
}

/** 下载回来的清单是不是 bz review 的：不是就停，别把别的插件装进来 */
export function isReviewManifest(text: string): boolean {
  return isManifestOf(text, REVIEW_PLUGIN_ID);
}

/** 取三件套：GitHub 优先，失败切码云 */
export function fetchReviewRelease(): Promise<ReviewReleaseFiles | null> {
  return fetchRelease(REVIEW_SPEC);
}

/** 让宿主认识并启用刚写进去的 bz review（设置页「启用」按钮也走它） */
export function enableInstalledReview(app: App): Promise<boolean> {
  return enableInstalledPlugin(app, REVIEW_PLUGIN_ID);
}

/** 一键安装并启用 */
export function installReview(app: App): Promise<ReviewInstallResult> {
  return installPlugin(app, REVIEW_SPEC);
}
