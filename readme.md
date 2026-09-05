# Meeting Transcript Extraction Eval

CDK infrastructure for evaluating a prompt that extracts meeting actions and decisions from
Google Meet transcripts, using Amazon Bedrock's native Prompt Management and Evaluation Jobs.
No evaluation logic is reimplemented here — the CDK stack is the only code needed to deploy and
run this; the prompt and datasets are plain data files, and running an evaluation is a single AWS
CLI call. The one deliberate exception is `scripts/build-eval-report.py`, a report generator for
results Bedrock already produced — it doesn't touch the evaluation itself.

## What's here

- `prompt/system-prompt.txt`, `prompt/user-message-template.txt` — the extraction prompt, as
  plain text. Edit these to change prompt behavior, then re-render `datasets/*.jsonl` before
  redeploying — evaluation jobs send each row's `prompt` field to the model; they do not invoke
  the Bedrock Prompt resource. See `docs/runbook.md`.
- `lib/eval-harness-stack.ts`, `bin/app.ts` — the CDK stack: a Bedrock Prompt resource built from
  the files above, two S3 buckets (dataset + output, both destroy-on-delete), and the IAM role
  Bedrock Evaluation Jobs assume.
- `datasets/golden.jsonl`, `datasets/edge-case.jsonl` — the evaluation datasets, in the JSONL
  schema Bedrock's automated evaluation jobs require.
- `fixtures/golden/`, `fixtures/edge-case/` — the same 14 cases as human-readable documentation
  (raw transcript, expected extraction, the rule each one validates).
- `eval-jobs/golden-job.json`, `eval-jobs/edge-case-job.json` — `create-evaluation-job` CLI input
  templates (need the placeholder values filled in after deploy — see `docs/runbook.md`).
- `iam/bootstrap-policy.json`, `iam/steady-state-policy.json` — the two IAM policy templates a new
  deploying account needs (placeholders for account ID/region) — see `docs/setup.md`.
- `docs/setup.md` — **first-time setup, start here on a brand-new account**: IAM policies, CDK
  bootstrap, enabling Bedrock model access, picking model IDs that actually work, first deploy —
  including everything that actually went wrong the first time this was done.
- `docs/operator-guide.md` — plain-language guide to the extraction rules.
- `docs/eval-harness-design.md` — what's evaluated, the custom-metric design, and the trade-off of
  zero bespoke code (no deterministic checks — everything is judged by an LLM against written
  instructions).
- `docs/golden-dataset.md` / `docs/edge-case-dataset.md` — what each dataset covers.
- `docs/runbook.md` — deploy, run an evaluation, read results, tear down.
- `scripts/build-eval-report.py` — turns one or more completed job ARNs into a readable HTML
  report (transcript, response, judge reasoning per fixture, with a version-comparison view across
  multiple runs). Plain Python 3 + the AWS CLI, no other dependencies. Output is gitignored.

## Quick start

**First time in a given AWS account: read `docs/setup.md` first** — it covers the IAM policies and
CDK bootstrap this needs before `cdk deploy` will work.

```bash
npm install
npx cdk deploy -c modelUnderTestId=<your enabled Bedrock model ID>
```

Then see `docs/runbook.md` for filling in `eval-jobs/*.json` and submitting an evaluation via
`aws bedrock create-evaluation-job`.

## Deploying this

No AWS account, region, or model ID is hardcoded — point it at whichever account has Bedrock
model access enabled for the Claude models you want to use, via standard AWS credential
resolution. Model IDs are passed as CDK context (`-c modelUnderTestId=...`). See `docs/setup.md`
for the full first-time sequence, including IAM.

## Tearing down

```bash
npx cdk destroy
```

Every resource here is destroy-on-delete — there's nothing to clean up by hand afterward.
