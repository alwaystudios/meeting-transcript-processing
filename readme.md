# Meeting Transcript Extraction Eval Harness

A Bedrock LLM-as-judge evaluation harness for a prompt that extracts meeting actions and
decisions from Google Meet transcripts. It validates the prompt against a golden dataset (clean
cases) and an adversarial edge-case dataset (over-extraction traps and prompt-injection
resistance), and produces a structured pass/fail report.

## What's here

- `src/prompt.ts` — the extraction prompt under test, plus the WebVTT decoding and
  untrusted-content wrap it depends on. Self-contained: change the prompt here, nothing else
  needs updating for that.
- `src/run-eval.ts` — the CLI entrypoint. See `docs/runbook.md` for how to use it.
- `src/checks.ts`, `src/judge.ts`, `src/bedrock.ts`, `src/report.ts` — the harness internals:
  deterministic checks, the Bedrock LLM judge, the Bedrock client, and report generation.
- `fixtures/golden/` — clean-case transcripts with manually validated expected extractions.
- `fixtures/edge-case/` — adversarial transcripts (over-extraction traps, injection attempts) that
  should extract nothing, or only part of what's present.
- `docs/operator-guide.md` — plain-language guide to the extraction rules, for anyone reviewing
  why an item was or wasn't extracted.
- `docs/eval-harness-design.md` — the harness's design: what it checks, deterministic vs. judged,
  success criteria, and the decisions behind them (judge model choice, review process).
- `docs/golden-dataset.md` / `docs/edge-case-dataset.md` — what each fixture set covers.
- `docs/runbook.md` — when and how to run the harness, what constitutes a pass, the feedback loop.

## Quick start

```bash
npm install

# Smoke-test the harness itself, no AWS credentials needed (uses each fixture's own
# expected output as a stand-in candidate — does not validate the prompt):
npm run eval:dry-run -- --verbose

# Real run against Bedrock (needs AWS credentials with Bedrock invoke access):
npm run eval -- --dataset=all --verbose
```

Flags: `--dataset=golden|edge-cases|all` (default `all`), `--dry-run`, `--verbose`,
`--model-under-test=<bedrock-model-id>`, `--judge-model=<bedrock-model-id>`,
`--out-dir=<path>` (default `reports/`). Model IDs default to placeholders and are meant to be
overridden via flags or the `MODEL_UNDER_TEST_ID` / `JUDGE_MODEL_ID` env vars for whichever
account and region this is deployed to (`AWS_REGION`, default `eu-west-2`).

Reports are written as JSON + Markdown to `reports/<run-id>.{json,md}` (gitignored — these are run
artifacts, not source).

## Testing the harness itself

```bash
npm test        # unit tests for the deterministic checks (src/checks.test.ts)
npm run typecheck
```

## Deploying this

This repo has no infrastructure-as-code checked in and makes no assumption about which AWS
account or region it runs against — point it at whichever account has Bedrock model access
enabled, via standard AWS credential resolution (`AWS_PROFILE`, `AWS_REGION`, or equivalent).
