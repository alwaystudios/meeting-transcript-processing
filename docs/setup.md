# First-time AWS setup

This is the exact sequence to get this stack running in a fresh AWS account, including the things
that actually went wrong the first time this was done — all fixed in the policy templates below,
but worth knowing why they're there.

## 0. Use a dedicated account

Don't deploy this into an account that runs anything else — see the reasoning in
`docs/eval-harness-design.md`. A throwaway, single-purpose account makes teardown unambiguous.

## 1. Attach the bootstrap policy (one-time)

Copy `iam/bootstrap-policy.json` to `iam/bootstrap-policy.local.json` (gitignored — see
`.gitignore`; the tracked template keeps its placeholders, only the local copy holds real values),
replace every `<ACCOUNT_ID>` and `<REGION>` with your actual account ID and target region, and
attach it to whatever IAM user/role you'll deploy with (console, or
`aws iam put-user-policy --policy-document file://iam/bootstrap-policy.local.json ...`).

This is deliberately scoped to CDK's own predictable bootstrap resource names (the
`cdk-hnb659fds-*` roles, staging bucket, staging ECR repo) rather than a blanket admin grant —
but it's not guaranteed complete. If `cdk bootstrap` fails partway with `AccessDenied`, add
whatever single action the error names rather than broadening the whole policy.

## 2. Bootstrap, and confirm it actually finished

```bash
AWS_PROFILE=<your-profile> AWS_REGION=<your-region> npx cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
```

Wait for the literal line `✅ Environment aws://<ACCOUNT_ID>/<REGION> bootstrapped.` — don't treat
"the command ran" as "it succeeded." Confirm with:

```bash
aws ssm get-parameter --name /cdk-bootstrap/hnb659fds/version --region <REGION> --profile <your-profile>
```

This should return a value. **This step was skipped once already** — bootstrap was assumed done
without checking, `cdk deploy` was attempted under the steady-state policy (below), and failed
with `SSM parameter /cdk-bootstrap/hnb659fds/version not found`, because bootstrap genuinely
hadn't completed. Don't move to step 3 without this check passing.

## 3. Swap to the steady-state policy

