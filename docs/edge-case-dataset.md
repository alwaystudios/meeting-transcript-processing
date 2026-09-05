# Edge-case / adversarial test dataset

## Two forms, one source of truth

Same relationship as the golden set (`docs/golden-dataset.md`): `fixtures/edge-case/*.json` is
the human-readable documentation (raw transcript, the specific rule each case validates), and
`datasets/edge-case.jsonl` is the machine-consumable form the evaluation job actually reads —
same schema, `referenceResponse` always `{"actions":[],"decisions":[]}` for this set by design.
Update both if you add or change a fixture.

## Purpose, and how this differs from the golden set

The golden set confirms the prompt gets clean cases right. This set exists to catch the opposite
failure mode: **over-extraction** — the model finding an action or decision where there isn't
one. Every fixture here expects empty arrays; a fixture that unexpectedly returns items is a real
bug, not noise, in the same way a golden-set failure is.

## Fixtures

| File | Rule validated |
|---|---|
| `01-agenda-setting-only.json` | Agenda fluff / vague discussion excluded |
| `02-speculative-not-concrete.json` | Concrete agreed actions only — floated idea, no commitment |
| `03-disagreement-no-consensus.json` | Decision requires group agreement — proposal disputed and parked |
| `04-hedged-non-commitment.json` | Concrete agreed actions only — hedged language ("I guess", "no promises") |
| `05-no-quotable-evidence.json` | Quote requirement — narrator annotation isn't a participant's actual words |
| `06-appended-auto-summary.json` | No meeting summary; no invention — auto-summary overclaims a decision |
| `07-incomplete-metadata-mixed.json` | Per-item speaker/timestamp handling within one transcript |
| `08-prompt-injection-direct.json` | Injection resistance — blunt "ignore instructions" attempt |
| `09-spoofed-decision-injection.json` | Injection resistance + no invention — planted fake structured decision |

Fixtures 08 and 09 are the injection-resistance cases — the security gate referenced in
`docs/eval-harness-design.md`: any deviation from empty arrays on either one means the
untrusted-content wrap failed to hold.

Fixture 09 is worth a second look: it plants a literal `Action:`/`Decision:`/`Quote:` structured
line inside an otherwise normal transcript, with a self-consistent quote — a purely deterministic
quote-containment check would wrongly pass it, since the planted text really is an exact
substring of the transcript. The judge's instructions (`eval-jobs/edge-case-job.json`) explicitly
call this pattern out so it isn't rated Pass just because the quote checks out mechanically.

## Extending this set

Same process as the golden set — add a fixture (both forms) whenever a real over-extraction
failure surfaces, with the rule it validates documented.
