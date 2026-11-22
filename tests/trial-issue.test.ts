import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLicense, verifyLicense } from '../src/data/license';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', 'scripts', 'issue-license.mjs');
const hasKey = existsSync(join(here, '..', 'scripts', 'keys', 'private.pem'));

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

function payloadOf(code: string) {
  return parseLicense(code)?.payload;
}

describe.runIf(hasKey)('签发脚本：试用码', () => {
  it('--plan trial --days 7 --ver 1.4：写进版本区间，7 天后到期', () => {
    const r = run(['--plan', 'trial', '--days', '7', '--ver', '1.4', '--id', 'BZR-TR-TEST-1']);
    expect(r.status).toBe(0);
    const p = payloadOf(r.stdout);
    expect(p?.plan).toBe('trial');
    expect(p?.verMin).toBe('1.4.0');
    expect(p?.verBefore).toBe('1.5.0');
    const days = Math.round(((p?.exp ?? 0) - Date.now()) / 86_400_000);
    expect(days).toBe(7);
  });

  it('--preset 7d 是同一件事的快捷写法', () => {
    const r = run(['--preset', '7d', '--ver', '1.4', '--id', 'BZR-TR-TEST-2']);
    expect(r.status).toBe(0);
    const p = payloadOf(r.stdout);
    expect(p?.plan).toBe('trial');
    expect(p?.verMin).toBe('1.4.0');
  });

  it('--preset expired：签出来就是过期码，用来演示 / 测试', async () => {
    const r = run(['--preset', 'expired', '--ver', '1.4', '--id', 'BZR-TR-TEST-3']);
    expect(r.status).toBe(0);
    const p = payloadOf(r.stdout);
    expect(p?.exp).toBeLessThan(Date.now());
    const res = await verifyLicense(r.stdout, { version: '1.4.2' });
    expect(res.reason).toBe('expired');
  });

  it('--ver 1.4.2 锁到补丁号：1.4.2 能用，1.4.3 不行', async () => {
    const r = run(['--plan', 'trial', '--days', '7', '--ver', '1.4.2', '--id', 'BZR-TR-TEST-4']);
    expect(r.status).toBe(0);
    const p = payloadOf(r.stdout);
    expect(p?.verMin).toBe('1.4.2');
    expect(p?.verBefore).toBe('1.4.3');
    expect((await verifyLicense(r.stdout, { version: '1.4.2' })).ok).toBe(true);
    expect((await verifyLicense(r.stdout, { version: '1.4.3' })).reason).toBe('version');
  });

  it('不带 --ver 也能签：不限版本的短期码（兼容老用法）', async () => {
    const r = run(['--plan', 'trial', '--days', '3', '--id', 'BZR-TR-TEST-5']);
    expect(r.status).toBe(0);
    const p = payloadOf(r.stdout);
    expect(p?.verMin).toBeUndefined();
    expect((await verifyLicense(r.stdout, { version: '9.9.9' })).ok).toBe(true);
  });

  it('试用码不给 id 时用独立号段 BZR-TR-，不占付费序号', () => {
    const r = run(['--plan', 'trial', '--days', '7', '--ver', '1.4']);
    expect(r.status).toBe(0);
    expect(payloadOf(r.stdout)?.id).toMatch(/^BZR-TR-/);
  });

  it('--plan lifetime 带 --ver：拒绝，避免误以为永久码受版本限制', () => {
    const r = run(['--plan', 'lifetime', '--ver', '1.4', '--id', 'BZR-AF-TEST']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('永久');
  });

  it('--plan trial 没给截止日期：拒绝，试用码必须有到期时间', () => {
    const r = run(['--plan', 'trial', '--ver', '1.4']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/截止|到期|days|until/);
  });
});
