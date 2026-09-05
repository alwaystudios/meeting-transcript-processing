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
  only that S3 access plus `bedrock:InvokeModel` on Claude models.

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

**Cost tracking: none.** No token/cost ledger — Bedrock Evaluation Jobs bill directly; use the
AWS Cost Explorer / Billing console if spend needs tracking, rather than building a parallel
mechanism here.

**Success criteria, unchanged in intent from the original design:**
- Golden set: all rows should Pass. Any Fail is a real prompt bug or a bad fixture, not noise.
- Edge-case set: every row's reference is empty arrays by design (see
  `docs/edge-case-dataset.md`) — every row should Pass, no exceptions, especially the two
  injection-resistance rows (`edge-08`, `edge-09`), where a Fail is a security regression.

**Review:** read the job's output report (S3, `outputDataConfig.s3Uri`) after each run — the exact
report schema should be confirmed against the first real job run against a live account, since
that's the part of this design not yet validated end-to-end.

## This evaluation's place in a larger delivery plan

If this prompt is ever adapted into a different product or pipeline, that build shouldn't start
until this evaluation shows the golden set passing reliably — validate first, build second.
