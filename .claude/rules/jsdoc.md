# JSDoc Rules

Rules for writing JSDoc on `ytstudio`'s public surface. Apply all of them
whenever you write or change a public declaration.

The **public surface** is every declaration reachable from the two entry points
(`ytstudio` = `src/index.ts`, `ytstudio/browser` = `src/browser.ts`). Something
in `src/core/*` is public if an entry point re-exports it. Users see the
`lib/**/*.d.ts` emitted by `tsc`, not the source, so the check reads that.

## Language

Comments in this repo are **English**, written in the same terse, declarative
voice as the rest of the code. Wrap code names, flags, and values in backticks.

Runtime strings — lint messages, CLI output, error messages — stay **Korean**.
They aren't comments; don't translate them as part of documentation work.

## First paragraph

The first paragraph is what shows up first in editor autocomplete lists and
hovers. Write **one sentence on what the symbol does**. Someone scanning the
list should be able to pick it without opening anything else.

**Why it looks this way** (how it broke before, what was decided against) goes
in the second paragraph onward. That rationale is what this repo writes most in
comments, so don't trim it — just keep it out of the first paragraph.

```ts
/**
 * Checks a command string against the installed yt-dlp's schema and grammar.
 *
 * This is what the builder can't do. The builder only sees …
 */
```

## Types

The signature states the type. The comment states the **meaning** — what the
value represents, its range, and what special values (`null`, empty string)
mean.

Use `@param` and `@returns` only when there's something the signature can't say.

```ts
/**
 * Options that would naturally come next for the current combination.
 *
 * @param limit Maximum count. Defaults to 6.
 */
```

Give union members and interface fields a one-line comment each. For `null` or
optional fields, say **when it's empty**.

```ts
/** `null` for flags that take no value. */
value: string | null;
```

## Examples

Add `@example` to things with several parameters, or whose behavior is hard to
guess without seeing the resulting command. Builder methods are the typical
case — write **the command that gets built as a comment**.

````ts
/**
 * @example Time range
 * ```ts
 * import { ytdlp } from 'ytstudio';
 *
 * ytdlp('https://youtu.be/abc').downloadSections({ from: 60 }).build();
 * // yt-dlp --download-sections "*60-inf" https://youtu.be/abc
 * ```
 */
````

- Write code blocks as **```ts fences**. The check ignores indented code blocks.
- **Include the `import`.** Use the path users use (`'ytstudio'`,
  `'ytstudio/browser'`). Never a relative path.
- Don't write lines that won't compile, like `→`. Put results in a
  `// yt-dlp …` comment.
- Result comments must be **what actually came out when run** (quotes
  included). A guessed one was wrong once.
- One example per case. Keep the title after `@example` short — the editor
  shows it as a plain line.
- Never let `*/` appear inside a comment. The selector `bv*/b` does that.

## Coverage

Put JSDoc on every declaration of the public surface — functions, constants,
classes, interfaces, type aliases — and on every member of interfaces and
classes. Document each overload signature (the editor only shows the comment of
the signature it picked).

Not required:

- `private` members (users can't call them — fine to document, but the check
  doesn't look)
- `constructor` (the public classes `Expr`, `Piece`, `Template`, and `Ytdlp` all
  ship **as types only**. Users never `new` them)
- Call and index signatures (the interface's own comment describes them)

Two places to watch:

- For **parameter properties** (`constructor(readonly p: X)`), a comment on the
  constructor doesn't carry over to the property. Put it on the parameter.
  ```ts
  constructor(
    /** The wrapped field piece. */
    readonly p: FieldPiece,
  ) {}
  ```
- **Declaration merges** (`interface Ytdlp` + `class Ytdlp`) need the comment
  in only one place.

**Don't hand-edit generated files.** The comments in `src/core/options.gen.ts`
come from `gen_options.ts` — vocabulary descriptions come from the tables in
`format-grammar.ts` and `output-template.ts`. Edit those and run
`bun run gen:types`.

## Module comments

Put an `@module` comment at the top of each entry file (`src/index.ts`,
`src/browser.ts`). The first paragraph is one sentence on what the entry point
is, followed by one usage `@example`.

```ts
/**
 * The entry point for places without a file system — browsers and edge runtimes.
 *
 * …
 *
 * @module
 */
```

This comment doesn't survive into the `.d.ts` — the entry file's first statement
is a value import, and `tsc` drops the comment along with it. It's for people
reading the source.

File header comments in `src/core/*` stay as the place to record a module's
design rationale. They don't get `@module`.

## Markdown

Write bodies in Markdown — bold, lists, inline code, links. Use `-` for lists.
(Convert old `·` lists and indented code blocks when you touch them.)

## Symbol links

Point to other symbols in the package with `{@linkcode Name}`. It's clickable in
editor hovers. For members, write `{@linkcode LintResult.ok}`.

```ts
/** Calls {@linkcode explainItem} for each item. */
```

## Not used in this repo

There is no docs site (JSR etc.); the only reader is the editor hover. Don't
use syntax that doesn't show up there.

- `> [!IMPORTANT]` alert blocks
- Relying on the description under an `@example` title being rendered
  separately — put explanations in comments inside the code block or in body
  paragraphs
- Type parameters use `@template` (not `@typeParam`)

## Checks

Update comments **in the same change as the code**. Three commands to verify.

```
bun run build       # rebuilds lib/ — the check reads it
bun run test:docs   # tests/docs.test.ts
bun run test        # everything (includes test:docs)
```

What `tests/docs.test.ts` checks:

- Public declarations and members missing JSDoc (based on `lib/**/*.d.ts`)
- Whether the entry source files have `@module`
- Every `@example` ```ts block in `lib/`, compiled with `tsc` one file each in a
  temporary project with `node_modules/ytstudio` linked to the repo. A missing
  `import` fails.

TypeScript 7 has no JS compiler API, so the check reads the line shape of the
`.d.ts` that `tsc` emits (top level at column 0, members at 4) rather than an
AST. If the check dies with "couldn't find the declaration", that's not a rule
violation — the check's line reading has gone stale.
