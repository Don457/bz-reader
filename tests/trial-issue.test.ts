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
  it('--plan trial --days 7：写 plan 与到期日，不写任何版本字段', () => {
    const r = run(['--plan', 'trial', '--days', '7', '--id', 'BZR-TR-TEST-1']);
    expect(r.status).toBe(0);
    const p = payloadOf(r.stdout);
    expect(p?.plan).toBe('trial');
    expect(p?.verMin).toBeUndefined();
    expect(p?.verBefore).toBeUndefined();
    const days = Math.round(((p?.exp ?? 0) - Date.now()) / 86_400_000);
    expect(days).toBe(7);
  });

  it('--preset 7d 是同一件事的快捷写法', () => {
    const r = run(['--preset', '7d', '--id', 'BZR-TR-TEST-2']);
    expect(r.status).toBe(0);
    expect(payloadOf(r.stdout)?.plan).toBe('trial');
  });

  it('--preset expired：签出来就是过期码，用来演示 / 测试', async () => {
    const r = run(['--preset', 'expired', '--id', 'BZR-TR-TEST-3']);
    expect(r.status).toBe(0);
    const p = payloadOf(r.stdout);
    expect(p?.exp).toBeLessThan(Date.now());
    const res = await verifyLicense(r.stdout);
    expect(res.reason).toBe('expired');
  });

  it('试用码不给 id 时用独立号段 BZR-TR-，不占付费序号', () => {
    const r = run(['--plan', 'trial', '--days', '7']);
    expect(r.status).toBe(0);
    expect(payloadOf(r.stdout)?.id).toMatch(/^BZR-TR-/);
  });

  it('--plan trial 没给截止日期：拒绝，试用码必须有到期时间', () => {
    const r = run(['--plan', 'trial']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/截止|到期|days|until/);
  });

  it('永久码照旧：带 --ver 也不会写进 payload（参数已删除）', () => {
    const r = run(['--plan', 'lifetime', '--ver', '1.4', '--id', 'BZR-AF-TEST']);
    expect(r.status).toBe(0);
    const p = payloadOf(r.stdout);
    expect(p?.plan).toBe('lifetime');
    expect(p?.verMin).toBeUndefined();
    expect(p?.exp).toBeUndefined();
  });
});
