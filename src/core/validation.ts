import type { Anchor, ObjectBase, PathBinding, PlotObject, Project, SceneObject, SourceEntry, Style, Vec } from './types';
import { hasDependencyCycle } from './paths';
import { validatePlotExpression } from './plot';

const COORDINATE_LIMIT = 1_000_000;
const MAX_OBJECTS = 10_000;
const MAX_TEXT_SIZE = 5_000_000;

function fail(path: string, message: string): never { throw new Error(`${path}: ${message}`); }
function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '올바른 객체 형식이 아닙니다.');
  return value as Record<string, unknown>;
}
function numeric(value: unknown, path: string, min = -COORDINATE_LIMIT, max = COORDINATE_LIMIT): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(path, `${min}~${max} 범위의 유한한 숫자여야 합니다.`);
  return value;
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, '참 또는 거짓 값이어야 합니다.');
  return value;
}
function enumeration<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) fail(path, '지원하지 않는 값입니다.');
  return value as T;
}
function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(path, '배열 형식이어야 합니다.');
  if (value.length > max) fail(path, `개수가 한도(${max})를 넘었습니다.`);
  return value;
}

function validateDeclarationRaw(raw: string, name: string, position: Vec, path: string): void {
  // Only literal coordinate declarations may carry metadata used to regenerate code.
  const semantic = raw.replace(/%[^\r\n]*/g, '').trim();
  const match = /^\\coordinate\s*(?:\[\s*\])?\s*\(\s*([A-Za-z][A-Za-z0-9_-]*)\s*\)\s*at\s*\(\s*([^,()]+),\s*([^,()]+)\)\s*;$/.exec(semantic);
  if (!match || match[1] !== name) fail(path, '점 선언 원문과 이름이 일치하지 않습니다.');
  const factors: Record<string, number> = { cm: 1, mm: 0.1, pt: 2.54 / 72.27, in: 2.54, bp: 2.54 / 72 };
  const dimension = (value: string): number => {
    const literal = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(cm|mm|pt|in|bp)?$/.exec(value.trim());
    if (!literal) fail(path, '점 선언의 좌표는 지원하는 숫자와 단위여야 합니다.');
    return Number(literal[1]) * factors[literal[2] || 'cm'];
  };
  const x = dimension(match[2]);
  const y = dimension(match[3]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x - position.x) > 1e-8 || Math.abs(y - position.y) > 1e-8) fail(path, '점 선언 원문과 저장된 원래 좌표가 일치하지 않습니다.');
}

