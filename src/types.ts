import { z } from "zod"

export const ExtractItemSchema = z.object({
  title: z.string(),
  content: z.string(),
  quote: z.string(),
  speaker: z.string().optional().default(""),
  timestamp: z.string().optional().default(""),
})
export type ExtractItem = z.infer<typeof ExtractItemSchema>

export const ExtractResponseSchema = z.object({
  actions: z.array(ExtractItemSchema),
  decisions: z.array(ExtractItemSchema),
})
export type ExtractResponse = z.infer<typeof ExtractResponseSchema>

export type Fixture = {
  id: string
  description: string
  sourceFormat: string
  rawTranscript: string
  expected: ExtractResponse
  ruleValidated?: string
  excludedFromExtraction?: Array<{ quote: string; reason: string }>
  notes?: string
}

export type FixtureSet = "golden" | "edge-case"

export type CheckResult = {
  name: string
  pass: boolean
  detail: string
}

export type JudgeVerdict = {
  pass: boolean
  rationale: string
}

export type FixtureResult = {
  id: string
  set: FixtureSet
  overallPass: boolean
  candidate: ExtractResponse | null
  checks: CheckResult[]
  judge: JudgeVerdict | null
  error?: string
}

export type EvalReport = {
  runId: string
  dryRun: boolean
  modelUnderTest: string
  judgeModel: string
  dataset: "golden" | "edge-cases" | "all"
  results: FixtureResult[]
  summary: {
    total: number
    passed: number
    failed: number
    bySet: Record<FixtureSet, { total: number; passed: number; failed: number }>
  }
}
