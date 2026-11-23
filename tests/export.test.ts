import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { makeBook } from '../src/data/book-repo';
import { addBookmark, addHighlight, DEFAULT_HIGHLIGHT_COLOR } from '../src/data/notes';
import { buildNotesBody, buildNotesMarkdown, EXPORT_MARK, exportBookNotes, exportStampOf, safeName } from '../src/data/export';
import { parseWikilinkHref } from '../src/data/wikilink';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { FakeAdapter } from './helpers/fake-adapter';

/** 把导出文本里的双链逐条解析回来：断言的是「点下去会落到哪」，不是字符串长相 */
function linksIn(md: string) {
  const out: Array<{ alias: string; sub: string; parsed: ReturnType<typeof parseWikilinkHref> }> = [];
  for (const m of md.matchAll(/\[\[([^\]|]+)\|([^\]]+)\]\]/g)) {
    out.push({ sub: m[1], alias: m[2], parsed: parseWikilinkHref(m[1]) });
  }
  return out;
}

function bookWithNotes() {
  const book = makeBook('书/测试书.epub', 'epub');
  book.meta.author = '作者甲';
  const h1 = addHighlight(book, { text: '第一章的划线', cfiRange: 'c1', chapterIndex: 0, chapterTitle: '第一章' });
  addHighlight(book, { text: '第一章第二条', cfiRange: 'c1b', chapterIndex: 0, chapterTitle: '第一章', comment: '有意思' });
  const h3 = addHighlight(book, { text: '第二章的划线', cfiRange: 'c2', chapterIndex: 1, chapterTitle: '第二章' });
  addBookmark(book, { cfi: 'm1', percent: 0.42, chapterTitle: '第二章' });
  return { book, h1, h3 };
}

