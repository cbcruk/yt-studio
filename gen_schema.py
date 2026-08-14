#!/usr/bin/env python3
"""
yt-dlp 옵션 스키마 추출기.

yt-dlp의 optparse 트리를 그대로 리플렉션해서 JSON으로 떨군다.
help 텍스트를 긁는 게 아니라 옵션 객체를 읽으므로, yt-dlp를 올리면
스키마도 같이 따라온다. CI에서 릴리스마다 재실행할 것.

    python gen_schema.py > ytstudio.schema.json
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
#
# allowed_values 를 쓰는 셋(아래 option_choices 참고)도 같은 성질이다 —
# 값을 모아 집합을 만든다. 그쪽은 손으로 안 적고 리플렉션으로 붙인다.
KIND_OVERRIDE = {
    "--paths": "repeatable",
}


# optparse 가 안 들고 있는 목록. yt-dlp 는 이 둘을 파싱한 **뒤에**
# validate_in 으로 본다(yt_dlp/__init__.py) — 그래서 옵션 객체에는 안 남는다.
#
# 여기 손으로 적는 것은 **어디서 읽을지**뿐이고 값은 yt-dlp 가 준다. 그래서
# 낡거나 지어낼 수가 없고, 상수가 사라지면 이 스크립트가 그 자리에서 죽는다 —
# 조용히 빈 목록이 되는 것보다 낫다.
def _validated_choices():
    from yt_dlp.extractor.adobepass import MSO_INFO
    from yt_dlp.options import _PRESET_ALIASES
    from yt_dlp.postprocessor import FFmpegSubtitlesConvertorPP

    return {
        # "--convert-subs none" 으로 끄는 것이 문서에 있다. 목록에는 없다.
        "--convert-subs": [*FFmpegSubtitlesConvertorPP.SUPPORTED_EXTS, "none"],
        "--ap-mso": sorted(MSO_INFO),
        # 콜백이 쓰는 표가 모듈 전역이라 옵션 객체에는 안 붙어 있다.
        "--preset-alias": list(_PRESET_ALIASES),
    }


# 값이 **어휘 하나가 아니라 어휘 위의 작은 문법**인 것들.
#
#     --recode-video "aac>mp3/mkv"
#      └ 원본>대상 을 / 로 이어 선호 순서를 준다 (FFmpeg*PP.FORMAT_RE)
#
# 그래서 `choices` 로 못 쓴다 — 그렇게 쓰면 `aac>mp3` 가 오류로 잡힌다. 어휘는
# 어휘대로 내고(자동완성이 그걸 쓴다) 문법은 검증기가 본다.
def _format_rules():
    from yt_dlp.postprocessor import (
        FFmpegExtractAudioPP, FFmpegMergerPP, FFmpegThumbnailsConvertorPP,
        FFmpegVideoConvertorPP, FFmpegVideoRemuxerPP,
    )

    return {
        # 'best' 는 SUPPORTED_EXTS 에 없지만 FORMAT_RE 에는 있다 — 기본값이다.
        "--audio-format": (["best", *FFmpegExtractAudioPP.SUPPORTED_EXTS], True),
        "--remux-video": (list(FFmpegVideoRemuxerPP.SUPPORTED_EXTS), True),
        "--recode-video": (list(FFmpegVideoConvertorPP.SUPPORTED_EXTS), True),
        # "--convert-thumbnails none" 으로 끈다.
        "--convert-thumbnails": ([*FFmpegThumbnailsConvertorPP.SUPPORTED_EXTS, "none"], True),
        # 이쪽만 `원본>대상` 없이 `/` 목록이다 — yt_dlp/__init__.py 의 정규식이
        # `(ext)(/(ext))*` 하나뿐이다.
        "--merge-output-format": (list(FFmpegMergerPP.SUPPORTED_EXTS), False),
    }


# 값이 한 덩이가 아니라 **자리 여럿인 구조**일 때, 자리마다의 어휘.
#
#     --cookies-from-browser  BROWSER[+KEYRING][:PROFILE][::CONTAINER]
#                             └ 목록   └ 목록      └ 자유    └ 자유
#
# 문법은 손으로 적는 층(`core/cookies.ts`)이 갖고, 어휘는 여기서 온다.
# 그 둘을 한 파일에 두면 `-o` 종류 표가 그랬듯이 조용히 갈린다.
def _value_vocabs():
    from yt_dlp.cookies import SUPPORTED_BROWSERS, SUPPORTED_KEYRINGS

    return {
        "--cookies-from-browser": {
            "browser": sorted(SUPPORTED_BROWSERS),
            "keyring": sorted(SUPPORTED_KEYRINGS),
        },
    }


def option_choices(opt, validated):
    """이 옵션이 받는 값이 정해져 있나. `(목록, 여러 개인가)` 또는 `None`.

    세 군데서 나오는데 셋 다 yt-dlp 가 준 것이다.

      1. optparse 의 `choices=` — `--fixup` 처럼 optparse 가 직접 거른다
      2. `_set_from_options_callback` 의 `allowed_values` — `--compat-options`
         처럼 **쉼표로 여러 개**를 받는다. `all` 과 별칭(`youtube-dl` 등)도
         값이므로 같이 넣는다. 안 넣으면 멀쩡한 명령어가 오류로 잡힌다.
      3. 파싱 뒤 `validate_in` — 위 표

    `-` 를 앞에 붙여 빼는 형태(`all,-multistreams`)도 되는데, 그건 2번에서만
    되므로 목록에 안 넣는다. "여러 개인가"가 곧 그 표시다.
    """
    if opt.choices:
        return list(opt.choices), False

    kwargs = getattr(opt, "callback_kwargs", None) or {}
    allowed = kwargs.get("allowed_values")
    if allowed is not None:
        names = sorted(x for x in allowed if x is not None)
        return [*names, *sorted(kwargs.get("aliases") or {}), "all"], True

    fixed = validated.get(opt._long_opts[0] if opt._long_opts else None)
    return (list(fixed), False) if fixed else None


def option_rule(long_opt, rules):
    """어휘 위의 작은 문법인 값. `{"vocab": [...], "from": bool}` 또는 `None`."""
    hit = rules.get(long_opt)
    if not hit:
        return None
    vocab, has_from = hit
    return {"vocab": vocab, "from": has_from}


def option_keys(opt):
    """`[TYPES:]PATH` 처럼 값 **앞에** 붙는 종류의 목록.

    `_dict_from_options_callback` 이 `allowed_keys` 로 들고 있다. 값 자체는
    자유 문자열(경로 · 템플릿 · 명령어)이라 `choices` 가 아니지만, 앞머리는
    닫혀 있다 — `-o thumbnail:%(id)s` 의 `thumbnail`.

    정규식으로 적힌 것(`\\w+(?:\\+\\w+)?`)은 목록이 아니므로 안 가져온다.
    갈래로만 적힌 것(`home|temp|…`)이 곧 목록이다.
    """
    keys = (getattr(opt, "callback_kwargs", None) or {}).get("allowed_keys")
    if not keys or not re.fullmatch(r"[\w|]+", keys):
        return None
    return keys.split("|")


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
    """옵션을 UI 컨트롤 종류로 분류.

    action 이름을 열거하면 계속 샌다 — store_const · version · help 처럼
    인자를 안 받는 action 이 여럿이고, yt-dlp 는 그중 여러 개를 쓴다.
    (그래서 --version · --write-thumbnail 이 한동안 값을 받는 옵션으로 잡혔다.)
    optparse 가 이미 답을 갖고 있으니 그걸 묻는다 — takes_value() 는
    type 이 붙어 있는지를 본다.
    """
    if opt.choices:
        return "choice"
    if opt.action == "count":
        return "count"
    if not opt.takes_value():
        return "flag"
    if opt.action == "append":
        return "repeatable"
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
    validated = _validated_choices()
    rules = _format_rules()
    vocabs = _value_vocabs()
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
            found = option_choices(opt, validated)
            choices, many = found if found else (None, False)
            # 목록이 있으면 종류는 그 목록이 정한다 — 여러 개면 repeatable,
            # 하나면 choice. optparse 의 action 만 봐서는 둘 다 그냥 value 다.
            kind = ("repeatable" if many else "choice") if choices else control_kind(opt)
            options.append({
                "id": long_opt.lstrip("-"),
                "flag": long_opt,
                "short": opt._short_opts[0] if opt._short_opts else None,
                "aliases": opt._long_opts[1:],
                "stage": STAGE_OVERRIDE.get(long_opt, stage),
                "group": group.title,
                "dest": opt.dest,
                "kind": KIND_OVERRIDE.get(long_opt, kind),
                "metavar": opt.metavar,
                "choices": choices,
                "keys": option_keys(opt),
                "rule": option_rule(long_opt, rules),
                "vocabs": vocabs.get(long_opt),
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
