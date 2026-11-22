import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 高分屏分页留白修复（上游 foliate-js bug）的补丁守卫。
 *
 * 上游把分页器 #top 的 grid-template-rows 写成
 *   minmax(margin,1fr) / minmax(0, max-height) / minmax(margin,1fr)
 * 正文轨被 max-height(1440px) 锁死，屏高超过它时多出的高度被上下两个 1fr
 * 均分，正文被挤到中下部、顶部空一大片（4K 3840x2070 实测）。
 *
 * 修复只能落在 vendor 补丁里——规则在 foliate 的 closed shadow DOM 内，
 * 运行时 CSS 变量覆盖不到 grid 结构本身。这里锁住补丁内容，防止 pnpm
 * 升级 / 重新生成 patch 时静默丢失这个修复。
 */
const here = dirname(fileURLToPath(import.meta.url));
const patch = readFileSync(join(here, '..', 'patches', 'foliate-js@1.0.1.patch'), 'utf8');

/** 取补丁里 grid-template-rows 那一段（到下一个属性为止） */
function gridRowsBlock(): string {
  const at = patch.indexOf('grid-template-rows:');
  expect(at, '补丁里应有 grid-template-rows 规则').toBeGreaterThan(-1);
  return patch.slice(at, patch.indexOf('&.vertical', at));
}

describe('foliate-js 高分屏分页留白补丁', () => {
  it('顶轨与底轨改成固定 margin，不再用 1fr 争抢高度', () => {
    const block = gridRowsBlock();
    expect(block).toContain('+                var(--_margin)');
    // 旧的居中写法必须被移除（diff 里的删除行）
    expect(block).toContain('-                minmax(var(--_margin), 1fr)');
    expect(block).not.toMatch(/\+[^\n]*minmax\(var\(--_margin\), 1fr\)/);
  });

  it('正文轨改成 minmax(0, 1fr) 吃满可用高度', () => {
    const block = gridRowsBlock();
    expect(block).toContain('+                minmax(0, 1fr)');
  });

  it('竖排的 --_max-width 语义保留，未被这次修复误伤', () => {
    expect(patch).toContain('--_max-width: var(--_max-block-size)');
  });
});
