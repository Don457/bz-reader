import { describe, expect, it } from 'vitest';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { licenseSummary, parseLicense, trialDaysLeft, verifyLicense } from '../src/data/license';

const here = dirname(fileURLToPath(import.meta.url));
const keyPath = join(here, '..', 'scripts', 'keys', 'private.pem');

const b64url = (buf: Buffer | Uint8Array): string =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** DER 签名 → P1363 裸格式（与 scripts/issue-license.mjs 同一转换，测试里独立实现一遍防脚本退化） */
function derToP1363(der: Buffer): Buffer {
  let at = 2;
  const readInt = (): Buffer => {
    const len = der[at + 1];
    const val = der.subarray(at + 2, at + 2 + len);
    at += 2 + len;
    const out = Buffer.alloc(32);
    let start = 0;
    while (start < val.length && val[start] === 0) start += 1;
    val.copy(out, 32 - (val.length - start), start);
    return out;
  };
  return Buffer.concat([readInt(), readInt()]);
}

function issue(payload: object, keyPem: string): string {
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signer = createSign('sha256');
  signer.update(payloadBytes);
  const sig = derToP1363(signer.sign({ key: keyPem, dsaEncoding: 'der' }));
  return `BZR1.${b64url(payloadBytes)}.${b64url(sig)}`;
}

const hasKey = existsSync(keyPath);
const keyPem = hasKey ? readFileSync(keyPath, 'utf8') : '';
// 内嵌公钥必须与 scripts/keys 里的私钥配对——不配对下面的签发测试全挂
const embeds = readFileSync(join(here, '..', 'src', 'data', 'license.ts'), 'utf8');
const PUB = /PUBKEY_SPKI_B64 =\s*'([^']+)'/;

describe('激活码解析', () => {
  it('三段式 + BZR1/BZR2 前缀 + v1/v2 payload 才算认识', () => {
    expect(parseLicense('BZR1.eyJ2IjoxfQ.aGVsbG8')).toBeTruthy();
    expect(parseLicense('BZR2.eyJ2IjoyfQ.aGVsbG8')).toBeTruthy();
    expect(parseLicense('BZR3.eyJ2IjoyfQ.aGVsbG8')).toBeNull(); // 未知前缀
    expect(parseLicense('BZR1.not-base64!!?.aGVsbG8')).toBeNull();
    expect(parseLicense('')).toBeNull();
  });

  it('坏 payload（不是 JSON / 版本不对）拒绝', () => {
    expect(parseLicense('BZR1.aGVsbG8.aGVsbG8')).toBeNull(); // "hello" 不是对象
    expect(parseLicense(`BZR1.${b64url(Buffer.from('{"v":3}'))}.aGVsbG8`)).toBeNull();
  });
});

describe.runIf(hasKey && PUB.test(embeds))('激活码验签（端到端，需要 scripts/keys + 内嵌公钥配对）', () => {
  it('签发的码验签通过，状态行带署名', async () => {
    const code = issue({ v: 1, name: '包仔' }, keyPem);
    const res = await verifyLicense(code);
    expect(res.ok).toBe(true);
    expect(res.message).toContain('包仔');
    expect(res.message).toContain('永久');
    expect(licenseSummary(code)).toContain('包仔');
  });

  it('改过 payload 的码拒绝', async () => {
    const code = issue({ v: 1, name: '包仔' }, keyPem);
    const [, , sig64] = code.split('.');
    const evil = `BZR1.${b64url(Buffer.from('{"v":1,"name":"别人"}'))}.${sig64}`;
    const res = await verifyLicense(evil);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('失败');
  });

  it('过期码拒绝并给出日期', async () => {
    const code = issue({ v: 1, name: '包仔', exp: Date.now() - 86_400_000 }, keyPem);
    const res = await verifyLicense(code);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('过期');
    expect(licenseSummary(code)).toContain('已过期');
  });

  it('用别的私钥签的码拒绝', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const other = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const res = await verifyLicense(issue({ v: 1, name: '冒牌' }, other));
    expect(res.ok).toBe(false);
  });

  it('空码给出引导而不是抛错', async () => {
    const res = await verifyLicense('  ');
    expect(res.ok).toBe(false);
    expect(res.message).toContain('激活码');
  });

  /* 2026-11-09：赞助人批次（BZR-AF-2026-0125 起）在 payload 里多带一个 patron，
     验签逻辑不看这个字段，但解析层必须原样透出——插件靠它画「赞助人」徽章。 */
  it('赞助人码：payload 的 patron 原样透出，验签照旧通过', async () => {
    const code = issue({ v: 2, id: 'BZR-AF-2026-0125', patron: true, plan: 'lifetime' }, keyPem);
    const res = await verifyLicense(code);
    expect(res.ok).toBe(true);
    expect(res.payload?.patron).toBe(true);
    expect(parseLicense(code)?.payload.patron).toBe(true);
  });
});

