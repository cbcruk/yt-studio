// 이 파일은 gen_options.ts 가 ytstudio.schema.json 에서 만든다. 손으로 고치지 말 것.
//
//   yt-dlp 2026.07.04 · 옵션 191개
//   bun gen_options.ts

/** 이 타입들이 나온 yt-dlp 버전. */
export type Version = '2026.07.04';

/**
 * 같은 것을 **값으로도** 낸다.
 *
 * 타입만으로는 런타임에 "자동완성이 어느 버전에서 나왔나"에 답할 수가 없다.
 * 예전에는 그 답을 패키지에 실린 스키마 파일을 읽어서 냈는데, 그러면 파일
 * 시스템이 없는 곳(브라우저)에서는 물어볼 수조차 없었다. 생성된 값이라
 * 위의 타입과 어긋날 수가 없다.
 */
export const TYPES_VERSION: Version = '2026.07.04';

/** 값을 받는 옵션에 줄 수 있는 것. */
export type Arg = string | number;

/** `--cookies-from-browser` 가 쿠키를 읽을 수 있는 브라우저. */
export type Browser = 'brave' | 'chrome' | 'chromium' | 'edge' | 'firefox' | 'opera' | 'safari' | 'vivaldi' | 'whale';

/** 리눅스에서 크로미움 계열 쿠키를 푸는 키체인. */
export type Keyring = 'BASICTEXT' | 'GNOMEKEYRING' | 'KWALLET' | 'KWALLET5' | 'KWALLET6';

/** `-f` 가 받는 셀렉터. 빌더에서는 `f.bv()` 처럼 메서드가 된다. */
export type Selector = 'b' | 'b*' | 'w' | 'w*' | 'bv' | 'bv*' | 'wv' | 'wv*' | 'ba' | 'ba*' | 'wa' | 'wa*';

/** 셀렉터 팩토리의 메서드 이름. `*` 는 `Star` 로 옮긴다. */
export type SelMethod = 'b' | 'bStar' | 'w' | 'wStar' | 'bv' | 'bvStar' | 'wv' | 'wvStar' | 'ba' | 'baStar' | 'wa' | 'waStar';

/**
 * 셀렉터 팩토리.
 *
 * 식 타입을 인자로 받는다 — build.ts 의 `Expr` 를 여기서 import 하면 순환이
 * 되고, 매핑 타입(`{ [K in SelMethod]: … }`)으로 쓰면 셀렉터마다 붙은 설명이
 * 사라진다. 그 설명이 에디터에 뜨라고 만든 파일이므로 한 줄씩 편다.
 */
export interface FormatFactory<E> {
  /** `b` — best — 영상·음성이 같이 든 것 중 최고 */
  b(filters?: Filters): E;
  /** `b*` — best* — 종류 안 가리고 최고 */
  bStar(filters?: Filters): E;
  /** `w` — worst — 같이 든 것 중 최저 */
  w(filters?: Filters): E;
  /** `w*` — worst* — 종류 안 가리고 최저 */
  wStar(filters?: Filters): E;
  /** `bv` — bestvideo — 영상만 든 것 중 최고 */
  bv(filters?: Filters): E;
  /** `bv*` — bestvideo* — 영상이 든 것 중 최고 (음성 동봉 허용) */
  bvStar(filters?: Filters): E;
  /** `wv` — worstvideo — 영상만 든 것 중 최저 */
  wv(filters?: Filters): E;
  /** `wv*` — worstvideo* — 영상이 든 것 중 최저 */
  wvStar(filters?: Filters): E;
  /** `ba` — bestaudio — 음성만 든 것 중 최고 */
  ba(filters?: Filters): E;
  /** `ba*` — bestaudio* — 음성이 든 것 중 최고 (영상 동봉 허용) */
  baStar(filters?: Filters): E;
  /** `wa` — worstaudio — 음성만 든 것 중 최저 */
  wa(filters?: Filters): E;
  /** `wa*` — worstaudio* — 음성이 든 것 중 최저 */
  waStar(filters?: Filters): E;
  /** 문법을 벗어나야 할 때. 검사 없이 그대로 나간다. */
  raw(selector: string): E;
}

/** 숫자 필드 비교. `loose` 는 그 값이 없는 포맷도 통과시킨다 (`height<=?1080`). */
export interface NumCond {
  lt?: number; lte?: number; gt?: number; gte?: number; eq?: number; ne?: number;
  loose?: boolean;
}

/** 문자 필드 비교. */
export interface StrCond {
  eq?: string; ne?: string;
  startsWith?: string; endsWith?: string; includes?: string; matches?: string;
  notStartsWith?: string; notEndsWith?: string; notIncludes?: string; notMatches?: string;
  loose?: boolean;
}

/**
 * 포맷 필터.
 *
 * 값을 그냥 주면 `=` 비교이고, `true`/`false` 는 있음/없음이다.
 *
 *     { height: { lte: 1080 }, ext: 'mp4', format_note: false }
 *     → [height<=1080][ext=mp4][!format_note]
 */
export interface Filters {
  /** 세로 해상도 */
  height?: number | NumCond | boolean;
  /** 가로 해상도 */
  width?: number | NumCond | boolean;
  /** 프레임 */
  fps?: number | NumCond | boolean;
  /** 전체 비트레이트 */
  tbr?: number | NumCond | boolean;
  /** 영상 비트레이트 */
  vbr?: number | NumCond | boolean;
  /** 음성 비트레이트 */
  abr?: number | NumCond | boolean;
  /** 샘플레이트 */
  asr?: number | NumCond | boolean;
  /** 음성 채널 수 */
  audio_channels?: number | NumCond | boolean;
  /** 파일 크기 */
  filesize?: number | NumCond | boolean;
  /** 대략 크기 */
  filesize_approx?: number | NumCond | boolean;
  /** 화면비 */
  aspect_ratio?: number | NumCond | boolean;
  /** 확장자 */
  ext?: string | StrCond | boolean;
  /** 영상 코덱 */
  vcodec?: string | StrCond | boolean;
  /** 음성 코덱 */
  acodec?: string | StrCond | boolean;
  /** 컨테이너 */
  container?: string | StrCond | boolean;
  /** 프로토콜 */
  protocol?: string | StrCond | boolean;
  /** 포맷 ID */
  format_id?: string | StrCond | boolean;
  /** 포맷 노트 */
  format_note?: string | StrCond | boolean;
  /** 해상도 */
  resolution?: string | StrCond | boolean;
  /** 언어 */
  language?: string | StrCond | boolean;
  /** 다이내믹 레인지 */
  dynamic_range?: string | StrCond | boolean;
}

/** `-o` 템플릿에 자주 쓰는 필드. 나머지는 `t.field('이름')` 으로. */
export type OutField = 'title' | 'fulltitle' | 'id' | 'ext' | 'upload_date' | 'timestamp' | 'duration' | 'duration_string' | 'view_count' | 'like_count' | 'webpage_url' | 'uploader' | 'uploader_id' | 'channel' | 'channel_id' | 'artist' | 'album' | 'track' | 'playlist' | 'playlist_title' | 'playlist_id' | 'playlist_index' | 'playlist_count' | 'n_entries' | 'autonumber' | 'format' | 'format_id' | 'format_note' | 'resolution' | 'height' | 'width' | 'fps' | 'vcodec' | 'acodec' | 'filesize' | 'chapter' | 'chapter_number' | 'section_title' | 'section_number' | 'section_start' | 'section_end' | 'extractor' | 'extractor_key' | 'epoch';
export type OutType = 'chapter' | 'subtitle' | 'thumbnail' | 'description' | 'annotation' | 'infojson' | 'link' | 'pl_video' | 'pl_thumbnail' | 'pl_description' | 'pl_infojson';
export type Conversion = 's' | 'd' | 'f' | 'B' | 'j' | 'l' | 'q' | 'D' | 'S' | 'U' | 'h';

/**
 * 템플릿 태그에 달리는 필드 접근자.
 *
 * 이름은 yt-dlp 것을 그대로 쓴다. camelCase 로 옮기면 예뻐지지만 yt-dlp
 * 문서에서 찾을 수 없는 이름이 된다.
 */
