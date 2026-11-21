# Contributing to jen

Thanks for helping. Bug reports, fixes and ideas are all welcome.

## Before you start

- **A bug or a small fix:** open a pull request, or an issue if you'd rather describe it.
- **Anything larger,** such as a new feature or a change to how agents behave: open an issue first, so we can agree on the approach before you spend time on it.

jen's design decisions and the reasons for them are in [`record/`](record/README.md), and its behavior is specified in [`openspec/specs/`](openspec/specs). Reading the parts your change touches saves a round of review.

## Working on jen

You need Node 26 or later and Docker with Engine 28.0 or later. `record/environment.md` shows how to build the images and run jen from a checkout, with `npm link`.

```sh
npm ci
npm run check   # types
npm test        # unit tests
```

The live checks (`npm run test:live`) run real agents and need a model key, so CI doesn't run them, and you needn't either. Say in your pull request if your change could affect them.

## Pull requests

- Keep each one to one change, and say what it fixes or adds and how you checked it.
- CI runs once a maintainer approves your pull request's workflows.
- Pull requests are squash-merged, so the title becomes the commit's subject. Make it say what the change does.
- Every merge to `main` that changes what ships releases a new version of jen.

## License

jen is licensed under the [Apache License 2.0](LICENSE). By sending a contribution, you agree that it's licensed under the same terms, as section 5 of the license says.
