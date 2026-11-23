import { describe, expect, it } from 'vitest';
import {
  ALIAS_SIMPLE,
  EXPORT_SIMPLE,
  aliasForCopy,
  builtinTemplate,
  isBuiltinTemplate,
  previewVars,
  renderAlias,
  renderExportItem,
  templateVarsOf,
} from '../src/data/link-template';
import type { ReaderBook } from '../src/data/schema';
import { makeBook } from '../src/data/book-repo';

function book(): ReaderBook {
  const b = makeBook('书/测试书.epub', 'epub');
  b.meta.author = '作者甲';
  return b;
}

function vars(over: Partial<ReturnType<typeof templateVarsOf>> = {}) {
  return {
    title: '测试书',
    author: '作者甲',
    chapter: '第一章',
    location: '第 12 页',
    time: '2026-11-23 14:05',
    quote: '这是原文摘录',
    link: '[[书/测试书.epub#bzr-cfi=epubcfi(/6/4)|这是原文摘录]]',
    ...over,
  };
}

describe('内置模板登记', () => {
  it('previewVars 给出一组稳定示例值，供设置页渲染预览', () => {
    const v = previewVars();
    expect(v.title).toBeTruthy();
    expect(v.link).toContain('[[');
    expect(v.time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(previewVars()).toEqual(v); // 稳定，不随时间变
  });

  it('四个内置模板 id：简洁 / 两种 callout / 自定义，三种是导出、别名只有简洁', () => {
    expect(builtinTemplate('simple')).toBe(EXPORT_SIMPLE);
    expect(builtinTemplate('quote')).toContain('[!quote]');
    expect(builtinTemplate('detail')).toContain('[!note]');
    expect(builtinTemplate('custom')).toBe('');
    expect(isBuiltinTemplate('simple')).toBe(true);
    expect(isBuiltinTemplate('quote')).toBe(true);
    expect(isBuiltinTemplate('detail')).toBe(true);
    expect(isBuiltinTemplate('custom')).toBe(true);
    /* 别名是「一行链接显示文字」，不该塞进多行 callout */
    expect(ALIAS_SIMPLE).not.toContain('\n');
  });
});

describe('导出模板渲染', () => {
  it('默认简洁模板 = 当前格式：摘录双链 + 单独一行时间，完全向后兼容', () => {
    const out = renderExportItem(EXPORT_SIMPLE, vars());
    expect(out).toBe(
      `> ${vars().link}\n> ↳ ${vars().time}`,
    );
  });

  it('callout 引文模板：书名·章节作标题，摘录/位置/时间收进引文块', () => {
    const out = renderExportItem(builtinTemplate('quote'), vars());
    expect(out).toContain('> [!quote] 测试书 · 第一章');
    expect(out).toContain(`> ${vars().link}`);
    expect(out).toContain(`> ↳ ${vars().time} · ${vars().location}`);
  });

  it('callout 详细模板：位置进标题、时间写在末尾', () => {
    const out = renderExportItem(builtinTemplate('detail'), vars());
    expect(out).toContain('> [!note] 测试书 — 第一章 · 第 12 页');
    expect(out).toContain('> 划线于 2026-11-23 14:05');
  });

  it('自定义模板：占位符逐个替换，支持任意多行', () => {
    const tpl = '> [!cite] {书名} / {章节}\n> {双链}\n> 位置 {位置}，{时间}';
    const out = renderExportItem(tpl, vars());
    expect(out).toBe('> [!cite] 测试书 / 第一章\n> ' + vars().link + '\n> 位置 第 12 页，2026-11-23 14:05');
  });

  it('未知占位符原样保留，不会因为一个笔误就清空整条', () => {
    const out = renderExportItem('> {书名} {不存在的变量} {双链}', vars());
    expect(out).toContain('{不存在的变量}');
    expect(out).toContain('测试书');
    expect(out).toContain(vars().link);
  });

  it('空模板回退到简洁模板，不让用户误删后导出空行', () => {
    expect(renderExportItem('', vars())).toBe(renderExportItem(EXPORT_SIMPLE, vars()));
    expect(renderExportItem('   \n  ', vars())).toBe(renderExportItem(EXPORT_SIMPLE, vars()));
  });

  it('无时间的划线：回退模板只写双链一行，不写「> ↳ 」空行（与老路径逐字等价）', () => {
    const noTime = vars({ time: '' });
    expect(renderExportItem('', noTime)).toBe(`> ${noTime.link}`);
    expect(renderExportItem('', noTime)).not.toContain('↳');
  });

  it('老划线没有 createdAt：时间变量为空，绝不编出 1970-01-01', () => {
    const b = book();
    const v = templateVarsOf({ book: b, chapter: '第一章', quote: '划线', link: '[[x]]', createdAt: 0 });
    expect(v.time).toBe('');
    const out = renderExportItem(builtinTemplate('quote'), v);
    expect(out).not.toContain('1970');
    expect(out).not.toContain('1970-01-01 08:00');
  });

  it('用户填的摘录带换行时压平，不破坏引用块结构（竖线在引用块里安全，保留原样）', () => {
    const out = renderExportItem('> {摘录}\n> {双链}', vars({ quote: '上一行\n下一行 | 竖线' }));
    expect(out.split('\n').length).toBe(2);
    expect(out).not.toContain('\n下一行');
    expect(out).toContain('上一行 下一行 | 竖线');
  });

  it('占位符来自书与划线：EPUB 位置退回章节名，时间来自划线时间', () => {
    const b = book();
    const v = templateVarsOf({
      book: b,
      chapter: '第二章',
      quote: '划线文字',
      link: '[[x]]',
      createdAt: Date.UTC(2026, 10, 23, 6, 5), // 本地时区 +08 → 14:05
    });
    expect(v.title).toBe('测试书');
    expect(v.author).toBe('作者甲');
    expect(v.chapter).toBe('第二章');
    expect(v.location).toBe('第二章'); // EPUB 无页码：退回章节名，不编假页码
    expect(v.time).toBe('2026-11-23 14:05');
  });
});

describe('别名模板渲染（单条复制划线）', () => {
  it('默认别名 = 摘录原文，与现在完全一样', () => {
    expect(renderAlias(ALIAS_SIMPLE, vars())).toBe('这是原文摘录');
  });

  it('自定义别名把书名/章节/位置/时间拼进一行，且仍是一行', () => {
    const out = renderAlias('《{书名}》· {章节} · {位置} · {时间}', vars());
    expect(out).toBe('《测试书》· 第一章 · 第 12 页 · 2026-11-23 14:05');
    expect(out).not.toContain('\n');
  });

  it('别名里不会出现双链占位符——别名本身嵌在双链里，不能再套一层', () => {
    const out = renderAlias('{双链} {摘录}', vars());
    expect(out).not.toContain('[[');
    expect(out).toContain('这是原文摘录');
  });

  it('别名压平换行、去掉会破坏 wikilink 语法的方括号', () => {
    const out = renderAlias('{摘录}', vars({ quote: '上一行\n[[下一行]]' }));
    expect(out).not.toContain('\n');
    expect(out).not.toContain('[[');
  });

  it('空别名回退到摘录原文', () => {
    expect(renderAlias('', vars())).toBe('这是原文摘录');
  });

  it('aliasForCopy：模板为空时返回空串（让 wikilink 走原来的摘录别名），不覆盖默认', () => {
    expect(aliasForCopy('', book(), { chapter: '第一章', quote: '划线文字', createdAt: 0 })).toBe('');
  });

  it('aliasForCopy：有模板时给出渲染好的一行别名，作为 display 传给 wikilink', () => {
    const out = aliasForCopy('《{书名}》· {章节}', book(), {
      chapter: '第一章', quote: '划线文字', createdAt: Date.UTC(2026, 10, 23, 6, 5), page: 12,
    });
    expect(out).toBe('《测试书》· 第一章');
  });

  it('aliasForCopy：未落标注的选区无时间，别名含 {时间} 也不出现 1970', () => {
    const out = aliasForCopy('{章节} · {时间}', book(), {
      chapter: '第一章', quote: '划线文字', createdAt: 0,
    });
    expect(out).toBe('第一章 ·');
    expect(out).not.toContain('1970');
  });
});
