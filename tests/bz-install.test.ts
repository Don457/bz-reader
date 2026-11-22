/**
 * bz 的一键安装（data/bz-install.ts）
 *
 * 与 bz Review 同一套「下载三件套 → 写插件目录 → 启用」，差别只在
 * 地址、id 与清单校验。这里钉住「不会把 bz Review 的包写进 bz 目录」。
 */
import { describe, expect, it } from 'vitest';
import { bzGiteeAssets, bzGithubAssets, isBzManifest } from '../src/data/bz-install';

describe('bzGithubAssets：GitHub 直链', () => {
  it('三件套都挂在 bz 仓库的 latest/download 下', () => {
    expect(bzGithubAssets()).toEqual({
      main: 'https://github.com/yeshimei/bz/releases/latest/download/main.js',
      manifest: 'https://github.com/yeshimei/bz/releases/latest/download/manifest.json',
      styles: 'https://github.com/yeshimei/bz/releases/latest/download/styles.css',
    });
  });
});

describe('bzGiteeAssets：码云备用线路', () => {
  it('三件套齐全才返回', () => {
    const json = {
      assets: [
        { name: 'main.js', browser_download_url: 'https://gitee.com/ntbl/bz/releases/download/v1.44.6/main.js' },
        {
          name: 'manifest.json',
          browser_download_url: 'https://gitee.com/ntbl/bz/releases/download/v1.44.6/manifest.json',
        },
        { name: 'styles.css', browser_download_url: 'https://gitee.com/ntbl/bz/releases/download/v1.44.6/styles.css' },
      ],
    };
    expect(bzGiteeAssets(json)?.manifest).toContain('/v1.44.6/manifest.json');
    expect(bzGiteeAssets({ assets: [] })).toBeNull();
  });
});

describe('isBzManifest：只认 bz 自己的清单', () => {
  it('id 是 bz 且有版本号才认', () => {
    expect(isBzManifest(JSON.stringify({ id: 'bz', version: '1.44.6' }))).toBe(true);
  });

  it('bz Review / bz Reader 的清单都不认', () => {
    expect(isBzManifest(JSON.stringify({ id: 'bz-review', version: '1.0.0' }))).toBe(false);
    expect(isBzManifest(JSON.stringify({ id: 'bz-reader', version: '1.0.0' }))).toBe(false);
    expect(isBzManifest(JSON.stringify({ id: 'bz', version: '  ' }))).toBe(false);
    expect(isBzManifest('')).toBe(false);
  });
});
