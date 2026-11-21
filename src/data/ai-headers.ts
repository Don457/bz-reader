/* ============================================================
 * bz-reader · 附加请求头（data/ai-headers.ts）
 *
 * 2026-11-22：有些 OpenAI 兼容网关除了地址 / 密钥 / 模型之外还要一个（或几个）
 * 自定义请求头才能路由，例如 OpenCode Go 要求 `x-opencode-session`。插件原来
 * 没有地方填它，用户只能看着「能拉模型、对话 400」不知道怎么办。
 *
 * 输入是设置页里的一段文本，一行一个 `Header: value`：
 *   · 空行与 `#` 开头的注释行忽略；
 *   · 只按**第一个**冒号拆，值里再有冒号（Bearer / URL）不受影响；
 *   · 头名只认 HTTP token 字符，含空格 / 中文的行整行跳过；
 *   · 会破坏请求本身的头（Host / Content-Length 等）一律不收。
 * 纯函数：不读设置、不碰网络，解析规则由 tests/ai-headers.test.ts 锁着。
 * ============================================================ */

/** HTTP 头名允许的字符（RFC 7230 token）；比它宽的名字 requestUrl 也会拒绝 */
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/** 这些头交给运行时自己算，用户填了只会把请求弄坏，直接丢 */
const FORBIDDEN = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'upgrade']);

/**
 * 附加请求头文本 → 头字典。
 *
 * 解析失败的行走跳过而不是抛错：这是设置页里的一段手填文本，一行写坏
 * 不该让整份 AI 配置连带不可用；用户看请求没带上头，回头检查这一行即可。
 */
export function parseExtraHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf(':');
    if (at <= 0) continue;
    const name = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (!HEADER_NAME_RE.test(name)) continue;
    if (FORBIDDEN.has(name.toLowerCase())) continue;
    out[name] = value;
  }
  return out;
}
