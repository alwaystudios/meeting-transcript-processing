# Operator guide: transcript extraction rules

This is the plain-language guide to what the extraction prompt (`src/prompt.ts`) does and doesn't
pull out of a meeting transcript, for anyone validating a prompt change or reviewing why a
particular item was or wasn't extracted.

## What counts as a concrete action (not noise)

An action needs an **owner** and a **commitment**, not just a topic. "Someone should look at the
memory leak" is a topic; "I'll fix the memory leak by Thursday" is an action. Hedged language —
"I guess I could", "no promises", "not sure I'll have time" — does not meet the bar even when a
name and a task are both present (see `fixtures/edge-case/04-hedged-non-commitment.json`).
Speculative ideas floated with no one committing to them ("maybe we could add dark mode
sometime") are noise, not actions (`fixtures/edge-case/02-speculative-not-concrete.json`).
Agenda-setting, small talk, and status-round chatter ("nothing major today") are noise regardless
of how much of the transcript they take up (`fixtures/edge-case/01-agenda-setting-only.json`).

## The quote requirement

Every extracted item must carry a `quote` — the speaker's exact words, verbatim, that a reader
could point to as evidence. If there's no sentence that directly evidences the item, the item is
dropped, even if it's clearly implied. This catches two failure modes:

- **Narration instead of dialogue**: a bracketed note like `[Priya to follow up on the invoice
  issue offline]` is not a participant speaking on the record, even though it's technically a
  substring of the transcript (`fixtures/edge-case/05-no-quotable-evidence.json`).
- **Appended summaries**: Google Meet sometimes appends an auto-generated summary block after the
  real transcript. A clean, quotable sentence in that block describing a decision that was never
  actually discussed must still be rejected — it's a summary, not evidence
  (`fixtures/edge-case/06-appended-auto-summary.json`).

## Speakers and timestamps

Include `speaker` and `timestamp` when the transcript actually has them; otherwise leave the field
empty — never guess or invent one. A single transcript can have mixed metadata (one cue with a
named speaker, the next with none, if diarization dropped mid-call); handle each item on its own
terms rather than applying one rule to the whole transcript
(`fixtures/edge-case/07-incomplete-metadata-mixed.json`).

## Durable decision vs. dismissed aside

A decision is a **durable, group-agreed choice** — something the team will still hold to later,
not just something said out loud in the moment. Two things disqualify a proposal from being a
decision:

- **No agreement reached.** A proposal that's raised and explicitly disputed or parked ("let's
  park it, we can revisit if it becomes a problem") is not a decision, however specific and
  technical it sounds (`fixtures/edge-case/03-disagreement-no-consensus.json`).
- **Explicit dismissal.** Phrases like "skip it", "just chat", "nobody asked", "do not build X
  now", "nice to have" mark something as noise even if it's a real idea someone raised in
  earnest — the group is saying "not this," which is the opposite of agreeing to it.

Conversely, a **lasting constraint** carried over or reconfirmed from before still counts as a
decision even if it's not new news in this meeting — e.g. "budget stays capped at two hires this
quarter" restated to confirm it still stands (`fixtures/golden/05-ops-hiring-review.json`).

## Examples

See `fixtures/golden/` for clean cases that should extract cleanly, and `fixtures/edge-case/` for
near-miss cases that should extract nothing (or only part of what's present). Every fixture file
documents its raw transcript, the expected output, and — for edge cases — the specific rule it
validates. Read a few before writing a new one; they're meant to double as documentation, not just
test data.

## Test dataset and evaluation harness

- `docs/golden-dataset.md` / `docs/edge-case-dataset.md` — what each fixture set is for.
- `docs/eval-harness-design.md` — how the harness checks a candidate response (deterministic
  checks vs. LLM judge, and why they're split that way).
- `docs/runbook.md` — how to actually run the harness against a prompt change.

## Troubleshooting common extraction failures

- **Partial transcripts** (meeting cut off mid-sentence, upload truncated): the model can only
  extract what's actually present. A dangling half-sentence with no resolution should not be
  extracted as either an action or a decision — treat "the transcript ended before this was
  resolved" the same as "this was never resolved."
- **Missing speaker names**: expected and correct when the source has no diarization (auto-
  captions without speaker labels, or plain-text pastes). Confirm `speaker` came back empty rather
  than guessed from context — a wrong guess is worse than an honest blank.
- **Messy VTT formatting** (stray `NOTE`/`STYLE`/`REGION` blocks, inconsistent line breaks): these
  are stripped during VTT parsing (`formatVttCues` in `src/prompt.ts`) before the prompt ever sees
  the text; if a fixture using unusual VTT formatting fails, check whether the raw cue text
  actually survived parsing before assuming the prompt itself is at fault.
- **A fixture fails and you're not sure if the prompt or the fixture is wrong**: re-read the
  fixture's `notes` field and `ruleValidated` (edge cases) — if the fixture's own expectation looks
  wrong, fix the fixture and say why in `notes`; don't quietly loosen the prompt to match a bad
  fixture.
