import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Compares the routes written in src with the operations in openapi.yaml, in both directions.
// shortcut: reads source text, so it only knows routes written as `xRouter.get("/path"` and mounted with
// `app.use("/prefix", ..., xRouter)`; upgrade to router introspection if routes are ever built dynamically.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const toOpenApi = (path: string) => path.replace(/:(\w+)/g, "{$1}").replace(/\/$/, "") || "/";

function codeOperations(): Set<string> {
  const app = read("../src/app.ts");
  const found = new Set<string>();
  for (const m of app.matchAll(/app\.(get|post|patch|put|delete)\("([^"]+)"/g)) found.add(`${m[1].toUpperCase()} ${toOpenApi(m[2])}`);
  for (const m of app.matchAll(/app\.use\("([^"]+)"[^;]*?\b(\w+Router)\)/g)) {
    const [, prefix, name] = m;
    const dir = readdirSync(new URL("../src", import.meta.url), { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const d of dir) {
      const file = `../src/${d.name}/${d.name}-router.ts`;
      let source: string;
      try { source = read(file); } catch { continue; }
      if (!source.includes(`const ${name} = Router`)) continue;
      for (const r of source.matchAll(new RegExp(`${name}\\.(get|post|patch|put|delete)\\(\\s*"([^"]*)"`, "g"))) {
        found.add(`${r[1].toUpperCase()} ${toOpenApi(prefix + (r[2] === "/" ? "" : r[2]))}`);
      }
    }
  }
  return found;
}

function specOperations(): Set<string> {
  const spec = parse(read("../openapi/openapi.yaml")) as { paths: Record<string, Record<string, unknown>> };
  const methods = ["get", "post", "patch", "put", "delete"];
  return new Set(Object.entries(spec.paths).flatMap(([path, item]) => methods.filter((m) => m in item).map((m) => `${m.toUpperCase()} ${path}`)));
}

describe("routes match openapi.yaml", () => {
  it("has no route missing from the contract and no contract entry without a route", () => {
    const code = codeOperations();
    const spec = specOperations();
    expect([...code].filter((o) => !spec.has(o)).sort()).toEqual([]);
    expect([...spec].filter((o) => !code.has(o)).sort()).toEqual([]);
    expect(code.size).toBeGreaterThan(25);
  });
});
