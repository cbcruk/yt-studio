#!/usr/bin/env python3
"""
index.html · src/**.js · src/app.css · schema.json 을 단일 HTML 로 굽는다.

같은 index.html 이 두 가지로 쓰인다.

    개발  vite → <link href="/src/app.css"> 와 <script type="module" src="/src/app.js">
          를 그대로 쓴다. HMR 이 붙고 schema.json 은 Vite 가 JSON import 로 준다.
    배포  이 스크립트가 그 두 줄을 인라인 <style> 과 <script> 로 갈아 끼운다.
          산출물에는 fetch 도 import 도 남지 않는다.

번들러는 쓰지 않는다. 모듈끼리 순환이 없고 최상위 이름이 겹치지 않으므로,
의존 순서대로 이어 붙이면서 import/export 키워드만 걷어내면 한 스코프에서
그대로 돌아간다. 덕분에 소스는 진짜 ES 모듈로 남아 node 로 단위 테스트가 되고,
산출물은 의존성 0 의 HTML 한 장으로 남는다.

    python build.py [출력경로]
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist" / "ytdlp-studio.html"

# 의존 순서. 위가 아래에 의존하지 않는다.
MODULES = [
    "src/core/schema-data.js",     # 빌드가 스키마 blob 으로 갈아 끼운다
    "src/core/schema.js",
    "src/core/graph.js",
    "src/core/format-grammar.js",
    "src/core/format-graph.js",
    "src/core/output-template.js",
    "src/core/output-graph.js",
    "src/core/paths-graph.js",
    "src/core/pipeline.js",
    "src/core/layout.js",
    "src/core/persist.js",
    "src/ui/node-kinds.js",
    "src/ui/graph-kinds.js",
    "src/app.js",
]

CSS_LINK = '  <link rel="stylesheet" href="/src/app.css">'
JS_TAG = '<script type="module" src="/src/app.js"></script>'

IMPORT_RE = re.compile(r"^\s*import\s[^;]*?;\s*$", re.M)
EXPORT_RE = re.compile(r"^export\s+(?=(?:const|let|var|function|async|class)\b)", re.M)
# `export { a, b }` 같은 재수출은 쓰지 않는다. 남아 있으면 잡아낸다.
BAD_EXPORT_RE = re.compile(r"^export\s*[{*]", re.M)

# 한 스코프로 합치므로 최상위 이름이 겹치면 조용히 덮어쓴다. 미리 막는다.
DECL_RE = re.compile(r"^(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)", re.M)


def strip_module(path: pathlib.Path) -> str:
    src = path.read_text(encoding="utf-8")
    bad = BAD_EXPORT_RE.search(src)
    if bad:
        raise SystemExit(f"{path}: `export {{…}}` / `export *` 는 번들에서 지원하지 않는다")
    src = IMPORT_RE.sub("", src)
    src = EXPORT_RE.sub("", src)
    return src.strip("\n")


def check_module_list() -> None:
    """src/ 아래 .js 가 전부 MODULES 에 있는지.

    개발(vite)은 import 를 따라가므로 목록을 안 봐도 돌지만, 배포는 이 목록이
    전부다. 새 모듈을 만들고 여기 안 적으면 개발만 되고 배포가 깨진다.
    """
    on_disk = {p.relative_to(ROOT).as_posix() for p in (ROOT / "src").rglob("*.js")}
    listed = set(MODULES)
    missing = sorted(on_disk - listed)
    ghost = sorted(listed - on_disk)
    if missing:
        raise SystemExit("MODULES 에 빠진 파일: " + ", ".join(missing))
    if ghost:
        raise SystemExit("MODULES 에 없는 파일이 적혀 있다: " + ", ".join(ghost))


def main() -> None:
    check_module_list()
    schema = json.loads((ROOT / "schema.json").read_text(encoding="utf-8"))
    blob = json.dumps(schema, ensure_ascii=False, separators=(",", ":"))
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "src" / "app.css").read_text(encoding="utf-8")

    seen: dict[str, str] = {}
    chunks = []
    for rel in MODULES:
        path = ROOT / rel
        if rel.endswith("schema-data.js"):
            # 개발용 JSON import 를 통째로 값 하나로 바꾼다.
            body = f"const SCHEMA = {blob};"
        else:
            body = strip_module(path)
        for name in DECL_RE.findall(path.read_text(encoding="utf-8")):
            if name in seen:
                raise SystemExit(f"최상위 이름 충돌: {name} ({seen[name]} ↔ {rel})")
            seen[name] = rel
        chunks.append(f"/* ── {rel} ─────────────────────────── */\n{body}")

    if CSS_LINK not in html or JS_TAG not in html:
        raise SystemExit("index.html 에서 CSS/JS 자리를 찾지 못했다 — 태그가 바뀌었나?")
    out = html.replace(CSS_LINK, "<style>\n" + css.strip() + "\n</style>")
    out = out.replace(JS_TAG, "<script>\n" + "\n\n".join(chunks) + "\n</script>")

    assert "/src/app." not in out, "개발용 경로가 산출물에 남았다"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(out, encoding="utf-8")
    print(
        f"{OUT} · 모듈 {len(MODULES)} · 최상위 이름 {len(seen)} · "
        f"옵션 {len(schema['options'])} · 단계 {len(schema['stages'])} · {len(out) // 1024}KB"
    )


if __name__ == "__main__":
    main()
