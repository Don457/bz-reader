import { describe, expect, it } from 'vitest';
import { aiCardHtml } from '../src/shell/reader-cards';

/** 构造一张「解释」浮框：ready 表示 AI 服务已配好（输入框/消息区才会渲染） */
const card = (opts: { ready?: boolean; followLocked?: boolean } = {}) =>
  aiCardHtml({
    ready: opts.ready ?? true,
    followLocked: opts.followLocked,
    mode: 'explain',
    quote: '在这本书里，我想写现代中国某一部分社会',
    bookTitle: '围城',
    chapter: '序',
    ask: '解释这一段',
    answer: '这段话交代了作者的写作意图。',
  });

describe('追问输入框锁定态（基础版下放解释/翻译/摘要后）', () => {
  it('追问未解锁时，输入行整块是解锁按钮，点它弹对比表并高亮 aiAsk', () => {
    const h = card({ followLocked: true });
    expect(h).toContain('data-act="unlock"');
    expect(h).toContain('data-mode="aiAsk"');
  });

  it('追问未解锁时，不渲染可输入的 textarea 与发送按钮', () => {
    const h = card({ followLocked: true });
    expect(h).not.toContain('data-role="aifollow"');
    expect(h).not.toContain('bzs-af-send');
  });

  it('追问未解锁时，锁提示文案出现，且带锁定样式类', () => {
    const h = card({ followLocked: true });
    expect(h).toContain('bzs-af-locked');
    expect(h).toContain('追问需高级版');
    expect(h).toContain('解释 / 翻译 / 摘要已免费');
  });

  it('追问已解锁时，保持可输入 textarea + 发送按钮，不出现解锁按钮', () => {
    const h = card({ followLocked: false });
    expect(h).toContain('data-role="aifollow"');
    expect(h).toContain('bzs-af-send');
    expect(h).not.toContain('data-mode="aiAsk"');
    expect(h).not.toContain('bzs-af-locked');
  });

  it('没传 followLocked 时默认不锁（向后兼容：调用方没更新也不误伤）', () => {
    const h = card();
    expect(h).toContain('data-role="aifollow"');
    expect(h).not.toContain('data-mode="aiAsk"');
  });

  it('AI 没配好时整个输入行都不出现，锁定态也不冒出来', () => {
    const h = card({ ready: false, followLocked: true });
    expect(h).not.toContain('data-mode="aiAsk"');
    expect(h).not.toContain('data-role="aifollow"');
    expect(h).toContain('bzs-af-empty');
  });
});
