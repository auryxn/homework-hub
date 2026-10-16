# Homework Hub — Solution Style Guide (ALL subjects)

**Rule: match the effort to the assignment weight. Do NOT over-engineer.**

These are student homework submissions. They must look like a competent student wrote
them — clear, correct, and *proportionate* — not like a documentation-generator output.

## Hard rules

1. **Scale to the task.** A 10-point conceptual question gets ~1 page of text + at most
   **1–2 small diagrams**. A big multi-part task may get more. Never add code, tests,
   CI, or extra folders unless the task explicitly asks for them.
2. **No code** unless the assignment literally asks to write code (e.g. Java labs).
   Systems-thinking / theory tasks = text + maybe a diagram. Full stop.
3. **Diagrams: keep it to 1–2.** Only when a diagram genuinely clarifies (state machine,
   hierarchy, function graph). Prefer a single mermaid block inline in the README over
   a `diagrams/` folder of many `.mmd` + rendered SVGs.
4. **No rendered SVG asset folders, no mindmaps, no sequence+deployment+value diagrams**
   for simple tasks. A mindmap summarising the whole answer is almost always overkill.
5. **Structure:** one `README.md` per task. Short intro, then the answer to each required
   point, then (optionally) a one-line conclusion. Plain Markdown tables are fine.
6. **Student voice.** Direct, first-person where natural ("I chose…"), no marketing
   padding, no "this document", no exhaustive subsections, no "Deliverables" tables
   listing files that only exist because you made them.
7. **Folder layout:** `sdc-homework-3/<subject>/<task-slug>/README.md`. Add extra files
   only if the task requires them.

## Size targets (guideline)
| Task type | Target |
|---|---|
| Simple conceptual (5–10 pts) | ~1 page, ≤ 2 diagrams, no code |
| Multi-part modelling | 1–2 pages, ≤ 2–3 diagrams |
| Programming lab | code + brief README |

## Anti-patterns (do NOT do these)
- ❌ 9 KB README for a 10-point question
- ❌ `assets/*.svg` + `diagrams/*.mmd` for a conceptual answer
- ❌ Runnable Python models when no code was requested
- ❌ `.gitignore`, `.puppeteer.json`, build scaffolding
- ❌ A "Deliverables in this folder" manpage-style listing
