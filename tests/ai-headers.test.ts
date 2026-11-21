import { describe, expect, it } from 'vitest';
import { parseExtraHeaders } from '../src/data/ai-headers';

/* 2026-11-22：OpenCode Go 这类网关要求自定义请求头（x-opencode-session），
   插件之前只有地址 / 密钥 / 模型三件套，没有地方填它。这里把「一行一个
   Header: value」的文本解析成可合并的字典，口径写死在这组测试里。 */
describe('附加请求头解析', () => {
  it('一行一个头，名与值都去掉首尾空格', () => {
    expect(parseExtraHeaders('x-opencode-session:  abc-123  ')).toEqual({ 'x-opencode-session': 'abc-123' });
  });

  it('多行、空行、# 注释都认', () => {
    expect(
      parseExtraHeaders(['# 会话路由', 'x-opencode-session: s1', '', 'X-Trace: t1', '   '].join('\n')),
    ).toEqual({ 'x-opencode-session': 's1', 'X-Trace': 't1' });
  });

  it('值里带冒号只按第一个冒号拆（Bearer / URL 都不怕）', () => {
    expect(parseExtraHeaders('Authorization: Bearer a:b:c')).toEqual({ Authorization: 'Bearer a:b:c' });
  });

  it('没冒号 / 名字非法的行跳过，不让坏行把整份配置带挂', () => {
    expect(parseExtraHeaders('没有冒号的一行\nbad name: x\n好: 值')).toEqual({});
  });

  it('保留用户写的头名大小写（HTTP 不区分，但原样回显更接近输入）', () => {
    expect(parseExtraHeaders('X-Custom-Header: v')).toEqual({ 'X-Custom-Header': 'v' });
  });

  it('空文本 → 空字典（不配就不加任何头）', () => {
    expect(parseExtraHeaders('')).toEqual({});
    expect(parseExtraHeaders('   \n  ')).toEqual({});
  });

  it('禁掉会破坏请求本身的头（Host / Content-Length / Transfer-Encoding）', () => {
    expect(parseExtraHeaders('Host: evil\nContent-Length: 1\nTransfer-Encoding: chunked\nX-Ok: 1')).toEqual({
      'X-Ok': '1',
    });
  });
});