export interface OutFields<P> {
  /** `%(title)s` — 제목 */
  readonly title: P;
  /** `%(fulltitle)s` — 제목 (원본) */
  readonly fulltitle: P;
  /** `%(id)s` — 영상 ID */
  readonly id: P;
  /** `%(ext)s` — 확장자 */
  readonly ext: P;
  /** `%(upload_date)s` — 업로드 날짜 (YYYYMMDD) */
  readonly upload_date: P;
  /** `%(timestamp)s` — 업로드 시각 (epoch) */
  readonly timestamp: P;
  /** `%(duration)s` — 길이 (초) */
  readonly duration: P;
  /** `%(duration_string)s` — 길이 (HH:MM:SS) */
  readonly duration_string: P;
  /** `%(view_count)s` — 조회수 */
  readonly view_count: P;
  /** `%(like_count)s` — 좋아요 수 */
  readonly like_count: P;
  /** `%(webpage_url)s` — 페이지 URL */
  readonly webpage_url: P;
  /** `%(uploader)s` — 업로더 */
  readonly uploader: P;
  /** `%(uploader_id)s` — 업로더 ID */
  readonly uploader_id: P;
  /** `%(channel)s` — 채널 */
  readonly channel: P;
  /** `%(channel_id)s` — 채널 ID */
  readonly channel_id: P;
  /** `%(artist)s` — 아티스트 */
  readonly artist: P;
  /** `%(album)s` — 앨범 */
  readonly album: P;
  /** `%(track)s` — 트랙 */
  readonly track: P;
  /** `%(playlist)s` — 재생목록 */
  readonly playlist: P;
  /** `%(playlist_title)s` — 재생목록 제목 */
  readonly playlist_title: P;
  /** `%(playlist_id)s` — 재생목록 ID */
  readonly playlist_id: P;
  /** `%(playlist_index)s` — 재생목록 번호 */
  readonly playlist_index: P;
  /** `%(playlist_count)s` — 재생목록 개수 */
  readonly playlist_count: P;
  /** `%(n_entries)s` — 항목 수 */
  readonly n_entries: P;
  /** `%(autonumber)s` — 자동 번호 */
  readonly autonumber: P;
  /** `%(format)s` — 포맷 */
  readonly format: P;
  /** `%(format_id)s` — 포맷 ID */
  readonly format_id: P;
  /** `%(format_note)s` — 포맷 노트 */
  readonly format_note: P;
  /** `%(resolution)s` — 해상도 */
  readonly resolution: P;
  /** `%(height)s` — 세로 */
  readonly height: P;
  /** `%(width)s` — 가로 */
  readonly width: P;
  /** `%(fps)s` — 프레임 */
  readonly fps: P;
  /** `%(vcodec)s` — 영상 코덱 */
  readonly vcodec: P;
  /** `%(acodec)s` — 음성 코덱 */
  readonly acodec: P;
  /** `%(filesize)s` — 파일 크기 */
  readonly filesize: P;
  /** `%(chapter)s` — 챕터 */
  readonly chapter: P;
  /** `%(chapter_number)s` — 챕터 번호 */
  readonly chapter_number: P;
  /** `%(section_title)s` — 구간 제목 */
  readonly section_title: P;
  /** `%(section_number)s` — 구간 번호 */
  readonly section_number: P;
  /** `%(section_start)s` — 구간 시작 */
  readonly section_start: P;
  /** `%(section_end)s` — 구간 끝 */
  readonly section_end: P;
  /** `%(extractor)s` — 추출기 */
  readonly extractor: P;
  /** `%(extractor_key)s` — 추출기 키 */
  readonly extractor_key: P;
  /** `%(epoch)s` — 현재 시각 (epoch) */
  readonly epoch: P;
}

/** `-P` 에 줄 수 있는 경로. `home` 만 접두어 없이 나간다. */
export interface PathMap {
  /** 받은 파일이 최종적으로 놓일 곳. */
  home?: string;
  /** 받는 동안 쓰는 임시 자리. */
  temp?: string;
  chapter?: string;
  subtitle?: string;
  thumbnail?: string;
  description?: string;
  annotation?: string;
  infojson?: string;
  link?: string;
  pl_video?: string;
  pl_thumbnail?: string;
  pl_description?: string;
  pl_infojson?: string;
}

/**
 * 설치된 yt-dlp 의 옵션 전부.
 *
 * `Ytdlp` 클래스와 선언 병합된다 — 런타임 메서드는 build.ts 가 같은
 * ytstudio.schema.json 에서 기르므로 이 인터페이스와 늘 짝이 맞는다.
 */
export interface Options {
  /**
   * `--abort-on-error` (--no-ignore-errors) — Abort downloading of further videos if an error occurs (Alias: --no-ignore-errors)
   *
   * @stage run · General Options
   * @remarks `.abortOnError(false)` → `--no-abort-on-error`
   */
  abortOnError(on?: boolean): this;

  /**
   * `--alias` — Create aliases for an option string. Unless an alias starts with a dash "-", it is prefixed with "--". Arguments are parsed according to the Python string formatting mini-language. E.g. --alias get-audio,-X "-S aext:{0},abr -x --audio-format {0}" creates options "--get-audio" and "-X" that takes an argument (ARG0) and expands to "-S aext:ARG0,abr -x --audio-format ARG0". All defined aliases are listed in the --help output. Alias options can trigger more aliases; so be careful to avoid defining recursive options. As a safety measure, each alias may be triggered a maximum of 100 times. This option can be used multiple times
   *
   * @stage run · General Options
   */
  alias(value: Arg): this;

  /**
   * `--color` — Whether to emit color codes in output, optionally prefixed by the STREAM (stdout or stderr) to apply the setting to. Can be one of "always", "auto" (default), "never", or "no_color" (use non color terminal sequences). Use "auto-tty" or "no_color-tty" to decide based on terminal support only. Can be used multiple times
   *
   * @stage run · General Options
   */
  color(value: Arg): this;

  /**
   * `--compat-options` — Options that can help keep compatibility with youtube-dl or youtube-dlc configurations by reverting some of the changes made in yt-dlp. See "Differences in default behavior" for details
   *
   * @stage run · General Options
   */
  compatOptions(...values: ('abort-on-error' | 'allow-unsafe-exec-expansion' | 'allow-unsafe-ext' | 'embed-metadata' | 'embed-thumbnail-atomicparsley' | 'filename' | 'filename-sanitization' | 'format-sort' | 'format-spec' | 'list-formats' | 'manifest-filesize-approx' | 'mtime-by-default' | 'multistreams' | 'no-attach-info-json' | 'no-certifi' | 'no-clean-infojson' | 'no-direct-merge' | 'no-external-downloader-progress' | 'no-keep-subs' | 'no-live-chat' | 'no-playlist-metafiles' | 'no-youtube-channel-redirect' | 'no-youtube-prefer-utc-upload-date' | 'no-youtube-unavailable-videos' | 'playlist-index' | 'playlist-match-filter' | 'prefer-legacy-http-handler' | 'prefer-vp9-sort' | 'seperate-video-versions' | '2021' | '2022' | '2023' | '2024' | '2025' | 'youtube-dl' | 'youtube-dlc' | 'all' | `-${'abort-on-error' | 'allow-unsafe-exec-expansion' | 'allow-unsafe-ext' | 'embed-metadata' | 'embed-thumbnail-atomicparsley' | 'filename' | 'filename-sanitization' | 'format-sort' | 'format-spec' | 'list-formats' | 'manifest-filesize-approx' | 'mtime-by-default' | 'multistreams' | 'no-attach-info-json' | 'no-certifi' | 'no-clean-infojson' | 'no-direct-merge' | 'no-external-downloader-progress' | 'no-keep-subs' | 'no-live-chat' | 'no-playlist-metafiles' | 'no-youtube-channel-redirect' | 'no-youtube-prefer-utc-upload-date' | 'no-youtube-unavailable-videos' | 'playlist-index' | 'playlist-match-filter' | 'prefer-legacy-http-handler' | 'prefer-vp9-sort' | 'seperate-video-versions' | '2021' | '2022' | '2023' | '2024' | '2025' | 'youtube-dl' | 'youtube-dlc' | 'all'}`)[]): this;

  /**
   * `--config-locations` — Location of the main configuration file; either the path to the config or its containing directory ("-" for stdin). Can be used multiple times and inside other configuration files
   *
   * @stage run · General Options
   * @remarks `.configLocations(false)` → `--no-config-locations`
   */
  configLocations(...values: Arg[]): this;

  /**
   * `--default-search` — Use this prefix for unqualified URLs. E.g. "gvsearch2:python" downloads two videos from google videos for the search term "python". Use the value "auto" to let yt-dlp guess ("auto_warning" to emit a warning when guessing). "error" just throws an error. The default value "fixup_error" repairs broken URLs, but emits an error if this is not possible instead of searching
   *
   * @stage run · General Options
   */
  defaultSearch(value: Arg): this;

  /**
   * `--extractor-descriptions` — Output descriptions of all supported extractors and exit
   *
   * @stage run · General Options
   */
  extractorDescriptions(on?: boolean): this;

  /**
   * `--flat-playlist` — Do not extract a playlist's URL result entries; some entry metadata may be missing and downloading may be bypassed
   *
   * @stage run · General Options
   * @remarks `.flatPlaylist(false)` → `--no-flat-playlist`
   */
  flatPlaylist(on?: boolean): this;

  /**
   * `--help` (-h) — Print this help text and exit
   *
   * @stage run · General Options
   */
  help(on?: boolean): this;

  /**
   * `--ignore-config` (--no-config) — Don't load any more configuration files except those given to --config-locations. For backward compatibility, if this option is found inside the system configuration file, the user configuration is not loaded. (Alias: --no-config)
   *
   * @stage run · General Options
   */
  ignoreConfig(on?: boolean): this;

  /**
   * `--ignore-errors` (-i) — Ignore download and postprocessing errors. The download will be considered successful even if the postprocessing fails
   *
   * @stage run · General Options
   */
  ignoreErrors(on?: boolean): this;

  /**
   * `--js-runtimes` — Additional JavaScript runtime to enable, with an optional location for the runtime (either the path to the binary or its containing directory). This option can be used multiple times to enable multiple runtimes. Supported runtimes are (in order of priority, from highest to lowest): deno, node, quickjs, bun. Only "deno" is enabled by default. The highest priority runtime that is both enabled and available will be used. In order to use a lower priority runtime when "deno" is available, --no-js-runtimes needs to be passed before enabling other runtimes
   *
   * @stage run · General Options
   * @remarks `.jsRuntimes(false)` → `--no-js-runtimes`
   */
  jsRuntimes(value: Arg): this;

  /**
   * `--list-extractors` — List all supported extractors and exit
   *
   * @stage run · General Options
   */
  listExtractors(on?: boolean): this;

  /**
   * `--live-from-start` — Download livestreams from the start. Currently experimental and only supported for YouTube, Twitch, TVer, and mellow-fan
   *
   * @stage run · General Options
   * @remarks `.liveFromStart(false)` → `--no-live-from-start`
   */
  liveFromStart(on?: boolean): this;

