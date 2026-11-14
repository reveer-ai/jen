# Product

## What jen is

jen is a harness for AI agents. A jen agent runs in its own container. It can delegate work to sub-agents, and each sub-agent is the same kind of agent, one level deeper. Agents use hosted AI models, not local inference. jen can run locally, for example from a terminal, or be hosted for users to reach through a web or app interface.

**The agents are the UI.** jen isn't a UI, website or app built to serve agents. Each agent presents itself to the user through UI it generates. This is jen's core concept, and it should shape design decisions.

**Agents build the software people work in.** jen generates the software an organization runs on, such as its messaging and its boards, in place of separate products. Agents build what should be built without being told. Many people use it and talk to each other through it, and the agent sees everything that happens there and acts on it.

**Logic lives in the weights.** As much of jen's behavior as possible comes from the model, not from code: when to delegate, what to ask, how agents work together. Code supplies mechanism, and decides behavior only where security, reliability or performance demand it. The architecture shouldn't constrain how an agent naturally behaves. For example, a sub-agent can ask its parent clarifying questions or launch sub-agents of its own, the same as any agent. jen is built for tomorrow's models: where today's fall short, it leaves room for better ones rather than deciding for them.

**Agents that present themselves set jen apart** from other agent runtimes, such as Agent Substrate ([ate.dev](https://ate.dev)), which runs sandboxed agents on Kubernetes.

**jen is also a service.** Any application, including traditional ones with static UIs, can connect to jen, local or hosted, the way it would to any other API.

## Company

jen is built by **reveer**. The GitHub org is `reveer-ai` and the Linear workspace is `reveer`.