describe('标注导出成 Markdown', () => {
  it('frontmatter 带书名/作者/导出日，正文带插件标记', () => {
    const { book } = bookWithNotes();
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    expect(md).toContain('title: "测试书"');
    expect(md).toContain('author: "作者甲"');
    expect(md).toContain(EXPORT_MARK);
    expect(exportStampOf(md)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  /* 属性表里每多一行机器字段，打开笔记第一眼就多一块噪音。条数写进正文
     那一行够看；frontmatter 只留「能被查、能被认领」的字段。 */
  it('frontmatter 不堆机器字段：条数不占属性表', () => {
    const { book } = bookWithNotes();
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    expect(md).not.toContain('highlights: 3');
    expect(md).not.toContain('bookmarks: 1');
    expect(md).not.toContain('progress:');
  });

  /* 双链是这次的主功能：每条摘录自己就是一条能点回原文的链接。
     别名用原文，点文字就跳回去——不用在段落末尾再挂一条「查看原文」。 */
  it('每条摘录都是双链，文字即链', () => {
    const { book } = bookWithNotes();
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    /* 同一本书的书签也带链接，这里只看那三条划线（cfi 以 c 开头） */
    const hit = linksIn(md).filter((l) => l.parsed?.target.cfi?.startsWith('c'));
    expect(hit).toHaveLength(3);
    const first = hit.find((l) => l.alias === '第一章的划线');
    expect(first?.parsed?.target.cfi).toBe('c1');
    expect(first?.parsed?.target.text).toBe('第一章的划线');
    expect(first?.parsed?.target.chapter).toBe('第一章');
    /* 不能再退回「裸引用」：一段没有链接的摘录是死笔记 */
    expect(md).not.toContain('> 第一章的划线');
  });

  it('书签也带双链：按百分比能跳回去', () => {
    const { book } = bookWithNotes();
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    const bm = linksIn(md).find((l) => l.parsed?.target.pct === 0.42);
    expect(bm).toBeTruthy();
    expect(bm?.parsed?.target.cfi).toBe('m1');
    expect(bm?.parsed?.target.chapter).toBe('第二章');
  });

  it('按章节分组，章节顺序不乱；想法压在引用下面', () => {
    const { book } = bookWithNotes();
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    const atCh1 = md.indexOf('## 第一章');
    const atCh2 = md.indexOf('## 第二章');
    expect(atCh1).toBeGreaterThan(0);
    expect(atCh2).toBeGreaterThan(atCh1);
    expect(md).toContain('|第一章第二条]]');
    /* 想法是斜体一段，不写「想法：」前缀：前缀每行重复，读起来像表单 */
    expect(md).toContain('*有意思*');
  });

  it('想法里自带 * 时原样保留，不再包一层斜体', () => {
    const book = makeBook('书/想法.epub', 'epub');
    addHighlight(book, { text: '一句', cfiRange: 'c1', comment: '这里用了**反讽**' });
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    expect(md).toContain('这里用了**反讽**');
    expect(md).not.toContain('*这里用了');
  });

  it('关掉「带想法」就只导原文引用', () => {
    const { book } = bookWithNotes();
    const md = buildNotesMarkdown(book, { ...DEFAULT_SETTINGS, exportComments: false });
    expect(md).not.toContain('有意思');
    expect(md).toContain('|第一章第二条]]');
  });

  it('没有划线也没有书签时不该生成空笔记（数据层返回 null 的依据）', () => {
    const book = makeBook('书/空书.epub', 'epub');
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    expect(md).toContain('还没有划线或书签');
    expect(DEFAULT_HIGHLIGHT_COLOR).toBe('amber');
  });

  it('多行摘录压平：换行压成空格后，中文之间不残留空格', () => {
    const book = makeBook('书/平.epub', 'epub');
    addHighlight(book, { text: '她转过身，\n没有回头', cfiRange: 'x' });
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    expect(md).toContain('|她转过身，没有回头]]');
  });

  /* 摘录是用户选的原话，可能自带 `|` `]` `[[`：别名里出现未转义的竖线
     会把后面的内容全吞进别名，方括号会让 `[[…]]` 提前闭合。 */
  it('原文里的 | 和方括号不会撑破双链', () => {
    const book = makeBook('书/符号.epub', 'epub');
    addHighlight(book, { text: '他说“A|B”，还写了 [[双链]] 与 [链接](x)', cfiRange: 'x1' });
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    const ln = linksIn(md)[0];
    expect(ln).toBeTruthy();
    expect(ln.parsed?.target.cfi).toBe('x1');
    expect(ln.alias).toContain('A\\|B');
    expect(ln.alias).not.toContain('[[双链]]');
  });

  it('书名/作者里的换行不能注入 frontmatter', () => {
    const { book } = bookWithNotes();
    book.meta.title = '正常书名"\nmalicious: 1\n---';
    book.meta.author = '作者\n注入';
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    /* 换行压平后整串仍在同一个引号里——不能变成新的 YAML 键或提前结束头部 */
    expect(md).toContain('title: "正常书名\\" malicious: 1 ---"');
    const front = md.slice(0, md.indexOf('\n---', 4));
    expect(front.split('\n').some((line) => line.startsWith('malicious:'))).toBe(false);
    expect(md.split('\n').some((line) => line.startsWith('注入'))).toBe(false);
  });

  it('frontmatter 写 bookId，同名书才认得出各自那份（A-16）', () => {
    const { book } = bookWithNotes();
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    expect(md).toContain(`bookId: "${book.id}"`);
  });

  it('PDF 划线带上页码回链：导出的笔记能点回原页', () => {
    const book = makeBook('书/论文.pdf', 'pdf');
    book.meta.title = '论文';
    addHighlight(book, { text: '第 12 页那句', cfiRange: 'pdf/12/0-5', chapterTitle: '第 12 页' });
    addHighlight(book, { text: '第 30 页那句', cfiRange: 'pdf/30/2-9', chapterTitle: '第 30 页' });
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    /* 链接要能跳回那一页：`page=` 给原生视图和 PDF++，`bzr=` 给我们自己 */
    const pages = linksIn(md)
      .map((l) => l.sub)
      .filter((s) => s.includes('page='));
    expect(pages.some((s) => s.includes('page=12&') && s.includes('bzr='))).toBe(true);
    expect(pages.some((s) => s.includes('page=30&') && s.includes('bzr='))).toBe(true);
    /* 别名是原文：点那句就回去 */
    expect(linksIn(md).map((l) => l.alias)).toContain('第 12 页那句');
  });

  it('EPUB 划线不加页码链接：它没有「页」这个概念', () => {
    const { book } = bookWithNotes();
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    expect(md).not.toContain('#page=');
  });

  /* 复制 Markdown / 弹层预览 / 落盘，以前是三段各写各的，同一本书三种样子。
     现在正文只有一份：落盘 = frontmatter + 这份正文。 */
  it('复制与预览用的正文，和落盘版逐字一致（只差 frontmatter）', () => {
    const { book } = bookWithNotes();
    const md = buildNotesMarkdown(book, DEFAULT_SETTINGS);
    const body = buildNotesBody(book, DEFAULT_SETTINGS);
    expect(body.startsWith('---')).toBe(false);
    expect(body.startsWith('# 测试书')).toBe(true);
    expect(md.endsWith(body)).toBe(true);
  });

  it('正文版也带双链：复制到剪贴板粘回 Obsidian 仍然能跳', () => {
    const { book } = bookWithNotes();
    const body = buildNotesBody(book, DEFAULT_SETTINGS);
    expect(linksIn(body).length).toBeGreaterThanOrEqual(4);
  });
});

/* ── A4：文件名与目录的边界 ─────────────────────────────────── */

describe('文件名安全（A4）', () => {
  it('Windows 保留名加前缀：CON.md 在那台机器上根本写不进去', () => {
    expect(safeName('CON')).toBe('_CON');
    expect(safeName('nul')).toBe('_nul');
    expect(safeName('COM3')).toBe('_COM3');
    /* 名字里只是含有这几个字母的不算保留名 */
    expect(safeName('CONSTANT')).toBe('CONSTANT');
  });

  it('路径穿越被压成一个普通名字：不产生越界路径', () => {
    expect(safeName('../x')).toBe('x');
    expect(safeName('../../etc/passwd')).toBe('etc passwd');
    expect(safeName('/')).toBe('未命名');
    expect(safeName('..')).toBe('未命名');
  });

  it('控制字符与结尾的点/空格都清掉', () => {
    expect(safeName('a\u0000b')).toBe('a b');
    expect(safeName('书.')).toBe('书');
    expect(safeName('  ')).toBe('未命名');
  });

  it('书名 CON 也能导出成一个真实文件', async () => {
    const adapter = new FakeAdapter();
    const app = { vault: { adapter, configDir: '.obsidian' } } as unknown as App;
    const b = makeBook('书/con.epub', 'epub');
    b.meta.title = 'CON';
    addHighlight(b, { text: '一句话', cfiRange: 'c1' });

    const r = await exportBookNotes(app, b, DEFAULT_SETTINGS);
    expect(r?.path).toBe('bz-reader/notes/_CON.md');
    expect(adapter.files.has('bz-reader/notes/_CON.md')).toBe(true);
  });

  it('导出目录设成库根（/）就落在根上，不悄悄换回默认目录', async () => {
    const adapter = new FakeAdapter();
    const app = { vault: { adapter, configDir: '.obsidian' } } as unknown as App;
    const b = makeBook('书/a.epub', 'epub');
    b.meta.title = '根目录的书';
    addHighlight(b, { text: '一句话', cfiRange: 'c1' });

    const r = await exportBookNotes(app, b, { ...DEFAULT_SETTINGS, exportDir: '/' });
    expect(r?.path).toBe('根目录的书.md');
    expect(adapter.files.has('根目录的书.md')).toBe(true);
  });

  it('同名文件读不出来时让开，不赌它是自己的（读失败 ≠ 可以覆盖）', async () => {
    const adapter = new FakeAdapter();
    const app = { vault: { adapter, configDir: '.obsidian' } } as unknown as App;
    const mine = makeBook('书/a.epub', 'epub');
    mine.meta.title = '同名书';
    addHighlight(mine, { text: '一句话', cfiRange: 'c1' });
    adapter.files.set('bz-reader/notes/同名书.md', '别的笔记');
    const original = adapter.read.bind(adapter);
    adapter.read = async (path: string) => {
      if (path === 'bz-reader/notes/同名书.md') throw new Error('EACCES: locked');
      return original(path);
    };

    const r = await exportBookNotes(app, mine, DEFAULT_SETTINGS);
    expect(r?.path).toBe('bz-reader/notes/同名书 (2).md');
    expect(adapter.files.get('bz-reader/notes/同名书.md')).toBe('别的笔记');
  });
});

describe('导出目标路径（A-16）', () => {
  function appWith(adapter: FakeAdapter): App {
    return { vault: { adapter, configDir: '.obsidian' } } as unknown as App;
  }

  function bookNamed(title: string, path: string) {
    const b = makeBook(path, 'epub');
    b.meta.title = title;
    addHighlight(b, { text: '一句话', cfiRange: 'c1' });
    return b;
  }

  it('两本同名书导出到不同文件，不互相覆盖', async () => {
    const adapter = new FakeAdapter();
    const app = appWith(adapter);
    const a = bookNamed('同名书', '书/a.epub');
    const b = bookNamed('同名书', '书/b.epub');

    const ra = await exportBookNotes(app, a, DEFAULT_SETTINGS);
    const rb = await exportBookNotes(app, b, DEFAULT_SETTINGS);

    expect(ra?.path).toBe('bz-reader/notes/同名书.md');
    expect(rb?.path).toBe('bz-reader/notes/同名书 (2).md');
    expect(adapter.files.get('bz-reader/notes/同名书.md')).toContain(`bookId: "${a.id}"`);
    expect(adapter.files.get('bz-reader/notes/同名书 (2).md')).toContain(`bookId: "${b.id}"`);
  });

  it('同一本书再导出：bookId 对得上就复用原路径，不堆 (2)(3)', async () => {
    const adapter = new FakeAdapter();
    const app = appWith(adapter);
    const a = bookNamed('同名书', '书/a.epub');

    const first = await exportBookNotes(app, a, DEFAULT_SETTINGS);
    addHighlight(a, { text: '第二条', cfiRange: 'c2' });
    const second = await exportBookNotes(app, a, DEFAULT_SETTINGS);

    expect(first?.path).toBe('bz-reader/notes/同名书.md');
    expect(second?.path).toBe('bz-reader/notes/同名书.md');
    expect(adapter.files.get('bz-reader/notes/同名书.md')).toContain('第二条');
  });

  it('同名文件是别人的笔记（没有 bookId / 没有插件标记）：让开，不覆盖', async () => {
    const adapter = new FakeAdapter();
    const app = appWith(adapter);
    const mine = bookNamed('同名书', '书/a.epub');
    adapter.files.set('bz-reader/notes/同名书.md', '我自己的读书笔记，不能被插件冲掉');

    const r = await exportBookNotes(app, mine, DEFAULT_SETTINGS);

    expect(r?.path).toBe('bz-reader/notes/同名书 (2).md');
    expect(adapter.files.get('bz-reader/notes/同名书.md')).toBe('我自己的读书笔记，不能被插件冲掉');
  });

  it('旧版导出（有插件标记但没有 bookId）也不能被当作同一本覆盖（A-16 的取舍）', async () => {
    const adapter = new FakeAdapter();
    const app = appWith(adapter);
    const mine = bookNamed('同名书', '书/a.epub');
    adapter.files.set(
      'bz-reader/notes/同名书.md',
      ['---', 'title: "同名书"', '---', EXPORT_MARK, '', '# 同名书'].join('\n'),
    );

    const r = await exportBookNotes(app, mine, DEFAULT_SETTINGS);

    expect(r?.path).toBe('bz-reader/notes/同名书 (2).md');
  });
});

/** 双链导出模板：接进 buildNotesBody，默认不变，选模板后每条摘录换排版 */
describe('导出模板接入', () => {
  it('默认设置导出的正文 = 现在的格式（摘录双链 + 单独一行时间）', () => {
    const { book } = bookWithNotes();
    const md = buildNotesBody(book, DEFAULT_SETTINGS);
    expect(md).toMatch(/> \[\[书\/测试书\.epub#[^\]]+\|第一章的划线\]\]/);
    expect(md).toMatch(/> ↳ \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(md).not.toContain('[!quote]');
    expect(md).not.toContain('[!note]');
  });

  it('选 callout 引文模板：每条摘录变成 callout 块，书名·章节进标题', () => {
    const { book } = bookWithNotes();
    const md = buildNotesBody(book, { ...DEFAULT_SETTINGS, exportTemplate: 'quote' });
    expect(md).toContain('> [!quote] 测试书 · 第一章');
    expect(md).toContain('> [!quote] 测试书 · 第二章');
    /* 双链仍在，点文字跳原文 */
    expect(linksIn(md).filter((l) => l.parsed?.target.cfi?.startsWith('c'))).toHaveLength(3);
  });

  it('callout 详细模板：位置进标题、时间写在末尾', () => {
    const { book } = bookWithNotes();
    const md = buildNotesBody(book, { ...DEFAULT_SETTINGS, exportTemplate: 'detail' });
    expect(md).toContain('> [!note] 测试书 — 第一章 · 第一章');
    expect(md).toContain('> 划线于 ');
  });

  it('自定义模板：用户字符串里的占位符被真实值替换，链接仍可解析', () => {
    const { book } = bookWithNotes();
    const md = buildNotesBody(book, {
      ...DEFAULT_SETTINGS,
      exportTemplate: 'custom',
      exportTemplateCustom: '> [!cite] 《{书名}》· {章节}\n> {双链}',
    });
    expect(md).toContain('> [!cite] 《测试书》· 第一章');
    expect(linksIn(md).filter((l) => l.parsed?.target.cfi?.startsWith('c'))).toHaveLength(3);
  });

  it('自定义模板设成空：回退简洁模板，不导出空摘录', () => {
    const { book } = bookWithNotes();
    const fallback = buildNotesBody(book, DEFAULT_SETTINGS);
    const md = buildNotesBody(book, { ...DEFAULT_SETTINGS, exportTemplate: 'custom', exportTemplateCustom: '  ' });
    expect(md).toBe(fallback);
  });
});
