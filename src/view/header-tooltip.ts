/**
 * 阅读器头栏图标的悬停气泡（2026-11-24，QQ 频道用户建议「如 obsidian 原功能一样」）。
 *
 * 为什么单独一个文件：
 *   · 全仓 2026-11-17 起禁悬停气泡（见 scripts/check-tooltip-attrs.mjs），
 *     气泡的**唯一合法来源**就是这里——门禁只对本文件放行 setTooltip；
 *   · 作者拍板气泡**只给选定的一批按钮**，不做成全局 UI 都有。范围收在
 *     TOOLTIP_ACTIONS 白名单里，且只在头栏工具栏调用（见 reader-view.ts）。
 *
 * 出现时机交给 Obsidian 默认（不设延迟、不设 placement），文案去掉单字母键位：
 * 气泡是给新用户认按钮用的，「（s）」这种物理键位对鼠标悬停没有意义。
 */
import { setTooltip } from 'obsidian';
import { headerActionLabel, HEADER_ACTION_IDS, type HeaderActionId } from './header-actions';

/**
 * 去掉尾部单字母键位提示：中文「目录（s）」→「目录」、英文「Contents (s)」→「Contents」。
 *
 * 只吃「末尾、括号里恰好一个字母」这一种形态，且兼容全角/半角括号与它前面的空格。
 * 「复制链接（页 / 视图 / 嵌入 / 标注）」这类说明性括号里不是单字母，原样保留。
 */
export function stripHotkey(label: string): string {
  return label.replace(/\s*[（(][A-Za-z][）)]$/, '');
}

/** 当前语言下的气泡文案：标签去键位，不另写一套字面量 */
export function headerActionTooltip(id: HeaderActionId): string {
  return stripHotkey(headerActionLabel(id));
}

/**
 * 带气泡的按钮白名单——只圈阅读器顶部工具栏那批图标动作。
 *
 * 作者明确「不要全局所有 UI 都带，要选择性的」。这里先收进全部头栏动作：
 * 它们本来就是同一排工具条（含收进 ⋮ 的同族），与设置页 / 侧栏 / 弹窗里那些
 * 视觉隐藏文本按钮是两类。将来要再收窄，改这一处即可，调用方不用动。
 */
export const TOOLTIP_ACTIONS: ReadonlySet<HeaderActionId> = new Set<HeaderActionId>(HEADER_ACTION_IDS);

/**
 * 挂气泡——全仓唯一调用 setTooltip 的地方。
 * @param text 可选覆盖文案；空串表示不挂（避免给宿主送一个空气泡）。
 */
export function attachHeaderTooltip(el: HTMLElement, id: HeaderActionId, text?: string): void {
  if (!TOOLTIP_ACTIONS.has(id)) return;
  const tip = text ?? headerActionTooltip(id);
  if (tip) setTooltip(el, tip);
}
