import { describe, expect, it } from 'vitest';
import { compareVersions, normalizeVersion } from '../src/core/version';

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
