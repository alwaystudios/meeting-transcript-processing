#!/usr/bin/env node
import * as cdk from "aws-cdk-lib"
import { EvalHarnessStack } from "../lib/eval-harness-stack"

const app = new cdk.App()

new EvalHarnessStack(app, "MeetingTranscriptEvalHarness", {
  /**
   * No account/region is hardcoded here — this stack is meant to deploy into whichever AWS
   * account and region it's run against. Uses the CDK CLI's default environment resolution
   * (CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION from the active AWS credentials).
   */
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
})
