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

// 저장 경로
// @ts-expect-error 없는 경로 종류
ytdlp(u).paths({ hom: '/dl' });

ytdlp(u).paths({ home: '/dl', temp: '/tmp', thumbnail: '/dl/thumbs' });

// 체인은 계속 자기 자신이다
const cmd: string = ytdlp(u).embedSubs().writeSubs().subLangs('ko,en').build();
const argv: string[] = ytdlp(u).extractAudio().toArray();
const ok: boolean = ytdlp(u).lint().ok;

void cmd; void argv; void ok;
