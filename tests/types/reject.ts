/**
 * What the types must block.
 *
 * `@ts-expect-error` bites both ways — if no error occurs, the directive itself becomes
 * an error. So running this one file through `tsc --noEmit` checks "blocks what must be
 * blocked" and "lets through what must not be blocked" together.
 *
 * Every line here used to be caught at runtime by the checker (`core/lint.js`). In the
 * builder the editor catches it first. That is the entire worth of this layer.
 */
import { ytdlp } from '../../src/index.js';

const u = 'https://youtu.be/abc';

// Unknown flags
// @ts-expect-error --write-sub does not exist in this version (it is --write-subs)
ytdlp(u).writeSub();

// @ts-expect-error entirely made up
ytdlp(u).downloadTheWholeInternet();

// Values from a fixed set
// @ts-expect-error a value outside choices
ytdlp(u).fixup('nope');

ytdlp(u).fixup('never');                    // must pass

// Lists are not only in optparse's choices=. yt-dlp also checks with validate_in after
// parsing (--convert-subs · --ap-mso), and with a callback's allowed_values
// (--compat-options · --sponsorblock-*). gen_schema.py reflects all three, so all are
// blocked here too.

// @ts-expect-error --convert-subs only takes subtitle formats
ytdlp(u).convertSubs('mp4');

ytdlp(u).convertSubs('srt');
ytdlp(u).convertSubs('none');               // the off value is in the list too

// @ts-expect-error TV provider identifier typo (it is Comcast_SSO)
ytdlp(u).apMso('Comcast');

ytdlp(u).apMso('Comcast_SSO');

// @ts-expect-error alias typo (it is youtube-dl)
ytdlp(u).compatOptions('youtube-dll');

// Several values, subtracting with `-`, aliases and all — every one is a form yt-dlp accepts
ytdlp(u).compatOptions('all', '-multistreams');
ytdlp(u).compatOptions('youtube-dl');
ytdlp(u).sponsorblockRemove('sponsor', 'intro');
ytdlp(u).sponsorblockMark('default');

// @ts-expect-error subtracting works, but an unknown value still does not
ytdlp(u).sponsorblockRemove('-intr');

// Values that are a grammar over a vocabulary (`--audio-format` etc.) are **left open on
// purpose** — `aac>mp3/best` is a valid value, so a union would produce false errors.
// Instead the vocabulary shows in autocomplete, and the checker (`core/lint.js`) reads the grammar.
ytdlp(u).audioFormat('mp3');
ytdlp(u).audioFormat('aac>mp3/best');
ytdlp(u).remuxVideo('mkv/mp4');
ytdlp(u).mergeOutputFormat('mp4');

// Presets are closed — the table the callback uses sits as-is in the yt-dlp module
ytdlp(u).presetAlias('mp3');

// @ts-expect-error unknown preset
ytdlp(u).presetAlias('mp5');

// The -o types are a list too. This table once diverged from yt-dlp —
// `annotation` was missing, and it had `default`, which yt-dlp does not read as a type.
ytdlp(u).output('annotation', t => t`${t.id}.${t.ext}`);

// @ts-expect-error yt-dlp does not read default: as a type (it becomes part of the filename)
ytdlp(u).output('default', t => t`${t.id}.${t.ext}`);

// `--cookies-from-browser` has four slots, so joining a string confuses `::` with `:`.
// Each slot got a name, and the vocabulary comes from the schema.
ytdlp(u).cookiesFromBrowser('firefox');
ytdlp(u).cookiesFromBrowser('chrome', { keyring: 'GNOMEKEYRING' });
ytdlp(u).cookiesFromBrowser('firefox', { profile: '~/.mozilla/firefox/x', container: 'Work' });

// @ts-expect-error browser typo
ytdlp(u).cookiesFromBrowser('chrom');

// @ts-expect-error unknown keyring
ytdlp(u).cookiesFromBrowser('chrome', { keyring: 'NOPE' });

// @ts-expect-error slot name typo
ytdlp(u).cookiesFromBrowser('firefox', { conatiner: 'Work' });

