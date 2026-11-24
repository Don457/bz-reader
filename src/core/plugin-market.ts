/* ============================================================
 * bz-reader · 打开插件市场并搜好名字（core/plugin-market.ts）
 *
 * 2026-11-23：bz review 已进官方目录，bz-reader 不再自己下载它。设置页那颗
 * 「去市场下载」要做的就是把人送到市场，搜索框里已经把名字填好——省掉
 * 「打开设置 → 找到第三方插件 → 点浏览 → 自己敲名字」四步。
 *
 * 宿主没有「打开市场并搜索」这种 API（官方 URI 只有 open / new / daily /
 * unique / search / choose-vault），所以只能按界面走三步，每一步都可能
 * 因为版本差异落空：
 *   1. 打开设置并切到「第三方插件」；
 *   2. 点那颗「浏览」——先认 `mod-cta` 这个 class，认不到再认多语言文案；
 *   3. 在弹出的市场里找到搜索框，填值并派发 input。
 *
 * 任何一步失败都只是「停在第三方插件页」，用户自己点一下就能继续，
 * 所以这里不报错、不弹窗——它本来就是个指路动作。
 * ============================================================ */
import type { App } from 'obsidian';

/** 宿主设置页里「第三方插件」那张 tab 的 id */
export const MARKET_TAB_ID = 'community-plugins';

interface HostSetting {
  open?: () => void;
  openTabById?: (id: string) => void;
}

/** 打开设置后等一帧多一点：tab 内容是同步渲染的，但要给宿主一次绘制时间 */
const TAB_DELAY_MS = 160;
/** 点完「浏览」到市场列表出现 */
const MODAL_DELAY_MS = 220;
/** 填完搜索词到列表重筛、可以滚到目标卡片 */
const SEARCH_SETTLE_MS = 420;
/** 渲染慢一拍的机器上最多再试几次（每次间隔） */
const RETRY_DELAY_MS = 180;
const RETRY_TIMES = 3;

/**
 * 「浏览」按钮：靠 `mod-cta` 这个 class 认，不认文案。
 *
 * 认文案就得把八种语言都写死在代码里（而且宿主语言和本插件语言是两回事），
 * 那是硬编码中文门禁明令禁止的；class 则是宿主换语言不换的东西。
 *
 * 「第三方插件」页上有两颗 mod-cta：「浏览」和「检查更新」，前者在前
 * （真机 2026-11-23 实测，安全模式那颗「开启」不是 mod-cta）。所以取第一颗。
 * 认不到就不点——用户会停在第三方插件页，那颗「浏览」就摆在他眼前。
 */
function browseButton(): HTMLElement | null {
  const tab = document.querySelector<HTMLElement>('.vertical-tab-content');
  return tab?.querySelector<HTMLElement>('button.mod-cta') ?? null;
}

/**
 * 市场弹窗里的搜索框。
 *
 * 设置本身也是一个 `.modal-container`，市场弹在它上面——两者都有
 * `input[type="search"]`，抓错了就会把搜索词填进「已安装插件」的框里
 * （真机 2026-11-23 踩过）。区别是设置那层有左侧导航 `.vertical-tab-content`，
 * 市场那层没有；从后往前找第一个没有导航的。
 */
function marketSearchInput(): HTMLInputElement | null {
  const modals = Array.from(document.querySelectorAll<HTMLElement>('.modal-container'));
  for (let i = modals.length - 1; i >= 0; i -= 1) {
    if (modals[i].querySelector('.vertical-tab-content')) continue;
    const input = modals[i].querySelector<HTMLInputElement>('input[type="search"]');
    if (input) return input;
  }
  return null;
}

/**
 * 把结果列表滚到第一张名字对得上的卡片。
 *
 * 「bz review」在这个版本的市场里排到第十条（真机 2026-11-23），首屏看不见，
 * 用户会以为搜不到。名字比对是拿用户给的搜索词去比卡片文字，大小写和空格
 * 归一化——这里没有任何写死的插件名。
 */
function scrollToHit(scope: HTMLElement, query: string): void {
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const want = norm(query);
  if (!want) return;
  const cards = Array.from(scope.querySelectorAll<HTMLElement>('.community-item'));
  const hit = cards.find((el) => norm(el.textContent ?? '').startsWith(want));
  hit?.scrollIntoView({ block: 'center' });
}

/** 填搜索框：只改 value 不派发事件的话，列表不会重筛 */
function fillSearch(box: HTMLInputElement, query: string): void {
  box.value = query;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  const scope = box.closest<HTMLElement>('.modal-container') ?? document.body;
  window.setTimeout(() => scrollToHit(scope, query), SEARCH_SETTLE_MS);
}

/** 一边等渲染一边做，最多试 RETRY_TIMES 次；做成了就停 */
function whenReady<T extends HTMLElement>(find: () => T | null, run: (el: T) => void, tries = 0): void {
  const hit = find();
  if (hit) {
    run(hit);
    return;
  }
  if (tries + 1 >= RETRY_TIMES) return;
  window.setTimeout(() => whenReady(find, run, tries + 1), RETRY_DELAY_MS);
}

/**
 * 打开插件市场并把 query 填进搜索框。
 *
 * `app.setting` 不是公开 API，和 `app.plugins` 同一档；拿不到就静默退出，
 * 让别人以为点了没反应也比抛错强——设置页本来就在那里。
 */
export function openPluginMarket(app: App | undefined, query: string): void {
  const setting = (app as unknown as { setting?: HostSetting } | undefined)?.setting;
  if (!setting?.open) return;
  setting.open();
  setting.openTabById?.(MARKET_TAB_ID);

  const q = String(query ?? '').trim();
  window.setTimeout(() => {
    whenReady(browseButton, (btn) => {
      btn.click();
      if (!q) return;
      window.setTimeout(() => {
        whenReady(marketSearchInput, (input) => fillSearch(input, q));
      }, MODAL_DELAY_MS);
    });
  }, TAB_DELAY_MS);
}

interface PluginRegistryLike {
  manifests?: Record<string, unknown>;
  plugins?: Record<string, unknown>;
}

export interface WatchOptions {
  intervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
}

/**
 * 等一个插件出现在宿主的清单里。
 *
 * 用户点「去市场下载」之后是在宿主的模态里装的，装完关掉模态就回到设置页；
 * 设置页那张卡是点按钮时画的，不会自己变。这里每隔一会儿看一眼清单，
 * 认到了就回调一次（壳层拿它重绘），两分钟还没等到就放弃——不挂常驻轮询。
 *
 * 返回取消函数：卡片被重绘 / 视图关掉时应调一次，别让定时器留在那儿。
 */
export function watchPluginAppear(
  app: App | undefined,
  id: string,
  onAppear: () => void,
  opts: WatchOptions = {},
): () => void {
  const intervalMs = opts.intervalMs ?? 800;
  /* 30 秒：用户装完插件通常十几秒内就回到设置页；拖满两分钟只会在
     他已经关掉页面之后继续空转 */
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const now = opts.now ?? Date.now;
  const started = now();
  let timer: number | null = null;
  let stopped = false;

  const stop = (): void => {
    stopped = true;
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };

  const tick = (): void => {
    if (stopped) return;
    const reg = (app as unknown as { plugins?: PluginRegistryLike } | undefined)?.plugins;
    const appeared = !!reg?.manifests?.[id] || !!reg?.plugins?.[id];
    if (appeared) {
      stop();
      onAppear();
      return;
    }
    if (now() - started >= timeoutMs) stop();
  };

  timer = window.setInterval(tick, intervalMs);
  return stop;
}
