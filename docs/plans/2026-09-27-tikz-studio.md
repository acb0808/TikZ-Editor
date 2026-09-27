# TikZ Studio Implementation Plan

**Goal:** 한국어 GUI로 수학 도형을 생성·편집하고 JSON, TikZ, SVG, PNG로 저장하는 MVP.

**Architecture:** JSON Scene이 원본이며 렌더러와 변환기는 독립적이다. 부분 parser는 해석할 수 없는 원문을 유지한다. 객체 변경분 transaction으로 실행 취소를 구성한다.

**Tech Stack:** React, TypeScript strict, Vite, Zustand, SVG, Monaco, KaTeX, Vitest, Playwright.

실행은 요청에 따라 같은 작업에서 병렬 모듈 구현과 통합 검증으로 진행한다. 빈 프로젝트이지만 상위 폴더가 다른 작업을 포함한 Git 저장소이므로 상위 저장소를 변경하거나 일괄 커밋하지 않는다.

## Task 1 — Core
파일: `src/core/types.ts`, `coordinates.ts`, `geometry.ts`, `snapping.ts`, `history.ts`, `validation.ts`, 각 `.test.ts`.
좌표 역변환, zoom anchor, 참조 점, snap 순위, 하나의 drag undo, 잘못된 JSON 거부 사례부터 작성. `npm test`로 실패 확인 후 구현, 해당 테스트 재실행.

## Task 2 — Document transforms
파일: `src/tikz/parser.ts`, `generator.ts`, `tikz.test.ts`.
기본 선/원/다각형/텍스트 생성, 색/두께/화살표 왕복, unknown command/option/scope 보존 사례를 먼저 작성. generator와 parser를 별도 순수 함수로 구현. 수정 전 원문과 수정 후 mixed 문서 보존 확인.

## Task 3 — Interactive canvas
파일: `src/canvas/Canvas.tsx`, `SceneShape.tsx`, `src/tools/registry.ts`.
도구 registry, SVG view, screen/world 변환, 포인터 capture, 선택/drag/handle/box 선택, polygon 완료, snap 가이드. zoom과 pan은 문서 이력과 분리. browser test로 기본 생성/drag/undo 검증.

## Task 4 — Editor UI and store
파일: `src/state/editor.ts`, `src/components/{Toolbar,Inspector,Layers,CodePanel}.tsx`, `src/App.tsx`, `src/styles/app.css`.
흰 작업지와 옅은 청회색 chrome, 청록색 선택 강조, 정돈된 한국어 inspector. change transactions를 통해서만 Scene 변경. 로컬 Monaco 번들, 입력 초안 충돌 방지, warning 표시. Ctrl/Cmd 단축키는 입력 영역에서 가로채지 않음.

## Task 5 — Persistence and export
파일: `src/io/project.ts`, `src/io/export.ts`, `README.md`.
version 및 모든 필드 검사 후 JSON import, 자동 저장 복구, 수동 다운로드. 원본 손실 없는 .tex export와 안전한 SVG escape. PNG는 실패를 감지하고 안내한다. 실제 컴파일 없는 기능을 ‘compile’로 표시하지 않음.

## Task 6 — Acceptance
`npm test`, `npm run build`, `npm run test:e2e`를 실행. 실제 브라우저 화면과 사용자 동작 검증. 지원 subset/제약/실행 방법을 README에 기록하고 로컬 앱을 연다.

## 완료 기록 — 2026-09-27

위 단계의 MVP를 구현했다. React 19, TypeScript, Zustand, SVG, Monaco, KaTeX를 사용하고 이미지 내보내기의 수식은 MathJax 벡터 경로로 변환한다. JSON Scene이 모든 편집과 변환의 원본이며 미지원 TikZ 원문은 보존한다.

단위 검사 118개, 브라우저 검사 11개를 통과했다. 브라우저 검사는 `dist/` 배포 파일에서도 수행했으며 드래그와 연결점, undo/redo, 반지름 핸들, 스냅 후 반지름 0인 원의 생성 취소, 정밀 좌표 보존, 코드 왕복, JSON 복구, SVG/PNG/TeX 다운로드, 작은 화면을 포함한다. 엄격한 타입 검사, 연속 배포 빌드, 의존성 보안 검사도 통과했다.

Windows의 기존 출력 폴더 재귀 삭제 중 런타임이 종료되는 문제를 재현하여, 프로젝트 `dist/` 내부만 경로 검사 후 개별 파일로 정리하는 빌드 스크립트를 적용했다. 실제 TeX 컴파일은 현재 환경의 내장 컴파일러 오류로 검증하지 못했다. 지원 문법과 후속 기능은 README에 명시했다.
