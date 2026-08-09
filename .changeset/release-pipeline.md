---
"@reveer/jen": minor
---

Release the package from GitHub Actions with no stored credential. A changeset on a merged pull request opens a Version Packages pull request; merging that publishes to npm, authenticating by trusted publishing rather than a token, and records the release as a git tag and a GitHub Release.