  /**
   * `--mark-watched` — Mark videos watched (even with --simulate)
   *
   * @stage run · General Options
   * @remarks `.markWatched(false)` → `--no-mark-watched`
   */
  markWatched(on?: boolean): this;

  /**
   * `--plugin-dirs` — Path to an additional directory to search for plugins. This option can be used multiple times to add multiple directories. Use "default" to search the default plugin directories (default)
   *
   * @stage run · General Options
   * @remarks `.pluginDirs(false)` → `--no-plugin-dirs`
   */
  pluginDirs(value: Arg): this;

  /**
   * `--preset-alias` (-t) — Applies a predefined set of options. e.g. --preset-alias mp3. The following presets are available: mp3, aac, mp4, mkv, sleep. See the "Preset Aliases" section at the end for more info. This option can be used multiple times
   *
   * @stage run · General Options
   */
  presetAlias(value: 'mp3' | 'aac' | 'mp4' | 'mkv' | 'sleep'): this;

  /**
   * `--remote-components` — Remote components to allow yt-dlp to fetch when required. This option is currently not needed if you are using an official executable or have the requisite version of the yt-dlp-ejs package installed. You can use this option multiple times to allow multiple components. Supported values: ejs:npm (external JavaScript components from npm), ejs:github (external JavaScript components from yt-dlp-ejs GitHub). By default, no remote components are allowed
   *
   * @stage run · General Options
   * @remarks `.remoteComponents(false)` → `--no-remote-components`
   */
  remoteComponents(value: Arg): this;

  /**
   * `--update` (-U) — Check if updates are available. You installed yt-dlp with pip or using the wheel from PyPi; Use that to update
   *
   * @stage run · General Options
   * @remarks `.update(false)` → `--no-update`
   */
  update(on?: boolean): this;

  /**
   * `--update-to` — Upgrade/downgrade to a specific version. CHANNEL can be a repository as well. CHANNEL and TAG default to "stable" and "latest" respectively if omitted; See "UPDATE" for details. Supported channels: stable, nightly, master
   *
   * @stage run · General Options
   */
  updateTo(value: Arg): this;

  /**
   * `--use-extractors` (--ies) — Extractor names to use separated by commas. You can also use regexes, "all", "default" and "end" (end URL matching); e.g. --ies "holodex.*,end,youtube". Prefix the name with a "-" to exclude it, e.g. --ies default,-generic. Use --list-extractors for a list of extractor names. (Alias: --ies)
   *
   * @stage run · General Options
   */
  useExtractors(value: Arg): this;

  /**
   * `--version` — Print program version and exit
   *
   * @stage run · General Options
   */
  version(on?: boolean): this;

  /**
   * `--wait-for-video` — Wait for scheduled streams to become available. Pass the minimum number of seconds (or range) to wait between retries
   *
   * @stage run · General Options
   * @remarks `.waitForVideo(false)` → `--no-wait-for-video`
   */
  waitForVideo(value: Arg): this;

  /**
   * `--add-headers` — Specify a custom HTTP header and its value, separated by a colon ":". You can use this option multiple times
   *
   * @stage connect · Workarounds
   */
  addHeaders(value: Arg): this;

  /**
   * `--ap-list-mso` — List all supported multiple-system operators
   *
   * @stage connect · Authentication Options
   */
  apListMso(on?: boolean): this;

  /**
   * `--ap-mso` — Adobe Pass multiple-system operator (TV provider) identifier, use --ap-list-mso for a list of available MSOs
   *
   * @stage connect · Authentication Options
   */
  apMso(value: 'ATT' | 'ATTOTT' | 'AlticeOne' | 'Brighthouse' | 'Cablevision' | 'Charter_Direct' | 'Comcast_SSO' | 'DTV' | 'Fubo' | 'Philo' | 'RCN' | 'Rogers' | 'Spectrum' | 'Suddenlink' | 'TWC' | 'Verizon' | 'acecommunications' | 'acm010' | 'ada020' | 'alb020' | 'algona' | 'all025' | 'all070' | 'allwest' | 'alpine' | 'ani030' | 'annearundel' | 'ara010' | 'arkwest' | 'art030' | 'arvig' | 'astound' | 'bal040' | 'baldwin' | 'bay030' | 'bci010-02' | 'bea020' | 'bee010' | 'bel020' | 'bev010' | 'big020' | 'ble020' | 'bra010' | 'bra020' | 'bra050' | 'btc010' | 'btc040' | 'bte010' | 'bul010' | 'but010' | 'bvt010' | 'cab038' | 'cab060' | 'cab140' | 'cab180' | 'cableamerica' | 'cam010' | 'canbytel' | 'car030' | 'car040' | 'car050' | 'car100' | 'carolinata' | 'cas' | 'casscomm' | 'cat020' | 'cccomm' | 'cccsmc010' | 'cci010' | 'cci020' | 'ced010' | 'cen100' | 'cfunet' | 'cha035' | 'cha050' | 'cha060' | 'che050' | 'cic010' | 'cimtel' | 'cit025' | 'cit040' | 'cit180' | 'cit210' | 'cit220' | 'cit230' | 'cit250' | 'cla010' | 'cla050' | 'clr010' | 'cml010' | 'cns' | 'coa020' | 'coa030' | 'col070' | 'col080' | 'com020' | 'com025' | 'com050' | 'com065' | 'com071' | 'com130-01' | 'com130-02' | 'com140' | 'com150' | 'com160' | 'consolidatedcable' | 'conwaycorp' | 'coo050' | 'coo080' | 'cou060' | 'coy010' | 'cpt010' | 'cra010' | 'crestview' | 'cro030' | 'cross' | 'crt020' | 'csicable' | 'ctc040' | 'cun010' | 'dak030' | 'daltonutilities' | 'dem010-01' | 'dem010-02' | 'dem010-03' | 'dem010-04' | 'dem010-05' | 'dem010-06' | 'dic010' | 'dix030' | 'doy010' | 'dpc010' | 'dtc010' | 'dtc020' | 'dum010' | 'dun010' | 'dur010' | 'eagle' | 'eatel' | 'ell010' | 'emerytelcom' | 'endeavor' | 'epb020' | 'ete010' | 'fal010' | 'fam010' | 'far020' | 'far030' | 'far035' | 'fay010' | 'fbc-tele' | 'fbcomm' | 'fib010' | 'fid010' | 'fli020' | 'foo010' | 'for030' | 'for080' | 'fullchannel' | 'gar040' | 'gbt010' | 'gla010' | 'gle010' | 'goldenwest' | 'gpcom' | 'gra060' | 'gri010' | 'hae010' | 'har005' | 'har020' | 'hbc010' | 'hea040' | 'hig030' | 'hin020' | 'hin020-02' | 'hometel' | 'hoodcanal' | 'hor040' | 'horizoncable' | 'htc010' | 'htc020' | 'htc030' | 'htccomm' | 'hun015' | 'icc010' | 'imon' | 'ind040' | 'ind060-dc' | 'ind060-ssc' | 'int050' | 'int100' | 'irv010' | 'jam030' | 'jea010' | 'k2c010' | 'kal010' | 'kal030' | 'kmt010' | 'kpu010' | 'kuh010' | 'lak130' | 'lan010' | 'lau020' | 'leh010' | 'lit020' | 'lns010' | 'loc010' | 'loc020' | 'lon030' | 'lumos' | 'mad030' | 'madison' | 'man060' | 'mar010' | 'mcc040' | 'mck010' | 'mctv' | 'med040' | 'merrimac' | 'metronet' | 'mhtc' | 'mid030' | 'mid045' | 'mid050' | 'mid055' | 'mid140' | 'mid180-01' | 'mid180-02' | 'midhudson' | 'midrivers' | 'mil080' | 'min030' | 'mlg010' | 'mol010' | 'mon060' | 'mou050' | 'mou110' | 'mpw' | 'mtacomm' | 'mtc010' | 'mtc030' | 'mul050' | 'mur010' | 'musfiber' | 'nctc' | 'nel020' | 'nem010' | 'net010' | 'net010-02' | 'new045' | 'new075' | 'nktelco' | 'nor030' | 'nor075' | 'nor100' | 'nor105' | 'nor115' | 'nor125' | 'nor140' | 'nor200' | 'nor240' | 'nor260' | 'nortex' | 'nts010' | 'nttcash010' | 'nttccde010' | 'nttcche010' | 'nttccst010' | 'nttcdel010' | 'nttcftc010' | 'nttchig010' | 'nttclpc010' | 'nttcmah010' | 'nttcmin010' | 'nttcsli010' | 'nttcsmi010' | 'nttcvtx010' | 'nttcwhi010' | 'nulink' | 'nwc010' | 'onesource' | 'ote010' | 'otter' | 'pan010' | 'pan020' | 'par010' | 'paulbunyan' | 'pem020' | 'phe030' | 'phi010' | 'phonoscope' | 'pie010' | 'pin060' | 'pin070' | 'pio060' | 'pioncomm' | 'pioneer' | 'pla020' | 'pottawatomie' | 'premiercomm' | 'pro035' | 'psc010' | 'pul010' | 'qco010' | 'qua010' | 'rad010' | 'rai030' | 'ral010' | 'rct010' | 'red040' | 'ree010' | 'res020' | 'res040' | 'riv030' | 'rld010' | 'rockportcable' | 'rrc010' | 'rsf010' | 'rtc' | 'rte010' | 'sal040' | 'sal060' | 'san020' | 'san040-01' | 'san040-02' | 'sav010' | 'sco020' | 'sco050' | 'scr010' | 'selco' | 'ser060' | 'she005' | 'she010' | 'she030' | 'she030-02' | 'sjoberg' | 'sky050' | 'slingtv' | 'sou025' | 'sou035' | 'sou065' | 'sou075' | 'spa020' | 'spc010' | 'spe010' | 'spi005' | 'spl010' | 'srt010' | 'sta025' | 'stc010' | 'stc020' | 'sul015' | 'sum010' | 'sun045' | 'swa010' | 'sweetwater' | 'tac020' | 'tcc' | 'tct' | 'tec010' | 'tel050' | 'tel095' | 'tel140' | 'tel160-csp' | 'tel160-del' | 'tel160-fra' | 'thr020' | 'thr030' | 'tom020' | 'tra010' | 'tre010' | 'tri025' | 'tri110' | 'tro010' | 'tsc' | 'tvc015' | 'tvc020' | 'tvc030' | 'tvtinc' | 'twi040' | 'uin010' | 'uis010' | 'uni110' | 'uni120' | 'uss020' | 'val025' | 'val030' | 'val040' | 'ver025' | 'ver070' | 'vik011' | 'vis030' | 'vis070' | 'vol040-01' | 'vol040-02' | 'volcanotel' | 'wab020' | 'wadsworth' | 'waitsfield' | 'wal005' | 'wal010' | 'war020' | 'war040' | 'wat025' | 'wav030' | 'wavebroadband' | 'wbi010' | 'wct010' | 'wcta' | 'web020' | 'weh010-camtel' | 'weh010-east' | 'weh010-hope' | 'weh010-longview' | 'weh010-pine' | 'weh010-resort' | 'weh010-talequah' | 'weh010-vicksburg' | 'weh010-white' | 'wes005' | 'wes110' | 'wes130' | 'westianet' | 'wik010' | 'wil015' | 'wil040' | 'wil070' | 'win010' | 'win090' | 'wir030' | 'woo010' | 'wtc010' | 'wya010' | 'xit010' | 'yel010'): this;