// The shape of values — for a while every value-taking option was `Arg = string | number`.
// That was wrong both ways: paths accepted numbers, and seconds accepted any string.

// @ts-expect-error a file path is not a number
ytdlp(u).cookies(42);

// @ts-expect-error a URL is not a number either
ytdlp(u).proxy(8080);

// @ts-expect-error optparse reads it as a float
ytdlp(u).socketTimeout('빠르게');

// @ts-expect-error parse_bytes cannot read it
ytdlp(u).maxFilesize('아주 큰 것');

// @ts-expect-error unit not in the table (parse_bytes('50KB') → None)
ytdlp(u).maxFilesize('50KB');

// @ts-expect-error a number or 'infinite'
ytdlp(u).retries('많이');

// Values yt-dlp really accepts must pass as-is — checked against parse_bytes
ytdlp(u).maxFilesize(1024);
ytdlp(u).maxFilesize('50K');
ytdlp(u).maxFilesize('44.6M');
ytdlp(u).limitRate('2.5g');
ytdlp(u).retries('infinite');
ytdlp(u).retries(10);
ytdlp(u).socketTimeout(5.5);
ytdlp(u).cookies('~/cookies.txt');

// Slots where a number is natural were not narrowed — narrowing would make this an error
ytdlp(u).audioQuality(0);
ytdlp(u).audioQuality('128K');

// Format filters
// @ts-expect-error filter key typo
ytdlp(u).format(f => f.bv({ heigth: { lte: 1080 } }));

// @ts-expect-error a string in a numeric field
ytdlp(u).format(f => f.bv({ height: { lte: '1080' } }));

// @ts-expect-error a comparison a numeric field does not have
ytdlp(u).format(f => f.bv({ height: { roughly: 1080 } }));

// @ts-expect-error unknown selector
ytdlp(u).format(f => f.bvv());

ytdlp(u).format(f => f.bvStar({ height: { lte: 1080, loose: true }, ext: 'mp4' }));
ytdlp(u).format(f => f.raw('bv*[height<=1080]'));   // the escape hatch is open

// Output template
// @ts-expect-error unknown field
ytdlp(u).output(t => t`${t.titel}.${t.ext}`);

// @ts-expect-error unknown conversion letter
ytdlp(u).output(t => t`${t.title.as('z')}`);

// @ts-expect-error type name typo
ytdlp(u).output('thumbnale', t => t`${t.id}`);

ytdlp(u).output(t => t`${t.upload_date.date('%Y-%m-%d')}/${t.title.trunc(40)}.${t.ext}`);
ytdlp(u).output('thumbnail', t => t`${t.id}.${t.ext}`);
ytdlp(u).output('%(title)s.%(ext)s');       // a string directly

// Values that are structures get hand-written signatures — because they are a **shape**, not a list
ytdlp(u).matchFilters({ duration: { gt: 120 }, is_live: false });
ytdlp(u).matchFilters('some_plugin_field > 1');   // outside the catalog, use a string
ytdlp(u).downloadSections({ from: 60, to: '2:30' });
ytdlp(u).downloadSections('인트로');

// Field names are **not closed** — yt-dlp accepts any key of the info dict, so closing
// them would make every extractor-specific field a type error. The price: typos go uncaught.
ytdlp(u).matchFilters({ some_extractor_field: { gt: 1 } });

// @ts-expect-error comparison names are closed
ytdlp(u).matchFilters({ duration: { roughly: 120 } });

// @ts-expect-error section slot name typo
ytdlp(u).downloadSections({ form: 60 });

// Save paths
// @ts-expect-error unknown path type
ytdlp(u).paths({ hom: '/dl' });

ytdlp(u).paths({ home: '/dl', temp: '/tmp', thumbnail: '/dl/thumbs' });

// The chain keeps returning itself
const cmd: string = ytdlp(u).embedSubs().writeSubs().subLangs('ko,en').build();
const argv: string[] = ytdlp(u).extractAudio().toArray();
const ok: boolean = ytdlp(u).lint().ok;

void cmd; void argv; void ok;
