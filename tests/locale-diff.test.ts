/**
 * 界面语言差异化：简体中文保留全部「中文生态」入口，非简体中文去掉。
 *
 * 简体中文（zh）── 微信赞赏码、QQ 群、各处的视频教程入口，全保留。
 * 非简体中文（zh-TW + 七种外语）──
 *   · 所有视频教程入口隐藏（B 站教程是简体中文讲解，海外/繁体用户看不动）；
 *   · QQ 群入口隐藏（海外没有 QQ，繁体人群也不常用）；
 *   · 支持作者弹层不显示二维码，只留一颗「支持作者」按钮跳 Creem 店，
 *     外加「给个 Star」（免费、海外可用，保留）。
 *
 * 判定只看界面语言，不猜国籍：界面语言是插件里唯一可靠、且不需联网的信号。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/core/notice', () => ({
  notify: () => undefined,
}));

vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return {
    ...actual,
    entitlement: () => ({
      tier: 'free' as const,
      unlocked: false,
      trialLeft: 0,
      trialUsed: 0,
      exp: 0,
      license: '',
      trialVoid: false,
      installId: 'test',
      days: [],
    }),
  };
});

import { isChineseUI, setLocale } from '../src/i18n';
import { CLIP_TUTORIAL_URL } from '../src/core/links';
import { supportDialogHtml } from '../src/shell/support-dialog';
import { clipEmptyHtml } from '../src/shell/clip-empty-dialog';
import { overlayUnlock } from '../src/shell/overlay';
import { viewSettings } from '../src/shell/render/settings';
import { changelogNoteHtml, setChangelogDataForTests } from '../src/shell/changelog-note';
import type { ChangelogRelease } from '../src/core/changelog-data';
import { DEFAULT_PREFS } from '../src/data/prefs';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { PURCHASE_URL_INTL } from '../src/data/entitlement';

/* 更新日志弹层要有一条 release 才渲染按钮区；传空数组会直接返回空串 */
const oneRelease = [{ version: '1.5.3', date: '2026-11-15', added: [{ domain: '书架', text: '一条改动' }], improved: [], fixed: [] }] as ChangelogRelease[];

beforeEach(() => setChangelogDataForTests(null));

afterEach(() => {
  setLocale('zh');
  vi.unstubAllGlobals();
});

function settingsHtml(): string {
  return viewSettings({
    prefs: DEFAULT_PREFS,
    settings: DEFAULT_SETTINGS,
    pen: 'amber',
    hotkeys: [],
    version: '1.5.1',
  });
}

/* 教程/群入口在这几个渲染器里的可识别标记 */
/* 只盯「入口标记」，不盯视频 URL 常量——URL 是点击时 window.open 的，
   不落在 HTML 上，其正确性由 ai-tutorial / tts-tutorial 等测试盯着。 */
const TUTORIAL_MARKS = ['data-act="aboutvideo"', 'data-act="aichattut"', 'data-act="bztut"', 'data-act="aitutorial"', 'data-role="clipempty-tutorial"', 'data-act="openvid"', 'data-act="chgnvideo"', CLIP_TUTORIAL_URL];
const GROUP_MARKS = ['data-act="copygroup"', 'data-act="chgnqq"'];

describe('界面语言判定', () => {
  it('简中是中文生态', () => {
    setLocale('zh');
    expect(isChineseUI()).toBe(true);
  });

  it('繁体不算中文生态（用 Creem、无 QQ/教程）', () => {
    setLocale('zh-TW');
    expect(isChineseUI()).toBe(false);
  });

  it('英文不算中文生态', () => {
    setLocale('en');
    expect(isChineseUI()).toBe(false);
  });

  it('其他外语也不算', () => {
    setLocale('ja');
    expect(isChineseUI()).toBe(false);
  });
});

describe('视频教程入口 · 按语言显隐', () => {
  it('简中：设置页/对照表/侧栏/剪藏空态/更新日志的教程入口都在', () => {
    setLocale('zh');
    const html = settingsHtml() + overlayUnlock() + clipEmptyHtml() + changelogNoteHtml(oneRelease);
    for (const mark of TUTORIAL_MARKS) {
      expect(html, `简中应保留 ${mark}`).toContain(mark);
    }
  });

  it('英文：所有教程入口全部消失', () => {
    setLocale('en');
    const html = settingsHtml() + overlayUnlock() + clipEmptyHtml() + changelogNoteHtml(oneRelease);
    for (const mark of TUTORIAL_MARKS) {
      expect(html, `英文不应有 ${mark}`).not.toContain(mark);
    }
  });

  it('繁体：教程入口同样全部消失', () => {
    setLocale('zh-TW');
    const html = settingsHtml() + overlayUnlock() + clipEmptyHtml() + changelogNoteHtml(oneRelease);
    for (const mark of TUTORIAL_MARKS) {
      expect(html, `繁体不应有 ${mark}`).not.toContain(mark);
    }
  });
});

describe('QQ 群入口 · 按语言显隐', () => {
  it('简中保留 QQ 群入口', () => {
    setLocale('zh');
    const html = settingsHtml() + overlayUnlock() + changelogNoteHtml(oneRelease);
    for (const mark of GROUP_MARKS) expect(html).toContain(mark);
  });

  it('英文与繁体去掉 QQ 群入口', () => {
    for (const lang of ['en', 'zh-TW'] as const) {
      setLocale(lang);
      const html = settingsHtml() + overlayUnlock() + changelogNoteHtml(oneRelease);
      for (const mark of GROUP_MARKS) expect(html, `${lang} 不应有 ${mark}`).not.toContain(mark);
    }
  });
});

describe('支持作者弹层 · 按语言变形', () => {
  it('简中：保留赞赏码与「成为赞助人」', () => {
    setLocale('zh');
    const html = supportDialogHtml([], '/qr.png');
    expect(html).toContain('/qr.png');
    expect(html).toContain('data-role="supsponsor"');
    expect(html).toContain('data-role="supstar"');
  });

  it('英文：不显示二维码，赞助与打赏合并成一颗按钮', () => {
    setLocale('en');
    const html = supportDialogHtml([], '/qr.png');
    expect(html).not.toContain('/qr.png');
    expect(html).not.toContain('<img');
    /* 合并后只有一颗「支持作者」按钮，不再是「成为赞助人」 */
    expect(html).toContain('data-role="supsponsor"');
    expect(html).not.toContain('data-role="supqr"');
  });

  it('英文：「给个 Star」保留', () => {
    setLocale('en');
    const html = supportDialogHtml([], '/qr.png');
    expect(html).toContain('data-role="supstar"');
  });

  it('繁体：与支持作者弹层同步去掉二维码', () => {
    setLocale('zh-TW');
    const html = supportDialogHtml([], '/qr.png');
    expect(html).not.toContain('/qr.png');
    expect(html).not.toContain('<img');
  });
});

describe('支持作者按钮跳转', () => {
  it('非简体中文的赞助按钮跳 Creem 店', async () => {
    setLocale('en');
    const { openSupportDialog } = await import('../src/shell/support-dialog');
    /* 只验常量：跳转目标就是海外店，国内简中才走 SPONSOR_URL */
    expect(PURCHASE_URL_INTL).toBe('https://www.creem.io/stores/baizai');
    expect(typeof openSupportDialog).toBe('function');
  });
});
