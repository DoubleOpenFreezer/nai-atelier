// @vitest-environment jsdom
import React, { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createGlassDisplacementMap, useGlassRefraction } from '../../components/useGlassRefraction';

afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  delete document.documentElement.dataset.themeMaterial; delete document.documentElement.dataset.themeRefraction;
  document.documentElement.removeAttribute('style');
});
const pixel = (map: ReturnType<typeof createGlassDisplacementMap>, x: number, y: number) => Array.from(map.pixels.slice((y * map.width + x) * 4, (y * map.width + x) * 4 + 4));

it('圆角法线只弯折窄边，中心不位移，四边和圆角方向对称', () => {
  const map = createGlassDisplacementMap(100, 60, 12);
  expect(pixel(map, 50, 30)).toEqual([128, 128, 128, 255]);
  expect(pixel(map, 1, 30)[0]).toBeLessThan(80); expect(pixel(map, 1, 30)[1]).toBe(128);
  expect(pixel(map, 98, 30)[0]).toBeGreaterThan(175);
  expect(pixel(map, 50, 1)[1]).toBeLessThan(80); expect(pixel(map, 50, 1)[0]).toBe(128);
  expect(pixel(map, 50, 58)[1]).toBeGreaterThan(175);
  const corner = pixel(map, 4, 4), opposite = pixel(map, 95, 55);
  expect(corner[0]).toBeLessThan(128); expect(corner[1]).toBeLessThan(128);
  expect(corner[0] + opposite[0]).toBe(255); expect(corner[1] + opposite[1]).toBe(255);
});

it('长宽变化不拉宽边缘，胶囊圆角不超过半高，贴图尺寸有上限', () => {
  const narrow = createGlassDisplacementMap(100, 60, 12), wide = createGlassDisplacementMap(400, 60, 12);
  expect(pixel(wide, 1, 30)).toEqual(pixel(narrow, 1, 30));
  expect(pixel(wide, 12, 30)).toEqual([128, 128, 128, 255]);
  expect(createGlassDisplacementMap(80, 40, 999).pixels).toEqual(createGlassDisplacementMap(80, 40, 20).pixels);
  const large = createGlassDisplacementMap(2048, 64, 18);
  expect([large.width, large.height, large.pixels.length]).toEqual([512, 16, 512 * 16 * 4]);
});

const Surface = () => {
  const ref = useRef<HTMLDivElement>(null); useGlassRefraction(ref);
  return <div ref={ref} style={{ borderRadius: 12 }}>菜单</div>;
};
it('两个表面独立持有透镜，颜色更新复用贴图，强度切换和退出玻璃及时清理', async () => {
  vi.stubGlobal('CSS', { supports: () => true });
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect; });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(240);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(70);
  const putImageData = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA==');
  const root = document.documentElement;
  root.dataset.themeMaterial = 'glass'; root.dataset.themeRefraction = 'true'; root.style.setProperty('--nai-glass-refraction', '8');
  const view = render(<><Surface /><Surface /></>);
  const filters = () => Array.from(document.querySelectorAll('filter[id^="nai-glass-contour-"]'));
  expect(filters()).toHaveLength(2); expect(filters()[0].id).not.toBe(filters()[1].id);
  for (const filter of filters()) {
    expect(filter.getAttribute('filterUnits')).toBe('userSpaceOnUse');
    expect(filter.getAttribute('primitiveUnits')).toBe('userSpaceOnUse');
    expect([filter.getAttribute('width'), filter.getAttribute('height')]).toEqual(['240', '70']);
    expect([filter.querySelector('feImage')?.getAttribute('width'), filter.querySelector('feImage')?.getAttribute('height')]).toEqual(['240', '70']);
  }
  expect(putImageData).toHaveBeenCalledTimes(2);
  await act(async () => { root.style.setProperty('--nai-accent', '#007aff'); });
  expect(putImageData).toHaveBeenCalledTimes(2);
  await act(async () => { root.style.setProperty('--nai-glass-refraction', '12'); });
  expect(filters().map(filter => filter.querySelector('feDisplacementMap')?.getAttribute('scale'))).toEqual(['12', '12']);
  expect(putImageData).toHaveBeenCalledTimes(2);
  await act(async () => { root.dataset.themeMaterial = 'solid'; });
  expect(filters()).toHaveLength(0);
  expect(view.container.querySelector('div')?.style.getPropertyValue('--nai-glass-contour')).toBe('');
  await act(async () => { root.dataset.themeMaterial = 'glass'; });
  expect(filters()).toHaveLength(2);
  view.unmount(); expect(filters()).toHaveLength(0); expect(disconnect).toHaveBeenCalledTimes(2);
});
