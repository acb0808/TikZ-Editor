# TikZ Studio 설계 및 선행 조사

목표: TikZ를 모르는 사용자가 점과 도형을 직접 조작하고, 그 결과를 편집 가능한 프로젝트 및 TikZ로 얻는다. 2026-09-27 공식 문서를 확인했다. 아래 선택은 프로젝트 요구에 대한 설계 판단이며 성능 벤치마크 결과는 아니다.

## 1. 유사 프로젝트와 재사용

|프로젝트 / 공식 출처|라이선스|참고할 기능|재사용 결정|
|---|---|---|---|
|[TikZ Editor](https://github.com/DominikPeters/tikz-editor)|MIT|부분 파서, 양방향 편집, SVG 장면|가장 가까운 참고. 구현 코드는 복사하지 않고 독립 Scene 중심으로 작성|
|[TikZiT](https://github.com/tikzit/tikzit)|GPL-3.0|노드·간선과 스타일|Qt 데스크톱 앱이므로 UX 참고|
|[Excalidraw](https://github.com/excalidraw/excalidraw)|MIT|선택, 조작, 내보내기|React 임베드 가능하지만 수학 객체와 별도 모델 연결이 필요하므로 UX 참고|
|[tldraw](https://tldraw.dev/community/license)|자체 SDK 라이선스|무한 캔버스와 도구 상태|production 라이선스 키 조건이 있어 의존성에서 제외|
|[draw.io](https://github.com/jgraph/drawio)|코드 Apache-2.0, 자산별 별도 조건|레이어·연결선·속성|완성형 앱의 통합 비용 때문에 UX 참고|
|[GeoGebra](https://www.geogebra.org/license)|소스 EUPL-1.2, 완제품·UI 자산 별도 조건|참조 점과 동적 기하|수학 객체 관계 UX 참고, 자산/코드 복사 없음|
|[TikZJax](https://github.com/kisonecat/tikzjax)|LPPL-1.3c|WASM TeX → SVG|추후 정확한 렌더링 후보, 편집 모델/역파서는 제공하지 않음|

## 2. 렌더러와 앱 구성 비교

- SVG 선택: 개별 도형의 DOM 이벤트, 선명한 벡터 확대, 접근성 이름, SVG export를 자연스럽게 처리한다. 수천 개 이상의 객체에서는 측정과 컬링/인덱싱이 필요하다.
- Canvas 직접 사용: 픽셀 재그리기 자유도가 높지만 hit testing, 장면, SVG export를 전부 구현해야 한다.
- [Konva](https://konvajs.org/docs/overview.html) (MIT): scene graph와 hit canvas, 변형 핸들이 유리하다. 별도의 SVG exporter가 필요하고 라이브러리 좌표와 수학 모델의 경계가 추가된다.
- [Fabric](https://www.fabricjs.com/docs/core-concepts/) (MIT): 범용 디자인 도구에 편리하다. 자체 객체 모델에 기하 의미 모델을 얹어야 하며 SVG import/export가 완전 왕복을 보장하지 않는다.
- Pixi/WebGL: 대량 렌더링에 유리하나 이 MVP의 정밀 도형/텍스트/벡터 출력에 필요한 복잡도가 크다.

React + TypeScript strict + Vite + Zustand를 사용한다. 인증, SEO, 서버 렌더링이 없는 로컬 문서 편집이므로 Next.js 서버 계층은 현재 불필요하다. 필요 시 UI와 core를 그대로 Next.js의 client component에 옮길 수 있다. UI는 작은 재사용 컴포넌트와 CSS 토큰, 아이콘은 lucide, 소스 편집은 로컬 번들 Monaco, 수식은 KaTeX를 쓴다.

## 3. 데이터 및 동기화

`Canvas ↔ Scene Model ↔ TikZ parser/generator`. SVG DOM이나 코드 문자열은 편집 상태의 원본이 아니다.

Scene: `version`, `name`, `objects`, `source`, `settings`. 객체는 공통 `id/name/visible/locked/style`와 type별 geometry를 갖는다. 점은 position, 선/화살표/사각형/다각형은 points, 원은 center/radius, 텍스트는 position/text/fontSize다. Anchor는 `{x,y,pointId?}`로 점 객체를 참조한다. 참조 점을 옮기면 연결 객체가 다시 해석된다. 점 삭제 시 참조를 현재 좌표로 해제하여 문서를 유효하게 유지한다. 향후 constraint 계산은 점 위치를 평가하는 독립 모듈로 추가한다.

원본 코드 정보도 JSON 모델에 포함한다. `source`는 object slot과 raw island의 순서 있는 목록이다. 지원되는 명령만 의미 객체로 바꾼다. unknown option/transform/scope/macro가 있는 명령은 추측해서 손상시키지 않고 통째로 보존한다. 원문과 signature가 동일하면 원문을 그대로 출력하고, 수정된 객체만 다시 생성한다. 미지원 코드는 warning과 줄 번호를 보여 주고 JSON/TikZ 내보내기에서 보존한다. 모르는 scope 안의 도형은 잘못된 좌표로 투영하지 않는다.

코드 패널에는 입력 초안과 적용된 Scene을 구분한다. 입력 중 그림 편집과 충돌하지 않도록 명시적 ‘도면에 적용’을 사용한다. 적용은 하나의 history transaction이며 실패 시 기존 Scene은 유지한다. format은 미지원 코드를 버리지 않는다.

MVP subset: 수치 좌표, 이름 있는 coordinate, draw 경로/rectangle/circle/cycle, fill 점, node 텍스트/수식, 단색과 strokeWidth/dash/opacity/arrow 옵션. 임의 TeX, loop, scope transform, macro expansion은 범위 밖이다. 완전한 TeX parser라고 주장하지 않는다.

## 4. 좌표

world/TikZ는 오른쪽 +X, 위 +Y이며 world 1단위 = TikZ 1cm다. 화면 기본 배율은 48 CSS px/world unit. `sx=viewport.x+x*48*zoom`, `sy=viewport.y-y*48*zoom`. 역변환과 포인터 중심 zoom은 `core/coordinates.ts` 한 곳에서 구현한다. event client 좌표는 SVG 경계 기준으로 먼저 정규화한다. snap tolerance와 선택 핸들은 화면 px 기준, 기하 연산은 world 기준이다. 선 굵기는 pt다.

## 5. History

문서 전체를 매 포인터 이동마다 복사하지 않는다. 변경된 객체의 before/after 및 순서/메타데이터 차이로 command를 구성한다. pointerdown 때 transaction 시작, drag는 live preview, pointerup 때 하나만 기록한다. 취소 시 before 상태로 복원한다. undo 후 새 명령은 redo를 폐기한다. 뷰 pan/zoom과 hover/선택은 document history와 분리한다. history 크기 상한을 둔다.

## 6. Snapping 및 도구

확장 가능한 후보 provider: 점, 끝점, 중점, 격자. 현재 배율에 맞는 world tolerance로 후보를 수집하고 우선순위와 거리로 결정한다. 선택된 객체와 그 종속점은 자기 자신에 스냅하지 않도록 제외한다. 결과에는 좌표·종류·참조 ID를 담아 guide 표시와 점 연결 생성에 쓴다. 추후 intersection/perpendicular/tangent provider를 추가할 수 있다.

도구 registry는 이름·단축키·생성 동작을 분리한다. pointer capture로 화면 밖 drag도 마감하며 Escape, pointercancel, window blur에서 임시 작업을 취소한다. 다각형은 여러 점을 클릭하고 첫 점/Enter로 완료한다. 조작 중 툴 전환은 임시 작업을 정리한다.

## 7. 폴더

```
src/
  core/       types, coordinates, geometry, snapping, history, validation
  state/      Zustand editor state, transaction boundary
  tikz/       parser, generator, supported subset
  tools/      tool registry and creation helpers
  canvas/     SVG objects, viewport, selection/handles
  components/ toolbar, inspector, layers, source editor, dialogs
  io/         JSON storage and SVG/PNG/TeX export
  styles/     application design tokens
tests/        browser interaction regression tests
docs/         architecture, implementation plan, limitations
```

## 8. 미리보기와 보안

빠른 SVG canvas가 MVP preview다. 실제 TeX 컴파일과 구분한다. [SwiftLaTeX](https://github.com/SwiftLaTeX/SwiftLaTeX) WASM은 클라이언트 실행이 가능하지만 AGPL-3.0 및 엔진/패키지 크기·폰트·한글 검증이 필요하다. [Tectonic](https://tectonic-typesetting.github.io/) backend는 후보이나 `--untrusted`만으로 파일 접근을 격리했다고 간주할 수 없다. 채택 시 non-root, network none, read-only root, job별 임시 공간, 리소스/시간 제한, shell escape 차단과 source revision 검사까지 필요하다. 임의 LaTeX 실행 endpoint는 이번 MVP에 두지 않는다. standalone .tex를 제공하며 실제 PDF/컴파일은 후속 작업으로 명시한다.

## 9. 구현 순서와 검증

1. Scene schema, pure geometry, 좌표와 참조점 테스트.
2. SVG 뷰포트, pan/zoom, 격자·좌표축.
3. 점/선/원 도구 및 생성 취소.
4. 다중 선택, 이동, 핸들, 나머지 MVP 도형과 snap.
5. 속성 inspector, 텍스트·수식, 이름/스타일.
6. Scene → TikZ 생성 테스트.
7. Monaco source panel.
8. subset parser, 원문 보존 및 round-trip 테스트.
9. 변경분 history, undo/redo, layer 순서·표시·잠금.
10. JSON validation/save/load, TikZ/SVG/PNG export, 브라우저 회귀 검사.

핵심 계산·변환은 먼저 실패하는 테스트를 작성하고 구현한다. 브라우저에서는 생성, 선택, 드래그/핸들, keyboard, zoom, source 적용, undo, JSON 재로드와 export를 검증한다. 수식 SVG/PNG는 렌더링 경로와 출력 제한을 별도 명시한다.
