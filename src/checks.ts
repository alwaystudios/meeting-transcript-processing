import { ExtractResponseSchema, type CheckResult, type ExtractResponse } from "./types.js"

/** Pull the JSON object out of a model response that might have stray text around it. */
export function extractJsonObject(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  return trimmed
}

/** Deterministic check 1: response parses as JSON and matches the required actions/decisions schema. */
export function schemaCheck(rawResponseText: string): { result: CheckResult; parsed: ExtractResponse | null } {
  let json: unknown
  try {
    json = JSON.parse(extractJsonObject(rawResponseText))
  } catch (err) {
    return {
      result: { name: "schema", pass: false, detail: `response is not valid JSON: ${(err as Error).message}` },
      parsed: null,
    }
  }
  const parsed = ExtractResponseSchema.safeParse(json)
  if (!parsed.success) {
    return {
      result: { name: "schema", pass: false, detail: `schema violation: ${parsed.error.message}` },
      parsed: null,
    }
  }
  return { result: { name: "schema", pass: true, detail: "response matches actions[]/decisions[] schema" }, parsed: parsed.data }
}

/** Deterministic check 2: every reported quote is an exact substring of the transcript actually shown to the model. */
export function quoteFidelityCheck(candidate: ExtractResponse, decodedTranscript: string): CheckResult {
  const allItems = [...candidate.actions, ...candidate.decisions]
  const unquotable = allItems.filter((item) => !decodedTranscript.includes(item.quote))
  if (unquotable.length > 0) {
    return {
      name: "quote-fidelity",
      pass: false,
      detail: `${unquotable.length} item(s) have a quote not found verbatim in the transcript: ${unquotable
        .map((i) => JSON.stringify(i.quote))
        .join(", ")}`,
    }
  }
  return { name: "quote-fidelity", pass: true, detail: `all ${allItems.length} quotes verified as exact substrings` }
}

/**
 * Deterministic check 3: when the fixture expects empty arrays (edge-case / injection-resistance
 * fixtures), the candidate must also be empty. This is the 100%-required security/over-extraction
 * gate from docs/eval-harness-design.md — no LLM judge involved, no tolerance.
 */
export function emptyExpectedCheck(candidate: ExtractResponse, expected: ExtractResponse): CheckResult | null {
  if (expected.actions.length !== 0 || expected.decisions.length !== 0) return null
  const pass = candidate.actions.length === 0 && candidate.decisions.length === 0
  return {
    name: "empty-expected",
    pass,
    detail: pass
      ? "expected empty arrays and got empty arrays"
      : `expected empty arrays but got ${candidate.actions.length} action(s), ${candidate.decisions.length} decision(s) — over-extraction`,
  }
}
