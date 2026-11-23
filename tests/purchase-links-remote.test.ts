/**
 * 购买链接走远程名单（bzr-data.json）。
 *
 * links 从两条扩成四条：support / buy（老字段保留）+ buyCn / buyIntl。
 * 购买入口按界面语言取对应那条，远程优先、内置兜底。作者在远程换支付
 * 渠道（换域名）后，用户联网拉到新数据 → 覆盖本地缓存 → 界面跟着换。
 *
 * 与反馈链接白名单隔离：购买链接只验 http(s)，不套 github/afdian/wzyp
 * 那套白名单——否则将来换 MoR / 新店铺域名会被判无效、整份数据作废。
 */
import { describe, expect, it } from 'vitest';
import {
  parseBzrData,
  purchaseUrlFor,
  safePurchaseUrl,
} from '../src/data/bzr-data';

const doc = (links: Record<string, unknown>) => JSON.stringify({
  version: 1,
  updatedAt: '2026-11-23',
  changelog: [{ version: '1.6.0', date: '2026-11-23', added: [
    { domain: { zh: '书架', en: 'Shelf' }, text: { zh: '改动', en: 'Change' } },
  ] }],
  roadmap: [],
  stats: { reward: 0, pro: 0, patrons: 0 },
  links,
});

describe('购买链接校验：不套反馈白名单', () => {
  it('任意 http(s) 域名都放行——方便将来换支付渠道', () => {
    expect(safePurchaseUrl('https://www.creem.io/stores/baizai')).toContain('creem.io');
    expect(safePurchaseUrl('https://some-new-mor.example.com/pay')).toContain('some-new-mor.example.com');
    expect(safePurchaseUrl('https://wzyp.cn/shop/IFCEI5I3')).toContain('wzyp.cn');
  });

  it('危险协议与坏格式仍然拒绝', () => {
    expect(safePurchaseUrl('javascript:alert(1)')).toBeNull();
    expect(safePurchaseUrl('ftp://x.com/a')).toBeNull();
    expect(safePurchaseUrl('not a url')).toBeNull();
    expect(safePurchaseUrl('')).toBeNull();
  });
});

describe('解析：四条链接', () => {
  it('buyCn / buyIntl 解析进 links', () => {
    const d = parseBzrData(doc({
      support: 'https://afdian.net/a/x',
      buy: 'https://wzyp.cn/shop/IFCEI5I3',
      buyCn: 'https://wzyp.cn/shop/IFCEI5I3',
      buyIntl: 'https://www.creem.io/stores/baizai',
    }));
    expect(d?.links.buyCn).toBe('https://wzyp.cn/shop/IFCEI5I3');
    expect(d?.links.buyIntl).toBe('https://www.creem.io/stores/baizai');
  });

  it('新字段是后加的：老数据缺这两条仍算有效', () => {
    const d = parseBzrData(doc({
      support: 'https://afdian.net/a/x',
      buy: 'https://wzyp.cn/shop/IFCEI5I3',
    }));
    expect(d).not.toBeNull();
    expect(d?.links.buyCn).toBe('');
    expect(d?.links.buyIntl).toBe('');
  });

  it('远程换成新域名的购买链接也能解析（不被白名单挡）', () => {
    const d = parseBzrData(doc({
      support: 'https://afdian.net/a/x',
      buy: 'https://newshop.example.com/buy',
      buyCn: 'https://newshop-cn.example.com/buy',
      buyIntl: 'https://newshop-intl.example.com/buy',
    }));
    expect(d?.links.buyCn).toContain('newshop-cn.example.com');
    expect(d?.links.buyIntl).toContain('newshop-intl.example.com');
  });
});

describe('purchaseUrlFor：远程优先、分语言、内置兜底', () => {
  const withLinks = (buyCn: string, buyIntl: string) => parseBzrData(doc({
    support: 'https://afdian.net/a/x',
    buy: 'https://wzyp.cn/shop/IFCEI5I3',
    buyCn, buyIntl,
  }));

  it('简中取 buyCn', () => {
    const d = withLinks('https://cn.example.com/pay', 'https://intl.example.com/pay');
    expect(purchaseUrlFor(true, d)).toBe('https://cn.example.com/pay');
  });

  it('非简中取 buyIntl', () => {
    const d = withLinks('https://cn.example.com/pay', 'https://intl.example.com/pay');
    expect(purchaseUrlFor(false, d)).toBe('https://intl.example.com/pay');
  });

  it('远程换成新店：重新解析后取到新地址（缓存刷新即同步）', () => {
    const old = withLinks('https://old-cn.example.com/pay', 'https://old-intl.example.com/pay');
    const fresh = withLinks('https://new-cn.example.com/pay', 'https://new-intl.example.com/pay');
    expect(purchaseUrlFor(true, old)).toContain('old-cn');
    expect(purchaseUrlFor(true, fresh)).toContain('new-cn');
    expect(purchaseUrlFor(false, fresh)).toContain('new-intl');
  });

  it('老数据缺字段：简中兜底国内店，非简中兜底 Creem', () => {
    const d = parseBzrData(doc({
      support: 'https://afdian.net/a/x',
      buy: 'https://wzyp.cn/shop/IFCEI5I3',
    }));
    expect(purchaseUrlFor(true, d)).toBe('https://wzyp.cn/shop/IFCEI5I3');
    expect(purchaseUrlFor(false, d)).toBe('https://www.creem.io/stores/baizai');
  });

  it('完全离线（无数据）：同样走内置兜底', () => {
    expect(purchaseUrlFor(true, null)).toBe('https://wzyp.cn/shop/IFCEI5I3');
    expect(purchaseUrlFor(false, null)).toBe('https://www.creem.io/stores/baizai');
  });
});
