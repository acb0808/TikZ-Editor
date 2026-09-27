import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { Project } from '../../src/core/types';

async function worldPosition(page: Page, x: number, y: number) {
  const project = await savedProject(page), area = (await page.getByTestId('canvas').boundingBox())!;
  return { x: area.x + project.viewport.x + x * 48 * project.viewport.zoom, y: area.y + project.viewport.y - y * 48 * project.viewport.zoom };
}

async function savedProject(page: Page): Promise<Project> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '프로젝트 저장', exact: true }).click();
  const download = await pending;
  return JSON.parse(await readFile((await download.path())!, 'utf8')) as Project;
}
async function newDrawing(page: Page) {
  await page.getByRole('button', { name: '새 도면', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '새 도면', exact: true }).click();
}
async function drag(page: Page, from: {x:number;y:number}, to: {x:number;y:number}) {
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 10 }); await page.mouse.up();
}

test('loads the editor with an editable construction', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '도구' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '레이어' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'TikZ 코드' })).toBeVisible();
  await expect(page.locator('svg[data-testid="canvas"]')).toBeVisible();
  await page.screenshot({ path: 'test-results/editor-desktop.png' });
});

test('formula graph, coefficient and a bound point survive save and reload', async ({ page }) => {
  await page.goto('/'); await newDrawing(page);
  await page.getByRole('button', { name: '함수 그래프 (F)', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '수식으로 그래프 그리기' });
  await dialog.getByRole('textbox', { name: '그래프 수식', exact: true }).fill('a*x^2');
  await dialog.getByRole('button', { name: '그래프 추가', exact: true }).click();
  await expect(page.locator('[data-object-type="plot"]')).toHaveCount(1);
  await page.getByRole('button', { name: '점 (P)', exact: true }).click();
  const at = await worldPosition(page, 1, 1); await page.mouse.click(at.x, at.y);
  const before = await savedProject(page), plot = before.scene.objects.find(o => o.type === 'plot')!;
  const point = before.scene.objects.find(o => o.type === 'point')!;
  expect(point.type === 'point' && point.binding?.objectId).toBe(plot.id);
  await page.getByRole('button', { name: `${plot.name} 선택`, exact: true }).click();
  await page.getByRole('spinbutton', { name: '계수 a', exact: true }).fill('2');
  await page.keyboard.press('Tab');
  const project = await savedProject(page);
  expect(project.scene.objects.find(o => o.type === 'plot')?.parameters.a).toBe(2);
  const renderedPoint = page.getByTestId(`object-${point.id}`).locator('circle').first();
  expect(Number(await renderedPoint.getAttribute('cy'))).toBeCloseTo(project.viewport.y - 2 * 48 * project.viewport.zoom, 1);
  await page.getByRole('slider', { name: 'a 슬라이더', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  expect((await savedProject(page)).scene.objects.find(o => o.type === 'plot')?.parameters.a).toBeCloseTo(2.1);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  expect((await savedProject(page)).scene.objects.find(o => o.type === 'plot')?.parameters.a).toBe(2);
  await page.locator('input[type=file]').setInputFiles({ name: 'graph.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  expect((await savedProject(page)).scene.objects).toEqual(project.scene.objects);
  await page.getByRole('button', { name: `${plot.name} 선택`, exact: true }).click();
  await page.screenshot({ path: 'test-results/formula-graph.png' });
});

test('path point follows its host and generic shape cutting creates removable pieces', async ({ page }) => {
  await page.goto('/'); await newDrawing(page);
  await page.getByRole('button', { name: '원 (C)', exact: true }).click();
  const origin = await worldPosition(page, 0, 0), right = await worldPosition(page, 2, 0);
  await drag(page, origin, right);
  const circle = (await savedProject(page)).scene.objects[0];
  await page.getByRole('button', { name: '점 (P)', exact: true }).click(); await page.mouse.click(right.x, right.y);
  const withPoint = await savedProject(page), point = withPoint.scene.objects.find(o => o.type === 'point')!;
  expect(point.type === 'point' && point.binding?.objectId).toBe(circle.id);
  await page.getByRole('button', { name: `${circle.name} 선택`, exact: true }).click();
  await page.getByRole('spinbutton', { name: 'X1', exact: true }).fill('1'); await page.keyboard.press('Tab');
  const movedProject = await savedProject(page);
  expect(Number(await page.getByTestId(`object-${point.id}`).locator('circle').first().getAttribute('cx'))).toBeCloseTo(movedProject.viewport.x + 3 * 48 * movedProject.viewport.zoom, 1);
  await page.getByRole('button', { name: '사각형 (R)', exact: true }).click();
  await drag(page, await worldPosition(page, 4, 1), await worldPosition(page, 6, -1));
  const rectangle = (await savedProject(page)).scene.objects.find(o => o.type === 'rectangle')!;
  await page.getByRole('button', { name: `${rectangle.name} 선택`, exact: true }).click();
  await page.getByRole('button', { name: '도형 자르기 (X)', exact: true }).click();
  await expect(page.getByTestId('cut-hint')).toContainText('첫 번째 점');
  const bottom = await worldPosition(page, 5, -2), top = await worldPosition(page, 5, 2);
  await page.mouse.click(bottom.x, bottom.y);
  await expect(page.getByTestId('cut-hint')).toContainText('두 번째 점');
  await page.mouse.click(top.x, top.y);
  await expect(page.locator('[data-object-type="polygon"]')).toHaveCount(2);
  await expect(page.locator('[data-object-type="rectangle"]')).toHaveCount(0);
  const split = await savedProject(page), other = split.scene.objects.find(o => o.type === 'polygon' && o.id !== rectangle.id)!;
  await page.getByRole('button', { name: `${other.name} 선택`, exact: true }).click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.locator('[data-object-type="polygon"]')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/shape-cut.png' });
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(page.locator('[data-object-type="polygon"]')).toHaveCount(2);
  const project = await savedProject(page);
  await page.locator('input[type=file]').setInputFiles({ name: 'cut.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  expect((await savedProject(page)).scene.objects).toEqual(project.scene.objects);
});

test('graph dialog rejects unsafe math, traps focus and supports parametric and polar presets', async ({ page }) => {
  await page.goto('/'); await newDrawing(page); await page.getByTestId('canvas').focus(); await page.keyboard.press('f');
  const dialog = page.getByRole('dialog', { name: '수식으로 그래프 그리기' });
  await expect(dialog.getByRole('textbox', { name: '그래프 수식', exact: true })).toBeFocused();
  await dialog.getByRole('textbox', { name: '그래프 수식', exact: true }).fill('globalThis.alert(1)');
  await dialog.getByRole('button', { name: '그래프 추가', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible(); await expect(page.locator('[data-object-type="plot"]')).toHaveCount(0);
  for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button', { name: '극좌표 꽃', exact: true }).click();
  await dialog.getByRole('spinbutton', { name: 't 최댓값', exact: true }).fill('6.28'); await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible(); await page.screenshot({ path: 'test-results/graph-dialog.png' });
  await dialog.getByRole('button', { name: '그래프 추가', exact: true }).click();
  expect((await savedProject(page)).scene.objects.find(o => o.type === 'plot')?.mode).toBe('polar');
  await page.getByRole('button', { name: '함수 그래프 (F)', exact: true }).click();
  await dialog.getByRole('button', { name: '매개변수 원', exact: true }).click(); await dialog.getByRole('button', { name: '그래프 추가', exact: true }).click();
  expect((await savedProject(page)).scene.objects.filter(o => o.type === 'plot').map(o => o.mode)).toEqual(['polar', 'parametric']);
});

test('a rational graph exports bounded SVG and PNG across its asymptote', async ({ page }) => {
  await page.goto('/'); await newDrawing(page);
  await page.getByRole('button', { name: '함수 그래프 (F)', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '수식으로 그래프 그리기' });
  await dialog.getByRole('button', { name: '반비례', exact: true }).click(); await dialog.getByRole('button', { name: '그래프 추가', exact: true }).click();
  for (const format of ['벡터 이미지', '고해상도 이미지']) {
    await page.getByRole('button', { name: '내보내기', exact: true }).click();
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: new RegExp(format) }).click();
    const file = await pending, bytes = await readFile((await file.path())!);
    if (format === '벡터 이미지') { const svg = bytes.toString('utf8'); expect(svg).not.toMatch(/NaN|Infinity/); expect((svg.match(/M /g) ?? []).length).toBeGreaterThanOrEqual(2); expect(svg.length).toBeLessThan(200000); }
    else expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  }
});

test('undefined graph points and dependent geometry disappear and recover with their bindings', async ({ page }) => {
  await page.goto('/');
  const project = await savedProject(page), base = { visible: true, locked: false, style: { stroke: '#138a80', fill: 'none', strokeWidth: 1, opacity: 1, dash: 'solid', arrows: 'none' } };
  const next = { ...project, scene: { ...project.scene, source: [], objects: [
    { ...base, id: 'root', name: '제곱근 그래프', type: 'plot', mode: 'cartesian', expression: 'sqrt(a-x)', xExpression: 't', xMin: 0, xMax: 2, parameters: { a: 2, b: 0, c: 0 } },
    { ...base, id: 'bound', name: '연결점', type: 'point', position: { x: 1, y: 1 }, binding: { objectId: 'root', t: .5 } },
    { ...base, id: 'dependent', name: '연결선', type: 'line', points: [{ x: 1, y: 1, pointId: 'bound' }, { x: -1, y: 0 }] },
    { ...base, id: 'dependentCircle', name: '연결 원', type: 'circle', center: { x: 1, y: 1, pointId: 'bound' }, radius: .4 },
  ] } };
  await page.locator('input[type=file]').setInputFiles({ name: 'dependencies.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(next)) });
  await expect(page.getByTestId('object-bound')).toBeVisible(); await expect(page.getByTestId('object-dependent')).toBeVisible();
  await page.getByRole('button', { name: '제곱근 그래프 선택', exact: true }).click();
  await page.getByRole('spinbutton', { name: '계수 a', exact: true }).fill('0'); await page.keyboard.press('Tab');
  await expect(page.getByTestId('object-bound')).toHaveCount(0); await expect(page.getByTestId('object-dependent')).toHaveCount(0); await expect(page.getByTestId('object-dependentCircle')).toHaveCount(0);
  expect((await savedProject(page)).scene.objects.find(o => o.type === 'point')?.binding?.objectId).toBe('root');
  await page.getByRole('spinbutton', { name: '계수 a', exact: true }).fill('2'); await page.keyboard.press('Tab');
  await expect(page.getByTestId('object-bound')).toBeVisible(); await expect(page.getByTestId('object-dependent')).toBeVisible(); await expect(page.getByTestId('object-dependentCircle')).toBeVisible();
});

test('references follow a dragged point, undo restores it, and JSON reloads', async ({ page }) => {
  await page.goto('/'); await newDrawing(page);
  const canvas = page.getByTestId('canvas'), area = (await canvas.boundingBox())!;
  for (const p of [{ x: 180, y: 200 }, { x: 400, y: 260 }]) {
    await page.getByRole('button', { name: '점 (P)', exact: true }).click(); await canvas.click({ position: p });
  }
  await page.getByRole('button', { name: '선분 (L)', exact: true }).click();
  await drag(page, { x: area.x + 180, y: area.y + 200 }, { x: area.x + 400, y: area.y + 260 });
  const before = await savedProject(page), points = before.scene.objects.filter(o => o.type === 'point');
  const line = before.scene.objects.find(o => o.type === 'line');
  expect(line?.type === 'line' && line.points.map(p => p.pointId)).toEqual(points.map(p => p.id));
  await page.getByRole('button', { name: `${points[0].name} 선택`, exact: true }).click();
  const handle = (await page.getByTestId(`handle-${points[0].id}-0`).boundingBox())!;
  await drag(page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, { x: handle.x + handle.width / 2 + 70, y: handle.y + handle.height / 2 - 40 });
  const after = await savedProject(page), moved = after.scene.objects.find(o => o.id === points[0].id);
  expect(moved?.type === 'point' && moved.position).not.toEqual(points[0].position);
  expect(after.scene.objects.find(o => o.type === 'line')).toEqual(line);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  expect((await savedProject(page)).scene.objects).toEqual(before.scene.objects);
  await page.locator('input[type=file]').setInputFiles({ name: 'drawing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(after)) });
  await expect(page.locator('[data-testid="layer-row"]')).toHaveCount(3);
  expect((await savedProject(page)).scene.objects).toEqual(after.scene.objects);
});

test('circle handle resizing, style and keyboard duplicate/delete undo', async ({ page }) => {
  await page.goto('/');
  const oldRadius = await page.getByRole('spinbutton', { name: '반지름', exact: true }).inputValue();
  const handle = (await page.getByTestId('handle-circumcircle-1').boundingBox())!;
  await drag(page, { x: handle.x + 5, y: handle.y + 5 }, { x: handle.x + 80, y: handle.y + 5 });
  expect(await page.getByRole('spinbutton', { name: '반지름', exact: true }).inputValue()).not.toBe(oldRadius);
  await page.getByRole('button', { name: '파선', exact: true }).click();
  await page.getByTestId('canvas').focus();
  await page.keyboard.press('Control+d');
  await expect(page.locator('[data-testid="layer-row"]')).toHaveCount(13);
  await page.keyboard.press('Delete'); await expect(page.locator('[data-testid="layer-row"]')).toHaveCount(12);
  await page.keyboard.press('Control+z'); await expect(page.locator('[data-testid="layer-row"]')).toHaveCount(13);
  const project = await savedProject(page);
  expect(project.scene.objects.at(-1)?.style.dash).toBe('dashed');
});

test('a circle snapped back to its center is cancelled without blocking the next drawing', async ({ page }) => {
  await page.goto('/'); await newDrawing(page);
  await page.getByRole('button', { name: '점 (P)', exact: true }).click();
  await page.getByTestId('canvas').click({ position: { x: 200, y: 200 } });
  const point = (await savedProject(page)).scene.objects[0];
  const handle = (await page.getByTestId(`handle-${point.id}-0`).boundingBox())!;
  const center = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  await page.getByRole('button', { name: '원 (C)', exact: true }).click();
  await drag(page, center, { x: center.x + 5, y: center.y });
  await expect(page.locator('[data-testid="layer-row"]')).toHaveCount(1);
  expect((await savedProject(page)).scene.objects.some(o => o.type === 'circle')).toBe(false);
  await drag(page, center, { x: center.x + 100, y: center.y });
  await expect(page.locator('[data-testid="layer-row"]')).toHaveCount(2);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(page.locator('[data-testid="layer-row"]')).toHaveCount(1);
});

test('TikZ apply preserves unsupported code, deletion remains loadable', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'TikZ 소스 코드' }); await expect(editor).toBeVisible();
  await editor.focus(); await page.keyboard.press('Control+a');
  const code = '\\begin{tikzpicture}\n\\draw (0,0) -- (2,1);\n\\begin{scope}[rotate=30]\n\\draw (0,0) circle (1);\n\\end{scope}\n\\end{tikzpicture}';
  await page.keyboard.insertText(code);
  await expect(page.getByRole('button', { name: '도면에 적용', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '도면에 적용', exact: true }).click();
  await expect(page.locator('[data-testid="layer-row"]')).toHaveCount(1);
  expect((await savedProject(page)).scene.source.some(s => s.kind === 'raw' && s.raw.includes('rotate=30'))).toBe(true);
  await page.getByRole('button', { name: '선분 선택', exact: true }).click();
  await page.getByTestId('canvas').focus(); await page.keyboard.press('Delete');
  const project = await savedProject(page);
  await page.locator('input[type=file]').setInputFiles({ name: 'drawing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.getByRole('status')).toContainText('프로젝트를 열었습니다');
});

test('SVG, PNG and standalone TeX downloads contain valid output', async ({ page }) => {
  await page.goto('/');
  for (const [label, suffix] of [['벡터 이미지', 'svg'], ['고해상도 이미지', 'png'], ['LaTeX 문서', 'tex']]) {
    await page.getByRole('button', { name: '내보내기', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: new RegExp(label) }).click();
    const file = await pending, bytes = await readFile((await file.path())!);
    expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${suffix}$`));
    if (suffix === 'svg') { expect(bytes.toString()).toContain('data-mml-node'); expect(bytes.toString()).not.toContain('foreignObject'); }
    if (suffix === 'png') expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    if (suffix === 'tex') { expect(bytes.toString()).toContain('\\documentclass'); await file.saveAs('test-results/exported-example.tex'); }
  }
});

test('focusing coordinates preserves precision and invalid autosave is retained', async ({ page }) => {
  await page.goto('/');
  const project = await savedProject(page);
  const circle = project.scene.objects.find(o => o.type === 'circle')!;
  if (circle.type === 'circle') circle.center.x = 1 / 3;
  await page.locator('input[type=file]').setInputFiles({ name: 'precision.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await page.getByRole('button', { name: '외접원 선택', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'X1', exact: true }).focus();
  await page.getByRole('spinbutton', { name: 'Y1', exact: true }).focus();
  expect((await savedProject(page)).scene.objects.find(o => o.id === circle.id)).toEqual(circle);
  await page.evaluate(() => localStorage.setItem('tikz-studio.project.v1', '{broken JSON'));
  await page.reload();
  await expect(page.getByText('자동 저장 중지 · 파일로 저장하세요', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '도면 이름', exact: true }).fill('수정한 예제');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('tikz-studio.project.v1'))).toBe('{broken JSON');
});

test('mobile layout exposes the properties panel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.getByRole('button', { name: '속성 패널 열기', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '반지름', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/editor-mobile.png' });
  await page.getByRole('button', { name: '속성 패널 닫기', exact: true }).click();
  await expect(page.getByTestId('canvas')).toBeInViewport();
});

test('a held drag ignores document shortcuts and can be undone after release', async ({ page }) => {
  await page.goto('/');
  const before = await savedProject(page), box = (await page.getByTestId('handle-circumcircle-1').boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + 5); await page.mouse.down(); await page.mouse.move(box.x + 50, box.y + 5, { steps: 5 });
  await page.keyboard.press('Control+z'); await page.keyboard.press('Delete');
  await page.mouse.move(box.x + 75, box.y + 5, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('[data-testid="layer-row"]')).toHaveCount(12);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  expect((await savedProject(page)).scene.objects).toEqual(before.scene.objects);
});

test('generated TikZ round trip and referenced point deletion remain reloadable', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'TikZ 소스 코드' }); await expect(editor).toBeVisible();
  await editor.focus(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n% round trip');
  await page.getByRole('button', { name: '도면에 적용', exact: true }).click();
  await expect(page.locator('[data-testid="layer-row"]')).toHaveCount(12);
  const parsed = await savedProject(page), point = parsed.scene.objects.find(o => o.type === 'point')!;
  await page.getByRole('button', { name: `${point.name} 선택`, exact: true }).click();
  await page.getByTestId('canvas').focus(); await page.keyboard.press('Delete');
  const after = await savedProject(page);
  await page.locator('input[type=file]').setInputFiles({ name: 'roundtrip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(after)) });
  await expect(page.getByRole('status')).toContainText('프로젝트를 열었습니다');
  await expect(page.locator('[data-testid="layer-row"]')).toHaveCount(11);
});

test('point creation, undo, redo and project download', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('svg[data-testid="canvas"]');
  await expect(canvas).toBeVisible();
  const before = await page.locator('[data-testid="layer-row"]').count();
  await page.getByRole('button', { name: '점 (P)', exact: true }).click();
  await canvas.click({ position: { x: 130, y: 170 } });
  await expect(page.locator('[data-testid="layer-row"]')).toHaveCount(before + 1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-testid="layer-row"]')).toHaveCount(before);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('[data-testid="layer-row"]')).toHaveCount(before + 1);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '프로젝트 저장' }).click();
  expect((await downloading).suggestedFilename()).toMatch(/\.json$/);
});
