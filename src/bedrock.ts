import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime"

/**
 * Model IDs are deliberately not hardcoded to any specific AWS account's inference profile —
 * this repo is meant to be deployable to any account (see readme.md). Pass real model IDs via
 * CLI flags or env vars; these are placeholders only.
 */
export const DEFAULT_MODEL_UNDER_TEST = process.env.MODEL_UNDER_TEST_ID ?? "anthropic.claude-haiku-4-5-20251001-v1:0"
export const DEFAULT_JUDGE_MODEL = process.env.JUDGE_MODEL_ID ?? "anthropic.claude-sonnet-5-20251115-v1:0"

let client: BedrockRuntimeClient | null = null
function getClient(): BedrockRuntimeClient {
  if (!client) client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "eu-west-2" })
  return client
}

/** One Converse call: system prompt + a single user text block. Returns the text response. */
export async function converse(modelId: string, system: string, userText: string): Promise<string> {
  const command = new ConverseCommand({
    modelId,
    system: [{ text: system }],
    messages: [{ role: "user", content: [{ text: userText }] }],
  })
  const response = await getClient().send(command)
  const blocks = response.output?.message?.content ?? []
  const text = blocks
    .map((b) => b.text ?? "")
    .filter(Boolean)
    .join("\n")
  if (!text) throw new Error(`empty response from model ${modelId}`)
  return text
}
