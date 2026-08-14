---
"@reveer/jen": minor
---

Teach `setup-jen` to establish the identities the pipeline acts under, and document them in the `registry.yaml` stub. A pipeline that authenticates as the person who launched it cannot review its own work — GitHub refuses a review from a pull request's own author — so the review stage records advisory prose where a merge gate belongs.

Binding now covers four identities: a GitHub App per role in your own organization — `design` for `design-task`, `dev` for `implement-task`, `deliver` for `review-task`, `test-task`, and `deliver-task` — and one Linear agent shared by all six stages. Each is registered by you, on the host, with the skill pre-filling what it can and then verifying what was actually granted rather than that something exists: an App created with no repository permissions installs cleanly and mints tokens that can do nothing, and nothing downstream reports it. Registration spanning two hosts and four browser visits is expected to take more than one sitting, so a half-registered project is a supported state — the run names exactly what is outstanding, leaves what exists alone, and completes the rest of the binding.

`setup-jen` also checks that your default branch requires an approving review postdating the last push, which is what makes a review verdict load-bearing rather than advisory. It presents the exact change and applies it only if you agree; declining leaves the gate reported as outstanding.

No credential is written to `registry.yaml` or to any other file. The registry names identities; your environment supplies what authenticates them.

Projects already on jen pick this up with `jen update`, and then a re-run of `setup-jen`.
