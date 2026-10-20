import { useId, useLayoutEffect, type RefObject } from 'react';

// 按实际像素距离生成圆角矩形法线；宽工具栏的边缘不能随整张贴图拉宽。
export const createGlassDisplacementMap = (width: number, height: number, radius: number) => {
  const ratio = Math.min(1, 512 / Math.max(width, height));
  const mapWidth = Math.max(1, Math.round(width * ratio)), mapHeight = Math.max(1, Math.round(height * ratio));
  const pixels = new Uint8ClampedArray(mapWidth * mapHeight * 4);
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const band = Math.min(10, Math.max(2, r * .65), Math.min(width, height) / 3);
  for (let y = 0; y < mapHeight; y++) for (let x = 0; x < mapWidth; x++) {
    const px = (x + .5) * width / mapWidth - width / 2, py = (y + .5) * height / mapHeight - height / 2;
    const qx = Math.abs(px) - width / 2 + r, qy = Math.abs(py) - height / 2 + r;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), corner = Math.hypot(ox, oy);
    const depth = r - corner - Math.min(Math.max(qx, qy), 0);
    const strength = Math.max(0, 1 - Math.max(0, depth) / band) ** 2;
    const nx = corner ? Math.sign(px) * ox / corner : qx > qy ? Math.sign(px) : 0;
    const ny = corner ? Math.sign(py) * oy / corner : qy >= qx ? Math.sign(py) : 0;
    const i = (y * mapWidth + x) * 4;
    pixels[i] = Math.round(127.5 + nx * strength * 127.5);
    pixels[i + 1] = Math.round(127.5 + ny * strength * 127.5);
    pixels[i + 2] = 128; pixels[i + 3] = 255;
  }
  return { width: mapWidth, height: mapHeight, pixels };
};

/** 只在挂载、尺寸或主题改变时更新背景透镜，不追踪鼠标，也不采样作品。 */
export const useGlassRefraction = (ref: RefObject<HTMLElement | null>) => {
  const id = 'nai-glass-contour-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof CSS === 'undefined' || !CSS.supports?.('backdrop-filter', 'url("#nai-glass-lens")')) return;
    const root = document.documentElement;
    let svg: SVGSVGElement | undefined, geometry = '';
    const clear = () => { svg?.remove(); svg = undefined; geometry = ''; element.style.removeProperty('--nai-glass-contour'); };
    const update = () => {
      if (root.dataset.themeMaterial !== 'glass' || root.dataset.themeRefraction !== 'true') { clear(); return; }
      const width = element.offsetWidth, height = element.offsetHeight;
      if (!width || !height) return;
      const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
      const next = `${width}:${height}:${radius}`;
      if (next !== geometry) {
        const map = createGlassDisplacementMap(width, height, radius);
        const canvas = document.createElement('canvas'); canvas.width = map.width; canvas.height = map.height;
        const context = canvas.getContext('2d');
        if (!context) return;
        const image = context.createImageData(map.width, map.height); image.data.set(map.pixels); context.putImageData(image, 0, 0);
        if (!svg) {
          svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('aria-hidden', 'true'); svg.style.cssText = 'position:fixed;width:0;height:0;pointer-events:none';
          svg.innerHTML = `<defs><filter id="${id}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="0" y="0" color-interpolation-filters="sRGB"><feImage x="0" y="0" preserveAspectRatio="none" result="contour"/><feDisplacementMap in="SourceGraphic" in2="contour" xChannelSelector="R" yChannelSelector="G"/></filter></defs>`;
          document.body.append(svg);
        }
        // 固定实际采样范围，避免按背景重绘矩形重新解释百分比透镜。
        for (const node of [svg.querySelector('filter')!, svg.querySelector('feImage')!]) {
          node.setAttribute('width', String(width)); node.setAttribute('height', String(height));
        }
        svg.querySelector('feImage')!.setAttribute('href', canvas.toDataURL());
        geometry = next;
        element.style.setProperty('--nai-glass-contour', `url("#${id}")`);
      }
      svg?.querySelector('feDisplacementMap')?.setAttribute('scale', getComputedStyle(root).getPropertyValue('--nai-glass-refraction').trim());
    };
    update();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update); resize?.observe(element);
    const theme = new MutationObserver(update);
    theme.observe(root, { attributes: true, attributeFilter: ['class', 'style', 'data-theme-material', 'data-theme-refraction'] });
    return () => { resize?.disconnect(); theme.disconnect(); clear(); };
  }, [id, ref]);
};
