#!/usr/bin/env python3
"""
yt-dlp option schema extractor.

Reflects yt-dlp's optparse tree as is and drops it as JSON.
It reads option objects rather than scraping help text, so upgrading yt-dlp
brings the schema along. Rerun in CI on every release.

    python gen_schema.py > yt-studio.schema.json
"""

import json
import optparse
import re
import sys

import yt_dlp
import yt_dlp.options

# optparse groups (16) → run lifecycle stages (9).
# This mapping is the only hand-decided part of this script.
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

# The few exceptions where yt-dlp's own grouping disagrees with the lifecycle.
# (Cookies are a "file" so they sit under Filesystem, but what they do is connecting.)
STAGE_OVERRIDE = {
    "--cookies": "connect",
    "--cookies-from-browser": "connect",
}

# Callbacks that **collect** values across repeated flags instead of replacing them.
# On the optparse side these are just `action='callback'`, so they don't look like
# append — for a while only `--paths` was marked by hand, and `-o` · `--exec` ·
# `--sub-langs` were treated as single values. The builder then dropped the default
# `-o` template when a typed one was added, and the checker warned "only the last
# one is used" about commands that were fine.
#
#     --sub-langs ko --sub-langs en    → ['ko', 'en']
#     -o a.%(ext)s -o thumbnail:%(id)s → {'default': …, 'thumbnail': …}
#
# Only names are listed; how each one collects is read from callback_kwargs.
COLLECTING_CALLBACKS = {
    "_list_from_options_callback",
    "_set_from_options_callback",
    "_dict_from_options_callback",
    "_create_alias",
    "_preset_alias_callback",
}


# Lists optparse doesn't hold. yt-dlp checks these **after** parsing with
# validate_in (yt_dlp/__init__.py) — so they don't remain on the option objects.
#
# The only thing written by hand here is **where to read from**; the values come
# from yt-dlp. So they can't go stale or be made up, and if a constant disappears
# this script dies on the spot — better than silently becoming an empty list.
def _validated_choices():
    from yt_dlp.extractor.adobepass import MSO_INFO
    from yt_dlp.options import _PRESET_ALIASES
    from yt_dlp.postprocessor import FFmpegSubtitlesConvertorPP

    return {
        # Turning it off with "--convert-subs none" is documented. It isn't in the list.
        "--convert-subs": [*FFmpegSubtitlesConvertorPP.SUPPORTED_EXTS, "none"],
        "--ap-mso": sorted(MSO_INFO),
        # The table the callback uses is module-global, so it isn't attached to the option object.
        "--preset-alias": list(_PRESET_ALIASES),
    }


# Values that are **not a single vocabulary but a small grammar over one**.
#
#     --recode-video "aac>mp3/mkv"
#      └ source>target joined by / gives the order of preference (FFmpeg*PP.FORMAT_RE)
#
# So they can't be `choices` — that would flag `aac>mp3` as an error. The
# vocabulary goes out as vocabulary (autocomplete uses it) and the checker handles the grammar.
def _format_rules():
    from yt_dlp.postprocessor import (
        FFmpegExtractAudioPP, FFmpegMergerPP, FFmpegThumbnailsConvertorPP,
        FFmpegVideoConvertorPP, FFmpegVideoRemuxerPP,
    )

    return {
        # 'best' isn't in SUPPORTED_EXTS but is in FORMAT_RE — it's the default.
        "--audio-format": (["best", *FFmpegExtractAudioPP.SUPPORTED_EXTS], True),
        "--remux-video": (list(FFmpegVideoRemuxerPP.SUPPORTED_EXTS), True),
        "--recode-video": (list(FFmpegVideoConvertorPP.SUPPORTED_EXTS), True),
        # Turned off with "--convert-thumbnails none".
        "--convert-thumbnails": ([*FFmpegThumbnailsConvertorPP.SUPPORTED_EXTS, "none"], True),
        # Only this one is a `/` list without `source>target` — the regex in
        # yt_dlp/__init__.py is just `(ext)(/(ext))*`.
        "--merge-output-format": (list(FFmpegMergerPP.SUPPORTED_EXTS), False),
    }


# When a value isn't one lump but **a structure with several slots**, the vocabulary per slot.
#
#     --cookies-from-browser  BROWSER[+KEYRING][:PROFILE][::CONTAINER]
#                             └ list   └ list      └ free    └ free
#
# The grammar lives in the hand-written layer (`core/cookies.ts`); the vocabulary comes from here.
# Keeping both in one file lets them silently diverge, as the `-o` type table did.
def _value_vocabs():
    from yt_dlp.cookies import SUPPORTED_BROWSERS, SUPPORTED_KEYRINGS

    return {
        "--cookies-from-browser": {
            "browser": sorted(SUPPORTED_BROWSERS),
            "keyring": sorted(SUPPORTED_KEYRINGS),
        },
    }


