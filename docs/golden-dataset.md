# Golden test dataset

## Two forms, one source of truth

- **`fixtures/golden/*.json`** — human-readable documentation. Raw transcript, expected
  extraction, and (for every excluded item) the reason it shouldn't be extracted. Read these to
  understand what the prompt should do.
- **`datasets/golden.jsonl`** — the machine-consumable form of the same five cases, one row per
  fixture, each row a `{"prompt": "...", "referenceResponse": "...", "category": "golden",
  "fixtureId": "..."}` object — the schema Bedrock's automated evaluation jobs require for a
  custom prompt dataset. `prompt` is the fully-rendered system prompt plus the wrapped, decoded
  transcript (the same decoding a real WebVTT transcript goes through — see
  `prompt/system-prompt.txt` / `prompt/user-message-template.txt`); `referenceResponse` is the
  expected JSON extraction. This is what the evaluation job actually reads from S3.

If you add or change a fixture, update both files — there's no code linking them, so keeping them
in sync is manual.

## Why synthetic, and why this shape

Fixtures are synthetic transcripts, not real meeting content — a real transcript contains real
people's names and conversations, which raises a consent question that fixture data checked into
a repo shouldn't carry. Instead, they're shaped to match the real Google Meet transcript format:
delivered as WebVTT, where each cue carries a timestamp and an optional `<v Name>...</v>` voice
tag for speaker attribution — absence of that tag means no speaker signal at all.

## Fixtures

| File | Category | What it tests |
|---|---|---|
| `01-sprint-planning.json` | Normal | Clear actions + an explicit durable decision, named speakers, full timestamps |
| `02-no-timestamps.json` | Edge case | No timestamp signal at all (plain text) — timestamp must be omitted/empty, not invented |
| `03-unnamed-speakers.json` | Edge case | VTT with no `<v Name>` tags — speaker must be omitted/empty, not guessed |
| `04-all-noise.json` | Edge case | Entire transcript is dismissed asides — both arrays must be empty |
| `05-ops-hiring-review.json` | Normal (different domain) | Plan reversal + a reconfirmed durable constraint, both as decisions |

Each fixture file contains `rawTranscript`, `expected.actions`/`expected.decisions`, and
`excludedFromExtraction` — the items present in the transcript that should **not** be extracted,
each with a stated reason. That last field exists because a golden set that only lists what
should be included can't catch an over-eager extractor.

## Extending this set

Add a new fixture (both the `fixtures/golden/*.json` doc and the corresponding `datasets/golden.jsonl`
row) whenever a real extraction failure surfaces that isn't already covered, or `fixtures/edge-case/`
per `docs/edge-case-dataset.md` if it should extract nothing.