  /**
   * `--ap-password` — Multiple-system operator account password. If this option is left out, yt-dlp will ask interactively
   *
   * @stage connect · Authentication Options
   */
  apPassword(value: Arg): this;

  /**
   * `--ap-username` — Multiple-system operator account login
   *
   * @stage connect · Authentication Options
   */
  apUsername(value: Arg): this;

  /**
   * `--bidi-workaround` — Work around terminals that lack bidirectional text support. Requires bidiv or fribidi executable in PATH
   *
   * @stage connect · Workarounds
   */
  bidiWorkaround(on?: boolean): this;

  /**
   * `--client-certificate` — Path to client certificate file in PEM format. May include the private key
   *
   * @stage connect · Authentication Options
   */
  clientCertificate(value: Arg): this;

  /**
   * `--client-certificate-key` — Path to private key file for client certificate
   *
   * @stage connect · Authentication Options
   */
  clientCertificateKey(value: Arg): this;

  /**
   * `--client-certificate-password` — Password for client certificate private key, if encrypted. If not provided, and the key is encrypted, yt-dlp will ask interactively
   *
   * @stage connect · Authentication Options
   */
  clientCertificatePassword(value: Arg): this;

  /**
   * `--cookies` — Netscape formatted file to read cookies from and dump cookie jar in
   *
   * @stage connect · Filesystem Options
   * @remarks `.cookies(false)` → `--no-cookies`
   */
  cookies(value: Arg): this;

  /**
   * `--enable-file-urls` — Enable file:// URLs. This is disabled by default for security reasons.
   *
   * @stage connect · Network Options
   */
  enableFileUrls(on?: boolean): this;

  /**
   * `--encoding` — Force the specified encoding (experimental)
   *
   * @stage connect · Workarounds
   */
  encoding(value: Arg): this;

  /**
   * `--force-ipv4` (-4) — Make all connections via IPv4
   *
   * @stage connect · Network Options
   */
  forceIpv4(on?: boolean): this;

  /**
   * `--force-ipv6` (-6) — Make all connections via IPv6
   *
   * @stage connect · Network Options
   */
  forceIpv6(on?: boolean): this;

  /**
   * `--geo-verification-proxy` — Use this proxy to verify the IP address for some geo-restricted sites. The default proxy specified by --proxy (or none, if the option is not present) is used for the actual downloading
   *
   * @stage connect · Geo-restriction
   */
  geoVerificationProxy(value: Arg): this;

  /**
   * `--impersonate` — Client to impersonate for requests. E.g. chrome, chrome-110, chrome:windows-10. Pass --impersonate="" to impersonate any client. Note that forcing impersonation for all requests may have a detrimental impact on download speed and stability
   *
   * @stage connect · Network Options
   */
  impersonate(value: Arg): this;

  /**
   * `--legacy-server-connect` — Explicitly allow HTTPS connection to servers that do not support RFC 5746 secure renegotiation
   *
   * @stage connect · Workarounds
   */
  legacyServerConnect(on?: boolean): this;

  /**
   * `--list-impersonate-targets` — List available clients to impersonate.
   *
   * @stage connect · Network Options
   */
  listImpersonateTargets(on?: boolean): this;

  /**
   * `--max-sleep-interval` — Maximum number of seconds to sleep. Can only be used along with --min-sleep-interval
   *
   * @stage connect · Workarounds
   */
  maxSleepInterval(value: Arg): this;

  /**
   * `--netrc` (-n) — Use .netrc authentication data
   *
   * @stage connect · Authentication Options
   */
  netrc(on?: boolean): this;

  /**
   * `--netrc-cmd` — Command to execute to get the credentials for an extractor.
   *
   * @stage connect · Authentication Options
   */
  netrcCmd(value: Arg): this;

  /**
   * `--netrc-location` — Location of .netrc authentication data; either the path or its containing directory. Defaults to ~/.netrc
   *
   * @stage connect · Authentication Options
   */
  netrcLocation(value: Arg): this;

  /**
   * `--no-check-certificates` — Suppress HTTPS certificate validation
   *
   * @stage connect · Workarounds
   */
  noCheckCertificates(on?: boolean): this;

  /**
   * `--password` (-p) — Account password. If this option is left out, yt-dlp will ask interactively
   *
   * @stage connect · Authentication Options
   */
  password(value: Arg): this;

  /**
   * `--prefer-insecure` (--prefer-unsecure) — Use an unencrypted connection to retrieve information about the video
   *
   * @stage connect · Workarounds
   */
  preferInsecure(on?: boolean): this;

  /**
   * `--proxy` — Use the specified HTTP/HTTPS/SOCKS proxy. To enable SOCKS proxy, specify a proper scheme, e.g. socks5://user:pass@127.0.0.1:1080/. Pass in an empty string (--proxy "") for direct connection
   *
   * @stage connect · Network Options
   */
  proxy(value: Arg): this;

  /**
   * `--sleep-interval` (--min-sleep-interval) — Number of seconds to sleep before each download. This is the minimum time to sleep when used along with --max-sleep-interval (Alias: --min-sleep-interval)
   *
   * @stage connect · Workarounds
   */
  sleepInterval(value: Arg): this;

  /**
   * `--sleep-requests` — Number of seconds to sleep between requests during data extraction
   *
   * @stage connect · Workarounds
   */
  sleepRequests(value: Arg): this;

  /**
   * `--sleep-subtitles` — Number of seconds to sleep before each subtitle download
   *
   * @stage connect · Workarounds
   */
  sleepSubtitles(value: Arg): this;

  /**
   * `--socket-timeout` — Time to wait before giving up, in seconds
   *
   * @stage connect · Network Options
   */
  socketTimeout(value: Arg): this;

  /**
   * `--source-address` — Client-side IP address to bind to
   *
   * @stage connect · Network Options
   */
  sourceAddress(value: Arg): this;

  /**
   * `--twofactor` (-2) — Two-factor authentication code
   *
   * @stage connect · Authentication Options
   */
  twofactor(value: Arg): this;

  /**
   * `--username` (-u) — Login with this account ID
   *
   * @stage connect · Authentication Options
   */
  username(value: Arg): this;

  /**
   * `--video-password` — Video-specific password
   *
   * @stage connect · Authentication Options
   */
  videoPassword(value: Arg): this;

  /**
   * `--xff` — How to fake X-Forwarded-For HTTP header to try bypassing geographic restriction. One of "default" (only when known to be useful), "never", an IP block in CIDR notation, or a two-letter ISO 3166-2 country code
   *
   * @stage connect · Geo-restriction
   */
  xff(value: Arg): this;

  /**
   * `--allow-dynamic-mpd` (--no-ignore-dynamic-mpd) — Process dynamic DASH manifests (default) (Alias: --no-ignore-dynamic-mpd)
   *
   * @stage extract · Extractor Options
   */
  allowDynamicMpd(on?: boolean): this;

  /**
   * `--extractor-args` — Pass ARGS arguments to the IE_KEY extractor. See "EXTRACTOR ARGUMENTS" for details. You can use this option multiple times to give arguments for different extractors
   *
   * @stage extract · Extractor Options
   */
  extractorArgs(value: Arg): this;

  /**
   * `--extractor-retries` — Number of retries for known extractor errors (default is 3), or "infinite"
   *
   * @stage extract · Extractor Options
   */
  extractorRetries(value: Arg): this;

  /**
   * `--hls-split-discontinuity` — Split HLS playlists to different formats at discontinuities such as ad breaks
   *
   * @stage extract · Extractor Options
   * @remarks `.hlsSplitDiscontinuity(false)` → `--no-hls-split-discontinuity`
   */
  hlsSplitDiscontinuity(on?: boolean): this;

