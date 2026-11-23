/**
 * 复制划线双链模板的行为测试（tests/copy-template-actions.test.ts）
 *
 * 四档配置真正的出口在 shell 层：笔记页的「双向链接」与选区的「双向链接」
 * 都必须读同一份 copyTemplate，切档只写自己的配置、不碰整本导出的那份。
 * 剪贴板内容桩掉，只验「交给剪贴板的那一行」和设置的落盘时机。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchAction, dispatchInput } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, setState } from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { DEFAULT_SETTINGS, normalizeSettings, type ReaderSettings } from '../src/data/settings';
import { addHighlight } from '../src/data/notes';
import { makeApp, makeStore, testBook } from './helpers/plugin-harness';

vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return { ...actual, can: () => true };
});

let settings: ReaderSettings;
const patches: Array<Partial<ReaderSettings>> = [];

afterEach(() => {
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
  vi.unstubAllGlobals();
  patches.length = 0;
});

function el(data: Record<string, string> = {}): HTMLElement {
  return { dataset: data } as unknown as HTMLElement;
}

function field(k: string, value: string): HTMLTextAreaElement {
  return { dataset: { role: 'setting', k }, value } as unknown as HTMLTextAreaElement;
}

function install(books: unknown[]): void {
  settings = { ...DEFAULT_SETTINGS };
  vi.stubGlobal('document', { querySelector: () => null });
  setShellSource({
    app: makeApp(),
    repo: {
      all: () => books,
      byId: (id: string) => (books as Array<{ id: string }>).find((b) => b.id === id),
    },
    store: makeStore(),
    settings: () => settings,
    setSettings: (patch: Partial<ReaderSettings>) => {
      patches.push(patch);
      settings = { ...settings, ...patch };
    },
    searchText: async () => [],
    hasOpenReader: () => true,
    setGoal: () => undefined,
  } as unknown as ShellSource);
}

function setup(copy?: Partial<ReaderSettings>): { markId: string } {
  const book = testBook('b1', '测试书');
  const mark = addHighlight(book as never, {
    text: '划线原文一段',
    cfiRange: 'cfi1',
    chapterTitle: '第一章',
    color: 'green',
  });
  install([book]);
  if (copy) settings = { ...settings, ...copy };
  setState({
    ...DEFAULT_SHELL_STATE,
    bookId: 'b1',
    overlay: {
      kind: 'hltools',
      markId: mark.id,
      bookId: 'b1',
      anchor: { left: 120, top: 300, width: 0, height: 0 },
    },
  });
  return { markId: mark.id };
}

function stubClipboard(): string[] {
  const writes: string[] = [];
  vi.stubGlobal('navigator', {
    clipboard: { writeText: async (text: string) => void writes.push(text) },
  });
  return writes;
}

describe('复制划线四档模板：走剪贴板', () => {
  it('默认简洁档：剪贴板拿到与导出同款的两行引用，含可点双链', async () => {
    const { markId } = setup();
    const writes = stubClipboard();

    dispatchAction('copylink', el({ id: markId, book: 'b1' }));

    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toContain('> [[');
    expect(writes[0]).toContain('书/b1.epub#bzr-cfi=');
    expect(writes[0].split('\n')).toHaveLength(2);
  });

  it('callout 引文档：整段多行 Markdown 进剪贴板，不再压成一行别名', async () => {
    const { markId } = setup({ copyTemplate: 'quote' });
    const writes = stubClipboard();

    dispatchAction('copylink', el({ id: markId, book: 'b1' }));

    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toContain('> [!quote] 测试书 · 第一章');
    expect(writes[0]).toContain('> [[');
    expect(writes[0].split('\n').length).toBeGreaterThan(2);
  });

  it('自定义档多行模板：{双链} 替换成可点链接，方括号照常保留', async () => {
    const { markId } = setup({
      copyTemplate: 'custom',
      copyTemplateCustom: '> [!note] {书名}\n> {双链}\n> {摘录}',
    });
    const writes = stubClipboard();

    dispatchAction('copylink', el({ id: markId, book: 'b1' }));

    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toContain('> [!note] 测试书');
    expect(writes[0]).toContain('> [[书/b1.epub#bzr-cfi=');
    expect(writes[0]).toContain('> 划线原文一段');
  });
  it('老 aliasTemplate 迁移后，复制结果仍含可点双链', async () => {
    const { markId } = setup();
    settings = normalizeSettings({
      ...settings,
      copyTemplateCustom: undefined,
      aliasTemplate: '《{书名}》· {章节}',
    });
    const writes = stubClipboard();

    dispatchAction('copylink', el({ id: markId, book: 'b1' }));

    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toContain('[[');
    expect(writes[0]).toContain('《测试书》· 第一章');
  });
});

describe('复制模板配置：与整本导出独立', () => {
  it('切档只写 copyTemplate，不动 exportTemplate', () => {
    setup();
    dispatchAction('setcopytpl', el({ v: 'quote' }));
    expect(patches).toContainEqual({ copyTemplate: 'quote' });
    expect(patches.some((p) => 'exportTemplate' in p)).toBe(false);
  });

  it('非法 id（旧档 brief）不写任何设置', () => {
    setup();
    dispatchAction('setcopytpl', el({ v: 'brief' }));
    expect(patches).toEqual([]);
  });

  it('自定义正文：input 不落盘，change 才写 copyTemplateCustom', () => {
    setup();
    const f = field('copyTemplateCustom', '> [!note] {书名}\n> {双链}');
    dispatchInput(f, { type: 'input' } as Event);
    expect(patches).toEqual([]);
    dispatchInput(f, { type: 'change' } as Event);
    expect(patches).toContainEqual({ copyTemplateCustom: '> [!note] {书名}\n> {双链}' });
  });
});
