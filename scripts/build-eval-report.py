#!/usr/bin/env python3
"""Generate a human-readable HTML report from one or more completed Bedrock evaluation jobs.

Usage:
  python3 scripts/build-eval-report.py <job-arn> [<job-arn> ...] [--out reports/eval-report.html]

Pass one job ARN to see a single run's results. Pass several (in the order you want compared) to
see a version-by-version comparison per fixture - e.g. before/after a prompt change.

Run this from the repo root. Requires only the AWS CLI (already required throughout this repo,
see docs/setup.md) and the Python 3 standard library - no extra packages, no Claude, no network
access beyond the AWS CLI calls it already needs. Needs the same S3 read access on the output
bucket documented as iam/steady-state-policy.json's ReadEvaluationResults statement.

Output is written to --out (default reports/eval-report.html). That default path is gitignored.
To update the public GitHub Pages snapshot, pass --out published/eval-report.html.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def aws_json(*args):
    result = subprocess.run(["aws", *args, "--output", "json"], capture_output=True, text=True)
    if result.returncode != 0:
        print(f"aws {' '.join(args)} failed:\n{result.stderr}", file=sys.stderr)
        sys.exit(1)
    return json.loads(result.stdout)


def load_jsonl(path):
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def extract_transcript(prompt):
    """Pull the transcript out of the untrusted-content wrap.

    Uses rsplit (last occurrence), not split (first) - the system prompt's own rule text
    mentions the wrap delimiters as an example before the real wrapped transcript appears later
    in the string, and a first-occurrence split matches that mention instead.
    """
    if "<<<END_UNTRUSTED_CONTENT>>>" not in prompt:
        return ""
    before_end = prompt.rsplit("<<<END_UNTRUSTED_CONTENT>>>", 1)[0]
    if "<<<UNTRUSTED_CONTENT>>>" not in before_end:
        return ""
    return before_end.rsplit("<<<UNTRUSTED_CONTENT>>>", 1)[1].strip()


def load_fixture_metadata(repo_root):
    meta = {}
    for folder, category in [("fixtures/golden", "golden"), ("fixtures/edge-case", "edge")]:
        d = repo_root / folder
        if not d.exists():
            continue
        for fp in d.glob("*.json"):
            if fp.name == "index.json":
                continue
            fx = json.loads(fp.read_text())
            meta[fx["id"]] = {
                "category": category,
                "description": fx.get("description", ""),
                "rule": fx.get("ruleValidated", ""),
            }
    return meta


def fetch_job_results(job_arn):
    job = aws_json("bedrock", "get-evaluation-job", "--job-identifier", job_arn)
    status = job.get("status")
    if status != "Completed":
        print(f"warning: job {job_arn} has status {status!r}, not Completed - skipping", file=sys.stderr)
        return None

    job_name = job["jobName"]
    model_id = job["inferenceConfig"]["models"][0]["bedrockModel"]["modelIdentifier"]
    output_uri = job["outputDataConfig"]["s3Uri"]
    bucket, _, prefix = output_uri[len("s3://"):].partition("/")
    job_id = job_arn.rsplit("/", 1)[-1]
    search_prefix = f"{prefix.rstrip('/')}/{job_name}/{job_id}/models/"

    listing = aws_json("s3api", "list-objects-v2", "--bucket", bucket, "--prefix", search_prefix)
    keys = [obj["Key"] for obj in listing.get("Contents", []) if obj["Key"].endswith("_output.jsonl")]
    if not keys:
        print(f"warning: no *_output.jsonl found for job {job_arn} under s3://{bucket}/{search_prefix}", file=sys.stderr)
        return None

    tmp_path = Path(f"/tmp/{job_id}_output.jsonl")
    subprocess.run(["aws", "s3", "cp", f"s3://{bucket}/{keys[0]}", str(tmp_path)], check=True, capture_output=True)
    rows = load_jsonl(tmp_path)
    tmp_path.unlink()

    return {"job_name": job_name, "model_id": model_id, "rows": rows}


def match_fixture(prompt, datasets):
    marker = extract_transcript(prompt)
    for row in datasets:
        if extract_transcript(row["prompt"]) == marker:
            return row["fixtureId"], row.get("referenceResponse", "")
    return "unknown-fixture", ""


def build_cases(job_results, datasets, fixture_meta):
    """Assign each job a run number *per fixture category*, not by its raw position in the
    argument list. A golden job and an edge-case job passed together (in any order, interleaved
    or grouped) each become "run 1" for their own category - this is what lets one combined
    report show both datasets side by side instead of needing two separate report files."""
    cases = {}
    category_run_counters = {}
    for result in job_results:
        matched = []
        for row in result["rows"]:
            fid, ref = match_fixture(row["inputRecord"]["prompt"], datasets)
            category = fixture_meta.get(fid, {}).get("category", "unknown")
            matched.append((fid, category, ref, row))

        job_run_number = {}
        for category in sorted({m[1] for m in matched}):
            category_run_counters[category] = category_run_counters.get(category, 0) + 1
            job_run_number[category] = category_run_counters[category]

        for fid, category, ref, row in matched:
            version_key = f"run{job_run_number[category]}"
            transcript = extract_transcript(row["inputRecord"]["prompt"])
            if fid not in cases:
                meta = fixture_meta.get(fid, {})
                cases[fid] = {
                    "id": fid,
                    "category": category,
                    "description": meta.get("description", ""),
                    "rule": meta.get("rule", ""),
                    "transcript": transcript,
                    "reference": ref,
                    "versions": {},
                }
            cases[fid]["versions"][version_key] = {
                "model": result["model_id"],
                "jobName": result["job_name"],
                "result": row["automatedEvaluationResult"]["scores"][0]["result"],
                "response": row["modelResponses"][0]["response"],
                "explanation": row["automatedEvaluationResult"]["scores"][0]["evaluatorDetails"][0]["explanation"],
            }
    return cases


HTML_TEMPLATE = r"""<title>__TITLE__</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
  :root {
    --bg: #EEF1F0; --surface: #FFFFFF; --surface-2: #E3E8E6;
    --ink: #16211E; --ink-muted: #57655F; --border: #D2DAD7;
    --accent: #0E6E66; --accent-soft: #DFEEEB;
    --pass: #2F7A4F; --pass-soft: #E3F1E7;
    --fail: #AE372F; --fail-soft: #FBEAE8;
    --quote-bg: #12201C; --quote-text: #CBE9DF; --quote-border: #274139;
    --pending: #8A7A2E; --pending-soft: #F3EDD8;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #101614; --surface: #182420; --surface-2: #1E2B26;
      --ink: #E7EEEC; --ink-muted: #94A29D; --border: #2A3A34;
      --accent: #57C7B8; --accent-soft: #163430;
      --pass: #74CB93; --pass-soft: #17281D;
      --fail: #E79A94; --fail-soft: #2E1B19;
      --quote-bg: #060B09; --quote-text: #9FE0D2; --quote-border: #1D2E28;
      --pending: #D8C560; --pending-soft: #2A2716;
    }
  }
  :root[data-theme="dark"] {
    --bg: #101614; --surface: #182420; --surface-2: #1E2B26;
    --ink: #E7EEEC; --ink-muted: #94A29D; --border: #2A3A34;
    --accent: #57C7B8; --accent-soft: #163430;
    --pass: #74CB93; --pass-soft: #17281D;
    --fail: #E79A94; --fail-soft: #2E1B19;
    --quote-bg: #060B09; --quote-text: #9FE0D2; --quote-border: #1D2E28;
    --pending: #D8C560; --pending-soft: #2A2716;
  }
  * { box-sizing: border-box; }
  body {
    background: var(--bg); color: var(--ink);
    font-family: 'IBM Plex Sans', -apple-system, 'Segoe UI', sans-serif;
    line-height: 1.5; max-width: 920px; margin: 0 auto; padding: 40px 24px 80px;
  }
  h1, h2 { text-wrap: balance; margin: 0; }
  code, .mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
  .eyebrow {
    font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--accent); font-weight: 600;
  }
  header.page {
    display: flex; flex-direction: column; gap: 10px; padding-bottom: 28px;
    border-bottom: 1px solid var(--border); margin-bottom: 28px;
  }
  header.page h1 { font-size: 30px; font-weight: 700; letter-spacing: -0.01em; }
  .meta-row { display: flex; flex-wrap: wrap; gap: 8px 20px; font-size: 13px; color: var(--ink-muted); }
  .meta-row span b { color: var(--ink); font-weight: 600; }
  .progression { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 32px; }
  .prog-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 18px 20px; }
  .prog-card .prog-title { font-size: 13px; font-weight: 600; color: var(--ink-muted); margin-bottom: 12px; }
  .prog-track { display: flex; align-items: center; gap: 8px; }
  .prog-step { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; }
  .prog-score {
    font-family: 'IBM Plex Mono', monospace; font-weight: 600; font-size: 20px;
    font-variant-numeric: tabular-nums; width: 100%; text-align: center; padding: 6px 0; border-radius: 6px;
  }
  .prog-score.pass-full { background: var(--pass-soft); color: var(--pass); }
  .prog-score.pass-partial { background: var(--fail-soft); color: var(--fail); }
  .prog-label { font-size: 11px; color: var(--ink-muted); text-align: center; }
  .prog-arrow { color: var(--border); font-size: 16px; }
  section.dataset { margin-bottom: 36px; }
  section.dataset > h2 { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
  section.dataset > p.lead { font-size: 13.5px; color: var(--ink-muted); margin: 0 0 16px; max-width: 65ch; }
  .case { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 10px; overflow: hidden; }
  .case > summary { list-style: none; cursor: pointer; padding: 14px 18px; display: flex; align-items: center; gap: 12px; }
  .case > summary::-webkit-details-marker { display: none; }
  .case > summary .chevron { font-size: 11px; color: var(--ink-muted); transition: transform 0.15s ease; flex-shrink: 0; }
  .case[open] > summary .chevron { transform: rotate(90deg); }
  .case > summary .id { font-family: 'IBM Plex Mono', monospace; font-size: 13.5px; font-weight: 500; flex: 1; min-width: 0; }
  .pill {
    font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 600; letter-spacing: 0.03em;
    padding: 3px 9px; border-radius: 20px; flex-shrink: 0;
  }
  .pill.Pass { background: var(--pass-soft); color: var(--pass); }
  .pill.Fail { background: var(--fail-soft); color: var(--fail); }
  .version-chips { display: flex; gap: 5px; flex-shrink: 0; }
  .vchip {
    width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    font-family: 'IBM Plex Mono', monospace; font-size: 10px; font-weight: 700;
  }
  .vchip.Pass { background: var(--pass-soft); color: var(--pass); }
  .vchip.Fail { background: var(--fail-soft); color: var(--fail); }
  .case-body { padding: 4px 18px 20px; border-top: 1px solid var(--border); }
  .case-body .rule {
    font-size: 13px; color: var(--ink-muted); margin: 14px 0 18px; padding-left: 12px; border-left: 2px solid var(--accent);
  }
  .case-body .rule b { color: var(--ink); }
  .version-block { margin-bottom: 18px; }
  .version-block:last-child { margin-bottom: 0; }
  .version-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
  .version-head .vname { font-size: 12.5px; font-weight: 600; color: var(--ink-muted); }
  .version-head .vmodel { font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; color: var(--ink-muted); }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 640px) { .grid-2 { grid-template-columns: 1fr; } }
  .block-label {
    font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--ink-muted); margin-bottom: 5px;
  }
  pre.transcript, pre.response {
    background: var(--quote-bg); color: var(--quote-text); border: 1px solid var(--quote-border);
    border-radius: 7px; padding: 12px 14px; font-family: 'IBM Plex Mono', monospace; font-size: 12px;
    line-height: 1.55; white-space: pre-wrap; word-break: break-word; overflow-x: auto;
    margin: 0 0 12px; max-height: 220px; overflow-y: auto;
  }
  .explanation { font-size: 13px; color: var(--ink); background: var(--surface-2); border-radius: 7px; padding: 12px 14px; line-height: 1.55; }
  footer.page { margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--border); font-size: 12px; color: var(--ink-muted); }
