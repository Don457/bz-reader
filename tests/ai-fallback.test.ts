import { afterEach, describe, expect, it, vi } from 'vitest';
import { postChat, type ChatConfig } from '../src/data/ai';

/* 2026-11-22 真机反馈（QQ 群「靛青」）：拉模型能成功，对话连不上；
   bz 主仓同一家却正常。根因是模型列表 fetch 失败会退回 Obsidian 的
   requestUrl（主进程代发，不受网页跨域限制），对话只有 fetch 一条路。
   这组测试把「对话也要有代发退路」钉住，口径与 bz core/ai.ts 的 prompt 一致：
   fetch 流式失败（跨域 / 网络）→ requestUrl 非流式再发一次。 */

const config: ChatConfig = {
  baseUrl: 'https://api.third-party.example/v1',
  apiKey: 'sk-test',
  model: 'third-model',
};

const messages = [{ role: 'user', content: '只回一个字：好' }];

/** 代发通道的返回值形状（requestUrl 回的是 text） */
function hit(text: string, status = 200) {
  return {
    status,
    text: JSON.stringify({ choices: [{ message: { content: text } }] }),
  };
}

describe('AI 对话通道：fetch 被拦时退回 Obsidian 代发', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('跨域报错（Failed to fetch）→ 代发拿到正文', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const requestUrlFn = vi.fn().mockResolvedValue(hit('好'));
    const text = await postChat(config, messages, {}, { requestUrlFn });
    expect(text).toBe('好');
    expect(requestUrlFn).toHaveBeenCalledTimes(1);
  });

  it('代发请求体是非流式的，且地址/鉴权与流式一致', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const requestUrlFn = vi.fn().mockResolvedValue(hit('好'));
    await postChat(config, messages, {}, { requestUrlFn });
    const opts = requestUrlFn.mock.calls[0][0] as { url: string; method: string; headers: Record<string, string>; body: string };
    expect(opts.url).toBe('https://api.third-party.example/v1/chat/completions');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(opts.body).stream).not.toBe(true);
  });

  it('两路都失败：两段原因都给人看，不只报第一段', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const requestUrlFn = vi.fn().mockRejectedValue(new Error('app://obsidian.md 也被拒'));
    const err = (await postChat(config, messages, {}, { requestUrlFn }).catch((e: unknown) => e)) as Error;
    expect(err.message).toContain('连不上 AI 接口：Failed to fetch');
    expect(err.message).toContain('改用 Obsidian 代发也失败');
    expect(err.message).toContain('app://obsidian.md 也被拒');
  });

  it('fetch 成功时不走代发（不多花一次请求）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '好' } }] }) }),
    );
    const requestUrlFn = vi.fn();
    await expect(postChat(config, messages, {}, { requestUrlFn })).resolves.toBe('好');
    expect(requestUrlFn).not.toHaveBeenCalled();
  });

  it('用户取消不走代发', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('aborted')));
    const requestUrlFn = vi.fn();
    await expect(postChat(config, messages, { signal: ctrl.signal }, { requestUrlFn })).rejects.toThrow('已取消');
    expect(requestUrlFn).not.toHaveBeenCalled();
  });

  it('代发返回 401 也按「检查 API Key」说人话', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const requestUrlFn = vi.fn().mockResolvedValue({ status: 401, text: '' });
    await expect(postChat(config, messages, {}, { requestUrlFn })).rejects.toThrow('检查 API Key');
  });
});
