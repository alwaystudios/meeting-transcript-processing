import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { Fixture, FixtureSet } from "./types.js"

const SET_DIRS: Record<FixtureSet, string> = {
  golden: "fixtures/golden",
  "edge-case": "fixtures/edge-case",
}

/** Load every fixture JSON file in a set's directory (index.json is a manifest, not a fixture). */
export function loadFixtureSet(root: string, set: FixtureSet): Fixture[] {
  const dir = join(root, SET_DIRS[set])
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json")
  return files
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as Fixture)
}

export function loadFixtures(root: string, dataset: "golden" | "edge-cases" | "all"): Array<{ set: FixtureSet; fixture: Fixture }> {
  const out: Array<{ set: FixtureSet; fixture: Fixture }> = []
  if (dataset === "golden" || dataset === "all") {
    for (const fixture of loadFixtureSet(root, "golden")) out.push({ set: "golden", fixture })
  }
  if (dataset === "edge-cases" || dataset === "all") {
    for (const fixture of loadFixtureSet(root, "edge-case")) out.push({ set: "edge-case", fixture })
  }
  return out
}
