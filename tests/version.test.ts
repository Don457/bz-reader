import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  inVersionRange,
  normalizeVersion,
  versionRangeText,
} from '../src/core/version';

describe('compareVersions', () => {
  it('按段比数字，不按字符串比', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.9', '0.1.10')).toBeLessThan(0);
    expect(compareVersions('1.6.0', '1.6.0')).toBe(0);
  });

  it('缺的段当 0，v 前缀与空白不影响', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('v1.4.2', '1.4.2')).toBe(0);
    expect(compareVersions(' 1.4.2 ', '1.4.1')).toBeGreaterThan(0);
  });

  it('空版本按 0 处理（与 changelog 既有口径一致）', () => {
    expect(compareVersions('', '0.1.0')).toBeLessThan(0);
    expect(compareVersions('', '')).toBe(0);
  });
});

describe('normalizeVersion', () => {
  it('去 v 前缀与空白，非字符串当空', () => {
    expect(normalizeVersion(' v1.4.2 ')).toBe('1.4.2');
    expect(normalizeVersion(undefined as unknown as string)).toBe('');
  });
});

describe('inVersionRange', () => {
  it('区间为空 = 不限制', () => {
    expect(inVersionRange('1.6.0', {})).toBe(true);
    expect(inVersionRange('0.0.1', {})).toBe(true);
  });

  it('下界含端点，上界不含端点', () => {
    const range = { min: '1.4.0', before: '1.5.0' };
    expect(inVersionRange('1.4.0', range)).toBe(true);
    expect(inVersionRange('1.4.9', range)).toBe(true);
    expect(inVersionRange('1.5.0', range)).toBe(false);
    expect(inVersionRange('1.3.9', range)).toBe(false);
  });

  it('只给下界 = 不低于；只给上界 = 低于', () => {
    expect(inVersionRange('1.6.0', { min: '1.6.0' })).toBe(true);
    expect(inVersionRange('1.5.9', { min: '1.6.0' })).toBe(false);
    expect(inVersionRange('1.5.9', { before: '1.6.0' })).toBe(true);
    expect(inVersionRange('1.6.0', { before: '1.6.0' })).toBe(false);
  });

  it('当前版本为空一律不通过（调用方负责「未知版本不判」）', () => {
    expect(inVersionRange('', { min: '1.4.0' })).toBe(false);
    expect(inVersionRange('', {})).toBe(true);
  });

  it('下界比上界还高时没有版本能通过', () => {
    expect(inVersionRange('1.4.0', { min: '1.5.0', before: '1.4.0' })).toBe(false);
  });
});

describe('versionRangeText', () => {
  it('整段主次版本压成 1.4.x', () => {
    expect(versionRangeText({ min: '1.4.0', before: '1.5.0' })).toBe('1.4.x');
  });

  it('不是整段时写清上下界', () => {
    expect(versionRangeText({ min: '1.4.2', before: '1.5.0' })).toBe('≥1.4.2 <1.5.0');
    expect(versionRangeText({ min: '1.4.0' })).toBe('≥1.4.0');
    expect(versionRangeText({ before: '1.5.0' })).toBe('<1.5.0');
  });

  it('空区间给空串，调用方据此不画限制', () => {
    expect(versionRangeText({})).toBe('');
  });
});
