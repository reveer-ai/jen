# Proposal

## Why

jen has no code yet. Every later milestone (the container, delegation, the UI engine) runs on the agent loop, and the loop runs on model access. The 2026-10-26 decisions in `context/decisions.md` settled that jen builds its own loop on a model port it defines. This change builds both, plus the TypeScript project they live in ([JEN-7](https://linear.app/reveer/issue/JEN-7)).

The port and the loop carry only what this milestone needs: a conversation with tool calls. Everything else is added when something uses it.

## What Changes

- **TypeScript project.** A single npm package on Node 26, with build, typecheck, tests and GitHub Actions CI.
- **Model port.** jen's own interface for asking a model for its next turn, in jen's terms. jen keeps the conversation; the model is sent all of it on each call.
- **Scripted fake model.** A port implementation that plays back scripted turns and records what it was sent. It's the loop's test fixture.
- **OpenAI Responses adapter.** The first real adapter, and the only module that imports the `openai` SDK. It reaches OpenAI, or OpenRouter by base URL, with an API key.
- **Agent loop.** It takes a user message, calls the model, runs the tools the model asks for, feeds the results back, and repeats until the model answers without a tool call. A failing tool goes back to the model as its result instead of crashing the loop.
- **Live check.** A test that runs the loop against a real model through the Responses adapter. It's skipped unless credentials are set.

## Capabilities

### New Capabilities

- `agent-loop`: how a jen agent runs a conversation turn: calling the model, running tools, feeding results back and ending the turn.
- `model-port`: the contract between jen and any model, and the scripted fake that implements it.
- `openai-responses-adapter`: how the port maps onto the OpenAI Responses API, for OpenAI and compatible endpoints such as OpenRouter.

### Modified Capabilities

None. There are no specs yet.

## Impact

- New code under `src/`, plus `package.json`, `tsconfig.json` and `.github/workflows/ci.yml`.
- New runtime dependency: `openai`. New dev dependencies: `typescript`, `vitest`, `@types/node`.
- The live check needs an OpenAI or OpenRouter API key and a model name.
