import { afterEach, describe, expect, it, vi } from 'vitest';

async function load(reduced: boolean) {
  vi.resetModules();
  vi.stubGlobal('window', { innerHeight: 800, matchMedia: () => ({ matches: reduced }) });
  vi.stubGlobal('getComputedStyle', () => ({ transform: 'none' }));
  return import('./motion');
}

const element = (top: number, height: number) =>
  ({ style: {}, getBoundingClientRect: () => ({ top, height }) }) as unknown as HTMLElement;

afterEach(() => vi.unstubAllGlobals());

describe('motion', () => {
  it('gives no duration to anything under Reduce Motion', async () => {
    const { dur, slideUp, collapse, MOTION } = await load(true);
    expect(dur(MOTION.slow)).toBe(0);
    expect(slideUp(element(500, 300)).duration).toBe(0);
    expect(collapse(element(0, 44)).duration).toBe(0);
  });

  it('leaves no clip behind when nothing animates', async () => {
    const { collapse } = await load(true);
    const node = element(0, 44);
    collapse(node);
    expect(node.style.overflow).toBeUndefined();
  });

  it('keeps every token within the limit for something waited on during a workout', async () => {
    const { MOTION } = await load(false);
    expect(Math.max(...Object.values(MOTION))).toBeLessThanOrEqual(300);
  });

  it('slides from just below the screen', async () => {
    const { slideUp } = await load(false);
    const { css, duration } = slideUp(element(500, 300));
    expect(duration).toBeGreaterThan(0);
    expect(css?.(0, 1)).toContain('translate3d(0, 300px, 0)');
    expect(css?.(1, 0)).toContain('translate3d(0, 0px, 0)');
  });

  it('clips while it opens and ends at full height', async () => {
    const { collapse } = await load(false);
    const node = element(0, 44);
    const { css } = collapse(node);
    expect(node.style.overflow).toBe('clip');
    expect(css?.(0, 1)).toContain('height: 0px');
    expect(css?.(1, 0)).toContain('height: 44px');
  });

  it('eases from 0 to 1, decelerating, without going past the end', async () => {
    const { easeOut } = await load(false);
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.25)).toBeGreaterThan(0.5);
    for (let t = 0; t <= 1; t += 0.05) expect(easeOut(t)).toBeLessThanOrEqual(1);
  });
});
