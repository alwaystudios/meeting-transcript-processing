# Golden test dataset

## Why synthetic, and why this shape

Fixtures are synthetic transcripts, not real meeting content — a real transcript contains real
people's names and conversations, which raises a consent question that fixture data checked into
a repo shouldn't carry. Instead, they're shaped to match the real Google Meet transcript format:
delivered as WebVTT (`.vtt`), where each cue carries a timestamp and an optional `<v Name>...</v>`
voice tag for speaker attribution — absence of that tag means no speaker signal at all. Non-VTT
sources (plain text, `.docx`) pass through with no timestamp parsing. `src/prompt.ts`
(`decodeRawTranscript`, `formatVttCues`) implements this decoding so fixtures exercise the same
path a real transcript would, not just the LLM call in isolation.

## Fixtures

Five fixtures in `fixtures/golden/` (see `index.json` for the manifest):

| File | Category | What it tests |
|---|---|---|
| `01-sprint-planning.json` | Normal | Clear actions + an explicit durable decision, named speakers, full timestamps |
| `02-no-timestamps.json` | Edge case | No timestamp signal at all (plain text) — timestamp must be omitted/empty, not invented |
| `03-unnamed-speakers.json` | Edge case | VTT with no `<v Name>` tags — speaker must be omitted/empty, not guessed |
| `04-all-noise.json` | Edge case | Entire transcript is dismissed asides — both arrays must be empty |
| `05-ops-hiring-review.json` | Normal (different domain) | Plan reversal + a reconfirmed durable constraint, both as decisions |

Each fixture file contains: `rawTranscript` (raw file content, matching a stated `sourceFormat`),
`expected.actions`/`expected.decisions` (matching the exact JSON schema the prompt requires the
model to return), and `excludedFromExtraction` — the items present in the transcript that should
**not** be extracted, each with a stated reason. That last field exists because a golden set that
only lists what should be included can't catch an over-eager extractor; listing what must be
excluded, and why, is what makes each fixture's rationale checkable rather than just descriptive.

## Extending this set

Add a new fixture whenever a real extraction failure surfaces that isn't already covered — same
JSON shape, same fields, place it in `fixtures/golden/` if it should extract cleanly (or
`fixtures/edge-case/` per below if it should extract nothing). Add it to that directory's
`index.json` manifest too.
