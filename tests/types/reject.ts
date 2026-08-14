/**
 * 타입이 막아야 하는 것들.
 *
 * `@ts-expect-error` 는 양쪽으로 문다 — 오류가 안 나면 그 주석 자체가 오류가
 * 된다. 그래서 이 파일 하나를 `tsc --noEmit` 로 돌리면 "막아야 할 것을 막는다"와
 * "막지 말아야 할 것은 통과한다"가 같이 검사된다.
 *
 * 여기 있는 줄들은 전부 검증기(`core/lint.js`)가 런타임에 잡던 것이다. 빌더에서는
 * 에디터가 먼저 잡는다. 그게 이 층의 값어치 전부다.
 */
import { ytdlp } from '../../src/index.js';

const u = 'https://youtu.be/abc';

// 없는 플래그
// @ts-expect-error --write-sub 는 이 버전에 없다 (--write-subs 다)
ytdlp(u).writeSub();

// @ts-expect-error 아예 지어낸 것
ytdlp(u).downloadTheWholeInternet();

// 고를 수 있는 값
// @ts-expect-error choices 밖의 값
ytdlp(u).fixup('nope');

ytdlp(u).fixup('never');                    // 통과해야 한다

// 목록이 optparse 의 choices= 에만 있는 게 아니다. yt-dlp 는 파싱한 뒤에
// validate_in 으로 보기도 하고(--convert-subs · --ap-mso), 콜백의
// allowed_values 로 보기도 한다(--compat-options · --sponsorblock-*).
// gen_schema.py 가 그 셋을 다 리플렉션하므로 여기서도 다 막힌다.

// @ts-expect-error --convert-subs 는 자막 포맷만 받는다
ytdlp(u).convertSubs('mp4');

ytdlp(u).convertSubs('srt');
ytdlp(u).convertSubs('none');               // 끄는 값도 목록에 있다

// @ts-expect-error TV 사업자 식별자 오타 (Comcast_SSO 다)
ytdlp(u).apMso('Comcast');

ytdlp(u).apMso('Comcast_SSO');

// @ts-expect-error 별칭 오타 (youtube-dl 이다)
ytdlp(u).compatOptions('youtube-dll');

// 여러 개를 주고, `-` 로 빼고, 별칭과 all 을 쓰는 것 전부 yt-dlp 가 받는 형태다
ytdlp(u).compatOptions('all', '-multistreams');
ytdlp(u).compatOptions('youtube-dl');
ytdlp(u).sponsorblockRemove('sponsor', 'intro');
ytdlp(u).sponsorblockMark('default');

// @ts-expect-error 빼기는 되지만 없는 값은 여전히 못 쓴다
ytdlp(u).sponsorblockRemove('-intr');

// 어휘 위의 문법인 값(`--audio-format` 등)은 **일부러 안 닫는다** —
// `aac>mp3/best` 가 멀쩡한 값이라 유니온으로 막으면 거짓 오류가 된다.
// 대신 어휘가 자동완성에 뜨고, 문법은 검증기(`core/lint.js`)가 본다.
ytdlp(u).audioFormat('mp3');
ytdlp(u).audioFormat('aac>mp3/best');
ytdlp(u).remuxVideo('mkv/mp4');
ytdlp(u).mergeOutputFormat('mp4');

// 프리셋은 닫혀 있다 — 콜백이 쓰는 표가 yt-dlp 모듈에 그대로 있다
ytdlp(u).presetAlias('mp3');

// @ts-expect-error 없는 프리셋
ytdlp(u).presetAlias('mp5');

// -o 의 종류도 목록이다. 예전에 이 표가 yt-dlp 와 갈려 있었다 —
// `annotation` 이 빠져 있었고, yt-dlp 가 종류로 안 읽는 `default` 가 있었다.
ytdlp(u).output('annotation', t => t`${t.id}.${t.ext}`);

// @ts-expect-error yt-dlp 는 default: 를 종류로 안 읽는다 (파일 이름이 된다)
ytdlp(u).output('default', t => t`${t.id}.${t.ext}`);

// `--cookies-from-browser` 는 자리가 넷이라 문자열로 이으면 `::` 와 `:` 를
// 헷갈린다. 자리마다 이름을 붙였고 어휘는 스키마에서 온다.
ytdlp(u).cookiesFromBrowser('firefox');
ytdlp(u).cookiesFromBrowser('chrome', { keyring: 'GNOMEKEYRING' });
ytdlp(u).cookiesFromBrowser('firefox', { profile: '~/.mozilla/firefox/x', container: 'Work' });

// @ts-expect-error 브라우저 오타
ytdlp(u).cookiesFromBrowser('chrom');

// @ts-expect-error 없는 키링
ytdlp(u).cookiesFromBrowser('chrome', { keyring: 'NOPE' });