/* 2026-11-22：群里分发的试用码要跟版本号绑定。
   口径（作者定）：只有 plan === 'trial' 的码看版本字段；永久码与赞助人码
   一概不看——那些是买断的，不能因为多写了一个字段就把老用户挡在外面。 */
describe.runIf(hasKey && PUB.test(embeds))('试用码的版本绑定', () => {
  const trial = (extra: object = {}): string =>
    issue(
      {
        v: 2,
        id: 'BZR-TR-2026-0001',
        plan: 'trial',
        exp: Date.now() + 7 * 86_400_000,
        verMin: '1.4.0',
        verBefore: '1.5.0',
        ...extra,
      },
      keyPem,
    );

  it('当前版本在区间内：通过，文案带剩余天数与版本范围', async () => {
    const res = await verifyLicense(trial(), { version: '1.4.2' });
    expect(res.ok).toBe(true);
    expect(res.message).toContain('试用');
    expect(res.message).toContain('1.4.x');
  });

  it('当前版本低于下界：报版本不符，不是「验签失败」', async () => {
    const res = await verifyLicense(trial(), { version: '1.3.9' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('version');
    expect(res.message).toContain('1.4.x');
    expect(res.message).toContain('1.3.9');
  });

  it('当前版本到了上界（不含）：同样拦下', async () => {
    const res = await verifyLicense(trial(), { version: '1.5.0' });
    expect(res.reason).toBe('version');
  });

  it('不给当前版本 = 调用方不判版本（兼容旧调用点与测试）', async () => {
    const res = await verifyLicense(trial());
    expect(res.ok).toBe(true);
  });

  it('永久码与赞助人码即使带版本字段也一概不看', async () => {
    for (const payload of [
      { plan: 'lifetime', verMin: '9.0.0', verBefore: '9.1.0' },
      { plan: 'lifetime', patron: true, verMin: '9.0.0' },
    ]) {
      const res = await verifyLicense(issue({ v: 2, id: 'BZR-O-1', ...payload }, keyPem), {
        version: '1.6.0',
      });
      expect(res.ok).toBe(true);
    }
  });

  it('老码（BZR1、只有 exp 没有 plan）不绑版本', async () => {
    const code = issue({ v: 1, name: '老用户', exp: Date.now() + 86_400_000 }, keyPem);
    expect((await verifyLicense(code, { version: '9.9.9' })).ok).toBe(true);
  });

  it('试用码没有版本字段 = 不限版本（兼容刚发的短期码）', async () => {
    const code = issue({ v: 2, id: 'BZR-TR-2', plan: 'trial', exp: Date.now() + 86_400_000 }, keyPem);
    expect((await verifyLicense(code, { version: '1.6.0' })).ok).toBe(true);
  });

  it('过期的试用码先报过期：时间到了比版本更根本', async () => {
    const code = issue({ v: 2, plan: 'trial', exp: Date.now() - 1000, verMin: '9.0.0' }, keyPem);
    expect((await verifyLicense(code, { version: '1.6.0' })).reason).toBe('expired');
  });
});

describe.runIf(hasKey && PUB.test(embeds))('试用码的文案', () => {
  it('licenseSummary 写清剩余天数与版本范围', () => {
    const code = issue(
      {
        v: 2,
        name: '小明',
        plan: 'trial',
        exp: Date.now() + 3 * 86_400_000,
        verMin: '1.4.0',
        verBefore: '1.5.0',
      },
      keyPem,
    );
    const text = licenseSummary(code, { version: '1.4.2' });
    expect(text).toContain('剩余');
    expect(text).toContain('1.4.x');
  });

  it('版本不符时状态行给换码的下一步', () => {
    const code = issue(
      { v: 2, plan: 'trial', exp: Date.now() + 86_400_000, verMin: '1.4.0', verBefore: '1.5.0' },
      keyPem,
    );
    const text = licenseSummary(code, { version: '1.6.0' });
    expect(text).toContain('1.4.x');
    expect(text).toMatch(/换|更新/);
  });
});

describe('试用剩余天数', () => {
  it('向上取整：不到半天也算 1 天，过期或不限期为 0', () => {
    const now = Date.now();
    expect(trialDaysLeft(now + 1000, now)).toBe(1);
    expect(trialDaysLeft(now + 3.2 * 86_400_000, now)).toBe(4);
    expect(trialDaysLeft(now - 1000, now)).toBe(0);
    expect(trialDaysLeft(0, now)).toBe(0);
  });
});
