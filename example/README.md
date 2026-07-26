# express-fast-json-stringify example

Boots a real Express server exposing the same payload twice — once through
`res.json()`, once through `res.fastJson()` — then prints both responses so you
can compare status, headers and body, including the conditional request that
answers `304`.

```sh
npm install
npm run example
```

Or run it without cloning anything, on
[StackBlitz](https://stackblitz.com/github/nigrosimone/express-fast-json-stringify):
`.stackblitzrc` in the repository root points it at this example.

The example imports the middleware straight from `../src`, so any change you
make to the source is picked up on the next run — no build step needed.
