// Runs examples/n8n/meeting-scheduler.workflow.json in a real n8n and prints one result per case.
// Needs the global `n8n` CLI. Everything lives in a throw-away folder: it never touches ~/.n8n.
//
//   node examples/n8n/verify.mjs [workDir]
//
// For each case the Settings and Build request nodes are patched (absolute request path under the
// restricted folder, `node <repo>/packages/cli/dist/bin.js` as the command, the case's request),
// the workflow is imported and executed, and the branch that ran is recorded.
import { spawnSync } from "node:child_process";
import console from "node:console";
import process from "node:process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../..");
const work = process.argv[2] ?? mkdtempSync(join(tmpdir(), "tempo-n8n-"));
const home = join(work, "n8n-home");
const files = join(work, "n8n-files");
mkdirSync(home, { recursive: true });
mkdirSync(files, { recursive: true });
const bin = join(repo, "packages/cli/dist/bin.js");
const fixture = (n) =>
  JSON.stringify(JSON.parse(readFileSync(join(repo, `packages/core/fixtures/examples/ex-${n}.json`), "utf8")).input, null, 2);

const env = {
  ...process.env,
  N8N_USER_FOLDER: home,
  NODES_EXCLUDE: "[]",
  N8N_RESTRICT_FILE_ACCESS_TO: files,
  N8N_DIAGNOSTICS_ENABLED: "false",
  N8N_VERSION_NOTIFICATIONS_ENABLED: "false",
  N8N_PERSONALIZATION_ENABLED: "false",
  N8N_RUNNERS_BROKER_PORT: "5791",
  N8N_PORT: "5792",
};
const n8n = (args) => spawnSync("n8n", args, { env, encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024 });

const cases = [
  { id: "ex01", fixture: "01", expectBranch: "Book slot" },
  { id: "ex17", fixture: "17", expectBranch: "Offer alternatives" },
  { id: "ex23", fixture: "23", expectBranch: "Report input error" },
];

const results = [];
for (const c of cases) {
  const wf = JSON.parse(readFileSync(join(import.meta.dirname, "meeting-scheduler.workflow.json"), "utf8"));
  wf.id = `tempo${c.id}`;
  const set = (node, name, value) => {
    const a = wf.nodes.find((n) => n.name === node).parameters.assignments.assignments.find((x) => x.name === name);
    a.value = value;
  };
  set("Settings", "tempoRequestPath", join(files, `tempo-request-${c.id}.json`));
  set("Settings", "tempoCommand", `node "${bin}"`);
  set("Build request", "requestJson", fixture(c.fixture));
  const file = join(work, `wf-${c.id}.json`);
  writeFileSync(file, JSON.stringify(wf));
  const imp = n8n(["import:workflow", `--input="${file}"`]);
  if (imp.status !== 0) throw new Error(`import failed for ${c.id}: ${imp.stdout}${imp.stderr}`);
  const run = n8n(["execute", `--id=${wf.id}`, "--rawOutput"]);
  const text = run.stdout;
  const exec = JSON.parse(text.slice(text.indexOf("{")));
  const last = exec.data.resultData.lastNodeExecuted;
  const out = exec.data.resultData.runData[last][0].data.main.flat()[0].json;
  results.push({
    case: `EX-${c.fixture}`,
    status: exec.status,
    branch: last,
    expectedBranch: c.expectBranch,
    decision: out.result?.decision ?? null,
    errorCode: out.result?.error?.code ?? null,
    candidateZones: out.result?.error?.details?.options?.length ?? null,
  });
}
const version = n8n(["--version"]).stdout.trim();
const summary = { n8nVersion: version, results };
console.log(JSON.stringify(summary, null, 2));
if (results.some((r) => r.status !== "success" || r.branch !== r.expectedBranch)) process.exitCode = 1;
