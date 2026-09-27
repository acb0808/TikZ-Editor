# TikZ import and export contract

The scene is the editable document model. `Scene.source` keeps an ordered source tape alongside editable objects: raw islands, whitespace/comments, wrappers, and each object's original statement and signature. The parser does not execute TeX. It independently implements a deliberately limited TikZ subset.

## Editable subset

- `\coordinate (A) at (x,y);` with a unique ASCII identifier and literal Cartesian position.
- `\draw`, `\fill`, and `\filldraw` with two-point lines, arrows, closed polygons using `-- cycle`, two-corner rectangles, and circles using `(radius)` or `[radius=...]`.
- Circular arcs with literal `arc[start angle=...,end angle=...,radius=...]` or `arc(start:end:radius)`, and sectors written as center → arc start → arc → `-- cycle`. Angles are degrees, signed sweeps cover at most one turn. A sector's declared center must agree with its arc.
- Explicit Cartesian numbers, `cm`, `mm`, `pt`, `bp`, and `in` dimensions. Editor coordinates use centimetres. Named references to previously parsed coordinates remain point dependencies.
- Stroke/fill colors from the built-in xcolor names, or `{rgb,255:red,R;green,G;blue,B}`. Export prefers an exactly matching named color; other colors use explicit RGB syntax. Line width is in TeX points; opacity, simple dash styles, thickness presets, and basic arrows are supported.
- Unnamed center-anchored `\node at (...) {text};` labels and `$...$` math labels. Plain labels escape TeX-special characters. Math content remains TeX. Explicit generated font size is supported; a general TeX label/macro is retained as source instead of guessed.

New point exports contain a coordinate declaration, plus an explicit `% tikz-studio point-marker: name` comment and marker path at the point's paint position. Declarations precede all geometry; markers retain scene layer order, so polygon fills do not accidentally cover points. The importer joins a marker with its earlier declaration as one point. The declaration uses explicit `SourceEntry.pointDeclaration` metadata; only the marker owns the editable object source binding. Ordinary circles around a named coordinate remain circles. Imported coordinate-only points remain invisible in TeX until a visible marker style is assigned; the editor may show construction handles.

## Preservation and diagnostics

Unmodified imports reproduce the original text, including document/picture wrappers, whitespace, comments, unknown options, and unsupported commands. GUI edits regenerate only changed supported object statements. Exporting a standalone document preserves an existing document wrapper; snippets receive the standard wrapper.

New drawing commands omit redundant defaults: black stroke, no fill for `\draw`, 0.4 pt line width, full opacity, solid lines, and no arrows. Empty option brackets are omitted. Point markers use `\filldraw`, whose default fill is black, so an unfilled marker explicitly retains `fill=none`. Nondefault values remain explicit. If preserved unsupported source may affect inherited settings, regenerated objects retain explicit defaults rather than assuming the surrounding state.

Scopes and other nested environments are opaque islands. Unsupported path options/operations stay in place. Unknown commands such as `\tikzset`, `\foreach`, `\clip`, or arbitrary macros can affect subsequent semantics, so the rest of that picture is retained as raw source. An unsupported coordinate definition also makes later references opaque. Unknown top-level picture options and detected preamble state changes retain the whole picture body. Added objects stay inside the first picture, but inherited unknown options can still affect them; the import warning explicitly states this.

Missing references, unsupported expressions/styles, duplicate coordinate names, and unsupported geometry generate warnings without inventing geometry. Unbalanced braces, environments, missing semicolons, and structurally incomplete commands generate errors. The UI should reject applying results with error diagnostics while retaining the draft source and last valid scene.

The scanner understands standard TeX comments, escaped characters, delimiter nesting, and environment boundaries. TeX catcode changes, macro expansion, arbitrary package side effects, and all possible semantic validity checks are outside this parser's contract. Actual compilation supplies further diagnostics.

## Ordering and references

- Raw islands are ordering barriers. Objects can reorder only within supported runs; the UI should disable unrestricted layer reordering for mixed unsupported source.
- An untouched imported run retains its exact original order. Coordinate-only definitions retain their source positions; they are not paint layers. Point markers can reorder with the visual objects independently of their declarations.
- New source-free scenes emit point declarations first, then visual objects in scene order. Newly added point definitions are inserted immediately after the picture opening; newly added visual objects are inserted before its closing marker.
- Point layer names are display names. Imported TeX coordinate names remain stable; new points receive a safe name derived from their object ID.
- Missing point references regenerate their stored fallback coordinate. The editor's dependency-aware deletion operation should first detach references using their current resolved positions.
- Multiple pictures are retained, but only the first is editable. Complex scopes and global options do not have an approximate editable projection.

