/* ============================================================
 * bz-reader · 插件更新检查（data/plugin-update.ts）
 *
 * 只做一件事：问一句「线上最新是几版」，跟当前 `manifest.version` 比。
 * 不下载、不替换、不碰插件目录——自动更新在移动端和受管环境里都是雷，
 * 提醒一句、给个下载入口就够了。
 *
 * 四条口径（作者 2026-11-22 定）：
 *   1. **默认自动查**：没有开关，启动后后台查一次，24 小时最多一次；
 *   2. **有更新就弹，每个新版本只弹一次**：记在本地 `notified` 里，
 *      用户忽略 1.7.0 之后 1.7.1 发布仍会弹——那是另一个新版本；
 *   3. **失败静默**：离线、被墙、清单坏了，一个字都不说，下次启动再试；
 *   4. **只认 Release**：GitHub 的 `releases/latest/download/manifest.json`
 *      随发布自动指向最新 tag；不读 master 的清单（发版流程是先涨号后发布，
 *      master 上的版本可能比线上新）。
 *
 * 源与停用名单同一套：GitHub 主源、码云兜底。国内直连 GitHub 常失败，
 * 没有兜底这条功能等于没有。
 * ============================================================ */
import { requestUrl } from 'obsidian';
import { compareVersions } from '../core/version';

/** 自动检查的间隔：24 小时。反复启停、切库都不会把两个 CDN 当接口刷 */
export const UPDATE_CHECK_GAP_MS = 24 * 60 * 60 * 1000;

/** 后台检查的超时。拉不到不打扰任何人 */
const FETCH_TIMEOUT_MS = 4_000;

/** 本插件 id：清单里的 id 必须是它，防拿错仓库 */
const PLUGIN_ID = 'bz-reader';

export const UPDATE_SOURCES = {
  /** GitHub latest 直链：版本随 Release 自动跟进，无 API 限流 */
  githubManifest: 'https://github.com/yeshimei/bz-reader/releases/latest/download/manifest.json',
  /** 码云没有 latest/download，先查 release JSON 再取 assets 里的清单 */
  giteeApi: 'https://gitee.com/api/v5/repos/ntbl/bz-reader/releases/latest',
} as const;

/** 本地状态键。带版本号：将来换结构时老状态自动作废 */
export const UPDATE_STATE_KEY = 'bz-reader:update-check:v1';

export interface UpdateState {
  /** 上次成功查到版本的时间，0 = 从没查到过 */
  checkedAt: number;
  /** 已经弹过提醒的版本；空 = 没弹过 */
  notified: string;
}

export const EMPTY_UPDATE_STATE: UpdateState = { checkedAt: 0, notified: '' };

/** 可注入的 HTTP：返回文本，失败返回 null（测试用它，不打真网络） */
export type UpdateHttp = (url: string, timeoutMs: number) => Promise<string | null>;

async function requestText(url: string, timeoutMs: number): Promise<string | null> {
  let timer: number | null = null;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = window.setTimeout(() => resolve(null), timeoutMs);
    });
    const req = requestUrl({ url, method: 'GET', throw: false }).then((resp) => {
      if (!resp || resp.status < 200 || resp.status >= 300) return null;
      return resp.text;
    });
    return await Promise.race([req, timeout]);
  } catch {
    return null;
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}

let http: UpdateHttp = requestText;

/** 换 HTTP 实现（测试隔离）；传 null 恢复真实请求 */
export function _setUpdateHttpForTests(fn: UpdateHttp | null): void {
  http = fn ?? requestText;
}

/** 从一份 manifest 文本里取版本号；不是本插件的清单 / 坏 JSON 一律 null */
export function versionFromManifest(text: string | null): string | null {
  if (!text) return null;
  try {
    const m = JSON.parse(text) as { id?: unknown; version?: unknown };
    if (m?.id !== PLUGIN_ID) return null;
    if (typeof m.version !== 'string') return null;
    const v = m.version.trim();
    return v || null;
  } catch {
    return null;
  }
}

/** 码云 release JSON 里清单资产的下载地址；缺了返回 null */
export function giteeManifestUrl(json: string | null): string | null {
  if (!json) return null;
  try {
    const assets = (JSON.parse(json) as { assets?: unknown } | null)?.assets;
    if (!Array.isArray(assets)) return null;
    const hit = (assets as Array<{ name?: unknown; browser_download_url?: unknown }>).find(
      (a) => a?.name === 'manifest.json',
    );
    const url = hit?.browser_download_url;
    return typeof url === 'string' && url.trim() ? url.trim() : null;
  } catch {
    return null;
  }
}

/**
 * 拉线上最新版本：GitHub 主源，失败切码云。
 *
 * 只拉几百字节的清单。两条都不通返回 null——调用方**不许**把它当异常处理，
 * 离线用户不该看到任何提示。
 */
export async function fetchLatestVersion(timeoutMs = FETCH_TIMEOUT_MS): Promise<string | null> {
  try {
    const gh = versionFromManifest(await http(UPDATE_SOURCES.githubManifest, timeoutMs));
    if (gh) return gh;
    const release = await http(UPDATE_SOURCES.giteeApi, timeoutMs);
    const url = giteeManifestUrl(release);
    if (!url) return null;
    return versionFromManifest(await http(url, timeoutMs));
  } catch {
    return null;
  }
}

/** 24 小时节流：没查过、或距上次成功查到已经满 24 小时 */
export function shouldCheck(state: UpdateState, now: number): boolean {
  return !state.checkedAt || now - state.checkedAt >= UPDATE_CHECK_GAP_MS;
}

/** 线上比当前新才算有更新；本机版本更高（自测构建）不提示 */
export function hasUpdate(current: string, latest: string): boolean {
  const c = String(current || '').trim();
  const l = String(latest || '').trim();
  if (!c || !l) return false;
  return compareVersions(l, c) > 0;
}

/** 这个版本还没弹过才提示 */
export function shouldNotify(state: UpdateState, latest: string): boolean {
  return !!String(latest || '').trim() && state.notified !== String(latest).trim();
}

/** 解析本地状态：任何坏数据都回退到空状态，不让一份脏 JSON 挡住检查 */
export function parseUpdateState(raw: unknown): UpdateState {
  if (raw === null || raw === undefined || raw === '') return { ...EMPTY_UPDATE_STATE };
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ...EMPTY_UPDATE_STATE };
    }
  }
  if (!obj || typeof obj !== 'object') return { ...EMPTY_UPDATE_STATE };
  const p = obj as Partial<UpdateState>;
  return {
    checkedAt: typeof p.checkedAt === 'number' && p.checkedAt > 0 ? p.checkedAt : 0,
    notified: typeof p.notified === 'string' ? p.notified : '',
  };
}

export function readUpdateState(): UpdateState {
  try {
    return parseUpdateState(window.localStorage.getItem(UPDATE_STATE_KEY));
  } catch {
    return { ...EMPTY_UPDATE_STATE };
  }
}

/**
 * 写本地状态。存不下不算错误——隐私模式 / quota 满时退化成
 * 「这次会话照常弹，下次启动可能再弹一遍」，功能不能因此停摆。
 */
export function writeUpdateState(state: UpdateState): void {
  try {
    window.localStorage.setItem(
      UPDATE_STATE_KEY,
      JSON.stringify({ checkedAt: state.checkedAt, notified: state.notified }),
    );
  } catch {
    /* 存不下：本次仍然可用 */
  }
}
