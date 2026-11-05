import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/main.js";
import { fakeEnv } from "./env.js";

const repoRoot = resolve(import.meta.dirname, "../../..");
const read = (rel: string): string => readFileSync(resolve(repoRoot, rel), "utf8");

interface Node {
  name: string;
  type: string;
  typeVersion: number;
  parameters: Record<string, unknown>;
  credentials?: unknown;
}
interface Workflow {
  name: string;
  nodes: Node[];
  connections: Record<string, { main: { node: string }[][] }>;
}
const wf = JSON.parse(read("examples/n8n/meeting-scheduler.workflow.json")) as Workflow;
const node = (name: string): Node => {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n) throw new Error(`no node ${name}`);
  return n;
};
const assignments = (name: string): { name: string; value: string }[] =>
  (node(name).parameters["assignments"] as { assignments: { name: string; value: string }[] }).assignments;

const COMMAND =
  "={{ $('Settings').item.json.tempoCommand }} check \"{{ $('Settings').item.json.tempoRequestPath }}\" --json || exit 0";

describe("examples/n8n workflow (M4 Task 5)", () => {
  it("is valid JSON with a name, nodes and connections", () => {
    expect(wf.name).toBeTruthy();
    expect(wf.nodes.length).toBeGreaterThan(5);
    expect(Object.keys(wf.connections).length).toBeGreaterThan(5);
  });

  it("every connection endpoint names an existing node", () => {
    const names = new Set(wf.nodes.map((n) => n.name));
    for (const [from, c] of Object.entries(wf.connections)) {
      expect(names.has(from), from).toBe(true);
      for (const to of c.main.flat()) expect(names.has(to.node), `${from} -> ${to.node}`).toBe(true);
    }
  });

  it("uses the node types and versions verified on n8n 2.38.7", () => {
    expect(node("Tempo check")).toMatchObject({ type: "n8n-nodes-base.executeCommand", typeVersion: 1 });
    expect(node("Request to file")).toMatchObject({ type: "n8n-nodes-base.convertToFile", typeVersion: 1.1 });
    expect(node("Write request file")).toMatchObject({ type: "n8n-nodes-base.readWriteFile", typeVersion: 1.1 });
    expect(node("Decision")).toMatchObject({ type: "n8n-nodes-base.switch", typeVersion: 3.4 });
  });

  it("the Execute Command node runs tempo check --json on an absolute path from Settings and never uses /tmp", () => {
    expect(node("Tempo check").parameters["command"]).toBe(COMMAND);
    expect(JSON.stringify(wf)).not.toContain("/tmp");
  });

  it("the decision node branches on book and counter_offer, with a named error fallback", () => {
    const text = JSON.stringify(node("Decision").parameters);
    expect(text).toContain('"rightValue":"book"');
    expect(text).toContain('"rightValue":"counter_offer"');
    expect(text).toContain('"renameFallbackOutput":"error"');
    const outputs = wf.connections["Decision"]!.main.map((o) => o.map((t) => t.node));
    expect(outputs).toEqual([["Book slot"], ["Offer alternatives"], ["Report input error"]]);
  });

  it("an exit-code-only failure cannot skip the branch: the command ends with || exit 0 and Parse result handles empty output", () => {
    expect(String(node("Tempo check").parameters["command"])).toMatch(/ \|\| exit 0$/);
    expect(assignments("Parse result")[0]!.value).toContain("NO_OUTPUT");
  });

  it("only the Settings node holds absolute paths, and nothing holds credentials", () => {
    for (const n of wf.nodes.filter((x) => x.name !== "Settings")) {
      expect(JSON.stringify(n.parameters), n.name).not.toMatch(/"(\/|[A-Za-z]:[\\/])(home|Users|tmp)/);
      expect(n.credentials, n.name).toBeUndefined();
    }
    expect(assignments("Settings").map((a) => a.name)).toEqual(["tempoRequestPath", "tempoCommand"]);
  });

  it("the default request is examples/demo.json", () => {
    const value = assignments("Build request")[0]!.value;
    expect(JSON.parse(value)).toEqual(JSON.parse(read("examples/demo.json")));
  });
});

describe("examples/n8n/verified.json: the pinned real-n8n results agree with the CLI", () => {
  const verified = JSON.parse(read("examples/n8n/verified.json")) as {
    n8nVersion: string;
    results: { case: string; status: string; branch: string; expectedBranch: string; decision: string | null; errorCode: string | null; candidateZones: number | null }[];
  };

  it("pins n8n 2.38.7 and three successful runs on the expected branches", () => {
    expect(verified.n8nVersion).toBe("2.38.7");
    expect(verified.results.map((r) => r.case)).toEqual(["EX-01", "EX-17", "EX-23"]);
    for (const r of verified.results) {
      expect(r.status).toBe("success");
      expect(r.branch).toBe(r.expectedBranch);
    }
  });

  it.each(["01", "17", "23"])("EX-%s: the CLI gives what n8n branched on", async (n) => {
    const fixture = JSON.parse(read(`packages/core/fixtures/examples/ex-${n}.json`)) as { input: unknown };
    const env = fakeEnv({ files: { "r.json": JSON.stringify(fixture.input) } });
    const code = await main(["check", "r.json", "--json"], env);
    const out = JSON.parse(env.out.join("")) as { decision?: string; error?: { code: string; details?: { options?: unknown[] } } };
    const pinned = verified.results.find((r) => r.case === `EX-${n}`)!;
    expect(out.decision ?? null).toBe(pinned.decision);
    expect(out.error?.code ?? null).toBe(pinned.errorCode);
    expect(out.error?.details?.options?.length ?? null).toBe(pinned.candidateZones);
    expect(code).toBe(n === "23" ? 3 : 0);
  });

  it("the default (demo) request is a counter_offer, the branch the README describes", async () => {
    const env = fakeEnv({ files: { "r.json": read("examples/demo.json") } });
    expect(await main(["check", "r.json", "--json"], env)).toBe(0);
    expect((JSON.parse(env.out.join("")) as { decision: string }).decision).toBe("counter_offer");
  });
});