  /**
   * `--ignore-dynamic-mpd` (--no-allow-dynamic-mpd) — Do not process dynamic DASH manifests (Alias: --no-allow-dynamic-mpd)
   *
   * @stage extract · Extractor Options
   */
  ignoreDynamicMpd(on?: boolean): this;

  /**
   * `--age-limit` — Download only videos suitable for the given age
   *
   * @stage select · Video Selection
   */
  ageLimit(value: Arg): this;

  /**
   * `--break-match-filters` — Same as "--match-filters" but stops the download process when a video is rejected
   *
   * @stage select · Video Selection
   * @remarks `.breakMatchFilters(false)` → `--no-break-match-filters`
   */
  breakMatchFilters(...values: Arg[]): this;

  /**
   * `--break-on-existing` — Stop the download process when encountering a file that is in the archive supplied with the --download-archive option
   *
   * @stage select · Video Selection
   * @remarks `.breakOnExisting(false)` → `--no-break-on-existing`
   */
  breakOnExisting(on?: boolean): this;

  /**
   * `--break-per-input` — Alters --max-downloads, --break-on-existing, --break-match-filters, and autonumber to reset per input URL
   *
   * @stage select · Video Selection
   * @remarks `.breakPerInput(false)` → `--no-break-per-input`
   */
  breakPerInput(on?: boolean): this;

  /**
   * `--date` — Download only videos uploaded on this date. The date can be "YYYYMMDD" or in the format [now|today|yesterday][-N[day|week|month|year]]. E.g. "--date today-2weeks" downloads only videos uploaded on the same day two weeks ago
   *
   * @stage select · Video Selection
   */
  date(value: Arg): this;

  /**
   * `--dateafter` — Download only videos uploaded on or after this date. The date formats accepted are the same as --date
   *
   * @stage select · Video Selection
   */
  dateafter(value: Arg): this;

  /**
   * `--datebefore` — Download only videos uploaded on or before this date. The date formats accepted are the same as --date
   *
   * @stage select · Video Selection
   */
  datebefore(value: Arg): this;

  /**
   * `--download-archive` — Download only videos not listed in the archive file. Record the IDs of all downloaded videos in it
   *
   * @stage select · Video Selection
   * @remarks `.downloadArchive(false)` → `--no-download-archive`
   */
  downloadArchive(value: Arg): this;

  /**
   * `--match-filters` — Generic video filter. Any "OUTPUT TEMPLATE" field can be compared with a number or a string using the operators defined in "Filtering Formats". You can also simply specify a field to match if the field is present, use "!field" to check if the field is not present, and "&" to check multiple conditions. Use a "\" to escape "&" or quotes if needed. If used multiple times, the filter matches if at least one of the conditions is met. E.g. --match-filters !is_live --match-filters "like_count>?100 & description~='(?i)\bcats \& dogs\b'" matches only videos that are not live OR those that have a like count more than 100 (or the like field is not available) and also has a description that contains the phrase "cats & dogs" (caseless). Use "--match-filters -" to interactively ask whether to download each video
   *
   * @stage select · Video Selection
   * @remarks `.matchFilters(false)` → `--no-match-filters`
   */
  matchFilters(...values: Arg[]): this;

  /**
   * `--max-downloads` — Abort after downloading NUMBER files
   *
   * @stage select · Video Selection
   */
  maxDownloads(value: Arg): this;

  /**
   * `--max-filesize` — Abort download if filesize is larger than SIZE, e.g. 50k or 44.6M
   *
   * @stage select · Video Selection
   */
  maxFilesize(value: Arg): this;

  /**
   * `--min-filesize` — Abort download if filesize is smaller than SIZE, e.g. 50k or 44.6M
   *
   * @stage select · Video Selection
   */
  minFilesize(value: Arg): this;

  /**
   * `--no-playlist` — Download only the video, if the URL refers to a video and a playlist
   *
   * @stage select · Video Selection
   * @remarks `.noPlaylist(false)` → `--yes-playlist`
   */
  noPlaylist(on?: boolean): this;

  /**
   * `--playlist-items` (-I) — Comma-separated playlist_index of the items to download. You can specify a range using "[START]:[STOP][:STEP]". For backward compatibility, START-STOP is also supported. Use negative indices to count from the right and negative STEP to download in reverse order. E.g. "-I 1:3,7,-5::2" used on a playlist of size 15 will download the items at index 1,2,3,7,11,13,15
   *
   * @stage select · Video Selection
   */
  playlistItems(value: Arg): this;

  /**
   * `--skip-playlist-after-errors` — Number of allowed failures until the rest of the playlist is skipped
   *
   * @stage select · Video Selection
   */
  skipPlaylistAfterErrors(value: Arg): this;

  /**
   * `--audio-multistreams` — Allow multiple audio streams to be merged into a single file
   *
   * @stage format · Video Format Options
   * @remarks `.audioMultistreams(false)` → `--no-audio-multistreams`
   */
  audioMultistreams(on?: boolean): this;

  /**
   * `--check-all-formats` — Check all formats for whether they are actually downloadable
   *
   * @stage format · Video Format Options
   */
  checkAllFormats(on?: boolean): this;

  /**
   * `--check-formats` — Make sure formats are selected only from those that are actually downloadable
   *
   * @stage format · Video Format Options
   * @remarks `.checkFormats(false)` → `--no-check-formats`
   */
  checkFormats(on?: boolean): this;

  /**
   * `--format-sort` (-S) — Sort the formats by the fields given, see "Sorting Formats" for more details
   *
   * @stage format · Video Format Options
   */
  formatSort(value: Arg): this;

  /**
   * `--format-sort-force` (--S-force) — Force user specified sort order to have precedence over all fields, see "Sorting Formats" for more details (Alias: --S-force)
   *
   * @stage format · Video Format Options
   * @remarks `.formatSortForce(false)` → `--no-format-sort-force`
   */
  formatSortForce(on?: boolean): this;

  /**
   * `--format-sort-reset` — Disregard previous user specified sort order and reset to the default
   *
   * @stage format · Video Format Options
   */
  formatSortReset(on?: boolean): this;

  /**
   * `--list-formats` (-F) — List available formats of each video. Simulate unless --no-simulate is used
   *
   * @stage format · Video Format Options
   */
  listFormats(on?: boolean): this;

  /**
   * `--list-subs` — List available subtitles of each video. Simulate unless --no-simulate is used
   *
   * @stage format · Subtitle Options
   */
  listSubs(on?: boolean): this;

  /**
   * `--list-thumbnails` — List available thumbnails of each video. Simulate unless --no-simulate is used
   *
   * @stage format · Thumbnail Options
   */
  listThumbnails(on?: boolean): this;

  /**
   * `--merge-output-format` — Containers that may be used when merging formats, separated by "/", e.g. "mp4/mkv". Ignored if no merge is required. (currently supported: avi, flv, mkv, mov, mp4, webm)
   *
   * @stage format · Video Format Options
   */
  mergeOutputFormat(value: 'avi' | 'flv' | 'mkv' | 'mov' | 'mp4' | 'webm' | (string & {})): this;

  /**
   * `--prefer-free-formats` — Prefer video formats with free containers over non-free ones of the same quality. Use with "-S ext" to strictly prefer free containers irrespective of quality
   *
   * @stage format · Video Format Options
   * @remarks `.preferFreeFormats(false)` → `--no-prefer-free-formats`
   */
  preferFreeFormats(on?: boolean): this;

  /**
   * `--sub-format` — Subtitle format; accepts formats preference separated by "/", e.g. "srt" or "ass/srt/best"
   *
   * @stage format · Subtitle Options
   */
  subFormat(value: Arg): this;

  /**
   * `--sub-langs` (--srt-langs) — Languages of the subtitles to download (can be regex) or "all" separated by commas, e.g. --sub-langs "en.*,ja" (where "en.*" is a regex pattern that matches "en" followed by 0 or more of any character). You can prefix the language code with a "-" to exclude it from the requested languages, e.g. --sub-langs all,-live_chat. Use --list-subs for a list of available language tags
   *
   * @stage format · Subtitle Options
   */
  subLangs(value: Arg): this;

  /**
   * `--video-multistreams` — Allow multiple video streams to be merged into a single file
   *
   * @stage format · Video Format Options
   * @remarks `.videoMultistreams(false)` → `--no-video-multistreams`
   */
  videoMultistreams(on?: boolean): this;

  /**
   * `--write-all-thumbnails` — Write all thumbnail image formats to disk
   *
   * @stage format · Thumbnail Options
   */
  writeAllThumbnails(on?: boolean): this;

  /**
   * `--write-auto-subs` (--write-automatic-subs) — Write automatically generated subtitle file (Alias: --write-automatic-subs)
   *
   * @stage format · Subtitle Options
   * @remarks `.writeAutoSubs(false)` → `--no-write-auto-subs`
   */
  writeAutoSubs(on?: boolean): this;

  /**
   * `--write-subs` (--write-srt) — Write subtitle file
   *
   * @stage format · Subtitle Options
   * @remarks `.writeSubs(false)` → `--no-write-subs`
   */
  writeSubs(on?: boolean): this;

  /**
   * `--write-thumbnail` — Write thumbnail image to disk
   *
   * @stage format · Thumbnail Options
   * @remarks `.writeThumbnail(false)` → `--no-write-thumbnail`
   */
  writeThumbnail(on?: boolean): this;

  /**
   * `--abort-on-unavailable-fragments` (--no-skip-unavailable-fragments) — Abort download if a fragment is unavailable (Alias: --no-skip-unavailable-fragments)
   *
   * @stage download · Download Options
   */
  abortOnUnavailableFragments(on?: boolean): this;