## Formula graphs and constrained points

Graph expressions are parsed by a bounded arithmetic parser, without `eval`, JavaScript functions, property access, or TeX execution. Cartesian graphs use `x`, parametric/polar graphs use `t` (both names alias the current parameter). Expressions support `^`, unary signs, implicit products such as `2x` and `2sin(x)`, `pi`/`π`, `e`, Unicode `²`/`³`, optional `y=`/`f(x)=` prefixes, and one-letter numeric parameters. Undefined parameters are diagnosed. Trigonometric functions use radians; `ln` is natural logarithm and `log`/`log10` is base ten. Other supported functions are `sqrt`, `abs`, `exp`, inverse/hyperbolic trig, `floor`, `ceil`, `round`, `sign`, and the two-argument `min`, `max`, `pow`, `atan2` functions.

Limits are 1,024 expression characters, 512 tokens, bounded nesting, 8,192 sampling evaluations, and at most 4,096 output samples per graph. Compiled expressions and samples use bounded caches. Nonfinite or undefined real values split paths. Adaptive sampling detects ordinary poles such as `1/x` and `tan(x)` and leaves unresolved intervals disconnected; finite sampling cannot prove continuity of every possible expression or resolve arbitrary oscillation frequencies.

The optional `yMin`/`yMax` display window defaults to −10…10 for every graph mode, before applying `offset`. Samples clip at the display boundary with interpolated edge points. `evaluatePlot` still returns mathematical coordinates outside the display window. The parameter range and display window are separate concepts.

TikZ graph export contains sampled straight segments identical to the canvas samples, with separate subpaths across gaps. A `% tikz-studio plot: ...` comment retains the expression, mode, domain, parameters, display window, and offset. Import treats this comment as untrusted data: it checks allowed fields, bounds, and expression syntax, then regenerates samples and verifies that they match the actual TikZ path. Only matching metadata produces an editable formula graph. Edited or malformed metadata/path combinations remain opaque original source with a warning.

Constrained points are resolved from their host at export, including when an imported source declaration has become stale after a host change. TikZ import currently restores these as ordinary coordinates, so binding relationships must be kept in the JSON project. An arc's numeric start point similarly flattens its center dependency on TikZ reimport. Named references on ordinary line/circle/sector geometry remain supported.

## Verification

The TikZ tests cover exact no-edit source preservation, mixed unsupported syntax, nested scopes, mutation preservation, live named references, point marker round trips, dependency-safe declaration ordering, document wrappers, escaped plain labels, mathematical labels containing nested braces/semicolons, all editable geometry types, units, unknown inherited settings, empty input, and malformed syntax.

This module does not claim to compile LaTeX. Compilation must occur in a separately sandboxed engine; disabling shell escape alone is insufficient. See the [Tectonic security documentation](https://tectonic-typesetting.github.io/book/latest/v2cli/compile.html) and the [PGF/TikZ manual](https://pgf-tikz.github.io/pgf/pgfmanual.pdf).

## Korean standalone documents

When the generated content contains Hangul, a newly created standalone wrapper adds `\usepackage{kotex}` and an editor hint `% !TeX program = xelatex`. Save the document as UTF-8 and compile with XeLaTeX (or LuaLaTeX) with ko.TeX, its dependencies, and Korean fonts installed. The hint selects an engine only in editors that support that convention; it does not install or invoke a compiler. The [ko.TeX maintainer's documentation](https://github.com/kihwanglee/kotex-utf) confirms that `kotex` selects the appropriate XeTeX-ko or LuaTeX-ko package. See also [XeTeX-ko on CTAN](https://ctan.org/pkg/xetexko).

ASCII-only generated documents do not acquire the ko.TeX dependency. Existing complete LaTeX documents remain unchanged, including their engine and package choices; their author must provide any Korean typesetting packages needed. Tests validate wrapper generation and source preservation, not successful compilation in an installed Korean TeX environment.
