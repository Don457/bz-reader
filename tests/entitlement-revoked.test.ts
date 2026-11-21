import { beforeEach, describe, expect, it } from 'vitest';
import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activateLicense,
  can,
  clearLicense,
  entitlement,
  revalidateLicense,
  setEntBackend,
  setProBuild,
  tierText,
} from '../src/data/entitlement';
import {
  _resetRevokedForTests,
  _setRevokedHttpForTests,
  clearRevoked,
  markRevoked,
  revokedCode,
} from '../src/data/revoked';

/* ============================================================
 * 停用名单 × 授权判定（tests/entitlement-revoked.test.ts）
 *
 * 三件事必须同时成立：
 *   1. 命中就降级——但**不删码**（解封要能自动恢复，误封也不用让人翻邮件）；
 *   2. 第一次激活必须联网核对，拉不到就明确拒绝，不悄悄放行；
 *   3. 本地已经判死的码，断网也贴不回来。
 * ============================================================ */

const here = dirname(fileURLToPath(import.meta.url));
const keyPath = join(here, '..', 'scripts', 'keys', 'private.pem');
const hasKey = existsSync(keyPath);
const keyPem = hasKey ? readFileSync(keyPath, 'utf8') : '';

const b64url = (buf: Buffer | Uint8Array): string =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

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

function issue(payload: object): string {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signer = createSign('sha256');
  signer.update(bytes);
  const sig = derToP1363(signer.sign({ key: keyPem, dsaEncoding: 'der' }));
  return `BZR2.${b64url(bytes)}.${b64url(sig)}`;
}

function signed(ids: string[], updatedAt = 1_800_000_000_000): string {
  const text = [
    'bzr-revoked',
    '1',
    String(updatedAt),
    ids.map((x) => x.trim().toUpperCase()).sort().join(','),
    '',
  ].join('\n');
  const signer = createSign('sha256');
  signer.update(Buffer.from(text, 'utf8'));
  const sig = derToP1363(signer.sign({ key: keyPem, dsaEncoding: 'der' }));
  return JSON.stringify({ v: 1, updatedAt, ids, hashes: [], sig: b64url(sig) });
}

/** 灌一份 data.json 里的授权快照（只读；写盘由空函数接住） */
function withLicense(code: string): void {
  setEntBackend({
    read: () => ({ license: code, checkedTs: Date.now(), activeDays: [], lastSeenTs: 0, clockAnomaly: 0, trialVoid: false }),
    write: () => undefined,
  });
}

beforeEach(() => {
  setProBuild(true);
  _resetRevokedForTests();
  setEntBackend(null);
  clearLicense();
});

describe.runIf(hasKey)('激活时核对', () => {
  it('命中的码：拒绝激活，不写 entitlement', async () => {
    _setRevokedHttpForTests(async () => signed(['BZR-AF-2026-0021']));
    const res = await activateLicense(issue({ v: 2, id: 'BZR-AF-2026-0021', plan: 'lifetime' }));
    expect(res.ok).toBe(false);
    expect(res.revoked).toBe(true);
    expect(res.message).toContain('停用');
    expect(entitlement().license).toBe('');
  });

  it('名单拉不到：拒绝并明确要求联网，不能悄悄放行', async () => {
    _setRevokedHttpForTests(async () => null);
    const res = await activateLicense(issue({ v: 2, id: 'BZR-AF-2026-0099', plan: 'lifetime' }));
    expect(res.ok).toBe(false);
    expect(res.revoked).toBeFalsy();
    expect(res.message).toContain('联网');
    expect(entitlement().license).toBe('');
  });

  it('名单里没有这枚码：正常激活', async () => {
    _setRevokedHttpForTests(async () => signed(['BZR-AF-2026-0099']));
    const res = await activateLicense(issue({ v: 2, id: 'BZR-AF-2026-0021', plan: 'lifetime' }));
    expect(res.ok).toBe(true);
    expect(entitlement().tier).toBe('paid');
    expect(revokedCode()).toBe('');
  });

  it('本地已判死的码：断网也贴不回来', async () => {
    const code = issue({ v: 2, id: 'BZR-AF-2026-0021', plan: 'lifetime' });
    markRevoked(code, 1_800_000_000_000);
    _setRevokedHttpForTests(async () => null);
    const res = await activateLicense(code);
    expect(res.ok).toBe(false);
    expect(res.revoked).toBe(true);
    expect(res.message).toContain('停用');
  });
});

describe.runIf(hasKey)('判定与恢复', () => {
  it('有码 + 命中：降为基础版，码保留，状态行报出码号', async () => {
    const code = issue({ v: 2, id: 'BZR-AF-2026-0021', name: '包仔', plan: 'lifetime' });
    withLicense(code);
    markRevoked(code, 1_800_000_000_000);
    await revalidateLicense();

    const v = entitlement();
    expect(v.tier).toBe('free');
    expect(v.revoked).toBe(true);
    expect(v.license).toBe(code);
    expect(v.licenseId).toBe('BZR-AF-2026-0021');
    expect(can('stats')).toBe(false);
    expect(tierText(v)).toContain('停用');
    expect(tierText(v)).toContain('BZR-AF-2026-0021');
  });

  it('解封：清掉本地标记后立刻回到高级版', async () => {
    const code = issue({ v: 2, id: 'BZR-AF-2026-0021', plan: 'lifetime' });
    withLicense(code);
    markRevoked(code, 1_800_000_000_000);
    await revalidateLicense();
    expect(entitlement().tier).toBe('free');

    clearRevoked();
    expect(entitlement().tier).toBe('paid');
    expect(can('stats')).toBe(true);
  });

  it('别的码命中不影响这一枚', async () => {
    const code = issue({ v: 2, id: 'BZR-AF-2026-0021', plan: 'lifetime' });
    withLicense(code);
    markRevoked(issue({ v: 2, id: 'BZR-AF-2026-0099' }), 1_800_000_000_000);
    await revalidateLicense();
    expect(entitlement().tier).toBe('paid');
    expect(entitlement().revoked).toBe(false);
  });

  it('老码没有码号：状态行不带括号，也不误伤', async () => {
    const code = issue({ v: 1, name: '老用户' });
    withLicense(code);
    markRevoked(code, 1_800_000_000_000);
    await revalidateLicense();
    const v = entitlement();
    expect(v.revoked).toBe(true);
    expect(v.licenseId).toBeUndefined();
    expect(tierText(v)).toContain('停用');
    expect(tierText(v)).not.toContain('（');
  });
});