Copy `iam/steady-state-policy.json` to `iam/steady-state-policy.local.json` the same way and
replace the placeholders. This is what stays attached long-term — `cdk deploy`/`cdk destroy` only
need `sts:AssumeRole` on 4 of the bootstrap-created roles (the CLI does the actual CloudFormation
work through the assumed `deploy-role`, not the caller's own permissions), plus direct Bedrock
permissions for actually submitting and reading evaluation jobs later.

**Attach this one as a customer-managed policy, not an inline policy** — it grew past the 2048
character inline-policy limit partway through this session (each fix below added a statement) and
will likely keep growing; a managed policy's 6144-character ceiling gives real headroom instead of
trimming statement names for space. The bootstrap policy from step 1 is small enough to stay
inline.

```bash
aws iam create-policy --policy-name meeting-transcript-eval-steady-state \
  --policy-document file://iam/steady-state-policy.local.json
# then attach the ARN it returns:
aws iam attach-user-policy --user-name <your-user> --policy-arn <arn from above>
```

If you'd already attached an earlier, smaller version as an *inline* policy and are now hitting
`Policy exceeding the 2048 characters limit can't be saved` when trying to update it — that's this
same limit; switch to the managed-policy commands above instead of trying to shrink it further, and
remove the old inline one (`aws iam delete-user-policy --user-name <your-user> --policy-name ...`)
once the managed one is attached, so you're not carrying two.

Three of this policy's statements exist because of real gaps found by actually running this, not
foresight — each is worth understanding before you assume the policy is complete:

- **`DiscoverModelCatalog`**: the first version of this policy didn't include
  `bedrock:ListFoundationModels` / `ListInferenceProfiles`, and discovering which Claude models
  were actually enabled failed with `AccessDeniedException`. These are catalog-wide read actions
  with no per-model ARN to scope to, so they need `Resource: "*"` — that's not a scoping mistake,
  there's nothing narrower to scope to.
- **`ReadStackOutputs`**: `cdk deploy` gets `cloudformation:DescribeStacks` implicitly through the
  assumed `deploy-role`, but a *plain* `aws cloudformation describe-stacks` call (which
  `docs/runbook.md` tells you to run, to fetch the stack outputs for `eval-jobs/*.local.json`)
  uses your own identity directly, not the assumed role — and failed with `AccessDenied` the first
  time this was run without this statement.
- **`CreateEvaluationJobOnModels`**: `bedrock:CreateEvaluationJob`'s resource-level check isn't
  only against the `evaluation-job` ARN being created — Bedrock also checks it against the model
  ARN(s) referenced inside the request, the same way `bedrock:InvokeModel` would. Granting the
  model ARNs to the `EvalJobRole` (the service role Bedrock assumes) wasn't enough; the caller's
  own identity needs it too, since the caller is who actually calls `CreateEvaluationJob`. Failed
  with `AccessDeniedException` naming the model's foundation-model ARN, not the evaluation-job one,
  the first time this was submitted. Its resource is also `"*"` — a scoped model ARN pattern here
  produced the same denial as above; confirmed this action doesn't respect scoped resources in
  practice, not just a syntax issue.
- **`ManageApplicationInferenceProfiles`**: needed to create your own single-region inference
  profile (step 4 below) — a real workaround for models that need *some* profile to invoke at all
  but don't need the built-in multi-region one specifically.

## 4. Enable Bedrock model access, and pick models that actually work

Console → Bedrock → **Model access** → enable candidates for a model under test and a separate,
stronger judge model (see `docs/eval-harness-design.md`). Then list what's actually enabled:

```bash
aws bedrock list-foundation-models --region <REGION> --profile <your-profile> \
  --by-provider anthropic --query "modelSummaries[].modelId" --output table
```

**Being listed here is not the same as being usable.** This step took by far the most iteration
of anything in this whole setup, because several different failure modes look similar at first
and need different fixes. In the order you're likely to hit them:

1. **The account may not be allowed to request a model at all**, regardless of what the catalog
   shows. Requesting access to Claude Opus 4.8 on a brand-new account failed with
   `anthropic.claude-opus-4-8 is not available for this account` — a hard account-tier gate, not
   an IAM or region problem. Nothing here fixes it; pick a different model.
2. **Some models can't be invoked directly at all** — only through a cross-region inference
   profile. A bare model ID fails with `on-demand throughput isn't supported for this model,
   retry with the ID or ARN of an inference profile`. Confirmed for Claude Haiku 4.5.
3. **The built-in cross-region profiles (`eu.`/`global.` prefix) need model access granted in
   every region they fan out to**, not just your home region — check with:
   ```bash
   aws bedrock get-inference-profile --inference-profile-identifier eu.anthropic.claude-X \
     --query "models[].modelArn"
   ```
   The `eu.` profile for Haiku 4.5 spans 7 regions; this account only had access in 2 of them
   (the rest failed the same account-tier-gate way as point 1) — the profile is unusable unless
   *all* underlying regions are granted, and there's no way to force which one it routes to.
4. **You can create your own single-region profile**, sidestepping the multi-region requirement
   entirely, *if* the model genuinely supports on-demand throughput in that one region:
   ```bash
   aws bedrock create-inference-profile --inference-profile-name my-profile \
     --model-source copyFrom="arn:aws:bedrock:<REGION>::foundation-model/anthropic.claude-X" \
     --region <REGION>
   ```
   This succeeded for Claude Opus 4.6 in `eu-west-2` — which also proved that model supports
   on-demand invocation directly, so the profile turned out to be unnecessary; the bare model ID
   works fine as the model under test. It failed for Haiku 4.5 in *two different regions* with
   `The provided foundation model does not support On Demand inference` — a hard model-level
   limitation (point 2's real cause), not something this workaround can route around. If you hit
   this, stop trying to fix that specific model and pick a different one.
5. **The judge model field has a stricter format than the model-under-test field.** The generator
   model (`inferenceConfig.models[].bedrockModel.modelIdentifier`) accepts a custom
   `application-inference-profile` ARN from point 4; the evaluator/judge model
   (`customMetricConfig.evaluatorModelConfig.bedrockEvaluatorModels[].modelIdentifier`) does
   **not** — only a bare foundation-model ID or a system-defined `inference-profile` ID. So your
   judge model specifically must support on-demand invocation directly (or via the built-in
   cross-region profile) — you can't paper over a judge model's on-demand limitation with a
   custom profile the way you sometimes can for the generator model.
6. **Even a model that's enabled and invokable may have a default account throughput quota too
   low to run a job at all.** A 5-row golden job failed with `Encountered throttling exception
   while serving the request for model ...` — confirmed genuinely account-level, not a config or
   concurrency issue, by retrying the identical job alone (no other job running) and getting the
   exact same failure. Fresh AWS accounts commonly start with minimal default Bedrock throughput
   quotas before usage history builds up. **The fix is a Service Quotas increase request, not
   anything in this repo or IAM policy**: console → **Service Quotas** → search **Amazon Bedrock**
   → find the on-demand requests-per-minute (or tokens-per-minute) quota for your chosen model →
   request an increase. This is the one failure mode in this whole setup that can't be resolved by
   changing code, IAM, or job config — only by AWS raising the account's own limit.

**Practical upshot: don't fight cross-region profiles if you don't have to.** The fastest path to
a working setup is testing candidate models with a plain bare model ID first (older, more
established models — e.g. Claude 3.7 Sonnet, Claude Opus 4.6 — are far more likely to support
on-demand invocation directly than the newest release). Only reach for inference profiles once
you've confirmed a model genuinely requires one, and even then, check regional model access is
actually consistent before assuming the built-in cross-region profile will work.

## 5. Deploy

```bash
AWS_PROFILE=<your-profile> AWS_REGION=<your-region> npx cdk deploy \
  -c modelUnderTestId=<the model ID from step 4>
```

If you omit `-c modelUnderTestId=...`, it deploys with a placeholder string that fails
CloudFormation template validation (a warning, not a hard failure — but fix it before relying on
the deployed Prompt resource).

Note the four `Outputs` values: `DatasetBucketName`, `OutputBucketName`, `EvalJobRoleArn`,
`PromptArn`.

## 6. Run an evaluation

See `docs/runbook.md` — fill in `eval-jobs/*.json` with the stack outputs plus your chosen
model-under-test and judge model IDs, then submit via `aws bedrock create-evaluation-job`.

## Tearing down

```bash
npx cdk destroy
```

Everything in the stack is destroy-on-delete. The bootstrap resources (`CDKToolkit` stack,
staging bucket, ECR repo, the 5 `cdk-hnb659fds-*` roles) aren't part of this stack and survive
`cdk destroy` — that's expected; they're CDK's own scaffolding, not this project's resources. Only
remove them (`cdk bootstrap` has no clean "un-bootstrap" command; it's a manual CloudFormation
stack delete of `CDKToolkit`) if you're decommissioning the account entirely.
