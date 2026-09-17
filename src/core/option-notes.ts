/**
 * One-line option notes — a layer painted over the reflection.
 *
 * What autocomplete showed used to be yt-dlp's help text verbatim. Most of it is
 * short enough to use as-is (median 84 characters), but some can't be read in a
 * tooltip — `--postprocessor-args` is 968 characters.
 *
 * What's written here **does not replace the original.** Our short guide line
 * comes first and yt-dlp's own text follows. The original is the truth; this is
 * a signpost.
 *
 * **Partial coverage is fine.** The schema decides the list and this file only
 * notes what we know — options without a note show only yt-dlp's text, as before.
 * The same goes for new options that exist only in the user's yt-dlp, and that's
 * right: they're options we've never seen.
 *
 * Notes on `-f` · `-o` · `-P` · `--cookies-from-browser` never show up — their
 * signatures are hand-written in `build.ts` and skip the generator. Their
 * descriptions go directly in the JSDoc there. A test covers that too.
 *
 * A note on a nonexistent option id is caught by a test. Once a note outlives its
 * option it becomes a lie — a road this repo already walked with the `-o` type table.
 */

/** Option id → one guide line. The key is the long flag without `--`. */
export const NOTES: Record<string, string> = {
  // ── ones that couldn't be read in a tooltip ──
  'postprocessor-args': 'ffmpeg arguments passed to postprocessors, given as `NAME:ARGS` like `ffmpeg:-vcodec libx265`.',
  'use-postprocessor': 'Enables a plugin postprocessor. `NAME[+WHEN][:ARGS]` — WHEN is the same as for `--exec`.',
  alias: 'Gives a new name to a bundle of options. `--alias mp3 "-x --audio-format mp3"`.',
  'js-runtimes': 'Runtime used by extractors that need JavaScript. `deno` · `node` etc.',
  'sub-langs': 'Subtitle languages to fetch. Comma-separated like `ko,en`, `all` for everything, `-live_chat` to exclude.',
  'playlist-items': 'Which playlist entries to fetch. `1,3,5-7` · `::2` (odd ones) · `-1` (last).',

  // ── commonly used, but the original was too short to convey the meaning ──
  'extract-audio': 'Drops the video and keeps only the audio. Requires ffmpeg.',
  simulate: 'Only pretends to download — leaves no files and no log. For trying out a command.',
  'no-playlist': 'Fetches just the one video even if the URL points to a playlist.',
  'download-archive': 'Skips what is listed here and records what gets downloaded — for resuming.',
  'concurrent-fragments': 'How many fragments to download at once. Only applies to DASH · HLS.',
  'limit-rate': 'Maximum download rate in bytes per second. `50K` · `4.2M`.',
  'embed-subs': 'Embeds subtitles into the video file. **It does not download them** — `--write-subs` is needed separately.',
  'embed-thumbnail': 'Embeds the thumbnail as cover art.',
  'embed-metadata': 'Writes info such as title · uploader into the file. Chapters too.',
  'sponsorblock-remove': 'Cuts segments marked by SponsorBlock out of the file. Several at once, like `sponsor,intro`.',
};

/** Every option id that has a note. A test checks them against the schema. */
export const ANNOTATED: string[] = Object.keys(NOTES);
