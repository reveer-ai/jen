# Proposal

## Why

The agent loop from [JEN-7](https://linear.app/reveer/issue/JEN-7) runs only inside a test, and its conversation lives in memory for a single call. The 2026-10-26 decisions in `context/decisions.md` made each jen agent an OCI container, with a mounted volume and SQLite on that volume. This change packages the agent that way ([JEN-8](https://linear.app/reveer/issue/JEN-8)). The container is the agent. The loop runs in it, its state lives there, and it is the boundary for whatever the agent will be allowed to do. Delegation and invocation both build on an agent that exists and remembers.

The container matches the agent as it is today. It has no tools, its only state is its conversation, and it runs once per message. It grows as the agent grows.

## What Changes

- **Agent store.** The agent keeps its conversation in a SQLite database on its state volume. It uses Node's built-in `node:sqlite`, so there's no native dependency. Each completed turn is saved whole. A failed turn saves nothing, which matches the loop's existing all-or-nothing contract.
- **Agent entrypoint.** One process handles one message:
  - opens the store and runs one turn on the stored conversation with that message
  - saves the turn
  - prints the assistant's reply and exits

  The model and its credentials come from environment variables, through the OpenAI Responses adapter. When an agent stays awake, and how it's reached over the network, belong to [JEN-9](https://linear.app/reveer/issue/JEN-9) and later work. They'll replace this entrypoint's interface rather than extend it.
- **OCI image.** A `Dockerfile` that runs the agent on Node 26 from the TypeScript sources, as a non-root user, with its state directory declared as a volume. The image holds Node and the agent's code, and nothing else.
- **Persistence check.** A check that runs two messages in two separate containers on the same volume, and confirms that the second turn sees the first. This is JEN-8's done condition. It needs a container runtime and model credentials, so it runs with the live checks and not in CI. The store's own behavior is unit-tested without either.

## Capabilities

### New Capabilities

- `agent-store`: how an agent persists its conversation: where it lives, what is saved when, and what a fresh start loads.
- `agent-container`: how an agent is packaged and run: the image, the state volume, the model configuration it reads, and the entrypoint's one-message contract.

### Modified Capabilities

None. The loop's contract already lets its caller own the conversation, so the store sits beside the loop without changing it.

## Impact

- New code under `src/` for the store and the entrypoint, plus a `Dockerfile` and `.dockerignore`.
- No new npm dependencies.
- The persistence check needs Docker (or another OCI runtime) and the same credentials as the existing live check.
