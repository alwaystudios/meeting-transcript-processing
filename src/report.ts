import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { EvalReport, FixtureResult } from "./types.js"

export function buildSummary(results: FixtureResult[]): EvalReport["summary"] {
  const bySet: EvalReport["summary"]["bySet"] = {
    golden: { total: 0, passed: 0, failed: 0 },
    "edge-case": { total: 0, passed: 0, failed: 0 },
  }
  for (const r of results) {
    const bucket = bySet[r.set]
    bucket.total++
    if (r.overallPass) bucket.passed++
    else bucket.failed++
  }
  const total = results.length
  const passed = results.filter((r) => r.overallPass).length
  return { total, passed, failed: total - passed, bySet }
}

export function writeReports(report: EvalReport, outDir: string): { jsonPath: string; markdownPath: string } {
  mkdirSync(outDir, { recursive: true })
  const jsonPath = join(outDir, `${report.runId}.json`)
  const markdownPath = join(outDir, `${report.runId}.md`)
  writeFileSync(jsonPath, JSON.stringify(report, null, 2))
  writeFileSync(markdownPath, renderMarkdown(report))
  return { jsonPath, markdownPath }
}

function renderMarkdown(report: EvalReport): string {
  const lines: string[] = []
  lines.push(`# Eval run ${report.runId}`)
  lines.push("")
  lines.push(`- Dataset: \`${report.dataset}\``)
  lines.push(`- Dry run: ${report.dryRun}`)
  lines.push(`- Model under test: \`${report.modelUnderTest}\``)
  lines.push(`- Judge model: \`${report.judgeModel}\``)
  lines.push("")
  lines.push(`## Summary`)
  lines.push("")
  lines.push(`**${report.summary.passed}/${report.summary.total} passed**`)
  lines.push("")
  lines.push("| Set | Total | Passed | Failed |")
  lines.push("|---|---|---|---|")
  for (const [set, s] of Object.entries(report.summary.bySet)) {
    if (s.total === 0) continue
    lines.push(`| ${set} | ${s.total} | ${s.passed} | ${s.failed} |`)
  }
  lines.push("")
  lines.push(`## Results`)
  lines.push("")
  for (const r of report.results) {
    lines.push(`### ${r.overallPass ? "✅" : "❌"} ${r.id} (${r.set})`)
    lines.push("")
    if (r.error) {
      lines.push(`- **error:** ${r.error}`)
    }
    for (const check of r.checks) {
      lines.push(`- ${check.pass ? "✅" : "❌"} **${check.name}**: ${check.detail}`)
    }
    if (r.judge) {
      lines.push(`- ${r.judge.pass ? "✅" : "❌"} **judge**: ${r.judge.rationale}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}
