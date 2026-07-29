#!/usr/bin/env python3
"""
src/ 의 ES 모듈과 schema.json 을 템플릿에 인라인해서 단일 HTML 로 굽는다.

번들러는 쓰지 않는다. 모듈끼리 순환이 없고 이름이 겹치지 않으므로,
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
    "src/core/schema.js",
    "src/core/graph.js",
    "src/core/format-grammar.js",
    "src/core/format-graph.js",
    "src/core/pipeline.js",
    "src/core/layout.js",
    "src/core/output-template.js",
    "src/core/output-graph.js",
    "src/core/persist.js",
    "src/ui/node-kinds.js",
    "src/ui/graph-kinds.js",
]

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


def main() -> None:
    schema = json.loads((ROOT / "schema.json").read_text(encoding="utf-8"))
    template = (ROOT / "app.template.html").read_text(encoding="utf-8")

    seen: dict[str, str] = {}
    chunks = []
    for rel in MODULES:
        path = ROOT / rel
        body = strip_module(path)
        for name in DECL_RE.findall(path.read_text(encoding="utf-8")):
            if name in seen:
                raise SystemExit(f"최상위 이름 충돌: {name} ({seen[name]} ↔ {rel})")
            seen[name] = rel
        chunks.append(f"/* ── {rel} ─────────────────────────── */\n{body}")

    bundle = "\n\n".join(chunks)
    blob = json.dumps(schema, ensure_ascii=False, separators=(",", ":"))

    out = template.replace("/*__MODULES__*/", bundle).replace("/*__SCHEMA__*/{}", blob)
    for marker in ("__MODULES__", "__SCHEMA__"):
        assert marker not in out, f"치환 실패: {marker}"

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(out, encoding="utf-8")
    print(
        f"{OUT} · 모듈 {len(MODULES)} · 최상위 이름 {len(seen)} · "
        f"옵션 {len(schema['options'])} · 단계 {len(schema['stages'])} · {len(out) // 1024}KB"
    )


if __name__ == "__main__":
    main()