  /**
   * `--buffer-size` — Size of download buffer, e.g. 1024 or 16K (default is 1024)
   *
   * @stage download · Download Options
   */
  bufferSize(value: Arg): this;

  /**
   * `--concurrent-fragments` (-N) — Number of fragments of a dash/hlsnative video that should be downloaded concurrently (default is 1)
   *
   * @stage download · Download Options
   */
  concurrentFragments(value: Arg): this;

  /**
   * `--download-sections` — Download only chapters that match the regular expression. A "*" prefix denotes time-range instead of chapter. Negative timestamps are calculated from the end. "*from-url" can be used to download between the "start_time" and "end_time" extracted from the URL. Needs ffmpeg. This option can be used multiple times to download multiple sections, e.g. --download-sections "*10:15-inf" --download-sections "intro"
   *
   * @stage download · Download Options
   */
  downloadSections(...values: Arg[]): this;

  /**
   * `--downloader` (--external-downloader) — Name or path of the external downloader to use (optionally) prefixed by the protocols (http, ftp, m3u8, dash, rtmp) to use it for. Currently supports native, aria2c, axel, curl, ffmpeg, httpie, wget. You can use this option multiple times to set different downloaders for different protocols. E.g. --downloader aria2c --downloader "dash,m3u8:native" will use aria2c for http/ftp downloads, and the native downloader for dash/m3u8 downloads (Alias: --external-downloader)
   *
   * @stage download · Download Options
   */
  downloader(value: Arg): this;

  /**
   * `--downloader-args` (--external-downloader-args) — Give these arguments to the external downloader. Specify the downloader name and the arguments separated by a colon ":". For ffmpeg, arguments can be passed to different positions using the same syntax as --postprocessor-args. You can use this option multiple times to give different arguments to different downloaders (Alias: --external-downloader-args)
   *
   * @stage download · Download Options
   */
  downloaderArgs(value: Arg): this;

  /**
   * `--file-access-retries` — Number of times to retry on file access error (default is 3), or "infinite"
   *
   * @stage download · Download Options
   */
  fileAccessRetries(value: Arg): this;

  /**
   * `--fragment-retries` — Number of retries for a fragment (default is 10), or "infinite" (DASH, hlsnative and ISM)
   *
   * @stage download · Download Options
   */
  fragmentRetries(value: Arg): this;

  /**
   * `--hls-use-mpegts` — Use the mpegts container for HLS videos; allowing some players to play the video while downloading, and reducing the chance of file corruption if download is interrupted. This is enabled by default for live streams
   *
   * @stage download · Download Options
   * @remarks `.hlsUseMpegts(false)` → `--no-hls-use-mpegts`
   */
  hlsUseMpegts(on?: boolean): this;

  /**
   * `--http-chunk-size` — Size of a chunk for chunk-based HTTP downloading, e.g. 10485760 or 10M (default is disabled). May be useful for bypassing bandwidth throttling imposed by a webserver (experimental)
   *
   * @stage download · Download Options
   */
  httpChunkSize(value: Arg): this;

  /**
   * `--keep-fragments` — Keep downloaded fragments on disk after downloading is finished
   *
   * @stage download · Download Options
   * @remarks `.keepFragments(false)` → `--no-keep-fragments`
   */
  keepFragments(on?: boolean): this;

  /**
   * `--lazy-playlist` — Process entries in the playlist as they are received. This disables n_entries, --playlist-random and --playlist-reverse
   *
   * @stage download · Download Options
   * @remarks `.lazyPlaylist(false)` → `--no-lazy-playlist`
   */
  lazyPlaylist(on?: boolean): this;

  /**
   * `--limit-rate` (-r · --rate-limit) — Maximum download rate in bytes per second, e.g. 50K or 4.2M
   *
   * @stage download · Download Options
   */
  limitRate(value: Arg): this;

  /**
   * `--playlist-random` — Download playlist videos in random order
   *
   * @stage download · Download Options
   */
  playlistRandom(on?: boolean): this;

  /**
   * `--resize-buffer` — The buffer size is automatically resized from an initial value of --buffer-size (default)
   *
   * @stage download · Download Options
   * @remarks `.resizeBuffer(false)` → `--no-resize-buffer`
   */
  resizeBuffer(on?: boolean): this;

  /**
   * `--retries` (-R) — Number of retries (default is 10), or "infinite"
   *
   * @stage download · Download Options
   */
  retries(value: Arg): this;

  /**
   * `--retry-sleep` — Time to sleep between retries in seconds (optionally) prefixed by the type of retry (http (default), fragment, file_access, extractor) to apply the sleep to. EXPR can be a number, linear=START[:END[:STEP=1]] or exp=START[:END[:BASE=2]]. This option can be used multiple times to set the sleep for the different retry types, e.g. --retry-sleep linear=1::2 --retry-sleep fragment:exp=1:20
   *
   * @stage download · Download Options
   */
  retrySleep(value: Arg): this;

  /**
   * `--skip-unavailable-fragments` (--no-abort-on-unavailable-fragments) — Skip unavailable fragments for DASH, hlsnative and ISM downloads (default) (Alias: --no-abort-on-unavailable-fragments)
   *
   * @stage download · Download Options
   */
  skipUnavailableFragments(on?: boolean): this;

  /**
   * `--throttled-rate` — Minimum download rate in bytes per second below which throttling is assumed and the video data is re-extracted, e.g. 100K
   *
   * @stage download · Download Options
   */
  throttledRate(value: Arg): this;

  /**
   * `--audio-format` — Format to convert the audio to when -x is used. (currently supported: best (default), aac, alac, flac, m4a, mp3, opus, vorbis, wav). You can specify multiple rules using similar syntax as --remux-video
   *
   * @stage process · Post-Processing Options
   */
  audioFormat(value: 'best' | 'mp3' | 'aac' | 'm4a' | 'opus' | 'vorbis' | 'flac' | 'alac' | 'wav' | (string & {})): this;

  /**
   * `--audio-quality` — Specify ffmpeg audio quality to use when converting the audio with -x. Insert a value between 0 (best) and 10 (worst) for VBR or a specific bitrate like 128K (default 5)
   *
   * @stage process · Post-Processing Options
   */
  audioQuality(value: Arg): this;

  /**
   * `--concat-playlist` — Concatenate videos in a playlist. One of "never", "always", or "multi_video" (default; only when the videos form a single show). All the video files must have the same codecs and number of streams to be concatenable. The "pl_video:" prefix can be used with "--paths" and "--output" to set the output filename for the concatenated files. See "OUTPUT TEMPLATE" for details
   *
   * @stage process · Post-Processing Options
   */
  concatPlaylist(value: 'never' | 'always' | 'multi_video'): this;

  /**
   * `--convert-subs` (--convert-sub · --convert-subtitles) — Convert the subtitles to another format (currently supported: ass, lrc, srt, vtt). Use "--convert-subs none" to disable conversion (default) (Alias: --convert-subtitles)
   *
   * @stage process · Post-Processing Options
   */
  convertSubs(value: 'srt' | 'vtt' | 'ass' | 'lrc' | 'none'): this;

  /**
   * `--convert-thumbnails` — Convert the thumbnails to another format (currently supported: jpg, png, webp). You can specify multiple rules using similar syntax as "--remux-video". Use "--convert-thumbnails none" to disable conversion (default)
   *
   * @stage process · Post-Processing Options
   */
  convertThumbnails(value: 'jpg' | 'png' | 'webp' | 'none' | (string & {})): this;

  /**
   * `--embed-chapters` (--add-chapters) — Add chapter markers to the video file (Alias: --add-chapters)
   *
   * @stage process · Post-Processing Options
   * @remarks `.embedChapters(false)` → `--no-embed-chapters`
   */
  embedChapters(on?: boolean): this;

  /**
   * `--embed-info-json` — Embed the infojson as an attachment to mkv/mka video files
   *
   * @stage process · Post-Processing Options
   * @remarks `.embedInfoJson(false)` → `--no-embed-info-json`
   */
  embedInfoJson(on?: boolean): this;

  /**
   * `--embed-metadata` (--add-metadata) — Embed metadata to the video file. Also embeds chapters/infojson if present unless --no-embed-chapters/--no-embed-info-json are used (Alias: --add-metadata)
   *
   * @stage process · Post-Processing Options
   * @remarks `.embedMetadata(false)` → `--no-embed-metadata`
   */
  embedMetadata(on?: boolean): this;

  /**
   * `--embed-subs` — Embed subtitles in the video (only for mp4, webm and mkv videos)
   *
   * @stage process · Post-Processing Options
   * @remarks `.embedSubs(false)` → `--no-embed-subs`
   */
  embedSubs(on?: boolean): this;

  /**
   * `--embed-thumbnail` — Embed thumbnail in the video as cover art
   *
   * @stage process · Post-Processing Options
   * @remarks `.embedThumbnail(false)` → `--no-embed-thumbnail`
   */
  embedThumbnail(on?: boolean): this;

  /**
   * `--exec` — Execute a command, optionally prefixed with when to execute it, separated by a ":". Supported values of "WHEN" are the same as that of --use-postprocessor (default: after_move). The same syntax as the output template can be used to pass any field as arguments to the command; however, for security reasons the only allowed conversions are: "i"/"d" (signed integer decimal), "f" (floating-point decimal) and "q" (shell-quoted). If no fields are passed, %(filepath,_filename|)q is appended to the end of the command. This option can be used multiple times
   *
   * @stage process · Post-Processing Options
   * @remarks `.exec(false)` → `--no-exec`
   */
  exec(value: Arg): this;

