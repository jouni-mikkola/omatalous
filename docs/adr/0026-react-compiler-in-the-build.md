# 0026 React Compiler in the web build

## Context

[ADR 0019](0019-ui-stack.md) chose React 19.3 with React Compiler 1.0 and listed it at 0 kB. Using it needs a Babel
step in the Vite build, which is a change to what is built. DEVELOPMENT.md asks for a record for that.

## Decision

- `apps/web/vite.config.ts` runs `@rolldown/plugin-babel` with the `reactCompilerPreset()` of
  `babel-plugin-react-compiler` after the React plugin. Vite 8 builds with Rolldown, and this plugin is the one the
  React team documents for it.
- The packages are devDependencies of `apps/web`: `babel-plugin-react-compiler`, `@rolldown/plugin-babel`,
  `@babel/core` and `@types/babel__core`. Nothing of them reaches the browser except the small runtime the compiler
  imports (`react/compiler-runtime`, part of React).
- A component that the compiler breaks gets `"use no memo"` as its first statement and a comment with the reason. The
  list is in the table below. None has needed it so far.

| Component | Reason |
|---|---|
| none | |

## Also in the build: layer order

The minifier drops the `@layer reset, tokens, base, components, pages, utilities;` line of `base.css`. With lazy pages the
sheet that table components share loads before the main sheet, and a layer's place is fixed by the first sheet that
names it, so `base` began to win over `components` (a primary button lost its colour). `layerOrder()` in
`vite.config.ts` puts the line read from `base.css` at the top of every stylesheet of the build.

## Size

The compiler adds a cache array and checks to each component. Measured on 2026-10-26 on the app's own build (`pnpm build`,
the same source with and without the plugin):

| | Without | With |
|---|---|---|
| Main chunk, minified | 343.7 kB | 359.2 kB |
| Main chunk, gzip -9 | 109.0 kB | 115.5 kB |
| All JavaScript chunks, minified | 1 536 kB | 1 743 kB |

The 0 kB of 0019 is for a test bundle of one component. In the app the main chunk grows 4.5 % and the page chunks
by about 13 %, which loads only with the page. Without route splitting the main chunk before this task was 900.4 kB.

## Review

Review again: 2027-10-25, with ADR 0019, or at React's next major version.

Review earlier when `@rolldown/plugin-babel` has no release for 6 months, when the compiler's output differs between
two builds of the same source, or when a `"use no memo"` is needed in more than five components.