// @ts-expect-error 자리 이름 오타
ytdlp(u).cookiesFromBrowser('firefox', { conatiner: 'Work' });

// 값의 모양 — 한동안 값 받는 옵션이 전부 `Arg = string | number` 였다.
// 그건 양쪽으로 틀렸다: 경로에 숫자를 받고, 초에 아무 문자열을 받았다.

// @ts-expect-error 파일 경로는 숫자가 아니다
ytdlp(u).cookies(42);

// @ts-expect-error URL 도 숫자가 아니다
ytdlp(u).proxy(8080);

// @ts-expect-error optparse 가 float 로 읽는다
ytdlp(u).socketTimeout('빠르게');

// @ts-expect-error parse_bytes 가 못 읽는다
ytdlp(u).maxFilesize('아주 큰 것');

// @ts-expect-error 표에 없는 단위 (parse_bytes('50KB') → None)
ytdlp(u).maxFilesize('50KB');

// @ts-expect-error 수 아니면 'infinite' 다
ytdlp(u).retries('많이');

// yt-dlp 가 진짜로 받는 값은 그대로 통과해야 한다 — parse_bytes 로 대조한 것들
ytdlp(u).maxFilesize(1024);
ytdlp(u).maxFilesize('50K');
ytdlp(u).maxFilesize('44.6M');
ytdlp(u).limitRate('2.5g');
ytdlp(u).retries('infinite');
ytdlp(u).retries(10);
ytdlp(u).socketTimeout(5.5);
ytdlp(u).cookies('~/cookies.txt');

// 숫자를 쓰는 게 자연스러운 자리는 안 좁혔다 — 좁혔으면 이게 오류가 됐다
ytdlp(u).audioQuality(0);
ytdlp(u).audioQuality('128K');

// 포맷 필터
// @ts-expect-error 필터 키 오타
ytdlp(u).format(f => f.bv({ heigth: { lte: 1080 } }));

// @ts-expect-error 숫자 필드에 문자
ytdlp(u).format(f => f.bv({ height: { lte: '1080' } }));

// @ts-expect-error 숫자 필드에 없는 비교
ytdlp(u).format(f => f.bv({ height: { roughly: 1080 } }));

// @ts-expect-error 없는 셀렉터
ytdlp(u).format(f => f.bvv());

ytdlp(u).format(f => f.bvStar({ height: { lte: 1080, loose: true }, ext: 'mp4' }));
ytdlp(u).format(f => f.raw('bv*[height<=1080]'));   // 탈출구는 열려 있다

// 출력 템플릿
// @ts-expect-error 없는 필드
ytdlp(u).output(t => t`${t.titel}.${t.ext}`);

// @ts-expect-error 없는 변환 글자
ytdlp(u).output(t => t`${t.title.as('z')}`);

// @ts-expect-error 종류 이름 오타
ytdlp(u).output('thumbnale', t => t`${t.id}`);

ytdlp(u).output(t => t`${t.upload_date.date('%Y-%m-%d')}/${t.title.trunc(40)}.${t.ext}`);
ytdlp(u).output('thumbnail', t => t`${t.id}.${t.ext}`);
ytdlp(u).output('%(title)s.%(ext)s');       // 문자열 직접

// 값이 구조인 것들은 손으로 쓴 시그니처를 갖는다 — 목록이 아니라 **모양**이라서다
ytdlp(u).matchFilters({ duration: { gt: 120 }, is_live: false });
ytdlp(u).matchFilters('some_plugin_field > 1');   // 카탈로그 밖은 문자열로
ytdlp(u).downloadSections({ from: 60, to: '2:30' });
ytdlp(u).downloadSections('인트로');

// 필드 이름은 **안 닫았다** — yt-dlp 가 info dict 의 아무 키나 받으므로
// 닫으면 추출기마다 다른 필드가 전부 타입 오류가 된다. 그 대가로 오타는 못 잡는다.
ytdlp(u).matchFilters({ some_extractor_field: { gt: 1 } });

// @ts-expect-error 비교 이름은 닫혀 있다
ytdlp(u).matchFilters({ duration: { roughly: 120 } });

// @ts-expect-error 구간 자리 이름 오타
ytdlp(u).downloadSections({ form: 60 });

// 저장 경로
// @ts-expect-error 없는 경로 종류
ytdlp(u).paths({ hom: '/dl' });

ytdlp(u).paths({ home: '/dl', temp: '/tmp', thumbnail: '/dl/thumbs' });

// 체인은 계속 자기 자신이다
const cmd: string = ytdlp(u).embedSubs().writeSubs().subLangs('ko,en').build();
const argv: string[] = ytdlp(u).extractAudio().toArray();
const ok: boolean = ytdlp(u).lint().ok;

void cmd; void argv; void ok;
