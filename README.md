# jen

jen runs AI agents on your machine. Each agent runs in its own container, delegates work to sub-agents of its own kind, and presents itself to you through a UI it builds, which you open in your browser. You talk to your agents from the terminal or that UI.

## What you need

- **Node 26** or later, from [nodejs.org](https://nodejs.org).
- **Docker**, with Docker Engine 28.0 or later: [Docker Desktop](https://docs.docker.com/desktop/) on macOS, or [Docker Engine](https://docs.docker.com/engine/install/) on Linux. jen starts Docker Desktop itself when it isn't running.
- **A key for a model provider that serves OpenAI's Responses API**, such as OpenAI or OpenRouter. Agents use hosted models and run none of their own.

jen runs on macOS and Linux.

## Install

```sh
npm install -g jen-ai
```

The command is `jen`. In zsh, a `?` or `*` in a query is a pattern, so add this to `~/.zshrc` to pass them to jen as typed:

```sh
alias jen='noglob jen'
```

## Use

```sh
jen new home
jen @home Remember the word heron.
jen @home open
```

`jen new home` creates an agent named `home`. The first time, jen pulls its images and asks for the model, its base URL, such as `https://api.openai.com/v1` or `https://openrouter.ai/api/v1`, and your key, which `jen config` changes later. `jen @home <query>` sends `home` a query, shows its progress and prints its reply. `jen @home open` opens its UI in your browser.

Agents keep running until you stop them, and keep their conversations and files when stopped. `jen stop all` stops every agent. `jen help` lists every command.

## Uninstall

```sh
jen uninstall
```

It deletes every agent, its conversation and files, jen's settings and images, and then the command itself. `npm uninstall -g jen-ai` alone would leave all of that in Docker.

## License

jen is free to install and use, for any purpose. Its code isn't open source: see [LICENSE](LICENSE).
