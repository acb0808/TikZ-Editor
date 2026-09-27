import { renderToStaticMarkup } from 'react-dom/server';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';
import { boundsOf, resolveAnchor } from '../core/geometry';
import { isObjectDefined } from '../core/defined';
import { worldToScreen } from '../core/coordinates';
import type { Scene, SceneObject, Viewport } from '../core/types';
import { SceneShape } from '../canvas/SceneShape';
import { download, filename } from './project';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const mathDocument = mathjax.document('', {
  InputJax: new TeX({ packages: ['base', 'ams', 'newcommand'], maxBuffer: 10000, maxMacros: 500 }),
  OutputJax: new SVG({ fontCache: 'none' }),
});
const view: Viewport = { x: 0, y: 0, zoom: 1 };
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function mathSvg(object: SceneObject, objects: SceneObject[]): string {
  if (object.type !== 'math') return '';
  try {
    const output = mathDocument.convert(object.text, { display: false });
    const svg = adaptor.firstChild(output);
    if (!svg || adaptor.outerHTML(output).includes('data-mml-node="merror"')) throw new Error('Invalid math');
    const element = svg as Parameters<typeof adaptor.getAttribute>[0];
    const box = adaptor.getAttribute(element, 'viewBox').split(/\s+/).map(Number);
    const fontSize = object.fontSize * 4 / 3;
    const width = box[2] / 1000 * fontSize, height = box[3] / 1000 * fontSize;
    if (!Number.isFinite(width + height) || width <= 0 || height <= 0) throw new Error('Empty math');
    const p = worldToScreen(resolveAnchor(object.position, objects), view);
    adaptor.setAttribute(element, 'x', String(p.x - width / 2)); adaptor.setAttribute(element, 'y', String(p.y - height / 2));
    adaptor.setAttribute(element, 'width', String(width)); adaptor.setAttribute(element, 'height', String(height));
    adaptor.setAttribute(element, 'color', object.style.stroke); adaptor.setAttribute(element, 'opacity', String(object.style.opacity));
    adaptor.removeAttribute(element, 'style');
    return adaptor.outerHTML(element);
  } catch { throw new Error(`‘${object.name}’의 수식을 확인해 주세요. 올바른 수식만 이미지로 내보낼 수 있습니다.`); }
}

/** Uses scene objects only; neither selection overlays nor raw TeX is executed. */
export async function renderSceneSvg(scene: Scene): Promise<string> {
  const visible = scene.objects.filter(o => o.visible && isObjectDefined(o, scene.objects));
  const bounds = boundsOf(visible, scene.objects);
  if (!bounds) throw new Error('내보낼 도형을 먼저 그려 주세요.');
  const content = visible.map(object => object.type === 'math' ? mathSvg(object, scene.objects) : renderToStaticMarkup(<SceneShape object={object} objects={scene.objects} viewport={view}/>)).join('\n');
  const padding = Math.max(18, ...visible.map(o => o.style.strokeWidth * 8));
  let x = bounds.minX * 48 - padding, y = -bounds.maxY * 48 - padding;
  let width = (bounds.maxX - bounds.minX) * 48 + padding * 2, height = (bounds.maxY - bounds.minY) * 48 + padding * 2;
  if (typeof document !== 'undefined') {
    await document.fonts.ready;
    // Measure final vector glyphs as well as text, so fractions and long labels are not clipped.
    const parsed = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg"><g>${content}</g></svg>`, 'image/svg+xml');
    if (parsed.querySelector('parsererror')) throw new Error('벡터 이미지를 만들지 못했습니다.');
    const host = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
    host.style.cssText = 'position:fixed;left:-100000px;top:-100000px;width:1px;height:1px;overflow:visible;pointer-events:none';
    document.body.append(host);
    try {
      const box = (host.firstElementChild as SVGGraphicsElement).getBBox();
      x = box.x - padding; y = box.y - padding; width = Math.max(1, box.width + padding * 2); height = Math.max(1, box.height + padding * 2);
    } finally { host.remove(); }
  }
  if (width > 30000 || height > 30000) throw new Error('내보낼 그림이 너무 큽니다. 도형의 크기와 좌표를 줄여 주세요.');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Math.ceil(width)}" height="${Math.ceil(height)}" viewBox="${x} ${y} ${width} ${height}" role="img"><title>${escape(scene.name)}</title><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="white"/>${content}</svg>`;
}

export async function exportImage(scene: Scene, type: 'svg' | 'png'): Promise<void> {
  const svg = await renderSceneSvg(scene);
  if (type === 'svg') { download(svg, `${filename(scene)}.svg`, 'image/svg+xml'); return; }
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('PNG 변환을 완료하지 못했습니다. SVG로 저장해 주세요.')); image.src = url; });
    const ratio = Math.min(3, 8192 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(image.width * ratio); canvas.height = Math.ceil(image.height * ratio);
    const context = canvas.getContext('2d'); if (!context) throw new Error('이 브라우저에서는 PNG 변환을 사용할 수 없습니다.');
    context.scale(ratio, ratio); context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG 파일을 만들지 못했습니다.')), 'image/png'));
    download(blob, `${filename(scene)}.png`, 'image/png');
  } finally { URL.revokeObjectURL(url); }
}
