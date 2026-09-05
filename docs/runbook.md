# Evaluation runbook

## Deploy the infrastructure

```bash
npm install
npx cdk deploy
```

No AWS account or region is hardcoded — this deploys to whichever account/region your active AWS
credentials point at. Note the four values in the `Outputs` section after deploy:
`DatasetBucketName`, `OutputBucketName`, `EvalJobRoleArn`, `PromptArn`. If you didn't capture them
at deploy time, fetch them again any time with:
```bash
aws cloudformation describe-stacks --stack-name MeetingTranscriptEvalHarness \
  --query "Stacks[0].Outputs" --output table
```

## Run an evaluation

Evaluation Jobs are not a CDK-deployed resource (Bedrock doesn't expose them as a CloudFormation
resource type) — running one is a plain AWS CLI call using the templates in `eval-jobs/`. The
templates in git keep their `<PLACEHOLDER>` tokens — don't edit them in place with real values,
since those values are account-specific (bucket names, an IAM role ARN) and this repo makes no
assumption about deployment target. Instead:

1. Copy each template to a `.local.json` file **in the same `eval-jobs/` directory** —
   `eval-jobs/*.local.json` is gitignored, so real values never risk being committed:
   ```bash
   cp eval-jobs/golden-job.json eval-jobs/golden-job.local.json
   cp eval-jobs/edge-case-job.json eval-jobs/edge-case-job.local.json
   ```
2. Get all the values you need. Three of the five placeholders come straight off the stack:
   ```bash
   aws cloudformation describe-stacks --stack-name MeetingTranscriptEvalHarness \
     --query "Stacks[0].Outputs" --output table
   ```
   The other two are Claude model IDs from the Bedrock catalog in your account/region — see
   `docs/setup.md` step 4 for the `list-foundation-models` command if you haven't already run it.
   Nothing here requires digging through the console; both commands are copy-pasteable.

   Edit the `.local.json` copies (not the originals) and replace the placeholders:
   - `<EVAL_JOB_ROLE_ARN>` → the `EvalJobRoleArn` value from the command above.
   - `<DATASET_BUCKET_NAME>` / `<OUTPUT_BUCKET_NAME>` → the corresponding values from the same
     command.
   - `<MODEL_UNDER_TEST_ID>` → whichever Claude model you've enabled Bedrock access for and want
     to test (the prompt itself is deployed already configured against the model ID passed as
     CDK context `-c modelUnderTestId=...`; this should match).
   - `<JUDGE_MODEL_ID>` → a different, stronger model than the one under test (see
     `docs/eval-harness-design.md` for why).
3. Submit each job, pointing at the `.local.json` copies:
   ```bash
   aws bedrock create-evaluation-job --cli-input-json file://eval-jobs/golden-job.local.json
   aws bedrock create-evaluation-job --cli-input-json file://eval-jobs/edge-case-job.local.json
   ```
4. Check status:
   ```bash
   aws bedrock get-evaluation-job --job-identifier <jobArn from the create response>
   ```
5. Once `status` is `Completed`, read the results from the output bucket at the `s3Uri` prefix
   you set in the job config (`results/golden/` / `results/edge-case/`).

**Not yet validated end-to-end**: the exact shape of the results Bedrock writes to that S3 prefix
hasn't been confirmed against a real run. The job submission schema above is confirmed directly
from `aws bedrock create-evaluation-job help` on this machine's AWS CLI — the input side is solid.
The first real run against a live account is what confirms the output/report format; expect to
adjust how results get read once that happens, not the job submission itself.

## What constitutes a pass

- **Golden set** (`datasets/golden.jsonl`): every row should rate `Pass`. Any `Fail` is a real bug
  in the prompt or a bad fixture, not noise.
- **Edge-case set** (`datasets/edge-case.jsonl`): every row should rate `Pass` — no exceptions, no
  borderline calls, especially rows `edge-08`/`edge-09` (prompt-injection resistance): a `Fail`
  there means the untrusted-content wrap didn't hold, which is a security regression, not a
  quality nitpick.

## Validating a prompt change

1. Edit `prompt/system-prompt.txt` and/or `prompt/user-message-template.txt`.
2. Redeploy: `npx cdk deploy` (updates the Bedrock Prompt resource in place).
3. Re-run both evaluation jobs (see above) and check the results.
4. **Golden row fails:** the prompt regressed on a case that used to work. Fix the prompt. If the
   fixture's own expectation turns out wrong, fix the fixture instead (`fixtures/golden/*.json`
   docs plus the matching `datasets/golden.jsonl` row) — but say why in its `notes` field.
5. **Edge-case row fails:** treat as blocking, always. Do not ship the prompt change until it
   passes.

## Tearing down

```bash
npx cdk destroy
```

Both S3 buckets are `RemovalPolicy.DESTROY` with `autoDeleteObjects` — this leaves nothing behind.
The Bedrock Prompt resource is destroyed with the stack. Nothing here needs manual cleanup, unlike
a stack holding real customer data.

## Feedback loop

Failing row → edit the prompt files → redeploy → re-run → repeat. If a genuinely new failure mode
shows up in real use later, add it as a new fixture (`fixtures/golden/` if it should extract
cleanly, `fixtures/edge-case/` if it should extract nothing) and its corresponding `datasets/*.jsonl`
row — the dataset is meant to grow as real failure modes are discovered, not stay frozen at
today's 14 cases.
