#!/usr/bin/env node
/**
 * Evaluation harness CLI. Runs the transcript extraction prompt (src/prompt.ts) against
 * the golden and edge-case fixture sets and produces a structured pass/fail report.
 *
 * Usage:
 *   pnpm eval -- --dataset=all --verbose
 *   pnpm eval -- --dataset=golden
 *   pnpm eval:dry-run                 # no Bedrock calls; smoke-tests the harness itself
 *
 * Flags:
 *   --dataset=golden|edge-cases|all   (default: all)
 *   --dry-run                         skip real Bedrock calls; use each fixture's own expected
 *                                      output as the candidate, to prove the harness plumbing
 *                                      (fixture loading -> checks -> report) works without
 *                                      AWS credentials. Does not validate the prompt itself.
 *   --verbose                         print per-fixture results to the console as they run
 *   --model-under-test=<bedrock-id>   override MODEL_UNDER_TEST_ID
 *   --judge-model=<bedrock-id>        override JUDGE_MODEL_ID
 *   --out-dir=<path>                  default "reports"
 */
import { decodeRawTranscript, TRANSCRIPT_EXTRACT_SYSTEM_PROMPT, wrapUntrustedContent } from "./prompt.js"
import { loadFixtures } from "./fixtures.js"
import { schemaCheck, quoteFidelityCheck, emptyExpectedCheck } from "./checks.js"
import { converse, DEFAULT_MODEL_UNDER_TEST, DEFAULT_JUDGE_MODEL } from "./bedrock.js"
import { judgeClassification } from "./judge.js"
import { buildSummary, writeReports } from "./report.js"
import type { EvalReport, ExtractResponse, FixtureResult } from "./types.js"

const RULES_SUMMARY_FOR_JUDGE = TRANSCRIPT_EXTRACT_SYSTEM_PROMPT.split("Rules:\n")[1]?.split(`\n- \${UNTRUSTED`)[0] ?? TRANSCRIPT_EXTRACT_SYSTEM_PROMPT

type Flags = {
  dataset: "golden" | "edge-cases" | "all"
  dryRun: boolean
  verbose: boolean
  modelUnderTest: string
  judgeModel: string
  outDir: string
}

function parseFlags(argv: string[]): Flags {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=")
  const has = (name: string) => argv.includes(`--${name}`)
  const dataset = (get("dataset") ?? "all") as Flags["dataset"]
  if (!["golden", "edge-cases", "all"].includes(dataset)) {
    throw new Error(`invalid --dataset value: ${dataset} (expected golden|edge-cases|all)`)
  }
  return {
    dataset,
    dryRun: has("dry-run"),
    verbose: has("verbose"),
    modelUnderTest: get("model-under-test") ?? DEFAULT_MODEL_UNDER_TEST,
    judgeModel: get("judge-model") ?? DEFAULT_JUDGE_MODEL,
    outDir: get("out-dir") ?? "reports",
  }
}

async function runOne(
  set: "golden" | "edge-case",
  fixture: Awaited<ReturnType<typeof loadFixtures>>[number]["fixture"],
  flags: Flags,
): Promise<FixtureResult> {
  const checks: FixtureResult["checks"] = []
  let candidate: ExtractResponse | null = null
  let judge: FixtureResult["judge"] = null

  try {
    const decodedTranscript = decodeRawTranscript(fixture.sourceFormat, fixture.rawTranscript)

    let responseText: string
    if (flags.dryRun) {
      responseText = JSON.stringify(fixture.expected)
    } else {
      responseText = await converse(
        flags.modelUnderTest,
        TRANSCRIPT_EXTRACT_SYSTEM_PROMPT,
        wrapUntrustedContent(decodedTranscript),
      )
    }

    const { result: schemaResult, parsed } = schemaCheck(responseText)
    checks.push(schemaResult)
    if (!parsed) return { id: fixture.id, set, overallPass: false, candidate: null, checks, judge: null }
    candidate = parsed

    checks.push(quoteFidelityCheck(candidate, decodedTranscript))

    const emptyCheck = emptyExpectedCheck(candidate, fixture.expected)
    if (emptyCheck) checks.push(emptyCheck)

    if (!flags.dryRun && (fixture.expected.actions.length > 0 || fixture.expected.decisions.length > 0)) {
      judge = await judgeClassification(flags.judgeModel, decodedTranscript, RULES_SUMMARY_FOR_JUDGE, fixture.expected, candidate)
    }

    const overallPass = checks.every((c) => c.pass) && (judge ? judge.pass : true)
    return { id: fixture.id, set, overallPass, candidate, checks, judge }
  } catch (err) {
    return {
      id: fixture.id,
      set,
      overallPass: false,
      candidate,
      checks,
      judge,
      error: (err as Error).message,
    }
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))
  const fixtures = loadFixtures(process.cwd(), flags.dataset)
  if (fixtures.length === 0) {
    console.error(`No fixtures found for --dataset=${flags.dataset}. Run this from the repo root.`)
    process.exit(1)
  }

  const results: FixtureResult[] = []
  for (const { set, fixture } of fixtures) {
    const result = await runOne(set, fixture, flags)
    results.push(result)
    if (flags.verbose) {
      console.log(`${result.overallPass ? "PASS" : "FAIL"}  ${result.id}`)
      for (const c of result.checks) if (!c.pass) console.log(`  - ${c.name}: ${c.detail}`)
      if (result.judge && !result.judge.pass) console.log(`  - judge: ${result.judge.rationale}`)
      if (result.error) console.log(`  - error: ${result.error}`)
    }
  }

  const report: EvalReport = {
    runId: new Date().toISOString().replace(/[:.]/g, "-"),
    dryRun: flags.dryRun,
    modelUnderTest: flags.modelUnderTest,
    judgeModel: flags.judgeModel,
    dataset: flags.dataset,
    results,
    summary: buildSummary(results),
  }

  const { jsonPath, markdownPath } = writeReports(report, flags.outDir)
  console.log(`\n${report.summary.passed}/${report.summary.total} passed`)
  console.log(`Report written to ${jsonPath} and ${markdownPath}`)

  if (report.summary.failed > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
