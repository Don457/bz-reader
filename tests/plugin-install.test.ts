/**
 * 一键安装的通用件（data/plugin-install.ts）
 *
 * 2026-11-22：bz Review 与 bz 两处都是「下载三件套 → 写插件目录 → 启用」，
 * 抽成一份。这里钉地址拼装、码云资产挑选与清单校验三件纯逻辑；
 * 写盘与启用交给真机验证（和 review-install 同一条边界）。
 */
import { describe, expect, it } from 'vitest';
import { githubAssets, giteeAssets, isManifestOf, type PluginReleaseSpec } from '../src/data/plugin-install';

const spec: PluginReleaseSpec = {
  id: 'bz',
  github: 'https://github.com/yeshimei/bz/releases/latest/download',
  giteeApi: 'https://gitee.com/api/v5/repos/ntbl/bz/releases/latest',
};

describe('githubAssets：GitHub 直链', () => {
  it('三件套都挂在 latest/download 下，版本随发布自动跟进', () => {
    expect(githubAssets(spec)).toEqual({
      main: 'https://github.com/yeshimei/bz/releases/latest/download/main.js',
      manifest: 'https://github.com/yeshimei/bz/releases/latest/download/manifest.json',
      styles: 'https://github.com/yeshimei/bz/releases/latest/download/styles.css',
    });
  });

  it('换一个插件前缀，地址跟着换，不会串到另一个插件', () => {
    expect(githubAssets({ ...spec, github: 'https://github.com/yeshimei/bz-review/releases/latest/download' }).main).toBe(
      'https://github.com/yeshimei/bz-review/releases/latest/download/main.js',
    );
  });
});

describe('giteeAssets：从码云 release JSON 里挑下载地址', () => {
  const json = {
    tag_name: 'v1.44.6',
    assets: [
      { name: 'main.js', browser_download_url: 'https://gitee.com/ntbl/bz/releases/download/v1.44.6/main.js' },
      {
        name: 'manifest.json',
        browser_download_url: 'https://gitee.com/ntbl/bz/releases/download/v1.44.6/manifest.json',
      },
      { name: 'styles.css', browser_download_url: 'https://gitee.com/ntbl/bz/releases/download/v1.44.6/styles.css' },
      { name: 'bz-1.44.6.zip', browser_download_url: 'https://gitee.com/ntbl/bz/releases/download/v1.44.6/bz.zip' },
    ],
  };

  it('挑出三件套，zip 不进列表', () => {
    expect(giteeAssets(json)).toEqual({
      main: 'https://gitee.com/ntbl/bz/releases/download/v1.44.6/main.js',
      manifest: 'https://gitee.com/ntbl/bz/releases/download/v1.44.6/manifest.json',
      styles: 'https://gitee.com/ntbl/bz/releases/download/v1.44.6/styles.css',
    });
  });

  it('缺任何一件都算拿不到，不拼半套地址', () => {
    expect(giteeAssets({ assets: [{ name: 'main.js', browser_download_url: 'x' }] })).toBeNull();
    expect(giteeAssets(null)).toBeNull();
    expect(giteeAssets({})).toBeNull();
  });
});

describe('isManifestOf：别把别的插件装进来', () => {
  it('id 对得上且有版本号才认', () => {
    expect(isManifestOf(JSON.stringify({ id: 'bz', version: '1.44.6' }), 'bz')).toBe(true);
  });

  it('别的 id / 坏 JSON / 空版本都不认', () => {
    expect(isManifestOf(JSON.stringify({ id: 'bz-review', version: '1.44.6' }), 'bz')).toBe(false);
    expect(isManifestOf(JSON.stringify({ id: 'bz-reader', version: '1.44.6' }), 'bz')).toBe(false);
    expect(isManifestOf(JSON.stringify({ id: 'bz', version: '' }), 'bz')).toBe(false);
    expect(isManifestOf('<!DOCTYPE html><html>404</html>', 'bz')).toBe(false);
    expect(isManifestOf('', 'bz')).toBe(false);
  });
});
