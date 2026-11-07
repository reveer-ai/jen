import { readFileSync, readdirSync } from "node:fs";
const ideal = { haiku: [1, 2], direct: [1, 0], fanout: [1, 6], clarify: [2, 2], followup: [2, 4], nested: [1, 6], thanks: [1, 3] };
for (const set of process.argv.slice(2)) {
  let owner = 0, clean = 0, n = 0; const bad = [];
  for (const dir of set.split("+")) for (const f of readdirSync(dir).filter((f) => f.endsWith(".txt"))) {
    const m = JSON.parse(readFileSync(`${dir}/${f}`, "utf8").split("\n")[0]); n++;
    const [o, s] = ideal[m.scenario.split("-")[0]];
    if (m.ownerSends === o) owner++;
    const why = [];
    if (m.ownerSends !== o) why.push(`owner=${m.ownerSends}`);
    if (m.interAgentSends !== s) why.push(`sends=${m.interAgentSends}`);
    for (const k of ["toolErrors", "listAgents", "unsentText", "urgent", "errors", "ownerSoft", "softReplies", "endedEmpty"]) if (m[k]) why.push(`${k}=${m[k]}`);
    if (why.length) bad.push(`${dir}/${m.scenario}: ${why.join(" ")}`); else clean++;
  }
  console.log(`${set}: owner ideal ${owner}/${n}, clean ${clean}/${n}`); for (const b of bad) console.log("  " + b);
}
