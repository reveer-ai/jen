# Proposal

## Why

Since [JEN-20](https://linear.app/reveer/issue/JEN-20), an agent with the `workspace` grant can read, write and edit files only through `run_command`, and that tool was built for commands, not files. Its output is capped at about 8 KB, so a longer file comes back without its middle. A file's content has to be written into the command itself, within 64 KB as sent and through shell quoting, where a mistake corrupts the file without an error. An edit is a `sed` pattern that exits 0 when it matches nothing, or a rewrite of the whole file. And the agent's own code can't get a file's exact bytes at all: the command route's output is capped, decoded as text, and only its first line can be trusted. [JEN-18](https://linear.app/reveer/issue/JEN-18) needs exactly that, to collect an agent's `ui/` folder into one document.

This change ([JEN-19](https://linear.app/reveer/issue/JEN-19)) gives an agent file tools in its workspace. They run inside the boundary JEN-20 set and add none of their own: they can reach exactly what a command can.

## What Changes

- **The runtime moves a file's exact bytes in and out of the caller's own workspace.** A new route reads a whole file and writes a whole file, binary included, up to a fixed size. The runtime does both in the workspace container, as the `agent` user, the way it runs a command. So a file can be read or written exactly where a command could read or write it, and nowhere else: no path rules, no second user, nothing of the engine's acting with more rights than a command. Only an agent with `workspace` may call it, on its own workspace, as with commands.
- **Three generic file tools for the model**, offered with `workspace` beside `run_command`, each built in the agent's code on that route:
  - `read_file` reads a text file, or a range of its lines, capped for the conversation.
  - `write_file` writes a whole file, creating its folders.
  - `edit_file` replaces an exact string, which must match once unless every match is asked for, and fails saying why when it doesn't.
- **The tools are plain function tools, the same for every model.** jen is model-agnostic: any model behind any adapter must work well with them. Exact string replacement is the edit shape most widely used across model families. Providers' own tools, such as OpenAI's built-in `apply_patch` or Anthropic's text editor tool, are trained into their own models only, and an adapter belongs to an API, not a model family: the Responses adapter can reach any model through OpenRouter. Native tools are revisited only if the behavior check shows a model editing badly with these.
- **`run_command`'s description points to the file tools** for writing files, in place of writing a large file in parts.
- **The boundary check covers the file route**, and **the behavior check gains a task that needs the file tools**: create a file, then change part of it, judged by the file left in the workspace.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-workspace`: the file route and its refusals and bound, the three file tools, `run_command`'s description, and the boundary check's file scenarios.
- `agent-delegation`: tools follow the grant, so `workspace` offers the file tools with `run_command`. The behavior check gains its file task.

## Impact

- **Runtime code:** the route in `src/runtime/server.ts`, reading and writing in `src/runtime/runtime.ts`, an exec that takes input in `src/runtime/docker.ts`, and the same in `src/runtime/fake-docker.ts` for the unit tests.
- **Agent code:** the tools in `src/agent/workspace.ts`, and a way for `RuntimeClient` (`src/agent/delegation.ts`) to send and receive bytes rather than JSON. The tools' descriptions are behavior, so the behavior check runs on `openai/gpt-6-luna`, as `src/agent/AGENTS.md` requires.
- **[JEN-18](https://linear.app/reveer/issue/JEN-18)** builds `publish_ui` on the route, and has its agent write `ui/` with the file tools.
- **Docs:** `docs/architecture.html` gains the file route beside the command route.
- **Nothing to migrate.** No image changes, and no grant changes: `workspace` already covers every tool in the workspace.
