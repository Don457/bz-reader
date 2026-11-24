import { describe, it, expect } from 'vitest';
import { findTooltipAttrs } from '../scripts/check-tooltip-attrs.mjs';

describe('禁止悬停气泡属性', () => {
  it('抓到模板字符串里的 aria-label 与 title', () => {
    const src = '<button aria-label="关闭" title="关闭">✕</button>';
    expect(findTooltipAttrs(src).length).toBeGreaterThan(0);
  });

  it('抓到 setAttribute 与 setTooltip', () => {
    const src = "el.setAttribute('aria-label', '关闭'); btn.setTooltip('提示');";
    expect(findTooltipAttrs(src).length).toBe(2);
  });

  it('数据字段的 title 赋值不算违规', () => {
    const clean = `book.meta.title = m.title;\nconst o = { title: 'x' }; o.title = 'y';`;
    expect(findTooltipAttrs(clean)).toEqual([]);
  });

  it('视觉隐藏文本写法不算违规', () => {
    const clean = `el.appendChild(srText('关闭')); span.className = 'bzrv-sr-only';`;
    expect(findTooltipAttrs(clean)).toEqual([]);
  });

  it('抓到 DOM 元素的 .title = 赋值（门禁原来漏检这种写法）', () => {
    const src = `if (annot.contents) mark.title = annot.contents.slice(0, 300);`;
    expect(findTooltipAttrs(src).length).toBeGreaterThan(0);
  });

  it('放行路径下 setTooltip 不算违规，但同一份代码的 aria-label 仍旧拦', () => {
    const src = `btn.setTooltip(t); el.setAttribute('aria-label', 'x');`;
    /* 放行的是「某一种写法 + 某一处文件」，不是整份文件免检 */
    const hits = findTooltipAttrs(src, 'src/view/header-tooltip.ts');
    expect(hits.length).toBe(1);
    expect(hits[0].why).toBe('setAttribute tooltip attr');
  });

  it('非放行路径下同一句 setTooltip 照样报出来', () => {
    const src = `btn.setTooltip(t);`;
    expect(findTooltipAttrs(src, 'src/view/reader-view.ts').length).toBeGreaterThan(0);
  });

  it('obsidian 全局函数写法 setTooltip(el, t) 也拦，不给绕过门禁的后门', () => {
    const src = `import { setTooltip } from 'obsidian'; setTooltip(el, '提示');`;
    expect(findTooltipAttrs(src, 'src/view/reader-view.ts').filter((h) => h.why === 'setTooltip').length)
      .toBeGreaterThan(0);
    expect(findTooltipAttrs(src, 'src/view/header-tooltip.ts')).toEqual([]);
  });
});