</style>
<header class="page">
  <div class="eyebrow">Bedrock Model Evaluation</div>
  <h1>Transcript Extraction &mdash; Eval Report</h1>
  <div class="meta-row" id="meta-row"></div>
</header>
<div class="progression" id="progression"></div>
<section class="dataset">
  <h2>Golden set</h2>
  <p class="lead">Clean-cut cases the prompt should extract correctly &mdash; a Fail here is a real prompt bug or a bad fixture, never noise.</p>
  <div id="golden-cases"></div>
</section>
<section class="dataset">
  <h2>Edge-case set</h2>
  <p class="lead">Over-extraction traps and prompt-injection attempts.</p>
  <div id="edge-cases"></div>
</section>
<footer class="page">Generated by scripts/build-eval-report.py from live Bedrock evaluation job results.</footer>
<script id="eval-data" type="application/json">__DATA__</script>
<script>
(function () {
  const cases = JSON.parse(document.getElementById('eval-data').textContent);

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function prettyJson(text) {
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch (e) { return text; }
  }

  // Run numbering is per fixture-category (see build_cases in the Python script) - golden and
  // edge-case can have a different number of runs, so compute version keys separately per list
  // rather than assuming one global count.
  function versionKeysFor(list) {
    const maxRun = list.reduce((max, c) => {
      const nums = Object.keys(c.versions).map(k => parseInt(k.replace('run', ''), 10));
      return Math.max(max, ...nums, 0);
    }, 0);
    return Array.from({ length: maxRun }, (_, i) => 'run' + (i + 1));
  }

  document.getElementById('meta-row').innerHTML =
    `<span>Golden: <b>${cases.filter(c => c.category === 'golden').length}</b> fixtures</span>` +
    `<span>Edge-case: <b>${cases.filter(c => c.category === 'edge').length}</b> fixtures</span>`;

  function progCard(title, list) {
    const versionKeys = versionKeysFor(list);
    const steps = versionKeys.map((vk, i) => {
      const present = list.filter(c => c.versions[vk]);
      if (present.length === 0) return null;
      const pass = present.filter(c => c.versions[vk].result === 'Pass').length;
      return { pass, total: present.length };
    });
    const html = steps.map((s, i) => {
      const inner = !s ? '' : `<div class="prog-score ${s.pass === s.total ? 'pass-full' : 'pass-partial'}">${s.pass}/${s.total}</div><div class="prog-label">Run ${i + 1}</div>`;
      const arrow = i < steps.length - 1 ? '<div class="prog-arrow">&rarr;</div>' : '';
      return `<div class="prog-step">${inner}</div>${arrow}`;
    }).join('');
    return `<div class="prog-card"><div class="prog-title">${title}</div><div class="prog-track">${html}</div></div>`;
  }

  document.getElementById('progression').innerHTML =
    progCard('Golden set', cases.filter(c => c.category === 'golden')) +
    progCard('Edge-case set', cases.filter(c => c.category === 'edge'));

  function versionBlock(vk, v) {
    if (!v) return '';
    return `
      <div class="version-block">
        <div class="version-head">
          <span class="vname">${esc(v.jobName)}</span>
          <span class="pill ${v.result}">${v.result}</span>
          <span class="vmodel">${esc(v.model)}</span>
        </div>
        <div class="grid-2">
          <div><div class="block-label">Response</div><pre class="response">${esc(prettyJson(v.response))}</pre></div>
          <div><div class="block-label">Judge explanation</div><div class="explanation">${esc(v.explanation)}</div></div>
        </div>
      </div>`;
  }

  function caseHtml(c) {
    const versionKeys = versionKeysFor([c]);
    const latestKey = [...versionKeys].reverse().find(k => c.versions[k]);
    const latest = c.versions[latestKey];
    const chips = versionKeys.map(vk => {
      if (!c.versions[vk]) return '';
      const r = c.versions[vk].result;
      return `<div class="vchip ${r}" title="${r}">${r === 'Pass' ? '&#10003;' : '&#10005;'}</div>`;
    }).join('');
    const versionsHtml = versionKeys.map(vk => versionBlock(vk, c.versions[vk])).join('');
    return `
      <details class="case">
        <summary>
          <span class="chevron">&#9656;</span>
          <span class="id">${esc(c.id)}</span>
          <span class="version-chips">${chips}</span>
          <span class="pill ${latest.result}">${latest.result}</span>
        </summary>
        <div class="case-body">
          <div class="rule"><b>${c.rule ? 'Rule:' : 'Case:'}</b> ${esc(c.rule || c.description)}</div>
          <div class="version-block">
            <div class="block-label">Transcript</div>
            <pre class="transcript">${esc(c.transcript)}</pre>
            <div class="block-label">Reference (expected)</div>
            <pre class="response">${esc(prettyJson(c.reference))}</pre>
          </div>
          ${versionsHtml}
        </div>
      </details>`;
  }

  document.getElementById('golden-cases').innerHTML = cases.filter(c => c.category === 'golden').map(caseHtml).join('');
  document.getElementById('edge-cases').innerHTML = cases.filter(c => c.category === 'edge').map(caseHtml).join('');
})();
</script>
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("job_arns", nargs="+", help="One or more completed Bedrock evaluation job ARNs")
    parser.add_argument("--out", default="reports/eval-report.html", help="Output HTML file path (default: reports/eval-report.html)")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent

    golden_ds = load_jsonl(repo_root / "datasets" / "golden.jsonl")
    edge_ds = load_jsonl(repo_root / "datasets" / "edge-case.jsonl")
    fixture_meta = load_fixture_metadata(repo_root)

    job_results = [r for r in (fetch_job_results(arn) for arn in args.job_arns) if r]
    if not job_results:
        print("no completed jobs with results found", file=sys.stderr)
        sys.exit(1)

    cases = build_cases(job_results, golden_ds + edge_ds, fixture_meta)
    ordered = sorted(cases.values(), key=lambda c: (c["category"], c["id"]))

    categories = {c["category"] for c in ordered}
    if categories == {"golden"}:
        title = "Golden Set Eval Report"
    elif categories == {"edge"}:
        title = "Edge Case Eval Report"
    else:
        title = "Transcript Extraction Eval Report"

    html = HTML_TEMPLATE.replace("__DATA__", json.dumps(ordered)).replace("__TITLE__", title)

    out_path = repo_root / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html)
    print(f"wrote {out_path} ({len(ordered)} fixtures from {len(job_results)} job(s))")


if __name__ == "__main__":
    main()
