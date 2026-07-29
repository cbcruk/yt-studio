#!/usr/bin/env python3
"""schema.json을 템플릿에 인라인해서 단일 HTML로 굽는다. CI에서 릴리스마다 재실행."""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).parent
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist" / "ytdlp-studio.html"

schema = json.loads((ROOT / "schema.json").read_text(encoding="utf-8"))
tpl = (ROOT / "app.template.html").read_text(encoding="utf-8")
blob = json.dumps(schema, ensure_ascii=False, separators=(",", ":"))
out = tpl.replace("/*__SCHEMA__*/{}", blob)
assert "__SCHEMA__" not in out, "치환 실패"

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(out, encoding="utf-8")
print(f"{OUT} · 옵션 {len(schema['options'])} · 단계 {len(schema['stages'])} · {len(out) // 1024}KB")
