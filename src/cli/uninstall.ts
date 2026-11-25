// jen uninstall: deletes everything jen ever made in Docker, then the
// command's npm package when it was installed globally with npm, since npm
// runs no script of a package as it's uninstalled. It goes through no
// runtime, which is removed too, so it works when one can't start. On macOS it
// deletes jen's machine instead, which holds all of it, without starting it.

import { realpathSync } from "node:fs";
import { join, sep } from "node:path";
import type { Runner } from "./docker.ts";
import type { Machine } from "./machine.ts";
import type { Context } from "./runtime.ts";
import { IMAGE_KEYS, Refusal, REGISTRY, registryRepository, runtimeContainer } from "./settings.ts";

export const QUESTION = "this deletes every agent's conversation and files, and can't be undone. Continue? [y/N] ";
// The package's name on npm.
const PACKAGE = "jen-ai";

// The exit code: 0 once everything is removed, 1 when the user declined or a
// step failed.
export async function uninstall(ctx: Context, { mainPath, npm, machine }: { mainPath: string; npm: Runner; machine?: Machine }): Promise<number> {
  if (!ctx.terminal.interactive) throw new Refusal("jen uninstall asks before it deletes anything, so it needs a terminal.");
  const answer = (await ctx.terminal.ask(QUESTION)).trim();
  // A blank line between the answer and what follows.
  ctx.say("");
  if (answer !== "y") {
    ctx.print("nothing was removed.");
    return 1;
  }

  const failures: string[] = [];
  const step = async (what: string, act: () => Promise<void>) => {
    try {
      await act();
    } catch (error) {
      failures.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  if (machine) {
    await step(`deleting jen's machine in ${machine.folder}`, () => machine.remove(ctx));
    if (failures.length === 0) ctx.print("deleted jen's machine, with every agent's conversation and files, the runtime, the settings and the images.");
  } else await removeFromDocker(ctx, step);

  if (failures.length > 0) {
    for (const failure of failures) ctx.say(`jen: ${failure}`);
    ctx.say(`some of jen is left${machine ? "" : " in Docker"}, and so is the command, to remove it with. Run jen uninstall again once that's fixed.`);
    return 1;
  }

  if (await installedWithNpm(mainPath, npm)) {
    const output = await npm("npm", ["uninstall", "-g", PACKAGE]);
    if (output.code !== 0) {
      ctx.say(`jen: npm uninstall -g ${PACKAGE} failed: ${output.stderr.trim()}`);
      return 1;
    }
    ctx.print(`uninstalled the ${PACKAGE} package. jen is gone.`);
  } else {
    ctx.print("the jen command itself wasn't installed with npm install -g, so remove it the way it was installed. From a checkout linked with npm link, that's: npm unlink -g jen");
  }
  return 0;
}

// Removes every container, volume, network and image of jen's from the
// engine, recording each failure with step and carrying on.
async function removeFromDocker(ctx: Context, step: (what: string, act: () => Promise<void>) => Promise<void>): Promise<void> {
  const { docker, names } = ctx;
  const label = `jen.runtime=${names.name}`;
  let agents = 0;
  await step("counting the agents", async () => void (agents = (await docker.volumes([label, "jen.agent"])).length));

  // The runtime first, so none watches its agents go. By name, which also
  // finds one started by hand without the label.
  await step(`removing ${runtimeContainer(names.name)}`, () => docker.remove(runtimeContainer(names.name)));
  await step("listing jen's containers", async () => {
    for (const c of await docker.containers([label])) await step(`removing container ${c.name}`, () => docker.remove(c.id));
  });
  // Volumes after containers, since Docker won't remove one in use.
  await step("listing jen's volumes", async () => {
    for (const v of await docker.volumes([label])) await step(`removing volume ${v}`, () => docker.removeVolume(v));
  });
  await step(`removing network ${names.name}`, () => docker.removeNetwork(names.name));
  // The images by their current names, and every version of the registry's
  // that the environment doesn't name others in place of, such as one an
  // earlier version left.
  const named = IMAGE_KEYS.map((key) => names[key]);
  const registry = IMAGE_KEYS.filter((key) => !names.overridden.includes(key)).map(registryRepository);
  await step("listing jen's images", async () => {
    if (registry.length === 0) return;
    for (const listed of await docker.listImages(`${REGISTRY}/jen-*`)) {
      if (registry.some((repository) => listed.startsWith(`${repository}:`)) && !named.includes(listed)) named.push(listed);
    }
  });
  const images: string[] = [];
  for (const image of named) {
    await step(`removing image ${image}`, async () => {
      if ((await docker.imageId(image)) === undefined) return;
      await docker.removeImage(image);
      images.push(image);
    });
  }

  ctx.print(`removed ${agents === 1 ? "1 agent" : `${agents} agents`} with their conversations and files, the runtime, the settings${images.length ? ` and the images ${images.join(", ")}` : ""}.`);
}

// Whether the running main.ts, or the package's main.js, is inside the
// global npm folder's package.
async function installedWithNpm(mainPath: string, npm: Runner): Promise<boolean> {
  const output = await npm("npm", ["root", "-g"]);
  if (output.code !== 0) return false;
  try {
    const root = realpathSync(output.stdout.trim());
    return realpathSync(mainPath).startsWith(join(root, PACKAGE) + sep);
  } catch {
    return false;
  }
}
