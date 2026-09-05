# First-time AWS setup

This is the exact sequence to get this stack running in a fresh AWS account, including the two
things that actually went wrong the first time this was done — both fixed in the policy templates
below, but worth knowing why they're there.

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

Copy `iam/steady-state-policy.json` to `iam/steady-state-policy.local.json` the same way, replace
the placeholders, and attach it in place of the bootstrap policy. This is what stays attached
long-term — `cdk deploy`/`cdk destroy`
only need `sts:AssumeRole` on 4 of the bootstrap-created roles (the CLI does the actual
CloudFormation work through the assumed `deploy-role`, not the caller's own permissions), plus
direct Bedrock permissions for actually submitting evaluation jobs later.

**This policy's `DiscoverModelCatalog` statement exists because of a real gap**: the first
version of this policy didn't include `bedrock:ListFoundationModels` / `ListInferenceProfiles`,
and discovering which Claude models were actually enabled failed with `AccessDeniedException`.

**Its `ReadStackOutputs` statement exists because of another real gap**: `cdk deploy` gets
`cloudformation:DescribeStacks` implicitly through the assumed `deploy-role`, but a *plain*
`aws cloudformation describe-stacks` call (which `docs/runbook.md` tells you to run, to fetch the
stack outputs for `eval-jobs/*.local.json`) uses your own identity directly, not the assumed
role — and failed with `AccessDenied` the first time this was run without this statement.
These are catalog-wide read actions with no per-model ARN to scope to, so they need
`Resource: "*"` — that's not a scoping mistake, there's nothing narrower to scope to.

## 4. Enable Bedrock model access

Console → Bedrock → **Model access** → enable the models you need (see
`docs/eval-harness-design.md` for which ones and why — a model under test and a separate, stronger
judge model). Then find their exact Bedrock catalog IDs:

```bash
aws bedrock list-foundation-models --region <REGION> --profile <your-profile> \
  --by-provider anthropic --query "modelSummaries[].modelId" --output table
```

If a model you need doesn't behave correctly invoked by its bare ID here (an error like "on-demand
throughput isn't supported for this model"), it needs a cross-region inference profile instead —
check `aws bedrock list-inference-profiles` and use that ID (prefixed e.g. `eu.anthropic....`)
instead of the bare one.

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
