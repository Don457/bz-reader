/* ============================================================
 * bz-reader · 打开设置页的某一组（shell/settings-focus.ts）
 *
 * 「加入复习」在没装 / 没启用 bz Review 时不再只弹一句提示，而是把用户
 * 送到设置页的「bz review」组：那里有安装 / 启用按钮。
 *
 * 用模块级 pending 而不是写进 ShellState：它是一次性的「这次打开要滚到哪」，
 * 不是界面状态——进 state 会污染渲染指纹，还会在下一次 store.touch 时
 * 把用户滚回那一组。
 * ============================================================ */

let pendingGroup: string | null = null;

/** 下一次设置页渲染完成后滚到这一组 */
export function requestSettingsFocus(group: string): void {
  pendingGroup = String(group || '').trim() || null;
}

/** 取走待滚动的组（只生效一次）；没人在等时返回 null */
export function takeSettingsFocus(): string | null {
  const group = pendingGroup;
  pendingGroup = null;
  return group;
}

/**
 * 设置页渲染完调：滚到那一组，并闪一下边框。
 *
 * 放在渲染之后而不是 openStudy 里：新建书架 tab 时设置页要等一次
 * setViewState 才画出来，提前查 DOM 只会查到空。
 *
 * 2026-11-22 补一次延迟重滚：划词入口是从**书 tab 切回书架**，
 * 第一次滚常常撞上 tab 激活 / 「恢复上次位置」，位置又被拉回页顶
 * （真机复现：设置页开了，却停在「界面」组）。隔 120ms 再滚一次，
 * 用户看到的仍是一下；书右键那条路本来一次就中，第二次滚是同位置，无感。
 */
export function applySettingsFocus(group: string): void {
  const target = (): HTMLElement | null =>
    document.querySelector<HTMLElement>(`.bzs-set-page #bz-set-${group}`);
  const scroll = (): void => {
    target()?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const el = target();
  if (!el) return;
  scroll();
  /* 复用已有的 .is-flash 动画（阅读页齿轮跳设置页时也用它）：
     先摘再加快一次布局，连续点「复习」时才会重新闪，而不是第二下没反应。 */
  el.classList.remove('is-flash');
  void el.offsetWidth;
  el.classList.add('is-flash');
  window.setTimeout(() => el.classList.remove('is-flash'), 1400);
  window.setTimeout(scroll, 120);
}
