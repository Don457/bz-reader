/** 漫画翻页手势：滚轮累计与点击开关的纯计算 */
import { describe, it, expect } from 'vitest';
import { wheelPixels, wheelTurn, clickTurns, turnReady } from '../src/engine/manga/gesture';

describe('漫画滚轮翻页', () => {
  it('像素模式取竖向位移，向下为正、向上为负', () => {
    expect(wheelPixels(100, 0, 0)).toBe(100);
    expect(wheelPixels(-100, 0, 0)).toBe(-100);
  });

  it('行模式与页模式折算成像素，Firefox 才翻得动', () => {
    expect(wheelPixels(3, 0, 1)).toBe(96);
    expect(wheelPixels(1, 0, 2)).toBe(800);
  });

  it('横向位移更大时取横向', () => {
    expect(wheelPixels(10, 120, 0)).toBe(120);
  });

  it('不够阈值不翻，够了翻一页并清零累计', () => {
    expect(wheelTurn(0, 20, 42)).toEqual({ acc: 20, dir: null });
    expect(wheelTurn(20, 20, 42)).toEqual({ acc: 40, dir: null });
    expect(wheelTurn(40, 5, 42)).toEqual({ acc: 0, dir: 'next' });
    expect(wheelTurn(0, -50, 42)).toEqual({ acc: 0, dir: 'prev' });
  });

  it('反向滚动抵消累计，不会攒够就乱翻', () => {
    expect(wheelTurn(40, -20, 42)).toEqual({ acc: 20, dir: null });
  });

  it('翻过之后冷却期内不重复翻', () => {
    expect(turnReady(1000, 800, 300)).toBe(false);
    expect(turnReady(1100, 800, 300)).toBe(true);
  });
});

describe('漫画点击翻页开关', () => {
  it('手机永远翻', () => {
    expect(clickTurns(true, false)).toBe(true);
  });

  it('桌面默认不翻，设置里开了才翻', () => {
    expect(clickTurns(false, false)).toBe(false);
    expect(clickTurns(false, true)).toBe(true);
  });
});
