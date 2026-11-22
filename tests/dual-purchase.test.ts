import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 双商店购买入口。
 *
 * 解锁弹层页脚给两颗按钮：中国大陆 → 国内店，其他地区 → Creem 海外店。
 * 不按界面语言自动跳——语言不等于国籍，让用户自己选，不会跳错。
 * 国内那颗保留 data-act="buy"，老调用与老测试继续有效；海外那颗是 buy-intl。
 */

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

import { PURCHASE_URL, PURCHASE_URL_INTL } from '../src/data/entitlement';
import { setLocale } from '../src/i18n';
import { overlayUnlock } from '../src/shell/overlay';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, setState, getState } from '../src/shell/state';

afterEach(() => {
  setLocale('zh');
  vi.unstubAllGlobals();
  setState({ ...DEFAULT_SHELL_STATE });
});

describe('双商店购买入口 · 常量', () => {
  it('国内店仍是原来的链动小铺，没被换掉', () => {
    expect(PURCHASE_URL).toBe('https://wzyp.cn/shop/IFCEI5I3');
  });

  it('海外店指向 Creem 商店', () => {
    expect(PURCHASE_URL_INTL).toBe('https://www.creem.io/stores/baizai');
  });

  it('两个地址不同：不能两颗按钮跳同一个店', () => {
    expect(PURCHASE_URL_INTL).not.toBe(PURCHASE_URL);
  });
});

describe('双商店购买入口 · 解锁弹层', () => {
  it('页脚有两颗购买按钮：buy 与 buy-intl 并存', () => {
    const html = overlayUnlock();
    expect(html).toContain('data-act="buy"');
    expect(html).toContain('data-act="buy-intl"');
  });

  it('中文界面按钮写「中国大陆」与「其他地区」', () => {
    const html = overlayUnlock();
    expect(html).toContain('中国大陆');
    expect(html).toContain('其他地区');
  });

  it('换到英文界面两颗按钮仍在，且不残留中文', () => {
    /* 按项目规矩：日常只写 zh.ts，外语包发版时统一翻译。
       这里只钉住「按钮跟着语言走、不留中文」，正式英文文案到发版补。 */
    setLocale('en');
    const html = overlayUnlock();
    expect(html).toContain('data-act="buy"');
    expect(html).toContain('data-act="buy-intl"');
    expect(html).not.toContain('中国大陆');
    expect(html).not.toContain('其他地区');
  });

  it('两颗按钮都在页脚，不散进正文对照表', () => {
    const html = overlayUnlock();
    const footAt = html.indexOf('<div class="bzs-mfoot">');
    expect(footAt).toBeGreaterThan(-1);
    expect(html.slice(0, footAt)).not.toContain('data-act="buy-intl"');
    expect(html.slice(footAt)).toContain('data-act="buy-intl"');
  });
});

describe('双商店购买入口 · 点击跳转', () => {
  it('国内按钮开国内店', () => {
    const opened: string[] = [];
    vi.stubGlobal('window', { open: (u: string) => void opened.push(u) });
    setState({ ...DEFAULT_SHELL_STATE, overlay: { kind: 'unlock', mode: '' } });
    dispatchAction('buy', { dataset: { act: 'buy' } } as unknown as HTMLElement);
    expect(opened).toEqual([PURCHASE_URL]);
  });

  it('海外按钮开 Creem 店', () => {
    const opened: string[] = [];
    vi.stubGlobal('window', { open: (u: string) => void opened.push(u) });
    setState({ ...DEFAULT_SHELL_STATE, overlay: { kind: 'unlock', mode: '' } });
    dispatchAction('buy-intl', { dataset: { act: 'buy-intl' } } as unknown as HTMLElement);
    expect(opened).toEqual([PURCHASE_URL_INTL]);
  });

  it('两颗按钮各跳各的，不串台', () => {
    const opened: string[] = [];
    vi.stubGlobal('window', { open: (u: string) => void opened.push(u) });
    setState({ ...DEFAULT_SHELL_STATE, overlay: { kind: 'unlock', mode: '' } });
    dispatchAction('buy', { dataset: { act: 'buy' } } as unknown as HTMLElement);
    dispatchAction('buy-intl', { dataset: { act: 'buy-intl' } } as unknown as HTMLElement);
    expect(opened).toEqual([PURCHASE_URL, PURCHASE_URL_INTL]);
  });
});
