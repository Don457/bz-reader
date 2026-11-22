/**
 * 制卡入口（tests/review-cards-flow.test.ts）
 *
 * 工具条单条「加入复习」与划选「加入复习」都走 `openCardsFlow`，它第一件事
 * 是 `requireReviewFlow`：没装 / 没启用时把用户送到设置页的「bz review」组。
 *
 * 2026-11-22 并组后落点从 `plugins` 改成 `review`——这里把两条工具条入口
 * 共用的那一步钉住，避免以后改组名又漏掉一处。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const notifySpy = vi.hoisted(() => vi.fn());
vi.mock('../src/core/notice', () => ({ notify: notifySpy }));

const openStudySpy = vi.hoisted(() => vi.fn());
vi.mock('../src/shell/source', () => ({
  getShellSource: () => ({ openStudy: openStudySpy, clearSelection: () => undefined }),
}));

vi.mock('../src/shell/state', () => ({ closeOverlay: () => undefined }));

import { openCardsFlow } from '../src/shell/review-cards-ui';
import { takeSettingsFocus } from '../src/shell/settings-focus';

const appWithoutReview = { plugins: { plugins: {}, manifests: {}, enabledPlugins: new Set() } } as never;

describe('openCardsFlow · 没装 bz Review', () => {
  beforeEach(() => {
    notifySpy.mockClear();
    openStudySpy.mockClear();
    takeSettingsFocus();
  });

  it('打开设置页并聚焦「bz review」组，不是旧的 plugins', () => {
    openCardsFlow(appWithoutReview, [{ key: 'k1', text: '一段划线', bookTitle: '一本书' }]);
    expect(openStudySpy).toHaveBeenCalledWith('settings');
    expect(takeSettingsFocus()).toBe('review');
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });
});
