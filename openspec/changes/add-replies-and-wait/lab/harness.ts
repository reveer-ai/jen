// Behavior lab: runs owner scenarios against a jen runtime of its own and
// records every agent's stream until the tree goes quiet.
// Usage: node harness.ts <repo> <outdir> <image-tag> [scenario...] [--runs N] [--replies]

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [repo, outdir, image, ...rest] = process.argv.slice(2);
const runsIdx = rest.indexOf("--runs");
const runs = runsIdx >= 0 ? Number(rest[runsIdx + 1]) : 1;
// --replies: a turn's final text is delivered to the parent (designs C and B+C).
const replies = rest.includes("--replies");
const only = rest.filter((a, i) => a !== "--runs" && a !== "--replies" && (runsIdx < 0 || i !== runsIdx + 1));

const env: Record<string, string> = {};
for (const line of readFileSync(join(repo, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

interface Scenario { name: string; steps: string[] }
const scenarios: Scenario[] = [
  { name: "haiku", steps: ["Spawn a sub-agent to write a haiku about herons, then send me its haiku."] },
  { name: "direct", steps: ["What's the capital of Australia?"] },
  { name: "fanout", steps: ["Get three sub-agents to each propose a name for a coffee shop, then send me the best of the three with one line on why."] },
  { name: "clarify", steps: ["Have a sub-agent write a two-line wedding toast for my sister and her partner, using their names."], answer: "Maya and Jordan." } as Scenario & { answer: string },
  { name: "followup", steps: ["Have a sub-agent write a haiku about herons and send it to me.", "Nice. Now one about cranes."] },
  { name: "thanks", steps: ["Spawn a sub-agent to write a haiku about herons. When it replies, send it a short thank-you, then send me the haiku."] },
  { name: "nested", steps: ["Set up a small team: one sub-agent who leads two sub-agents of its own. The two each write one sentence of a two-sentence story about a lighthouse, and the lead combines them. Send me the story."] },
];

const QUIET_MS = 30_000;
const MAX_MS = 360_000;

function docker(args: string[], extra: Record<string, string> = {}) {
  const r = spawnSync("docker", args, { encoding: "utf8", env: { ...process.env, ...extra }, timeout: 120_000 });
  if (r.status !== 0) throw new Error(`docker ${args[0]}: ${r.stderr}`);
  return r.stdout;
}

const name = `jen-lab-${randomBytes(3).toString("hex")}`;
const token = randomBytes(32).toString("hex");
const auth = { Authorization: `Bearer ${token}` };
const renv = { JEN_RUNTIME_NAME: name, JEN_OWNER_TOKEN: token, JEN_MODEL: process.env.LAB_MODEL ?? env.JEN_LIVE_MODEL, JEN_API_KEY: env.JEN_LIVE_API_KEY, JEN_BASE_URL: env.JEN_LIVE_BASE_URL ?? "", JEN_AGENT_IMAGE: image, JEN_MAX_AGENTS: "50" };
docker(["run", "-d", "--name", `${name}-runtime`, "-p", "127.0.0.1::8080", "-v", "/var/run/docker.sock:/var/run/docker.sock", ...Object.keys(renv).flatMap((k) => ["-e", k]), "jen-runtime"], renv);
const port = docker(["port", `${name}-runtime`, "8080/tcp"]).trim().split("\n")[0].split(":").at(-1);
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 100; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }

const api = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(base + path, { ...init, headers: { ...auth, ...init.headers } });
  const t = await res.text();
  return t ? JSON.parse(t) : undefined;
};

interface Rec { t: number; agent: string; kind: string; item: any }

async function runScenario(s: Scenario & { answer?: string }, label: string) {
  const start = Date.now();
  const root = (await api("/agents", { method: "POST", body: JSON.stringify({ grant: { spawn: true } }) })).id as string;
  const recs: Rec[] = [];
  const watching = new Map<string, AbortController>();
  let last = Date.now();
  const watch = async (id: string) => {
    const ac = new AbortController();
    watching.set(id, ac);
    try {
      const res = await fetch(`${base}/agents/${id}/events`, { headers: auth, signal: ac.signal });
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = block.match(/^event: (.*)$/m)?.[1];
          const data = block.match(/^data: (.*)$/m)?.[1];
          if (!ev || !data) continue;
          recs.push({ t: Date.now() - start, agent: id, kind: ev, item: JSON.parse(data) });
          last = Date.now();
        }
      }
    } catch {}
    watching.delete(id);
  };
  const refresh = async () => {
    const all = (await api("/agents")) as { id: string; parent: string | null; state: string }[];
    const mine = new Set([root]);
    for (let grew = true; grew; ) { grew = false; for (const a of all) if (a.parent && mine.has(a.parent) && !mine.has(a.id)) { mine.add(a.id); grew = true; } }
    const agents = all.filter((a) => mine.has(a.id));
    for (const a of agents) if (!watching.has(a.id) && a.state === "running") void watch(a.id);
    return agents;
  };
  // A final reply: an assistant message the same agent's next item isn't a tool call of.
  const finals = () => {
    const out: Rec[] = [];
    const byAgent = new Map<string, Rec[]>();
    for (const r of recs) if (r.kind !== "note") (byAgent.get(r.agent) ?? byAgent.set(r.agent, []).get(r.agent)!).push(r);
    for (const list of byAgent.values())
      list.forEach((r, i) => {
        if (r.item.type === "message" && r.item.role === "assistant" && list[i + 1]?.item.type !== "tool_call" && r.item.text.trim() !== "") out.push(r);
      });
    return out;
  };
  const ownerMsgs = () =>
    replies
      ? finals().filter((r) => r.agent === root && !r.item.working)
      : recs.filter((r) => r.agent === root && r.item.type === "tool_call" && (r.item.name === "send_message" || r.item.name === "message_sub_agent") && r.item.input?.to === "owner");
  void watch(root);
  let answered = false;
  for (const [n, text] of s.steps.entries()) {
    if (n > 0) last = Date.now();
    await api(`/agents/${root}/messages`, { method: "POST", body: JSON.stringify({ text }) });
    const stepStart = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      await refresh();
      // Answer the first question the root sends the owner, if the scenario has one.
      if (s.answer && !answered) {
        const q = ownerMsgs()[0];
        if (q) { answered = true; recs.push({ t: Date.now() - start, agent: "owner", kind: "note", item: {} }); await api(`/agents/${root}/messages`, { method: "POST", body: JSON.stringify({ text: s.answer }) }); last = Date.now(); }
      }
      if (Date.now() - last > QUIET_MS || Date.now() - stepStart > MAX_MS) break;
    }
  }
  const agents = await refresh();
  for (const ac of watching.values()) ac.abort();
  await api(`/agents/${root}`, { method: "DELETE" });
  const ids = [root, ...agents.filter((a) => a.id !== root).map((a) => a.id)];
  const short = (id: string) => (id === root ? "root" : id === "owner" ? "owner" : `a${ids.indexOf(id)}`);
  const finalSet = new Set(replies ? finals() : []);
  const ownerCount = ownerMsgs().length;
  recs.sort((a, b) => a.t - b.t);
  const lines: string[] = [];
  for (const r of recs) {
    const it = r.item; const who = short(r.agent).padEnd(5);
    const ts = (r.t / 1000).toFixed(0).padStart(4) + "s";
    if (r.kind === "error") lines.push(`${ts} ${who} ERROR ${JSON.stringify(it)}`);
    else if (r.kind === "note") lines.push(`${ts} owner answers question`);
    else if (it.type === "message" && it.role === "user") lines.push(`${ts} ${who} <-${it.working ? " (working)" : ""}${it.ended ? " (ENDED SIGNAL)" : it.text === "" ? " (EMPTY)" : ""} ${it.from === root ? "root" : it.from === "owner" || it.from === "runtime" ? it.from : short(it.from)}: ${it.text.replace(/\n/g, " / ")}`);
    else if (it.type === "message" && finalSet.has(r)) lines.push(`${ts} ${who} ${it.working ? "SOFT" : "REPLY"} -> ${r.agent === root ? "owner" : "parent"}: ${it.text.replace(/\n/g, " / ")}`);
    else if (it.type === "message") lines.push(`${ts} ${who} TEXT (unsent): ${it.text.replace(/\n/g, " / ")}`);
    else if (it.type === "tool_call") lines.push(`${ts} ${who} call ${it.name} ${(it.name === "send_message" || it.name === "message_sub_agent") ? `-> ${it.input.to === "owner" ? "owner" : short(it.input.to)}: ${String(it.input.text).replace(/\n/g, " / ")}${it.input.urgent ? " [URGENT]" : ""}` : JSON.stringify(it.input)}`);
    else if (it.type === "tool_result" && it.output !== "delivered") lines.push(`${ts} ${who}   = ${String(it.output).slice(0, 160)}`);
  }
  const calls = recs.filter((r) => r.item.type === "tool_call");
  const m = {
    scenario: label,
    agents: ids.length,
    ownerSends: ownerCount,
    interAgentSends: calls.filter((r) => (r.item.name === "send_message" || r.item.name === "message_sub_agent") && r.item.input?.to !== "owner").length + [...finalSet].filter((r) => r.agent !== root).length,
    ownerSoft: [...finalSet].filter((r) => r.agent === root && r.item.working).length,
    softReplies: [...finalSet].filter((r) => r.agent !== root && r.item.working).length,
    endedEmpty: recs.filter((r) => r.item.type === "message" && r.item.role === "user" && (r.item.text === "(I ended my turn without a reply.)" || r.item.text === "")).length,
    subAgentSends: recs.filter((r) => r.item.type === "tool_call" && r.item.name === "message_sub_agent").length,
    toolErrors: recs.filter((r) => r.item.type === "tool_result" && String(r.item.output).startsWith("Error")).length,
    listAgents: calls.filter((r) => r.item.name === "list_agents").length,
    unsentText: recs.filter((r) => r.item.type === "message" && r.item.role === "assistant" && !finalSet.has(r) && r.item.text.trim() !== "").length,
    urgent: calls.filter((r) => r.item.input?.urgent).length,
    errors: recs.filter((r) => r.kind === "error").length,
    seconds: Math.round((Date.now() - start) / 1000),
  };
  writeFileSync(join(outdir, `${label}.txt`), JSON.stringify(m) + "\n\n" + lines.join("\n") + "\n");
  return m;
}

mkdirSync(outdir, { recursive: true });
const results = [];
try {
  const chosen = scenarios.filter((s) => only.length === 0 || only.includes(s.name));
  // Scenarios run in parallel; each has its own root.
  const jobs = chosen.flatMap((s) => Array.from({ length: runs }, (_, r) => runScenario(s, `${s.name}-${r + 1}`)));
  for (const r of await Promise.allSettled(jobs)) results.push(r.status === "fulfilled" ? r.value : { error: String(r.reason) });
} finally {
  const q = (a: string[]) => spawnSync("docker", a, { encoding: "utf8" });
  const cs = q(["ps", "-aq", "--filter", `label=jen.runtime=${name}`]).stdout.split("\n").filter(Boolean);
  q(["rm", "-f", `${name}-runtime`, ...cs]);
  const vs = q(["volume", "ls", "-q", "--filter", `label=jen.runtime=${name}`]).stdout.split("\n").filter(Boolean);
  if (vs.length) q(["volume", "rm", ...vs]);
  q(["network", "rm", name]);
}
writeFileSync(join(outdir, "summary.json"), JSON.stringify(results, null, 1));
console.table(results);
