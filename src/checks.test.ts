import assert from "node:assert/strict"
import { test } from "node:test"
import { schemaCheck, quoteFidelityCheck, emptyExpectedCheck } from "./checks.js"

test("schemaCheck rejects non-JSON", () => {
  const { result } = schemaCheck("not json at all")
  assert.equal(result.pass, false)
})

test("schemaCheck rejects missing decisions array", () => {
  const { result } = schemaCheck(JSON.stringify({ actions: [] }))
  assert.equal(result.pass, false)
})

test("schemaCheck accepts a well-formed response embedded in stray text", () => {
  const { result, parsed } = schemaCheck(
    `Here you go:\n${JSON.stringify({ actions: [], decisions: [] })}\nhope that helps`,
  )
  assert.equal(result.pass, true)
  assert.deepEqual(parsed, { actions: [], decisions: [] })
})

test("quoteFidelityCheck fails when a quote is not an exact substring of the transcript", () => {
  const candidate = {
    actions: [{ title: "t", content: "c", quote: "this was never said", speaker: "", timestamp: "" }],
    decisions: [],
  }
  const result = quoteFidelityCheck(candidate, "Priya: We should ship on Friday.")
  assert.equal(result.pass, false)
})

test("quoteFidelityCheck passes when every quote is a verbatim substring", () => {
  const candidate = {
    actions: [{ title: "t", content: "c", quote: "We should ship on Friday.", speaker: "", timestamp: "" }],
    decisions: [],
  }
  const result = quoteFidelityCheck(candidate, "Priya: We should ship on Friday.")
  assert.equal(result.pass, true)
})

test("emptyExpectedCheck is null (not applicable) when the fixture expects real items", () => {
  const expected = { actions: [{ title: "t", content: "c", quote: "q", speaker: "", timestamp: "" }], decisions: [] }
  const candidate = { actions: [], decisions: [] }
  assert.equal(emptyExpectedCheck(candidate, expected), null)
})

test("emptyExpectedCheck fails over-extraction: candidate non-empty when expected is empty", () => {
  const expected = { actions: [], decisions: [] }
  const candidate = { actions: [{ title: "t", content: "c", quote: "q", speaker: "", timestamp: "" }], decisions: [] }
  const result = emptyExpectedCheck(candidate, expected)
  assert.equal(result?.pass, false)
})

test("emptyExpectedCheck passes when both expected and candidate are empty", () => {
  const expected = { actions: [], decisions: [] }
  const candidate = { actions: [], decisions: [] }
  const result = emptyExpectedCheck(candidate, expected)
  assert.equal(result?.pass, true)
})
