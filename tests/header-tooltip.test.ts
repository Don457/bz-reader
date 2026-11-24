import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Obsidian 的全局 setTooltip(el, text) 在 node 里不存在；mock 成记录调用，
   这样「挂没挂、挂了什么文案」都能断言，不必依赖宿主原型扩展。 */
const tipCalls = vi.hoisted(() => [] as string[]);
vi.mock('obsidian', () => ({
  setTooltip: (_el: unknown, text: string) => { tipCalls.push(text); },
}));

import { setLocale } from '../src/i18n';
import {
  HEADER_ACTION_IDS,
  headerActionLabel,
  type HeaderActionId,
} from '../src/view/header-actions';
import {
  TOOLTIP_ACTIONS,
  attachHeaderTooltip,
  headerActionTooltip,
  stripHotkey,
} from '../src/view/header-tooltip';

/**
 * 阅读器头栏图标的悬停气泡（2026-11-24，QQ 频道用户建议）。
 *
 * 两条硬约束：
 *   · 作者拍板气泡文案**不含快捷键**——「目录（s）」要变成「目录」；
 *   · 气泡只在白名单按钮上挂（头栏工具栏那批），不做成全局 UI 都有。
 * 出现时机用 Obsidian 默认，本模块不碰延迟设置。
 */
afterEach(() => setLocale('zh'));

describe('stripHotkey：去掉单字母键位提示', () => {
  it('中文全角键位「（s）」去掉', () => {
    expect(stripHotkey('目录（s）')).toBe('目录');
    expect(stripHotkey('朗读（r）')).toBe('朗读');
  });

  it('英文半角键位「 (s)」连同前面的空格一起去掉', () => {
    expect(stripHotkey('Contents (s)')).toBe('Contents');
    expect(stripHotkey('Read aloud (r)')).toBe('Read aloud');
  });

  it('说明性括号保留——「复制链接（页 / 视图 / 嵌入 / 标注）」不能只剩「复制链接」', () => {
    expect(stripHotkey('复制链接（页 / 视图 / 嵌入 / 标注）')).toBe(
      '复制链接（页 / 视图 / 嵌入 / 标注）',
    );
  });

  it('没有键位的文案原样返回', () => {
    expect(stripHotkey('搜索')).toBe('搜索');
    expect(stripHotkey('')).toBe('');
  });
});

describe('headerActionTooltip：气泡文案随语言走，且永远不带键位', () => {
  it('中文取去掉键位的标签', () => {
    setLocale('zh');
    expect(headerActionTooltip('toc')).toBe('目录');
    expect(headerActionTooltip('tts')).toBe('朗读');
  });

  it('英文取去掉键位的标签', () => {
    setLocale('en');
    expect(headerActionTooltip('toc')).toBe('Contents');
  });

  it('每一种语言的每一颗动作，气泡文案都不含单字母键位', () => {
    for (const loc of ['zh', 'en', 'ja', 'de', 'fr', 'es', 'pt', 'zh-TW'] as const) {
      setLocale(loc);
      for (const id of HEADER_ACTION_IDS) {
        expect(headerActionTooltip(id)).not.toMatch(/[（(][A-Za-z][）)]$/);
      }
    }
  });

  it('文案就是「标签去键位」，不另写一套字面量', () => {
    setLocale('zh');
    expect(headerActionTooltip('type')).toBe(stripHotkey(headerActionLabel('type')));
  });
});

describe('TOOLTIP_ACTIONS：气泡只圈头栏按钮，不做成全局', () => {
  it('白名单里的每一项都是合法的头栏动作', () => {
    for (const id of TOOLTIP_ACTIONS) {
      expect(HEADER_ACTION_IDS).toContain(id);
    }
  });

  it('目录 / 搜索 / 书签 / 朗读这些常用按钮在白名单里', () => {
    expect(TOOLTIP_ACTIONS.has('toc')).toBe(true);
    expect(TOOLTIP_ACTIONS.has('search')).toBe(true);
    expect(TOOLTIP_ACTIONS.has('mark')).toBe(true);
    expect(TOOLTIP_ACTIONS.has('tts')).toBe(true);
  });

  it('白名单只含头栏动作，不含伪造的非头栏 id（选择性，不是全 UI 都挂）', () => {
    /* 选择性的边界 = 头栏这批图标动作。「全 UI」指的是设置页 / 侧栏 / 弹窗那些，
       它们根本不在 HEADER_ACTION_IDS 里，也不会调 attachHeaderTooltip。 */
    expect(TOOLTIP_ACTIONS.has('bogus' as HeaderActionId)).toBe(false);
    expect(TOOLTIP_ACTIONS.size).toBe(HEADER_ACTION_IDS.length);
  });
});

describe('attachHeaderTooltip：唯一的 setTooltip 入口', () => {
  /* 每次断言前清空记录；element 在 mock 里只是占位，真正被断言的是传给
     Obsidian setTooltip 的文案。 */
  beforeEach(() => { tipCalls.length = 0; });
  const el = {} as HTMLElement;

  it('给白名单按钮挂上去的是去掉键位的文案', () => {
    setLocale('zh');
    attachHeaderTooltip(el, 'toc');
    expect(tipCalls).toEqual(['目录']);
  });

  it('白名单之外的按钮不挂——保证气泡的选择性', () => {
    attachHeaderTooltip(el, 'bogus' as HeaderActionId);
    expect(tipCalls).toEqual([]);
  });

  it('文案为空也不挂，不给 Obsidian 送空气泡', () => {
    attachHeaderTooltip(el, 'toc', '');
    expect(tipCalls).toEqual([]);
  });

  it('显式传入的文案原样使用（允许调用方覆盖），但白名单外仍不挂', () => {
    attachHeaderTooltip(el, 'toc', '自定义提示');
    attachHeaderTooltip(el, 'bogus' as HeaderActionId, '不该出现');
    expect(tipCalls).toEqual(['自定义提示']);
  });
});
