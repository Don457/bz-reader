import { afterEach, describe, expect, it, vi } from 'vitest';
import { postChat, type ChatConfig } from '../src/data/ai';
import { resolveAiConfig } from '../src/data/ai-providers';

/* 2026-11-22：自定义通道的附加请求头要真的进请求，两条通道都要带——
   OpenCode Go 这类网关缺了 x-opencode-session 会 400，光把文本存进设置没用。 */
const config: ChatConfig = {
  baseUrl: 'https://api.gateway.example/v1',
  apiKey: 'sk-test',
  model: 'gw-model',
  extraHeaders: { 'x-opencode-session': 'sess-1' },
};

const messages = [{ role: 'user', content: '只回一个字：好' }];
const okJson = { ok: true, json: async () => ({ choices: [{ message: { content: '好' } }] }) };

describe('附加请求头进请求', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('流式 fetch 通道带上附加头', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson);
    vi.stubGlobal('fetch', fetchMock);
    await postChat(config, messages);
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['x-opencode-session']).toBe('sess-1');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
  });

  it('代发（requestUrl）通道同样带上附加头', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const requestUrlFn = vi.fn().mockResolvedValue({
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: '好' } }] }),
    });
    const text = await postChat(config, messages, {}, { requestUrlFn });
    expect(text).toBe('好');
    const opts = requestUrlFn.mock.calls[0][0] as { headers: Record<string, string> };
    expect(opts.headers['x-opencode-session']).toBe('sess-1');
  });
});

describe('resolveAiConfig 只给自定义通道附加头', () => {
  it('custom 解析出字典', () => {
    const c = resolveAiConfig({
      provider: 'custom',
      baseUrl: 'https://api.gateway.example/v1',
      apiKey: 'k',
      model: 'm',
      customHeaders: 'x-opencode-session: sess-1',
    });
    expect(c.extraHeaders).toEqual({ 'x-opencode-session': 'sess-1' });
  });

  it('注册表里的服务商不读这个字段（端点与鉴权都清楚，不该被手填头污染）', () => {
    const c = resolveAiConfig({
      provider: 'kimi',
      apiKeys: { kimi: 'sk' },
      modelOverrides: { kimi: 'kimi-k3' },
      customHeaders: 'x-opencode-session: sess-1',
    });
    expect(c.extraHeaders).toEqual({});
  });
});