/** Rebuild only the documented schema so imported unknown fields cannot reach rendering. */
export function validateProject(value: unknown): Project {
  let textSize = 0;
  let anchorCount = 0;
  const encoder = new TextEncoder();
  function text(value: unknown, path: string, max = 1000, allowEmpty = true): string {
    if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) fail(path, `문자열 형식 또는 길이(최대 ${max}자)가 올바르지 않습니다.`);
    textSize += encoder.encode(value).byteLength;
    if (textSize > MAX_TEXT_SIZE) fail(path, '프로젝트의 전체 텍스트 크기가 5MB 한도를 넘었습니다.');
    return value;
  }
  function anchor(value: unknown, path: string, reference = true): Anchor {
    const input = record(value, path);
    anchorCount++;
    if (anchorCount > 100_000) fail(path, '전체 점의 개수가 한도(100000)를 넘었습니다.');
    const result: Anchor = { x: numeric(input.x, `${path}.x`), y: numeric(input.y, `${path}.y`) };
    if (input.pointId !== undefined) {
      if (!reference) fail(path, '독립 점에는 다른 점의 참조를 지정할 수 없습니다.');
      result.pointId = text(input.pointId, `${path}.pointId`, 256, false);
    }
    return result;
  }
  function paint(value: unknown, path: string): string {
    const color = text(value, path, 40, false);
    if (!/^#[\da-f]{6}$/i.test(color) && color !== 'none') fail(path, '지원하지 않는 색상입니다. #RRGGBB 색상 또는 none을 사용하세요. 투명도는 불투명도 항목으로 지정합니다.');
    return color;
  }
  function style(value: unknown, path: string): Style {
    const input = record(value, path);
    return {
      stroke: paint(input.stroke, `${path}.stroke`), fill: paint(input.fill, `${path}.fill`),
      strokeWidth: numeric(input.strokeWidth, `${path}.선 두께`, 0, 100), opacity: numeric(input.opacity, `${path}.불투명도`, 0, 1),
      dash: enumeration(input.dash, ['solid', 'dashed', 'dotted'], `${path}.dash`),
      arrows: enumeration(input.arrows, ['none', 'start', 'end', 'both'], `${path}.arrows`),
    };
  }
  function object(value: unknown, index: number): SceneObject {
    const path = `객체 ${index + 1}`;
    const input = record(value, path);
    const base: ObjectBase = {
      id: text(input.id, `${path}.id`, 256, false), name: text(input.name, `${path}.이름`, 500),
      visible: boolean(input.visible, `${path}.표시`), locked: boolean(input.locked, `${path}.잠금`), style: style(input.style, `${path}.스타일`),
    };
    const type = enumeration(input.type, ['point', 'line', 'arrow', 'rectangle', 'polygon', 'circle', 'arc', 'sector', 'plot', 'text', 'math'], `${path}.종류`);
    if (type === 'point') {
      const result: SceneObject = { ...base, type, position: anchor(input.position, `${path}.위치`, false) as Vec };
      if (input.binding !== undefined) {
        const binding = record(input.binding, `${path}.경로 연결`);
        const validated: PathBinding = { objectId: text(binding.objectId, `${path}.경로 ID`, 256, false), t: numeric(binding.t, `${path}.경로 위치`, 0, 1) };
        if (binding.segment !== undefined) {
          validated.segment = numeric(binding.segment, `${path}.변 번호`, 0, 10_000);
          if (!Number.isInteger(validated.segment)) fail(path, '변 번호는 정수여야 합니다.');
        }
        result.binding = validated;
      }
      return result;
    }
    if (type === 'circle') return { ...base, type, center: anchor(input.center, `${path}.중심`), radius: numeric(input.radius, `${path}.반지름`, 0, COORDINATE_LIMIT) };
    if (type === 'arc' || type === 'sector') {
      const sweepAngle = numeric(input.sweepAngle, `${path}.호 각도`, -360, 360);
      if (Math.abs(sweepAngle) < 1e-9) fail(path, '호 각도는 0일 수 없습니다.');
      return { ...base, type, center: anchor(input.center, `${path}.중심`), radius: numeric(input.radius, `${path}.반지름`, 0, COORDINATE_LIMIT), startAngle: numeric(input.startAngle, `${path}.시작 각도`), sweepAngle };
    }
    if (type === 'plot') {
      const result: PlotObject = {
        ...base, type, mode: enumeration(input.mode, ['cartesian', 'parametric', 'polar'], `${path}.그래프 형식`),
        expression: text(input.expression, `${path}.수식`, 1024, false), xExpression: text(input.xExpression, `${path}.x 수식`, 1024),
        xMin: numeric(input.xMin, `${path}.구간 시작`), xMax: numeric(input.xMax, `${path}.구간 끝`), parameters: {},
      };
      if (result.xMin >= result.xMax) fail(path, '그래프 구간의 시작은 끝보다 작아야 합니다.');
      if (input.yMin !== undefined) result.yMin = numeric(input.yMin, `${path}.표시 범위 아래`);
      if (input.yMax !== undefined) result.yMax = numeric(input.yMax, `${path}.표시 범위 위`);
      if ((result.yMin ?? -10) >= (result.yMax ?? 10)) fail(path, '그래프 표시 범위의 아래값은 위값보다 작아야 합니다.');
      if (input.offset !== undefined) result.offset = anchor(input.offset, `${path}.평행 이동`, false);
      const parameters = record(input.parameters, `${path}.매개 변수`), entries = Object.entries(parameters);
      if (entries.length > 26) fail(path, '매개 변수의 개수가 한도를 넘었습니다.');
      for (const [name, value] of entries) {
        if (!/^[a-z]$/.test(name) || ['x', 't', 'e'].includes(name)) fail(path, '매개 변수 이름은 x, t, e를 제외한 영문 소문자 한 글자여야 합니다.');
        result.parameters[name] = numeric(value, `${path}.매개 변수 ${name}`);
      }
      const error = validatePlotExpression(result);
      if (error) fail(`${path}.수식`, error);
      return result;
    }
    if (type === 'text' || type === 'math') return {
      ...base, type, position: anchor(input.position, `${path}.위치`), text: text(input.text, `${path}.글자`, 20_000), fontSize: numeric(input.fontSize, `${path}.글자 크기`, 1, 1000),
    };
    const points = array(input.points, `${path}.점`, 10_000).map((value, index) => anchor(value, `${path}.점 ${index + 1}`));
    if (type === 'polygon' ? points.length < 3 : type === 'rectangle' ? points.length !== 2 : points.length < 2) fail(`${path}.점`, type === 'polygon' ? '다각형에는 꼭짓점이 세 개 이상 필요합니다.' : '이 도형에는 점이 두 개 이상 필요합니다.');
    return { ...base, type, points };
  }

  const input = record(value, '프로젝트');
  const version = enumeration(input.version, ['1.0'], '프로젝트 버전');
  const scene = record(input.scene, '도면');
  const sceneVersion = enumeration(scene.version, ['1.0'], '도면 버전');
  const objects = array(scene.objects, '도면 객체', MAX_OBJECTS).map(object);
  const byId = new Map<string, SceneObject>();
  for (const object of objects) {
    if (byId.has(object.id)) fail('도면 객체', `중복된 ID "${object.id}"가 있습니다.`);
    byId.set(object.id, object);
  }
  for (const object of objects) {
    const anchors = 'points' in object ? object.points : 'center' in object ? [object.center] : object.type === 'point' || object.type === 'plot' ? [] : [object.position];
    for (const anchor of anchors) {
      if (anchor.pointId && byId.get(anchor.pointId)?.type !== 'point') fail(`객체 ${object.name}`, `참조 "${anchor.pointId}"는 존재하는 점을 가리켜야 합니다.`);
    }
    if (object.type === 'point' && object.binding) {
      const binding = object.binding, host = byId.get(binding.objectId);
      if (!host || host.type === 'point' || host.type === 'text' || host.type === 'math') fail(`객체 ${object.name}`, '연결 경로는 존재하는 선·도형·그래프여야 합니다.');
      if ('points' in host) {
        const segments = host.type === 'polygon' ? host.points.length : host.type === 'rectangle' ? 4 : host.points.length - 1;
        if ((binding.segment ?? 0) >= segments) fail(`객체 ${object.name}`, '연결 경로의 변 번호가 범위를 벗어났습니다.');
      } else if (binding.segment !== undefined && !(host.type === 'sector' && (binding.segment === 0 || binding.segment === 1))) fail(`객체 ${object.name}`, '이 경로에는 올바른 변 번호를 지정해야 합니다.');
    }
  }
  if (hasDependencyCycle(objects)) fail('도면 객체', '도형과 점의 연결에 순환 참조가 있습니다.');
  const sourceIds = new Set<string>();
  const declarationIds = new Set<string>();
  const declarationNames = new Set<string>();
  const source: SourceEntry[] = array(scene.source, '원본 코드 항목', 30_000).map((value, index) => {
    const path = `원본 코드 ${index + 1}`;
    const input = record(value, path);
    const kind = enumeration(input.kind, ['raw', 'object'], `${path}.종류`);
    if (kind === 'raw') {
      const result: SourceEntry = { kind, raw: text(input.raw, path, MAX_TEXT_SIZE) };
      if (input.reason !== undefined) result.reason = text(input.reason, `${path}.이유`, 10_000);
      if (input.line !== undefined) {
        result.line = numeric(input.line, `${path}.줄`, 1, MAX_TEXT_SIZE);
        if (!Number.isInteger(result.line)) fail(path, '줄 번호는 정수여야 합니다.');
      }
      if (input.pointDeclaration !== undefined) {
        const declaration = record(input.pointDeclaration, `${path}.점 선언`);
        const objectId = text(declaration.objectId, `${path}.점 ID`, 256, false);
        if (byId.get(objectId)?.type !== 'point') fail(path, '점 선언은 존재하는 점 객체를 참조해야 합니다.');
        const name = text(declaration.name, `${path}.점 선언 이름`, 256, false);
        if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) fail(path, '점 선언 이름은 영문자로 시작하고 영문·숫자·밑줄·하이픈만 사용할 수 있습니다.');
        const position = anchor(declaration.position, `${path}.점 선언 위치`, false);
        validateDeclarationRaw(result.raw, name, position, path);
        if (declarationIds.has(objectId) || declarationNames.has(name)) fail(path, '중복된 점 선언 또는 점 선언 이름이 있습니다.');
        declarationIds.add(objectId);
        declarationNames.add(name);
        result.pointDeclaration = { objectId, position, name };
      }
      return result;
    }
    const objectId = text(input.objectId, `${path}.객체 ID`, 256, false);
    if (!byId.has(objectId)) fail(path, `존재하지 않는 객체 "${objectId}"를 참조합니다.`);
    if (sourceIds.has(objectId)) fail(path, `객체 "${objectId}"의 원본 코드가 중복되었습니다.`);
    sourceIds.add(objectId);
    const result: SourceEntry = { kind, objectId };
    if (input.raw !== undefined) result.raw = text(input.raw, path, MAX_TEXT_SIZE);
    if (input.signature !== undefined) result.signature = text(input.signature, `${path}.서명`, MAX_TEXT_SIZE);
    return result;
  });
  const settings = record(scene.settings, '도면 설정');
  const viewport = record(input.viewport, '화면 위치');
  return {
    version,
    scene: {
      version: sceneVersion, name: text(scene.name, '도면 이름', 500), objects, source,
      settings: {
        grid: boolean(settings.grid, '격자 표시'), axes: boolean(settings.axes, '좌표축 표시'), snap: boolean(settings.snap, '맞추기'),
        gridSize: numeric(settings.gridSize, '격자 간격', 0.001, 10_000),
      },
    },
    viewport: { x: numeric(viewport.x, '화면 x'), y: numeric(viewport.y, '화면 y'), zoom: numeric(viewport.zoom, '확대 배율', 0.05, 20) },
  };
}
