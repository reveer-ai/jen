// Plans a release of jen from the commit checked out, for the release
// workflow (.github/workflows/release.yml):
//
//   node scripts/release.ts plan >> "$GITHUB_OUTPUT"
//
// It prints `release`, true or false, and when true the `version` and the
// `notes`, as the workflow's outputs, and says what it decided on stderr. The
// last release is the highest v<x.y.z> tag reachable from HEAD. What ships is
// the commits since then that change the package or the images. Their pull
// requests' labels choose the bump, and their subjects are the notes. It reads
// the labels from the GitHub API, with GITHUB_TOKEN, in GITHUB_REPOSITORY.

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

// What ships: the packages and the images. README.md, LICENSE and NOTICE are
// in the packages, and LICENSE and NOTICE in the images too. The launcher's
// tests are Swift's, under its Tests/.
export const SHIPS = ["src", ":(exclude,glob)src/**/*.test.ts", ":(exclude,glob)src/machine/launcher/Tests/**", "package.json", "package-lock.json", "Dockerfile", "README.md", "LICENSE", "NOTICE"];
export const FIRST = "0.1.0";

export type Bump = "major" | "minor" | "patch";

export interface Deps {
  // Runs git with args in the repo, answering its stdout.
  git: (args: string[]) => Promise<string>;
  // A pull request's labels.
  labels: (pr: number) => Promise<string[]>;
}

export type Plan = { release: false; last?: string } | { release: true; last?: string; version: string; bump?: Bump; notes: string };

type Version = [number, number, number];
const parse = (tag: string): Version | undefined => {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
};
const compare = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export function bumped([major, minor, patch]: Version, bump: Bump): string {
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export async function plan({ git, labels }: Deps): Promise<Plan> {
  const tags = (await git(["tag", "--merged", "HEAD", "--list", "v*"])).split("\n").map((t) => t.trim());
  const versions = tags.map(parse).filter((v): v is Version => v !== undefined).sort(compare);
  const last = versions.at(-1);
  const since = last ? `v${last.join(".")}..HEAD` : "HEAD";
  const commits = (await git(["log", "--format=%s", since, "--", ...SHIPS])).split("\n").filter((s) => s.trim() !== "");
  const lastName = last && last.join(".");
  if (commits.length === 0) return { release: false, ...(lastName ? { last: lastName } : {}) };
  const notes = commits.map((subject) => `- ${subject}`).join("\n");
  if (!last) return { release: true, version: FIRST, notes };

  let bump: Bump = "patch";
  for (const subject of commits) {
    // A squash merge's subject ends with its pull request's number.
    const pr = /\(#(\d+)\)$/.exec(subject)?.[1];
    if (pr === undefined) continue;
    const found = await labels(Number(pr));
    if (found.includes("major")) bump = "major";
    else if (found.includes("minor") && bump === "patch") bump = "minor";
  }
  return { release: true, last: lastName!, version: bumped(last, bump), bump, notes };
}

// The plan as GitHub Actions outputs, the notes in its multiline form.
export function outputs(planned: Plan, delimiter = `NOTES_${randomBytes(8).toString("hex")}`): string {
  if (!planned.release) return "release=false\n";
  return `release=true\nversion=${planned.version}\nnotes<<${delimiter}\n${planned.notes}\n${delimiter}\n`;
}

export function describe(planned: Plan): string {
  const since = planned.last ? `since v${planned.last}` : "in any release";
  if (!planned.release) return `nothing that ships changed ${since}, so nothing is released.`;
  const why = planned.bump ? `, a ${planned.bump} release` : ", the first release";
  return `releasing ${planned.version}${why}, with what changed ${since}:\n${planned.notes}`;
}

const run = promisify(execFile);

export const realGit: Deps["git"] = async (args) => (await run("git", args, { maxBuffer: 64 * 1024 * 1024 })).stdout;

export function githubLabels(repository: string, token: string | undefined, fetcher: typeof fetch = fetch): Deps["labels"] {
  return async (pr) => {
    const res = await fetcher(`https://api.github.com/repos/${repository}/issues/${pr}/labels`, {
      headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    // A number that isn't a pull request's, or no longer exists, has none.
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for #${pr}'s labels: ${await res.text()}`);
    return ((await res.json()) as { name: string }[]).map((label) => label.name);
  };
}

if (import.meta.main) {
  if (process.argv[2] !== "plan") {
    process.stderr.write("usage: node scripts/release.ts plan\n");
    process.exit(2);
  }
  try {
    const planned = await plan({ git: realGit, labels: githubLabels(process.env.GITHUB_REPOSITORY || "reveer-ai/jen", process.env.GITHUB_TOKEN) });
    process.stderr.write(`${describe(planned)}\n`);
    process.stdout.write(outputs(planned));
  } catch (error) {
    process.stderr.write(`release: ${(error as Error).message}\n`);
    process.exit(1);
  }
}
