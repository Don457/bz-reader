import { describe, expect, it } from 'vitest';
import {
  EXPORT_SIMPLE,
  builtinCopyTemplate,
  builtinTemplate,
  copyTemplateText,
  isBuiltinTemplate,
  isCopyTemplate,
  previewVars,
  renderCopyItem,
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
    /* 复制侧认同一组四档，不再有「单行别名」这种特殊档 */
    expect(isCopyTemplate('quote')).toBe(true);
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

describe('复制划线双链模板：与导出完全一致的四档', () => {
  const ids = ['simple', 'quote', 'detail', 'custom'] as const;

  it('四档正文与导出逐字相同：简洁是两行引用，两种 callout 可多行，自定义空串', () => {
    for (const id of ids) {
      expect(builtinCopyTemplate(id)).toBe(builtinTemplate(id));
    }
    expect(builtinCopyTemplate('simple')).toBe(EXPORT_SIMPLE);
    expect(builtinCopyTemplate('quote')).toContain('\n');
    expect(builtinCopyTemplate('quote')).toContain('[!quote]');
    expect(builtinCopyTemplate('detail')).toContain('\n');
    expect(builtinCopyTemplate('custom')).toBe('');
  });

  it('复制档认同一组 id：quote 合法，旧的 brief 档不存在', () => {
    for (const id of ids) expect(isCopyTemplate(id)).toBe(true);
    expect(isCopyTemplate('brief')).toBe(false);
    expect(isCopyTemplate(42)).toBe(false);
  });

  it('copyTemplateText：内置取模板，自定义取用户字符串（可多行）', () => {
    expect(copyTemplateText('quote', '被忽略')).toBe(builtinTemplate('quote'));
    expect(copyTemplateText('custom', '> [!note] {书名}\n> {双链}')).toBe('> [!note] {书名}\n> {双链}');
  });

  it('同样的数据下，复制渲染与导出渲染逐字一致（含双链、多行、callout）', () => {
    for (const id of ['simple', 'quote', 'detail'] as const) {
      const tpl = copyTemplateText(id, '');
      expect(renderCopyItem(tpl, vars())).toBe(renderExportItem(tpl, vars()));
    }
  });

  it('自定义档里的 {双链} 原样替换成可点链接，不再清方括号', () => {
    const out = renderCopyItem('> [!quote] {书名}\n> {双链}\n> {摘录}', vars());
    expect(out).toBe('> [!quote] 测试书\n> ' + vars().link + '\n> 这是原文摘录');
    expect(out).not.toContain('{双链}');
  });

  it('空模板回退到与导出相同的简洁档', () => {
    expect(renderCopyItem('', vars())).toBe(renderExportItem(EXPORT_SIMPLE, vars()));
  });

  it('无时间不编 1970；EPUB 位置退化成章节名也照导出口径，两边不出现分歧', () => {
    const v = vars({ time: '', location: '第一章' });
    const tpl = copyTemplateText('detail', '');
    const out = renderCopyItem(tpl, v);
    expect(out).toBe(renderExportItem(tpl, v));
    expect(out).not.toContain('1970');
  });
});
