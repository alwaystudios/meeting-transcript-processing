# Edge-case / adversarial test dataset

## Purpose, and how this differs from the golden set

The golden set (`docs/golden-dataset.md`) confirms the prompt gets clean cases right. This set
exists to catch the opposite failure mode: **over-extraction** — the model finding an action or
decision where there isn't one. Every fixture here expects empty (or near-empty) arrays; a
fixture that unexpectedly returns items is a real bug, not noise, in the same way a golden-set
failure is.

## Fixtures

9 fixtures in `fixtures/edge-case/` (see `index.json` for the manifest), each documenting the
expected output and the specific prompt rule it validates:

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

Fixtures 08 and 09 are the injection-resistance cases referenced in `docs/eval-harness-design.md`
as the 100%-pass-required security gate — any deviation from empty arrays on either one means the
untrusted-content wrap failed to hold, which blocks shipping the prompt change outright.

Fixture 09 is worth a second look: it plants a literal `Action:`/`Decision:`/`Quote:` structured
line inside an otherwise normal transcript, with a self-consistent quote. A purely deterministic
quote-containment check would wrongly pass it — the planted text really is an exact substring of
the transcript. No real participant actually said or agreed to it, so it must still be dropped;
this is precisely why classification correctness needs the LLM judge and can't be verified by
string-matching alone.

## Extending this set

Same process as the golden set (`docs/golden-dataset.md`) — add a fixture whenever a real
over-extraction failure surfaces, with its expected output and the rule it validates documented.