def option_choices(opt, validated):
    """Whether this option's values are fixed. `(list, takes several)` or `None`.

    They come from three places, all provided by yt-dlp.

      1. optparse's `choices=` — optparse filters directly, like `--fixup`
      2. `allowed_values` of `_set_from_options_callback` — takes **several,
         comma-separated**, like `--compat-options`. `all` and aliases
         (`youtube-dl` etc.) are values too, so they go in. Leaving them out
         would flag valid commands as errors.
      3. `validate_in` after parsing — the table above

    The `-`-prefixed exclusion form (`all,-multistreams`) also works, but only
    for case 2, so it isn't put in the list. "Takes several" is that marker.
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
    """A value that is a small grammar over a vocabulary. `{"vocab": [...], "from": bool}` or `None`."""
    hit = rules.get(long_opt)
    if not hit:
        return None
    vocab, has_from = hit
    return {"vocab": vocab, "from": has_from}


def option_keys(opt):
    """The list of types prefixed **before** a value, like `[TYPES:]PATH`.

    `_dict_from_options_callback` holds it as `allowed_keys`. The value itself
    is a free string (path, template, command), so it isn't `choices`, but the
    prefix is closed — the `thumbnail` in `-o thumbnail:%(id)s`.

    Ones written as a regex (`\\w+(?:\\+\\w+)?`) aren't lists, so they're
    skipped. Ones written purely as alternatives (`home|temp|…`) are the list.
    """
    keys = (getattr(opt, "callback_kwargs", None) or {}).get("allowed_keys")
    if not keys or not re.fullmatch(r"[\w|]+", keys):
        return None
    return keys.split("|")


def clean_help(text, default):
    """Substitute optparse's %default and normalize whitespace."""
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
    """Classify an option into a UI control kind.

    Enumerating action names keeps leaking — several actions take no argument,
    like store_const, version, and help, and yt-dlp uses many of them.
    (That's why --version and --write-thumbnail were treated as value-taking
    options for a while.) optparse already has the answer, so ask it —
    takes_value() checks whether a type is attached.
    """
    if opt.choices:
        return "choice"
    if opt.action == "count":
        # No option uses it today. The schema has no kind for it, so die rather
        # than emit something the TypeScript side can't read.
        raise SystemExit(f"{opt._long_opts[0]}: action=count has no kind")
    if not opt.takes_value():
        return "flag"
    if opt.action == "append":
        return "repeatable"
    if opt.action == "callback" and callback_name(opt) in COLLECTING_CALLBACKS:
        if callback_name(opt) == "_list_from_options_callback" \
                and (opt.callback_kwargs or {}).get("append", True) is False:
            return "value"
        return "repeatable"
    return "value"


def callback_name(opt):
    cb = getattr(opt, "callback", None)
    return getattr(cb, "__name__", None)


def option_keyed(opt):
    """How a `KEYS:VALUE` option is split into keys — `_dict_from_options_callback`.

    A repeated flag replaces the earlier value **only for the same keys**
    (`-o a -o thumbnail:b` keeps both), unless `append` collects every value
    (`--exec`). The checker and the builder need the key to tell those apart.

    `pattern` is yt-dlp's own `allowed_keys` regex, kept as is — it is also valid
    as a JavaScript regex for every option today, and a test checks that.
    """
    if callback_name(opt) != "_dict_from_options_callback":
        return None
    kw = opt.callback_kwargs or {}
    if kw.get("delimiter", ":") != ":":
        raise SystemExit(f"{opt._long_opts[0]}: delimiter other than ':' is not handled")
    default = kw.get("default_key")
    return {
        "pattern": kw.get("allowed_keys", r"[\w-]+"),
        "defaults": None if default is None else ([default] if isinstance(default, str) else list(default)),
        "multiple": bool(kw.get("multiple_keys", True)),
        "append": bool(kw.get("append", False)),
    }


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
            # If there's a list, it decides the kind — repeatable if several,
            # choice if one. Looking only at optparse's action, both are just value.
            kind = ("repeatable" if many else "choice") if choices else control_kind(opt)
            options.append({
                "id": long_opt.lstrip("-"),
                "flag": long_opt,
                "short": opt._short_opts[0] if opt._short_opts else None,
                "aliases": opt._long_opts[1:],
                "stage": STAGE_OVERRIDE.get(long_opt, stage),
                "group": group.title,
                "dest": opt.dest,
                "kind": kind,
                "metavar": opt.metavar,
                "choices": choices,
                "keys": option_keys(opt),
                "rule": option_rule(long_opt, rules),
                "vocabs": vocabs.get(long_opt),
                "keyed": option_keyed(opt),
                # What optparse reads the value as. int and float are real numbers —
                # everything used to be `string | number`, and then the types
                # couldn't stop `--socket-timeout 'fast'`.
                "valueType": opt.type,
                "default": jsonable(opt.default),
                "help": clean_help(opt.help, jsonable(opt.default)),
                # for merging negation pairs
                "_base": name,
                "_polarity": polarity,
            })

    # Fold --foo / --no-foo into a single control.
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
            # When both sides are negated forms, like --no-playlist / --yes-playlist
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