  /**
   * `--extract-audio` (-x) — Convert video files to audio-only files (requires ffmpeg and ffprobe)
   *
   * @stage process · Post-Processing Options
   */
  extractAudio(on?: boolean): this;

  /**
   * `--ffmpeg-location` — Location of the ffmpeg binary; either the path to the binary or its containing directory
   *
   * @stage process · Post-Processing Options
   */
  ffmpegLocation(value: Arg): this;

  /**
   * `--fixup` — Automatically correct known faults of the file. One of never (do nothing), warn (only emit a warning), detect_or_warn (the default; fix the file if we can, warn otherwise), force (try fixing even if the file already exists)
   *
   * @stage process · Post-Processing Options
   */
  fixup(value: 'never' | 'ignore' | 'warn' | 'detect_or_warn' | 'force'): this;

  /**
   * `--force-keyframes-at-cuts` — Force keyframes at cuts when downloading/splitting/removing sections. This is slow due to needing a re-encode, but the resulting video may have fewer artifacts around the cuts
   *
   * @stage process · Post-Processing Options
   * @remarks `.forceKeyframesAtCuts(false)` → `--no-force-keyframes-at-cuts`
   */
  forceKeyframesAtCuts(on?: boolean): this;

  /**
   * `--keep-video` (-k) — Keep the intermediate video file on disk after post-processing
   *
   * @stage process · Post-Processing Options
   * @remarks `.keepVideo(false)` → `--no-keep-video`
   */
  keepVideo(on?: boolean): this;

  /**
   * `--no-sponsorblock` — Disable both --sponsorblock-mark and --sponsorblock-remove
   *
   * @stage process · SponsorBlock Options
   */
  noSponsorblock(on?: boolean): this;

  /**
   * `--parse-metadata` — Parse additional metadata like title/artist from other fields; see "MODIFYING METADATA" for details. Supported values of "WHEN" are the same as that of --use-postprocessor (default: pre_process)
   *
   * @stage process · Post-Processing Options
   */
  parseMetadata(value: Arg): this;

  /**
   * `--post-overwrites` — Overwrite post-processed files (default)
   *
   * @stage process · Post-Processing Options
   * @remarks `.postOverwrites(false)` → `--no-post-overwrites`
   */
  postOverwrites(on?: boolean): this;

  /**
   * `--postprocessor-args` (--ppa) — Give these arguments to the postprocessors. Specify the postprocessor/executable name and the arguments separated by a colon ":" to give the argument to the specified postprocessor/executable. Supported PP are: Merger, ModifyChapters, SplitChapters, ExtractAudio, VideoRemuxer, VideoConvertor, Metadata, EmbedSubtitle, EmbedThumbnail, SubtitlesConvertor, ThumbnailsConvertor, FixupStretched, FixupM4a, FixupM3u8, FixupTimestamp and FixupDuration. The supported executables are: AtomicParsley, FFmpeg and FFprobe. You can also specify "PP+EXE:ARGS" to give the arguments to the specified executable only when being used by the specified postprocessor. Additionally, for ffmpeg/ffprobe, "_i"/"_o" can be appended to the prefix optionally followed by a number to pass the argument before the specified input/output file, e.g. --ppa "Merger+ffmpeg_i1:-v quiet". You can use this option multiple times to give different arguments to different postprocessors. (Alias: --ppa)
   *
   * @stage process · Post-Processing Options
   */
  postprocessorArgs(value: Arg): this;

  /**
   * `--recode-video` — Re-encode the video into another format if necessary. The syntax and supported formats are the same as --remux-video
   *
   * @stage process · Post-Processing Options
   */
  recodeVideo(value: 'avi' | 'flv' | 'gif' | 'mkv' | 'mov' | 'mp4' | 'webm' | 'aac' | 'aiff' | 'alac' | 'flac' | 'm4a' | 'mka' | 'mp3' | 'ogg' | 'opus' | 'vorbis' | 'wav' | (string & {})): this;

  /**
   * `--remove-chapters` — Remove chapters whose title matches the given regular expression. The syntax is the same as --download-sections. This option can be used multiple times
   *
   * @stage process · Post-Processing Options
   * @remarks `.removeChapters(false)` → `--no-remove-chapters`
   */
  removeChapters(...values: Arg[]): this;

  /**
   * `--remux-video` — Remux the video into another container if necessary (currently supported: avi, flv, gif, mkv, mov, mp4, webm, aac, aiff, alac, flac, m4a, mka, mp3, ogg, opus, vorbis, wav). If the target container does not support the video/audio codec, remuxing will fail. You can specify multiple rules; e.g. "aac>m4a/mov>mp4/mkv" will remux aac to m4a, mov to mp4 and anything else to mkv
   *
   * @stage process · Post-Processing Options
   */
  remuxVideo(value: 'avi' | 'flv' | 'gif' | 'mkv' | 'mov' | 'mp4' | 'webm' | 'aac' | 'aiff' | 'alac' | 'flac' | 'm4a' | 'mka' | 'mp3' | 'ogg' | 'opus' | 'vorbis' | 'wav' | (string & {})): this;

  /**
   * `--replace-in-metadata` — Replace text in a metadata field using the given regex. This option can be used multiple times. Supported values of "WHEN" are the same as that of --use-postprocessor (default: pre_process)
   *
   * @stage process · Post-Processing Options
   */
  replaceInMetadata(value: Arg): this;

  /**
   * `--split-chapters` (--split-tracks) — Split video into multiple files based on internal chapters. The "chapter:" prefix can be used with "--paths" and "--output" to set the output filename for the split files. See "OUTPUT TEMPLATE" for details
   *
   * @stage process · Post-Processing Options
   * @remarks `.splitChapters(false)` → `--no-split-chapters`
   */
  splitChapters(on?: boolean): this;

  /**
   * `--sponsorblock-api` — SponsorBlock API location, defaults to https://sponsor.ajay.app
   *
   * @stage process · SponsorBlock Options
   */
  sponsorblockApi(value: Arg): this;

  /**
   * `--sponsorblock-chapter-title` — An output template for the title of the SponsorBlock chapters created by --sponsorblock-mark. The only available fields are start_time, end_time, category, categories, name, category_names. Defaults to "[SponsorBlock]: %(category_names)l"
   *
   * @stage process · SponsorBlock Options
   */
  sponsorblockChapterTitle(value: Arg): this;

  /**
   * `--sponsorblock-mark` — SponsorBlock categories to create chapters for, separated by commas. Available categories are sponsor, intro, outro, selfpromo, preview, filler, interaction, music_offtopic, hook, poi_highlight, chapter, all and default (=all). You can prefix the category with a "-" to exclude it. See [1] for descriptions of the categories. E.g. --sponsorblock-mark all,-preview [1] https://wiki.sponsor.ajay.app/w/Segment_Categories
   *
   * @stage process · SponsorBlock Options
   */
  sponsorblockMark(...values: ('chapter' | 'filler' | 'hook' | 'interaction' | 'intro' | 'music_offtopic' | 'outro' | 'poi_highlight' | 'preview' | 'selfpromo' | 'sponsor' | 'default' | 'all' | `-${'chapter' | 'filler' | 'hook' | 'interaction' | 'intro' | 'music_offtopic' | 'outro' | 'poi_highlight' | 'preview' | 'selfpromo' | 'sponsor' | 'default' | 'all'}`)[]): this;

  /**
   * `--sponsorblock-remove` — SponsorBlock categories to be removed from the video file, separated by commas. If a category is present in both mark and remove, remove takes precedence. The syntax and available categories are the same as for --sponsorblock-mark except that "default" refers to "all,-filler" and poi_highlight, chapter are not available
   *
   * @stage process · SponsorBlock Options
   */
  sponsorblockRemove(...values: ('filler' | 'hook' | 'interaction' | 'intro' | 'music_offtopic' | 'outro' | 'preview' | 'selfpromo' | 'sponsor' | 'default' | 'all' | `-${'filler' | 'hook' | 'interaction' | 'intro' | 'music_offtopic' | 'outro' | 'preview' | 'selfpromo' | 'sponsor' | 'default' | 'all'}`)[]): this;

  /**
   * `--use-postprocessor` — The (case-sensitive) name of plugin postprocessors to be enabled, and (optionally) arguments to be passed to it, separated by a colon ":". ARGS are a semicolon ";" delimited list of NAME=VALUE. The "when" argument determines when the postprocessor is invoked. It can be one of "pre_process" (after video extraction), "after_filter" (after video passes filter), "video" (after --format; before --print/--output), "before_dl" (before each video download), "post_process" (after each video download; default), "after_move" (after moving the video file to its final location), "after_video" (after downloading and processing all formats of a video), or "playlist" (at end of playlist). This option can be used multiple times to add different postprocessors
   *
   * @stage process · Post-Processing Options
   */
  usePostprocessor(value: Arg): this;

  /**
   * `--xattrs` (--xattr) — Write metadata to the video file's xattrs (using Dublin Core and XDG standards)
   *
   * @stage process · Post-Processing Options
   */
  xattrs(on?: boolean): this;

  /**
   * `--batch-file` (-a) — File containing URLs to download ("-" for stdin), one URL per line. Lines starting with "#", ";" or "]" are considered as comments and ignored
   *
   * @stage store · Filesystem Options
   * @remarks `.batchFile(false)` → `--no-batch-file`
   */
  batchFile(value: Arg): this;

  /**
   * `--cache-dir` — Location in the filesystem where yt-dlp can store some downloaded information (such as client ids and signatures) permanently. By default ${XDG_CACHE_HOME}/yt-dlp
   *
   * @stage store · Filesystem Options
   * @remarks `.cacheDir(false)` → `--no-cache-dir`
   */
  cacheDir(value: Arg): this;

