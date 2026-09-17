# yt-studio

[![Test](https://github.com/cbcruk/yt-studio/actions/workflows/test.yml/badge.svg)](https://github.com/cbcruk/yt-studio/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/yt-studio.svg)](https://www.npmjs.com/package/yt-studio)

**A typed builder and command checker built by reflecting the installed yt-dlp.**

The option list, the value lists, and the shape of values are **not written by
hand.** They are reflected from what yt-dlp itself uses for validation — so what
autocomplete offers is, by definition, what the installed yt-dlp accepts.

```
npm i yt-studio
npx yt-studio lint 'yt-dlp -f bv+ba --write-sub https://youtu.be/abc'
```

**Want to try it before installing → [Playground](https://cbcruk.github.io/yt-studio/)**
Write code in an editor with autocomplete, and the command is built on the spot and
checked. The page runs on exactly the `.d.ts` and schema this package ships.

ESM only, no runtime dependencies, Node 22+.

> Lint messages and CLI output are currently in **Korean**. The examples below show
> them as they are.

Working on the repository **requires [bun](https://bun.com).** The version is pinned
by the `packageManager` field, and CI's `setup-bun` reads the same field.

```
bun install       # the only dependencies are typescript and @types/node
bun run build     # → lib/  (tsc — declarations must be emitted too, so tsc does this)
bun run gen:types # yt-studio.schema.json → src/core/options.gen.ts
bun run cli       # run the CLI without building
bun run test      # types + build + unit + CLI + types command + docs
```

> It's **`bun run test`**, not `bun test`. The latter calls bun's test runner
> directly and only runs the unit suite.

**Users don't need bun.** This constraint lives only inside the repository — the
published package is `#!/usr/bin/env node`, and `engines` is still `node >=22`.

**There is no `.js` in the repository.** Sources, tests, and generators are all
`.ts`: **bun runs things, tsc produces types and artifacts.** bun reads `.ts` as-is
and resolves `./x.js` to `x.ts`, so unit tests and generators skip the build. But
bun doesn't type-check and can't emit `.d.ts`, so tsc handles that side.

For a while bun was a devDependency, which meant CI **installed the whole bun binary
on every run** — `node_modules` was 380MB, 347MB of it bun. It's 34MB now. Users are
unaffected (`dependencies` was always empty).

### `types: ["node"]` is a constraint kept on purpose

Since bun runs everything, switching to `bun-types` looks tempting, but **it has to
go the other way.** `bun-types` layers `Bun.*` on top of the Node types. Then
`Bun.file()` inside the published `src/` type-checks fine and blows up on the user's
Node.

`types: ["node"]` in `tsconfig.json` is the only thing that prevents this — **letting
the compiler enforce that the published package runs on Node.** Moving development
to bun didn't touch it.

There is no linter. eslint had only two rules on (`no-undef` · `no-unused-vars`), and
once everything became `.ts`, tsc and `noUnusedLocals` catch both.

## Why

LLMs write plausible yt-dlp commands. And **they can't tell when they're wrong** —
they use flags that existed at training time, and build `-f` · `-o` values from
memory rather than grammar.

This tool looks at the real thing, not memory. The 191 options are extracted by
`gen_schema.py` reflecting the installed yt-dlp's optparse tree, and `-f` · `-o` ·
`-P` are read by real parsers. So it can answer:

> Can I run this command on the yt-dlp I have right now? What file will it produce?

There are two entry points over the same schema. **Build it in code**, or **check a
string.**

## Building in code

```ts
import { ytdlp } from 'yt-studio';

ytdlp('https://youtu.be/abc')
  .format(f => f.bv({ height: { lte: 1080 } }).plus(f.ba()).or(f.b()))
  .output(t => t`${t.title} [${t.id}].${t.ext}`)
  .paths({ home: '/dl', temp: '/tmp/yt' })
  .writeSubs().subLangs('ko,en').embedSubs()
  .build();

// yt-dlp -f "bv[height<=1080]+ba/b" -o "%(title)s [%(id)s].%(ext)s"
//        -P /dl -P temp:/tmp/yt --write-subs --sub-langs ko,en --embed-subs
//        https://youtu.be/abc
```

The 184 methods **grow from the schema** — there is no hand-written list. The types
come from the same place, so **the options in autocomplete = the options of the
reflected yt-dlp.** Not from a model's memory. So half of the checker's job moves up
to compile time.

```
ytdlp(u).writeSub()      → Property 'writeSub' does not exist. Did you mean 'writeSubs'?
ytdlp(u).fixup('nope')   → 'nope' is not assignable to '"never" | "ignore" | …'
```

The compiler does for free what edit-distance suggestion code used to do.
`.toArray()` gives the argv to pass to `spawn`.

### Types know the **shape** of values too

For a while every option taking a value was `Arg = string | number`. That was wrong
both ways — paths accepted numbers, and seconds accepted any string.

```ts
ytdlp(u).cookies(42)             // ✗ a file path is not a number
ytdlp(u).socketTimeout('fast')   // ✗ optparse reads it as a float
ytdlp(u).maxFilesize('50KB')     // ✗ a unit parse_bytes can't read
ytdlp(u).retries('lots')         // ✗ a number or 'infinite'

ytdlp(u).maxFilesize('44.6M')    // ✓ decimals and units both work
ytdlp(u).audioQuality(0)         // ✓ not narrowed here — a number is natural
```

Here too, nothing is listed by hand. optparse knows **what each option reads its
value as** (`int` · `float` · `string`), and that goes into the schema.
`arg-types.ts` adds only two things on top — metavars that can never be numbers
(paths · URLs · passwords), and two fixed shapes (`Size` · `Retries`).

**One rule when narrowing: never reject a value yt-dlp accepts.** That's why
`--audio-quality` was left alone — both `0` and `128K` are used. Everything narrowed
was checked against yt-dlp's own parsers (`parse_bytes` etc.), and if a hand-written
metavar disappears from the schema, a test catches it.

### Not just names — **values** have lists too

```ts
ytdlp(u).convertSubs('srt')                      // 'srt'|'vtt'|'ass'|'lrc'|'none'
ytdlp(u).apMso('Comcast_SSO')                    // 435 TV providers
ytdlp(u).sponsorblockRemove('sponsor', 'intro')  // several at once
ytdlp(u).compatOptions('all', '-multistreams')   // remove with '-'
```

These aren't invented lists either. yt-dlp filters fixed-value options in **five
places**, and `gen_schema.py` reflects all five.

| Where | How | Examples |
|---|---|---|
| optparse | `choices=` | `--fixup` · `--concat-playlist` |
| callback | `callback_kwargs['allowed_values']` | `--compat-options` · `--sponsorblock-*` |
| callback | `callback_kwargs['allowed_keys']` | the prefix of `-o` · `-P` · `--exec` |
| after parsing | `validate_in(…)` | `--convert-subs` · `--ap-mso` |
| postprocessors | `FFmpeg*PP.SUPPORTED_EXTS` | `--audio-format` · `--remux-video` |
| cookies | `cookies.SUPPORTED_BROWSERS` · `_KEYRINGS` | each slot of `--cookies-from-browser` |

The first three are attached to the option objects as-is, so there's nothing to
write by hand. For the rest, only **where to read from** is written (not the
values), and if a constant disappears the generator dies on the spot — better than
silently becoming an empty list.

### When it's a grammar, not a list

```ts
ytdlp(u).audioFormat('mp3')          // autocomplete: best · mp3 · aac · m4a · …
ytdlp(u).audioFormat('aac>mp3/best') // still not rejected
```

`--audio-format` chains `[source>]target` with `/` to give a preference order
(`FFmpegExtractAudioPP.FORMAT_RE`). Closing it as a union would make **valid values
type errors**, so it's left open on purpose (`| (string & {})`) and only the
vocabulary shows in autocomplete. Closing is the checker's job — it actually reads
the grammar and checks only the target extensions.

### When a value has several slots

```ts
ytdlp(u).cookiesFromBrowser('firefox', { container: 'Personal' })
// → --cookies-from-browser firefox::Personal
```

`--cookies-from-browser` is `BROWSER[+KEYRING][:PROFILE][::CONTAINER]`. Joined as a
string it's easy to mix up `::` and `:` (especially container without a profile), so
each slot gets a name. The grammar lives in `core/cookies.ts` and **the vocabulary
comes from the schema** — keeping both in one file once let the `-o` type table
drift.

```ts
ytdlp(u).matchFilters({ duration: { gt: 120 }, is_live: false })
// → --match-filters "duration>120 & !is_live"

ytdlp(u).downloadSections({ from: 60, to: '2:30' })
// → --download-sections "*60-2:30"
```

`--match-filters` has **the operators of `-f` filters and the fields of `-o`
templates** — yt-dlp defines it that way. So the existing pieces are reused. Field
names are **left open**: info dict keys differ per extractor, so closing them would
turn valid conditions into errors.

`--download-sections` is a time range when given an object and a chapter regex when
given a string. If you forget the `*`, yt-dlp silently reads it as a regex, so the
asterisk isn't left for you to add by hand.

The prefix of `-o thumbnail:%(id)s` is a list too, but here it's a **warning**.
yt-dlp doesn't reject an unknown prefix; it leaves it in the value — `-o
nope:%(title)s.%(ext)s` produces a file starting with `nope:` without any error.

A closed list **must not flag valid commands as errors.** Options like
`--compat-options` take several values separated by commas, have `all` and aliases
(`youtube-dl`), and allow removal with a `-` prefix. The checker knows all four.

> The full builder is in **[docs/builder.md](docs/builder.md)**, along with why this
> fits better than a node graph.

## Checking a string

The builder sees **only what was written with the builder.** Whether picked up from
a blog, pasted by a colleague, or handed over by an LLM, other people's commands
arrive as strings. Checking those against the installed yt-dlp is the one thing only
this tool does.

```
$ yt-studio lint 'yt-dlp -f "bv+ba/" --write-sub -o "%(title)s" https://youtu.be/abc'
✗ --write-sub 는 이 yt-dlp 버전에 없는 플래그다 — --write-subs · --write-srt · --write-link 를 찾은 것 아닐까
    → --write-subs  --write-srt  --write-link
✗ -f 값을 읽지 못했다 — 셀렉터를 찾지 못했다 (7번째 글자 근처)
! -o 에 %(ext)s 가 없다 — 확장자 없는 파일이 만들어진다

만들 파일  ‹제목›
판정      오류 2개 · 옵션 2개를 스키마 191개와 대조
스키마    패키지 내장 (yt-dlp 2026.07.04)
```

The output says: `--write-sub` isn't a flag in this yt-dlp (did you mean
`--write-subs`?), the `-f` value can't be read, and `-o` has no `%(ext)s` so the file
gets no extension. Then the file it would produce, the verdict, and the schema.

The last line is **the basis of the verdict.** Without knowing what it was checked
against, you don't know the verdict either, so it's always printed — see
[Which yt-dlp it checks against](#which-yt-dlp-it-checks-against) below.

**It exits with 1 when there are errors** — it drops straight into scripts and CI.
Pipes work too (`pbpaste | yt-studio lint`). To read what a command means, use
`yt-studio explain`.

In code, call the same thing as a function.

```ts
import { lintCommand, previewFilename } from 'yt-studio';

const r = lintCommand(commandFromSomeoneElse);
if (!r.ok) throw new Error(r.issues.map(i => i.msg).join('\n'));
previewFilename(r.values).text;   // '/dl/‹업로더›/‹제목›.‹확장자›'
```

## What the checker looks at

`src/core/lint.ts` — runs locally, deterministically, without the network.

| What it checks | Based on |
|---|---|
| Is the flag in this yt-dlp version? | the reflected `yt-studio.schema.json` (aliases · short forms · negations included) |
| If it's a typo, what was meant? | three candidates by edit distance + prefix weighting |
| Is there a value where one is required? | `kind` · `metavar` |
| Is it one of the allowed values? | `choices` |
| Does `-f` follow the format selector grammar? | the `core/format-grammar.ts` parser |
| Does `-o` follow the output template grammar · does it get an extension? | the `core/output-template.ts` parser |
| Does `-P` avoid the same type twice? | `core/paths.ts` |
| Is it a conflicting combination? | `-x` with a video-only `-f`, `--embed-subs` without downloading subtitles … |

The last row is why the checker doesn't go away even with the builder. **Types can't
see combinations** — `-x` and `-f bv` are both real options, so the compiler lets
them through. The builder can run the same check with `.lint()`.

## Which yt-dlp it checks against

The package has two layers, and **they can come from different places.** This is the
one trap to know about when using the tool, so it's up front.

| | What it looks at | Can it change? |
|---|---|---|
| **Runtime** — `lintCommand` · `ytdlp()` methods | reads a file | **Yes.** It can see what you installed |
| **Types** — autocomplete · `.d.ts` | baked in when the package was built | **Overlaid with `yt-studio types`** |

The runtime looks in this order.

```
$YT_STUDIO_SCHEMA          → an explicitly given location
./yt-studio.schema.json    → the working directory
bundled with the package   → when there's nothing else (default)
```

The default being last matters. **The bundled schema is the yt-dlp this repository
was built with, not yours.** So if your yt-dlp is newer, new flags are flagged as
nonexistent with **exit 1** — if it's wired into CI, the build breaks.

To match yours, **extract it once.**

```
$ npx yt-studio types
읽음      /usr/local/bin/yt-dlp (yt-dlp 2026.09.01) · --help 파싱
옵션      194개 · 새로 3 · 사라짐 0 (번들 191 대비)
씀        yt-studio.schema.json · yt-studio-env.d.ts
새 옵션   --brand-new  --another  --third
```

(Read from `/usr/local/bin/yt-dlp` by parsing `--help`; 194 options, 3 added,
0 removed compared to the bundled 191; wrote the schema and the declaration file;
lists the new options.)

**Both layers move together.** The checker picks up the new schema immediately, and
new options become real methods.

```ts
ytdlp(u).brandNew('x').build();   // a method that didn't exist yesterday
```

Instead of overwriting the `.d.ts`, it places a **module augmentation** at the
project root, so it survives `npm ci`.

```ts
// yt-studio-env.d.ts — generated by yt-studio types
import 'yt-studio';
declare module 'yt-studio' {
  interface Ytdlp {
    brandNew(value: Arg): this;
  }
}
```

> **Your `tsconfig.json`'s `include` must cover this file.** If it doesn't, the file
> is there but autocomplete doesn't grow — it's silently ignored, so
> `yt-studio types` detects that case and warns.

If you haven't run it, or upgraded yt-dlp again afterward, you can see the mismatch
from code.

```ts
import { ytstudio } from 'yt-studio';

const yt = ytstudio();
yt.source.from;          // 'local' | 'env' | 'bundled'
yt.source.version;       // '2026.09.01'  what this handle checks against
yt.source.typesVersion;  // '2026.07.04'  what's baked into the package
yt.source.stale;         // true — the two have diverged
```

### The schema is a value

`ytstudio()` returns a **handle** bound to one schema. The flat functions
(`lintCommand` · `ytdlp` …) just sit on a lazily built default handle, so building
handles yourself **lets you hold two schemas side by side.**

```ts
const mine = ytstudio();                        // env var → working directory → bundled
const theirs = ytstudio({ cwd: '/other/repo' });
const pinned = ytstudio({ raw: someSchemaJson });

mine.lint(cmd);          theirs.lint(cmd);      // they don't affect each other
mine.ytdlp(url);         theirs.ytdlp(url);     // each has its own method list
```

So **it runs where there's no file system too.** The only part that needs Node is the
single layer of "where to pick the schema up from", so there's a separate entry point
without it.

```ts
import { studio } from 'yt-studio/browser';

const yt = studio(await (await fetch('/yt-studio.schema.json')).json());
yt.ytdlp('https://youtu.be/abc').extractAudio().build();
```

The [Playground](https://cbcruk.github.io/yt-studio/) runs on that — what runs in the
browser is the published module itself.

For a while it was the opposite — `core/schema.ts` held `export let OPTS/BY_ID/…` and
`initSchema` filled them in, so loading a schema twice corrupted the first one. And
`VERSION` stayed the same while only the behavior changed, so **the module lied
about its own state.** Tests had to spawn a fresh process for each case to check the
resolution order, and that was the sign the shape was wrong.

### Why `--help` and not Python

The repository uses `gen_schema.py` to **import yt-dlp as a Python module** and read
the optparse tree. That's more accurate, but it mostly doesn't work in users'
environments — `import yt_dlp` fails for `brew install yt-dlp`, the standalone
binary, and pipx alike.

So on the user side, it asks the binary for its help text. We measured whether
anything is lost.

```
The same yt-dlp (2026.07.04) reflected two ways and compared

  options     191 / 191      field mismatches 0
```

**Known options don't differ by a single character.** What the help text can't give
(`choices` · some aliases · whether it's `repeatable`) is inherited from the bundled
schema. So the loss remains **only for newly added options.** Whether that verdict
actually holds is tested against fixture help text
(`tests/unit/help-schema.test.ts`).

## Layout

```
src/core/            knows neither the DOM nor the file system. All TypeScript
  schema.ts          reflected JSON → indexes. A value — no mutable globals
  build.ts           commands in code — 184 methods grow from the schema
  options.gen.ts     generated: option types · filters · fields (made by gen_options.ts)
  lint.ts            command diagnostics — the heart of this tool
  explain.ts         per-token explanation · filename preview · next steps
  command.ts         command string ↔ item sequence (scanCommand is the only way in)
  format-grammar.ts  -f parser · compiler · selector/filter vocabulary
  output-template.ts -o parser · compiler · field/conversion vocabulary
  paths.ts           reads one -P entry
  cookies.ts         reads one --cookies-from-browser value (vocabulary from the schema)
  help-schema.ts     yt-dlp --help parser — user-side reflection
  env-types.ts       schema → option method declarations. Shared by both generators
src/browser.ts       entry point without the file system — studio(raw) returns a handle
src/index.ts         public API — browser.ts + one layer of where to pick the schema up
src/cli.ts           yt-studio lint · explain · types
demo/                Playground — consumes lib/ and the schema as-is (vite · monaco)
tests/               all bun:test. A single `bun test` runs everything
  unit/*.test.ts     pure logic (132 — schema resolution order lives here too)
  cli.test.ts        the CLI as a process — exit codes · pipes · schema resolution order
  types.test.ts      yt-studio types — compiles the generated .d.ts with real tsc
  docs.test.ts       JSDoc on public declarations · do @example blocks compile (.claude/rules/jsdoc.md)
  drift.test.ts      compared against the real yt-dlp. Skipped without yt-dlp
  fixtures/          one real yt-dlp --help. The schema is the parser's answer key
gen_schema.py        reflects the yt-dlp optparse tree               ← the only non-TS
gen_options.ts       turns that schema into option types
yt-studio.schema.json the reflection result. Shipped with the package
tsconfig.json        for the build (src → lib)
tsconfig.test.json   type-checking only (sources · tests · generators)
.github/workflows/   CI — same as bun run test + whether types match the schema
.claude/skills/      four skills loaded every session (picked from mattpocock/skills)
```

`options.gen.ts` is committed — editors must offer autocomplete right after cloning.
`lib/` is not committed (`prepare` builds it).

## What runs on what

| | With | Why |
|---|---|---|
| Installing dependencies | **bun**, `bun.lock` | 0.04s with a warm cache |
| All tests | **`bun:test`** | one runner. A single `bun test` runs all 12 files |
| Unit tests | **bun**, directly on `src/` | no build. 130ms |
| Generating option types | **bun** | reads the `.ts` vocabulary tables as-is |
| Type-checking | **tsc** | bun doesn't check types. This also stands in for a linter |
| Published `lib/` | **tsc** | bun can't emit `.d.ts` |
| CLI tests | **node**, against `lib/` | what ships is `#!/usr/bin/env node` |
| `types` tests | **node** + **tsc**, in a temp project | compiling is the only way to know the generated `.d.ts` is real |

Tests are unified on `bun:test`, with assertions from `node:assert/strict` — there are
many places comparing parser trees with `deepEqual`, and that reads better. For a
while there were three runners (one `node:test`, two hand-written harnesses), and the
two harnesses each reimplemented `check` · `assert` · pass counting · exit codes.

The last rows matter. While unit tests look at the source, CLI tests launch **the
compiled artifact as a real process** — if only the source is tested, nobody has
checked that what `tsc` emitted actually runs.

### Keeping determinism and reality apart

All the tests above run **inside a committed snapshot** — the committed schema, the
committed help text, and a stub yt-dlp that `cat`s that help. So they can run on
every PR, and when one fails, it's my change that broke it.

In exchange, **changes coming from outside are invisible there.** If yt-dlp changes
its `--help` formatting, the parser silently breaks, and nobody knows until a user
hits it. That's `drift.test.ts`'s job — it installs the real yt-dlp and compares
**the results of the two reflection paths field by field** (help parser ↔
`gen_schema.py`).

```
bun run test:drift     # skips 4 without yt-dlp
```

It only runs in a scheduled job (`.github/workflows/drift.yml`). Running it on every
PR would let a yt-dlp release turn someone else's PR red, which is noise, not an
alert. **It fails only when the machinery is broken**; the committed schema being
older than the latest is only reported as a notice.

## Regenerating the schema

After upgrading yt-dlp, run both together. CI catches **updating the schema without
regenerating the types.**

```
python3 gen_schema.py > yt-studio.schema.json   # installed yt-dlp → schema
bun run gen:types                               # schema → src/core/options.gen.ts
```

## Publishing

```
npm version <patch|minor|major>   # bumps package.json and the v* tag together
git push --follow-tags            # pushing the tag runs the publish job
```

Publishing is done by [`.github/workflows/publish.yml`](.github/workflows/publish.yml).
With `--provenance`, **npm attests which commit and which workflow this tarball came
from.** If the tag and `package.json` disagree, it stops before publishing.

There's no way out without tests — `prepublishOnly` runs `bun run test` again. And on
every PR, `publint` inspects **the tarball.** Getting `files` or `exports` wrong looks
fine inside the repository but breaks on install, and unit tests can't catch that.

### The public surface is listed by hand

The list exported from `src/index.ts` is explicit on purpose. For a while it was
`export * from './core/build.js'`, which dragged internals along — `grow` ·
`methodName` · `selMethod` · `toFilters` · `formatFactory` · `outTag`. **Once
published, those six are API too, and removing them is breaking.** Before the first
publish it was cut from 26 to 16.

`Expr` · `Piece` · `Template` ship **as types only.** `f.bv()` and `t.title` already
create them for you, so users never need `new`.

## The hand-filled layer

There are two things reflection can never provide, and that's where the tool's real
added value is.

1. The **conflicting combination** rules in `core/lint.ts` (`crossChecks`)
2. The **vocabulary and descriptions** in `core/format-grammar.ts` ·
   `core/output-template.ts` — filter fields, output fields, conversion characters.
   The descriptions shown in autocomplete come from here

## Limitations

- **If you haven't run `yt-studio types`, it's based on the yt-dlp version committed
  to this repository.** That's the default, so you have to extract once explicitly.
  `ytstudio().source.stale` and the schema line (`스키마`) of `yt-studio lint` always
  tell you which one it is.
- **Module augmentation can only add.** Options **removed** from your yt-dlp keep
  showing in autocomplete. They're only struck through with `@deprecated` — the
  checker catches them properly.
- **The checker only says "nothing contradicts the schema and grammar."** A command
  can be grammatically right and still not do what you meant, so it also gives the
  filename preview and per-token explanations.
- Builder-side decisions are in [docs/builder.md](docs/builder.md).

These three are things **to fix someday.** What follows is different in kind — not
things to fix, but choices.

## Decided against

**It doesn't actually run anything.** Whether a format really exists for this URL is
only known by running yt-dlp. That isn't something the tool can't do — it's **a choice
not to.**

```
what the checker sells = the same answer yesterday and today
add execution          = network · progress · streaming · process errors
                       = that property is the first thing to break
```

This repository changed its input three times (node graph → prompt → code), and what
survived all three was **the check that runs locally, deterministically, without the
network.** That's also why this tool is different from asking an LLM — a model gives
plausible answers too, but there's no guarantee yesterday and today agree.

If you need execution, take the argv and spawn it yourself. It's one line.

```ts
import { spawn } from 'node:child_process';
spawn('yt-dlp', ytdlp(url).format('bv+ba').toArray(), { stdio: 'inherit' });
```

**It doesn't download or upgrade yt-dlp.** Wrappers that manage the binary already
exist (`ytdlp-nodejs` etc.). Their main job is wrapping `spawn` and types are a
convenience on the side, so the two layers don't overlap.

|  | Execution wrappers | yt-studio |
|---|---|---|
| What it does | downloads · streaming · metadata | **builds and checks** commands |
| Binary | downloads and upgrades it | doesn't touch it |
| Option list | usually hand-written | reflected |
| Validation | none | this is the core |

We measured what happens to hand-written lists. Asking yt-dlp 2026.07.04 about the 251
flags in one wrapper's types, **12 no longer exist** (`--write-all-subs` ·
`--no-part-files` · `--print-command-line` …). A few happen to work thanks to
optparse's prefix abbreviation, but the rest pass the types and get rejected by
yt-dlp. That's the worst result a checker can produce.

**Combination rules aren't grown from imagination either.** `crossChecks` in
`core/lint.ts` has 6 rules today, all from mistakes actually made. A false warning is
the most expensive mistake a checker can make — emit one, and everything after gets
ignored. The 7th rule comes when someone actually gets it wrong.
