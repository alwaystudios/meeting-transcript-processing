import { converse } from "./bedrock.js"
import type { ExtractResponse, JudgeVerdict } from "./types.js"

/**
 * Judge runs on a different, stronger model than the one under test to avoid same-model
 * self-preference bias (decided in docs/eval-harness-design.md). It is only asked to judge
 * classification correctness — whether each item is a genuine concrete action / durable
 * decision per the prompt's rules — not schema or quote fidelity, which are checked
 * deterministically in checks.ts and don't need a model's judgement.
 */
const JUDGE_SYSTEM_PROMPT = `You are a strict evaluator for a meeting-transcript extraction system.
You will be given: the original transcript, the extraction rules that were applied, the expected (human-validated) extraction, and a candidate extraction to evaluate.
Decide whether the candidate is an acceptable extraction: it does not need to match the expected output word-for-word, but it must not miss a genuine action/decision the expected output has, and it must not include anything the expected output omits (no over-extraction of chat, speculation, disagreement, dismissed asides, or fabricated items).
Reply with a single JSON object only: {"pass": true|false, "rationale": "<one or two sentences>"}`

export async function judgeClassification(
  judgeModelId: string,
  transcript: string,
  rules: string,
  expected: ExtractResponse,
  candidate: ExtractResponse,
): Promise<JudgeVerdict> {
  const userText = [
    "TRANSCRIPT:",
    transcript,
    "",
    "EXTRACTION RULES:",
    rules,
    "",
    "EXPECTED EXTRACTION:",
    JSON.stringify(expected, null, 2),
    "",
    "CANDIDATE EXTRACTION TO EVALUATE:",
    JSON.stringify(candidate, null, 2),
  ].join("\n")

  const responseText = await converse(judgeModelId, JUDGE_SYSTEM_PROMPT, userText)
  const start = responseText.indexOf("{")
  const end = responseText.lastIndexOf("}")
  const jsonText = start >= 0 && end > start ? responseText.slice(start, end + 1) : responseText
  try {
    const parsed = JSON.parse(jsonText) as { pass?: unknown; rationale?: unknown }
    return {
      pass: parsed.pass === true,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "(judge gave no rationale)",
    }
  } catch {
    return { pass: false, rationale: `judge response was not valid JSON: ${responseText.slice(0, 200)}` }
  }
}
