import * as fs from "node:fs"
import * as path from "node:path"
import * as cdk from "aws-cdk-lib"
import * as bedrock from "aws-cdk-lib/aws-bedrock"
import * as iam from "aws-cdk-lib/aws-iam"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment"
import type { Construct } from "constructs"

/**
 * Infrastructure only — no application/checking logic lives here. It provisions:
 *  - a Bedrock Prompt resource (Prompt Management) holding the extraction prompt as data,
 *    read verbatim from prompt/system-prompt.txt and prompt/user-message-template.txt,
 *  - S3 buckets for the evaluation dataset and evaluation job output (both destroy-on-delete —
 *    nothing here holds real data that needs retaining),
 *  - the IAM service role Bedrock Evaluation Jobs assume to read the dataset and write results.
 *
 * Evaluation Jobs themselves are not a CloudFormation resource (no CfnEvaluationJob exists in
 * aws-cdk-lib as of writing — confirmed by inspecting the installed aws-cdk-lib/aws-bedrock
 * module, which has CfnPrompt/CfnPromptVersion but nothing for evaluation jobs). Running an
 * evaluation is therefore a plain `aws bedrock create-evaluation-job` CLI call against the
 * outputs this stack produces — see docs/runbook.md and eval-jobs/*.json.
 */
export class EvalHarnessStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const modelUnderTestId = this.node.tryGetContext("modelUnderTestId") ?? "REPLACE_WITH_ENABLED_MODEL_ID"

    const datasetBucket = new s3.Bucket(this, "DatasetBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    })

    const outputBucket = new s3.Bucket(this, "OutputBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    })

    new s3deploy.BucketDeployment(this, "DeployDatasets", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "..", "datasets"))],
      destinationBucket: datasetBucket,
      destinationKeyPrefix: "datasets",
      prune: true,
    })

    const evalJobRole = new iam.Role(this, "EvalJobRole", {
      assumedBy: new iam.ServicePrincipal("bedrock.amazonaws.com", {
        conditions: {
          StringEquals: { "aws:SourceAccount": cdk.Aws.ACCOUNT_ID },
          ArnLike: { "aws:SourceArn": `arn:aws:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:evaluation-job/*` },
        },
      }),
      description: "Assumed by Bedrock Evaluation Jobs to read the dataset and write results for this project only.",
    })
    datasetBucket.grantRead(evalJobRole)
    outputBucket.grantWrite(evalJobRole)
    evalJobRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "InvokeClaudeModelsForEval",
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: [
          `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/anthropic.claude-*`,
          `arn:aws:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:inference-profile/*.anthropic.claude-*`,
        ],
      }),
    )

    const systemPromptText = fs.readFileSync(path.join(__dirname, "..", "prompt", "system-prompt.txt"), "utf-8")
    const userMessageTemplate = fs.readFileSync(
      path.join(__dirname, "..", "prompt", "user-message-template.txt"),
      "utf-8",
    )

    const prompt = new bedrock.CfnPrompt(this, "TranscriptExtractPrompt", {
      name: "transcript-extraction",
      description: "Extracts meeting actions and decisions from a transcript. See prompt/*.txt for the source text.",
      defaultVariant: "default",
      variants: [
        {
          name: "default",
          templateType: "CHAT",
          modelId: modelUnderTestId,
          templateConfiguration: {
            chat: {
              system: [{ text: systemPromptText }],
              messages: [{ role: "user", content: [{ text: userMessageTemplate }] }],
              inputVariables: [{ name: "transcript" }],
            },
          },
          inferenceConfiguration: {
            text: { temperature: 0, maxTokens: 2000 },
          },
        },
      ],
    })

    new cdk.CfnOutput(this, "DatasetBucketName", { value: datasetBucket.bucketName })
    new cdk.CfnOutput(this, "OutputBucketName", { value: outputBucket.bucketName })
    new cdk.CfnOutput(this, "EvalJobRoleArn", { value: evalJobRole.roleArn })
    new cdk.CfnOutput(this, "PromptArn", { value: prompt.promptRef.promptArn })
  }
}
