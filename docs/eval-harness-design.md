# Evaluation design

## Architecture: Bedrock-native, not a bespoke app

This evaluates the transcript extraction prompt using Amazon Bedrock's own Prompt Management and
Evaluation Jobs — not a custom script. CDK (`lib/eval-harness-stack.ts`) provisions only the
supporting infrastructure:

- A Bedrock `CfnPrompt` resource holding the extraction prompt, read verbatim from
  `prompt/system-prompt.txt` and `prompt/user-message-template.txt`.
- Two S3 buckets: one for the evaluation datasets (`datasets/*.jsonl`, deployed via
  `BucketDeployment`), one for evaluation job output. Both `RemovalPolicy.DESTROY` with
  `autoDeleteObjects` — nothing here holds data worth retaining.
- An IAM role Bedrock Evaluation Jobs assume to read the dataset and write results, scoped to
  only that S3 access plus `bedrock:InvokeModel` (`Resource: "*"` — a scoped model ARN here
  produced "does not have permission to call the model" from Bedrock's own job validation,
  confirmed by testing, not a syntax issue; see `docs/setup.md`).

Evaluation Jobs themselves are **not** a CloudFormation resource — confirmed by inspecting the
installed `aws-cdk-lib/aws-bedrock` module, which has `CfnPrompt`/`CfnPromptVersion` but nothing
for evaluation jobs. Running an evaluation is a single `aws bedrock create-evaluation-job` CLI
call using the config templates in `eval-jobs/*.json` — see `docs/runbook.md`. There is no
application code in this repo; the only code is the CDK stack itself.

## What this evaluates, and how

Four properties, but unlike a hand-rolled harness, all of them now run through Bedrock's
**custom metric** mechanism (`eval-jobs/*.json`, `customMetricConfig`) — a judge model (see below)
rates each row Pass/Fail against instructions that cover all four at once:

1. Schema/shape conformance (the response must match the required `actions[]`/`decisions[]` JSON).
2. Quote fidelity (every `quote` must be verbatim in the transcript).
3. Classification correctness (concrete actions and durable decisions only; dismissed asides and
   speculative/hedged/disputed items excluded; no invented items).
4. Injection resistance (transcript content impersonating instructions must not change output).

**Trade-off worth being explicit about:** a hand-rolled harness could check #1 and #2
deterministically in code — a quote is either an exact substring or it isn't, no judgement
required. Here, without bespoke code, everything is judged by an LLM against written instructions
(`eval-jobs/*.json` → `customMetricDefinition.instructions`), including the things that used to be
code-guaranteed. That's the direct cost of zero bespoke code: the judge could occasionally
mis-rate something a deterministic check never would have gotten wrong. Sample job results
periodically rather than trusting the aggregate pass rate blindly, especially early on.

**A real constraint hit while wiring this up, not documented in the CLI help text**: each
`ratingScale[].definition` string has a hard 100-character limit, enforced server-side
(`ValidationException`, not visible from `aws bedrock create-evaluation-job help`). The `Pass`/
`Fail` definitions in `eval-jobs/golden-job.json` are deliberately terse for this reason — if you
rewrite them, keep them under 100 characters, and check the actual API response if you're unsure
rather than trusting the CLI help text as the complete schema.

## Datasets

`datasets/golden.jsonl` and `datasets/edge-case.jsonl` — one row per fixture, each row containing
the fully-rendered prompt (system + wrapped transcript) as `prompt` and the expected extraction as
`referenceResponse`, per the schema Bedrock's automated evaluation jobs require for a custom
prompt dataset (`aws bedrock create-evaluation-job help`). These are generated from the same
content as the human-readable fixtures in `fixtures/golden/` and `fixtures/edge-case/` (see
`docs/golden-dataset.md` / `docs/edge-case-dataset.md`) — the fixtures are the documentation, the
JSONL files are what the evaluation job actually reads.

## Decisions

**Judge model: a separate, stronger model than the one under test** (`<JUDGE_MODEL_ID>` in
`eval-jobs/*.json`, wired to `customMetricConfig.evaluatorModelConfig.bedrockEvaluatorModels`) —
deliberately different from the model under test to avoid same-model self-preference bias.

Which exact model that ends up being is account-specific, not a single fixed answer — three
independent constraints narrow it down, and all three need checking empirically, not assumed from
a catalog listing (see `docs/setup.md` step 4 for the full account-tier / regional-access story):

1. Bedrock restricts which models are usable as a custom-metrics judge at all (a separate, shorter
   allowlist than the general model catalog — confirmed against AWS's own docs). As of writing,
   `anthropic.claude-sonnet-5` and `anthropic.claude-opus-5` are not on it — recheck the "Supported
   evaluator models (custom metrics)" list in AWS's model evaluation docs before assuming a newer
   model works.
2. The account may not be allowed to request every model the allowlist names — Claude Opus 4.8
   failed with "not available for this account" (a hard account-tier gate, unrelated to IAM/region).
3. The evaluator-model field only accepts a bare foundation-model ID or a system-defined
   cross-region `inference-profile` ID — **not** a custom `application-inference-profile` ARN
   (stricter than the model-under-test field). So the judge model must support on-demand
   invocation directly; you can't work around that limitation with your own pinned profile the
   way you sometimes can for the model under test.

On this account, that worked out to **Claude Opus 4.6** (bare `anthropic.claude-opus-4-6-v1`, no
inference profile needed at all) — confirmed by testing, not assumed to generalize to every
account. Re-derive this for a new account rather than hardcoding the same model ID.

**The model under test needs the same empirical check, for a different reason**: Claude Haiku 4.5
(the original choice) turned out to have no on-demand invocation path at all in this account —
confirmed by testing two different single-region pinned profiles, both rejected with "does not
support On Demand inference." This account ended up using **Claude 3.7 Sonnet**
(`anthropic.claude-3-7-sonnet-20250219-v1:0`) instead — an older, more established model, which
turned out to matter: newer releases are more likely to require cross-region-only invocation.

**Cost tracking: none.** No token/cost ledger — Bedrock Evaluation Jobs bill directly; use the
AWS Cost Explorer / Billing console if spend needs tracking, rather than building a parallel
mechanism here.

**Success criteria, unchanged in intent from the original design:**
- Golden set: all rows should Pass. Any Fail is a real prompt bug or a bad fixture, not noise.
- Edge-case set: every row's reference is empty arrays by design (see
  `docs/edge-case-dataset.md`) — every row should Pass, no exceptions, especially the two
  injection-resistance rows (`edge-08`, `edge-09`), where a Fail is a security regression.

**Review:** read the job's output report (S3, `outputDataConfig.s3Uri`) after each run — confirmed
against a real completed run (5/5 Pass on the golden set, Claude Sonnet 4.6 under test, Claude
Opus 4.6 as judge), not assumed. Per-row results live in a `..._output.jsonl` file, one JSON
object per row, with the judge's full explanation alongside each `Pass`/`Fail` — see
`docs/runbook.md` for the exact path and schema.

## This evaluation's place in a larger delivery plan

If this prompt is ever adapted into a different product or pipeline, that build shouldn't start
until this evaluation shows the golden set passing reliably — validate first, build second.
