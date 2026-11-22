/* ============================================================
 * bz-reader · 更新提醒弹窗（src/shell/update-note.ts）
 *
 * 只做「发现新版本」这一件事：报当前 / 最新两个版本号，告诉用户**去哪里
 * 更新**（Obsidian 设置 → 第三方插件 → 检查更新），按钮只有一个
 * 「忽略此版本」。
 *
 * **不做自更新，也不放下载链接**（作者 2026-11-22 明确）：
 *   · 插件不碰自己的文件——自动替换在移动端、受管环境、社区市场里都是雷；
 *   · 用户没有「下载页」这个习惯，给一个 GitHub 链接只会把人带出应用；
 *   · 社区市场的更新路径就够了，弹窗只负责说清「去设置里点检查更新」。
 *
 * 弹窗挂在 body 上，不在 .bzs-shell 里，样式走 `.bzs-upd-*` 自己的局部
 * 令牌（见 shell/styles/update.css）；选择器以 `.bzs-` 开头，构建时不会
 * 被加 .bzs-shell 前缀。
 *
 * 什么时候弹由 plugin.ts 决定（24 小时节流 + 每个新版本只弹一次），
 * 这里只负责画和关。
 * ============================================================ */
import { uiModal } from '../core/ui/modal';
import { t } from '../i18n';
import { esc } from './render/html';

/** 弹窗正文。纯字符串，便于单测文案与转义 */
export function updateNoteHtml(current: string, latest: string): string {
  return `<div class="bzs-upd">
      <p class="bzs-upd-ver"><b>v${esc(latest)}</b><span>${esc(
        t('update.current', { now: current }),
      )}</span></p>
      <p class="bzs-upd-note">${esc(t('update.hint'))}</p>
      <p class="bzs-upd-note">${esc(t('update.keep'))}</p>
      <div class="bzs-upd-acts">
        <button class="bzs-upd-btn" type="button" data-role="updignore">${esc(t('update.ignore'))}</button>
      </div>
    </div>`;
}

export interface UpdateNoteHandle {
  close: () => void;
}

/** 当前活着的那一个：连点 / 重复触发都只留一层遮罩 */
let live: UpdateNoteHandle | null = null;

/**
 * 打开更新提醒。
 *
 * 返回句柄只是给「插件卸载 / 测试收口」用的；用户交互走「忽略此版本」、
 * 点遮罩或 ESC，与插件里其它弹窗同一套。弹之前 plugin.ts 已经写过
 * `notified`，所以任何关闭方式都不会让这版再弹。
 */
export function openUpdateNote(current: string, latest: string): UpdateNoteHandle {
  live?.close();
  live = null;

  const modal = uiModal({
    content: updateNoteHtml(current, latest),
    className: 'bzs-upd-dialog',
    title: t('update.title'),
    head: true,
    maxWidth: 400,
  });

  modal.popup.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest) return;
    if (target.closest('[data-role="updignore"]')) modal.close();
  });

  const handle: UpdateNoteHandle = {
    close: () => {
      modal.close();
      if (live === handle) live = null;
    },
  };
  live = handle;
  return handle;
}
