# Dynamic Math Implementation Plan

**Goal:** 외부 GeoGebra 없이 수식 그래프, 경로에 연결된 점, 원 분할과 부채꼴 편집을 실제 작업 흐름에 통합한다.

**Architecture:** JSON Scene에 수식과 경로 매개변수를 저장한다. 안전한 수식 평가기, 경로 해석과 투영을 렌더러·기하 연산·출력이 공유한다. 기존 문서는 그대로 읽고 새 객체도 검증한다.

**Tech Stack:** React, TypeScript, Zustand, SVG, Vitest, Playwright. 외부 계산 서비스는 사용하지 않는다.

## 1. 기하 엔진

파일: `src/core/types.ts`, `geometry.ts`, `snapping.ts`, `validation.ts`, 새 테스트.
먼저 경로 점의 투영/호스트 이동/삭제/복제와 순환 참조 거부 테스트를 작성하고 실패 확인 후 구현한다. 원 분할 시 기존 점의 위치를 유지한 채 새 호에 재연결한다. 선·원 교점 스냅을 계산한다.

## 2. 수식과 출력

파일: `src/core/plot.ts`, 수식 테스트, `src/tikz/parser.ts`, `generator.ts`, TikZ 테스트.
일반 함수·매개변수·극좌표, 계수, 연산 우선순위, 허용되지 않는 입력, 점근선 분리 테스트를 먼저 작성한다. JavaScript eval 없이 AST를 평가하고 불연속 구간을 나눈다. 새 도형의 SVG와 TikZ 결과 및 도면 재적용을 검증한다.

## 3. 화면 조작

파일: `src/canvas/Canvas.tsx`, `SceneShape.tsx`, `construction.ts`, `src/tools/registry.ts` 및 테스트.
도형 위 점은 클릭할 때 경로 매개변수를 저장한다. 원 선택→둘레 두 위치 지정→두 호 생성 흐름과 Esc 취소를 구현한다. 호의 중심/각도 핸들과 그래프 선택 영역을 추가한다.

## 4. 사용자 인터페이스

파일: `src/components/GraphDialog.tsx`, `GraphFields.tsx`, `Inspector.tsx`, `Toolbar.tsx`, `Layers.tsx`, `src/App.tsx`, CSS.
그래프 입력창과 예제, a/b/c 슬라이더, 연결 해제, 원 나누기, 호↔부채꼴 전환을 제공한다. 그래프 입력 오류는 현재 도면을 변경하지 않는다. 열린 입력창 뒤의 캔버스와 단축키를 잠근다.

## 5. 통합 확인

파일: `tests/browser/editor.spec.ts`, `README.md`, `docs/tikz-subset.md`.
`npm test`, `npm run build`, `npm run test:e2e`를 수행한다. 브라우저에서 식 입력·슬라이더·연결점 이동·원 분할·부분 삭제·부채꼴·undo/redo·JSON 재열기·이미지 출력까지 확인한다. CAS/3D/통계 등 후속 범위를 명확히 기록한다.

## 완료 기록 — 2026-09-27

1~5단계를 구현했다. 일반 함수·매개변수·극좌표와 a/b/c 슬라이더, 경로에 연결된 점, 선·원 교점 스냅, 원 분할 및 호↔부채꼴 변환을 기존 저장·실행 취소·SVG/PNG/TikZ 출력 흐름에 통합했다. 사용자의 선택에 따라 외부 GeoGebra를 포함하지 않았다.

- `npm test`: 10개 파일, **209개 검사 통과**.
- `npm run test:e2e`: **16개 검사 통과**. 식 입력과 계수 변경, 실제 점 이동, 원 분할·부분 삭제·부채꼴, 되돌리기와 재열기, 극좌표/매개변수 입력, 점근선을 포함한 이미지 내보내기, 정의되지 않는 점과 종속 도형의 숨김·복원을 확인했다.
- `npm run build`, `npx tsc --noEmit`: 통과. 큰 지연 로딩 번들에 대한 빌드 경고는 남아 있다.
- 그래프 속성, 부채꼴 편집, 극좌표 입력창의 브라우저 캡처를 육안 확인했다.

경로 연결점의 원본은 JSON이다. TikZ 재적용 시 연결점은 현재 위치의 자유점으로 변환되며, 코드 패널과 안내 문서에 이를 표시했다. 그래프는 샘플 경로로 출력하고 검증된 메타데이터가 유지된 경우 식을 복구한다. 기존 환경의 TeX 컴파일러 오류 때문에 실제 LaTeX 컴파일 성공은 이번에도 검증 범위에 포함하지 않는다.

이번 단계의 자르기는 원을 두 호로 나누는 작업이다. 일반 도형의 임의 절단, 동적 교점·수직·평행 등 고급 작도, 음함수·부등식, CAS·3D·통계는 아직 구현하지 않았다. GeoGebra 전체 기능과 동등하다고 주장하지 않는다.
