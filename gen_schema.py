#!/usr/bin/env python3
"""
yt-dlp 옵션 스키마 추출기.

yt-dlp의 optparse 트리를 그대로 리플렉션해서 JSON으로 떨군다.
help 텍스트를 긁는 게 아니라 옵션 객체를 읽으므로, yt-dlp를 올리면
스키마도 같이 따라온다. CI에서 릴리스마다 재실행할 것.

    python gen_schema.py > schema.json
"""

import json
import optparse
import re
import sys

import yt_dlp
import yt_dlp.options

# optparse 그룹(16개) → 실행 생애주기 스테이지(9개).
# 이 매핑만이 이 스크립트에서 유일하게 손으로 정한 부분이다.
STAGES = [
    ("run",      "실행",     "한 번의 실행 전체가 어떻게 동작할지",
     ["General Options"]),
    ("connect",  "접속",     "어떻게 서버에 붙을지",
     ["Network Options", "Geo-restriction", "Workarounds", "Authentication Options"]),
    ("extract",  "추출",     "무엇을 긁어올지",
     ["Extractor Options"]),
    ("select",   "선택",     "컬렉션에서 어떤 항목을 남길지",
     ["Video Selection"]),
    ("format",   "포맷",     "어떤 스트림·자막·썸네일을 고를지",
     ["Video Format Options", "Subtitle Options", "Thumbnail Options"]),
    ("download", "다운로드", "어떻게 받아올지",
     ["Download Options"]),
    ("process",  "후처리",   "받은 뒤 어떻게 가공할지",
     ["Post-Processing Options", "SponsorBlock Options"]),
    ("store",    "저장",     "어디에 어떤 이름으로 둘지",
     ["Filesystem Options", "Internet Shortcut Options"]),
    ("report",   "보고",     "이 과정을 어떻게 보여줄지",
     ["Verbosity and Simulation Options"]),
]

GROUP_TO_STAGE = {g: s[0] for s in STAGES for g in s[3]}

# yt-dlp 자신의 그룹 분류가 생애주기와 어긋나는 소수의 예외.
# (쿠키는 "파일"이라 Filesystem에 들어가 있지만, 하는 일은 접속이다.)
STAGE_OVERRIDE = {
    "--cookies": "connect",
    "--cookies-from-browser": "connect",
}

# yt-dlp 가 TYPES 로 값을 모으는 옵션은 실제로 여러 번 준다.
#     -P home:/a -P temp:/b
# optparse 쪽은 callback 액션에 dict 기본값일 뿐이라 append 로 안 보인다.
# --output·--progress-template 도 같은 성질이지만, 지금 UI 가 값 하나를
# 전제하므로 건드리지 않는다. 그쪽을 열 때 여기 같이 추가할 것.
KIND_OVERRIDE = {
    "--paths": "repeatable",
}


def clean_help(text, default):
    """optparse의 %default 치환과 공백 정규화."""
    if not text:
        return ""
    text = text.replace("%default", str(default))
    text = re.sub(r"\s+", " ", text).strip()
    return text


def jsonable(v):
    if v is optparse.NO_DEFAULT:
        return None
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    if isinstance(v, (list, tuple)):
        return [jsonable(x) for x in v]
    if isinstance(v, dict):
        return {str(k): jsonable(x) for k, x in v.items()}
    return repr(v)


def control_kind(opt):
    """옵션을 UI 컨트롤 종류로 분류."""
    if opt.choices:
        return "choice"
    if opt.action in ("store_true", "store_false"):
        return "flag"
    if opt.action == "count":
        return "count"
    if opt.action == "append":
        return "repeatable"
    if opt.action == "callback" and not opt.nargs:
        return "flag"
    return "value"


def base_name(long_opt):
    """--no-foo / --yes-foo → foo"""
    n = long_opt.lstrip("-")
    for prefix in ("no-", "yes-"):
        if n.startswith(prefix):
            return n[len(prefix):], prefix[:-1]
    return n, None


def main():
    parser = yt_dlp.options.create_parser()
    options = []

    for group in parser.option_groups:
        stage = GROUP_TO_STAGE.get(group.title)
        if stage is None:
            print(f"미매핑 그룹: {group.title}", file=sys.stderr)
            continue

        for opt in group.option_list:
            if opt.help == optparse.SUPPRESS_HELP or not opt._long_opts:
                continue
            long_opt = opt._long_opts[0]
            name, polarity = base_name(long_opt)
            options.append({
                "id": long_opt.lstrip("-"),
                "flag": long_opt,
                "short": opt._short_opts[0] if opt._short_opts else None,
                "aliases": opt._long_opts[1:],
                "stage": STAGE_OVERRIDE.get(long_opt, stage),
                "group": group.title,
                "dest": opt.dest,
                "kind": KIND_OVERRIDE.get(long_opt, control_kind(opt)),
                "metavar": opt.metavar,
                "choices": list(opt.choices) if opt.choices else None,
                "default": jsonable(opt.default),
                "help": clean_help(opt.help, jsonable(opt.default)),
                # 부정 짝 병합용
                "_base": name,
                "_polarity": polarity,
            })

    # --foo / --no-foo 를 하나의 컨트롤로 접는다.
    by_base = {}
    for o in options:
        by_base.setdefault(o["_base"], []).append(o)

    merged = []
    for base, group in by_base.items():
        positive = [o for o in group if o["_polarity"] is None]
        negative = [o for o in group if o["_polarity"] == "no"]
        forced = [o for o in group if o["_polarity"] == "yes"]

        if positive and (negative or forced):
            head = positive[0]
            head["negation"] = (negative or forced)[0]["flag"]
            merged.append(head)
        elif negative and forced:
            # --no-playlist / --yes-playlist 처럼 양쪽 다 부정형인 경우
            head = negative[0]
            head["negation"] = forced[0]["flag"]
            merged.append(head)
        else:
            merged.extend(group)

    for o in merged:
        o.pop("_base", None)
        o.pop("_polarity", None)
        o.setdefault("negation", None)

    merged.sort(key=lambda o: ([s[0] for s in STAGES].index(o["stage"]), o["id"]))

    json.dump({
        "ytdlp_version": yt_dlp.version.__version__,
        "stages": [
            {"id": s[0], "label": s[1], "blurb": s[2], "groups": s[3]}
            for s in STAGES
        ],
        "options": merged,
    }, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
