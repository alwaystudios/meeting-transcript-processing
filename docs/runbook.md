# Evaluation harness runbook

## When and how the harness runs

- **On-demand**, any time `src/prompt.ts` (the prompt under test) changes. This is the primary
  use case right now — there's no CI or deployed n8n router yet.
- **Before any prompt change ships** to wherever it's actually used (the eventual n8n router),
  this harness is the gate, not a suggestion. Nothing here auto-deploys anything.
- **As a CI check**, once the dedicated eval AWS account has deploy keys set up: add a workflow
  step running `npm ci && npm run eval -- --dataset=all`, gated on credentials scoped to that
  account. The harness already exits non-zero on any failure, so a CI step just needs to fail
  the build on that exit code — no extra wiring needed on the harness side.

## Who owns success

**Gary Alway** — sole owner of this project currently (settled in `docs/eval-harness-design.md`).
"Prompt owner" and "n8n team" aren't yet separate roles because there's no n8n implementation and
no second person on this work yet; this section should be revisited once either changes.

## What constitutes a pass

- **Golden set** (`fixtures/golden/`): every fixture must pass — schema, quote-fidelity, and the
  judge's classification-correctness verdict. `docs/eval-harness-design.md` sets a ≥95% target,
  which in practice means "all of them" until the set is large enough for that threshold to
  differ from 100%.
- **Edge-case set** (`fixtures/edge-case/`): the empty-expected check must pass 100% — no
  exceptions, no borderline calls. This is strictest for the two injection-resistance fixtures
  (`edge-08`, `edge-09`): a failure there means the untrusted-content wrap didn't hold, which is a
  security regression, not a quality nitpick, and blocks shipping the change outright.

## Runbook: validating a prompt change (no specialist knowledge required)

1. Edit `src/prompt.ts`.
2. Run `npm run eval -- --dataset=all --verbose` (needs AWS credentials for the eval account —
   `AWS_PROFILE=<eval-account-profile>` or equivalent env vars; region defaults to `eu-west-2`,
   override with `AWS_REGION`).
3. Read the printed pass count, and the ❌ lines for anything that failed — each names the exact
   check (`schema`, `quote-fidelity`, `empty-expected`, or `judge`) and why.
4. **Golden fixture failed:** the prompt regressed on a case that used to work. Fix the prompt.
   If the fixture's own expectation turns out to be wrong, fix the fixture instead — but say why
   in its `notes` field, don't silently loosen it.
5. **Edge-case fixture failed:** treat as blocking, always — especially `edge-08`/`edge-09`. Do
   not ship the prompt change until it passes.
6. Full JSON + Markdown reports land in `reports/<run-id>.{json,md}` (gitignored — these are run
   artifacts, not source).

Before real AWS credentials exist, `npm run eval:dry-run` smoke-tests the harness plumbing itself
(fixture loading → checks → report) using each fixture's own expected output as a stand-in
candidate — it does not validate the prompt and always passes trivially; it only proves the
harness runs.

## Feedback loop

Failing case → fix `src/prompt.ts` → rerun → repeat. If a genuinely new failure mode shows up in
production use later, add it as a new fixture (golden if it should extract cleanly, edge-case if
it should extract nothing) rather than only fixing the prompt — the dataset is meant to grow as
real failure modes are discovered, not stay frozen at today's 14 fixtures.

Per `docs/eval-harness-design.md`, Gary also samples judge rationale on golden-set passes
periodically (not just failures) to catch judge drift before it hides a real regression.