  /**
   * `--clean-info-json` (--clean-infojson) — Remove some internal metadata such as filenames from the infojson (default)
   *
   * @stage store · Filesystem Options
   * @remarks `.cleanInfoJson(false)` → `--no-clean-info-json`
   */
  cleanInfoJson(on?: boolean): this;

  /**
   * `--continue` (-c) — Resume partially downloaded files/fragments (default)
   *
   * @stage store · Filesystem Options
   * @remarks `.continue(false)` → `--no-continue`
   */
  continue(on?: boolean): this;

  /**
   * `--force-overwrites` (--yes-overwrites) — Overwrite all video and metadata files. This option includes --no-continue
   *
   * @stage store · Filesystem Options
   * @remarks `.forceOverwrites(false)` → `--no-force-overwrites`
   */
  forceOverwrites(on?: boolean): this;

  /**
   * `--load-info-json` — JSON file containing the video information (created with the "--write-info-json" option)
   *
   * @stage store · Filesystem Options
   */
  loadInfoJson(value: Arg): this;

  /**
   * `--mtime` — Use the Last-modified header to set the file modification time
   *
   * @stage store · Filesystem Options
   * @remarks `.mtime(false)` → `--no-mtime`
   */
  mtime(on?: boolean): this;

  /**
   * `--no-overwrites` (-w) — Do not overwrite any files
   *
   * @stage store · Filesystem Options
   */
  noOverwrites(on?: boolean): this;

  /**
   * `--output-na-placeholder` — Placeholder for unavailable fields in --output (default: "NA")
   *
   * @stage store · Filesystem Options
   */
  outputNaPlaceholder(value: Arg): this;

  /**
   * `--part` — Use .part files instead of writing directly into output file (default)
   *
   * @stage store · Filesystem Options
   * @remarks `.part(false)` → `--no-part`
   */
  part(on?: boolean): this;

  /**
   * `--restrict-filenames` — Restrict filenames to only ASCII characters, and avoid "&" and spaces in filenames
   *
   * @stage store · Filesystem Options
   * @remarks `.restrictFilenames(false)` → `--no-restrict-filenames`
   */
  restrictFilenames(on?: boolean): this;

  /**
   * `--rm-cache-dir` — Delete all filesystem cache files
   *
   * @stage store · Filesystem Options
   */
  rmCacheDir(on?: boolean): this;

  /**
   * `--trim-filenames` (--trim-file-names) — Limit the filename length (excluding extension) to the specified number of characters
   *
   * @stage store · Filesystem Options
   */
  trimFilenames(value: Arg): this;

  /**
   * `--windows-filenames` — Force filenames to be Windows-compatible
   *
   * @stage store · Filesystem Options
   * @remarks `.windowsFilenames(false)` → `--no-windows-filenames`
   */
  windowsFilenames(on?: boolean): this;

  /**
   * `--write-comments` (--get-comments) — Retrieve video comments to be placed in the infojson. The comments are fetched even without this option if the extraction is known to be quick (Alias: --get-comments)
   *
   * @stage store · Filesystem Options
   * @remarks `.writeComments(false)` → `--no-write-comments`
   */
  writeComments(on?: boolean): this;

  /**
   * `--write-description` — Write video description to a .description file
   *
   * @stage store · Filesystem Options
   * @remarks `.writeDescription(false)` → `--no-write-description`
   */
  writeDescription(on?: boolean): this;

  /**
   * `--write-desktop-link` — Write a .desktop Linux internet shortcut
   *
   * @stage store · Internet Shortcut Options
   */
  writeDesktopLink(on?: boolean): this;

  /**
   * `--write-info-json` — Write video metadata to a .info.json file (this may contain personal information)
   *
   * @stage store · Filesystem Options
   * @remarks `.writeInfoJson(false)` → `--no-write-info-json`
   */
  writeInfoJson(on?: boolean): this;

  /**
   * `--write-link` — Write an internet shortcut file, depending on the current platform (.url, .webloc or .desktop). The URL may be cached by the OS
   *
   * @stage store · Internet Shortcut Options
   */
  writeLink(on?: boolean): this;

  /**
   * `--write-playlist-metafiles` — Write playlist metadata in addition to the video metadata when using --write-info-json, --write-description etc. (default)
   *
   * @stage store · Filesystem Options
   * @remarks `.writePlaylistMetafiles(false)` → `--no-write-playlist-metafiles`
   */
  writePlaylistMetafiles(on?: boolean): this;

  /**
   * `--write-url-link` — Write a .url Windows internet shortcut. The OS caches the URL based on the file path
   *
   * @stage store · Internet Shortcut Options
   */
  writeUrlLink(on?: boolean): this;

  /**
   * `--write-webloc-link` — Write a .webloc macOS internet shortcut
   *
   * @stage store · Internet Shortcut Options
   */
  writeWeblocLink(on?: boolean): this;

  /**
   * `--console-title` — Display progress in console titlebar
   *
   * @stage report · Verbosity and Simulation Options
   */
  consoleTitle(on?: boolean): this;

  /**
   * `--dump-json` (-j) — Quiet, but print JSON information for each video. Simulate unless --no-simulate is used. See "OUTPUT TEMPLATE" for a description of available keys
   *
   * @stage report · Verbosity and Simulation Options
   */
  dumpJson(on?: boolean): this;

  /**
   * `--dump-pages` — Print downloaded pages encoded using base64 to debug problems (very verbose)
   *
   * @stage report · Verbosity and Simulation Options
   */
  dumpPages(on?: boolean): this;

  /**
   * `--dump-single-json` (-J) — Quiet, but print JSON information for each URL or infojson passed. Simulate unless --no-simulate is used. If the URL refers to a playlist, the whole playlist information is dumped in a single line
   *
   * @stage report · Verbosity and Simulation Options
   */
  dumpSingleJson(on?: boolean): this;

  /**
   * `--force-write-archive` (--force-write-download-archive · --force-download-archive) — Force download archive entries to be written as far as no errors occur, even if -s or another simulation option is used (Alias: --force-download-archive)
   *
   * @stage report · Verbosity and Simulation Options
   */
  forceWriteArchive(on?: boolean): this;

  /**
   * `--ignore-no-formats-error` — Ignore "No video formats" error. Useful for extracting metadata even if the videos are not actually available for download (experimental)
   *
   * @stage report · Verbosity and Simulation Options
   * @remarks `.ignoreNoFormatsError(false)` → `--no-ignore-no-formats-error`
   */
  ignoreNoFormatsError(on?: boolean): this;

  /**
   * `--newline` — Output progress bar as new lines
   *
   * @stage report · Verbosity and Simulation Options
   */
  newline(on?: boolean): this;

  /**
   * `--no-warnings` — Ignore warnings
   *
   * @stage report · Verbosity and Simulation Options
   */
  noWarnings(on?: boolean): this;

  /**
   * `--print` (-O) — Field name or output template to print to screen, optionally prefixed with when to print it, separated by a ":". Supported values of "WHEN" are the same as that of --use-postprocessor (default: video). Implies --quiet. Implies --simulate unless --no-simulate or later stages of WHEN are used. This option can be used multiple times
   *
   * @stage report · Verbosity and Simulation Options
   */
  print(value: Arg): this;

  /**
   * `--print-to-file` — Append given template to the file. The values of WHEN and TEMPLATE are the same as that of --print. FILE uses the same syntax as the output template. This option can be used multiple times
   *
   * @stage report · Verbosity and Simulation Options
   */
  printToFile(value: Arg): this;

  /**
   * `--print-traffic` — Display sent and read HTTP traffic
   *
   * @stage report · Verbosity and Simulation Options
   */
  printTraffic(on?: boolean): this;

  /**
   * `--progress` — Show progress bar, even if in quiet mode
   *
   * @stage report · Verbosity and Simulation Options
   * @remarks `.progress(false)` → `--no-progress`
   */
  progress(on?: boolean): this;

  /**
   * `--progress-delta` — Time between progress output (default: 0)
   *
   * @stage report · Verbosity and Simulation Options
   */
  progressDelta(value: Arg): this;

  /**
   * `--progress-template` — Template for progress outputs, optionally prefixed with one of "download:" (default), "download-title:" (the console title), "postprocess:", or "postprocess-title:". The video's fields are accessible under the "info" key and the progress attributes are accessible under "progress" key. E.g. --console-title --progress-template "download-title:%(info.id)s-%(progress.eta)s"
   *
   * @stage report · Verbosity and Simulation Options
   */
  progressTemplate(value: Arg): this;

  /**
   * `--quiet` (-q) — Activate quiet mode. If used with --verbose, print the log to stderr
   *
   * @stage report · Verbosity and Simulation Options
   * @remarks `.quiet(false)` → `--no-quiet`
   */
  quiet(on?: boolean): this;

  /**
   * `--simulate` (-s) — Do not download the video and do not write anything to disk
   *
   * @stage report · Verbosity and Simulation Options
   * @remarks `.simulate(false)` → `--no-simulate`
   */
  simulate(on?: boolean): this;

  /**
   * `--skip-download` (--no-download) — Do not download the video but write all related files (Alias: --no-download)
   *
   * @stage report · Verbosity and Simulation Options
   */
  skipDownload(on?: boolean): this;

  /**
   * `--verbose` (-v) — Print various debugging information
   *
   * @stage report · Verbosity and Simulation Options
   */
  verbose(on?: boolean): this;

  /**
   * `--write-pages` — Write downloaded intermediary pages to files in the current directory to debug problems
   *
   * @stage report · Verbosity and Simulation Options
   */
  writePages(on?: boolean): this;
}
