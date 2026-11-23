# Development

## Local development

```bash
npm ci
apm install --frozen     # the agent skills, into .claude/skills/ and .agents/skills/ (`pipx install apm-cli`)
npm run dev              # the app, with hot reload
npm test                 # unit tests (add `:coverage`, or `:watch`)
npm run test:integration # Playwright, against a fresh build
npm run lint && npm run typecheck
```

Set `PLAYWRIGHT_CHROMIUM_PATH` to reuse a browser already on the machine instead of `npx playwright install`.

## Live test injections

None yet: the page has a single state.
`?test` alone is a no-op that never changes anything by itself.

## Expected console noise

None at present.
Add a note here for any expected warning or failed request a person might otherwise report as a bug.

Add an injection table here for the first injection the app grows, and read the `visual-snapshots` skill (installed by `apm install --frozen`) before adding one.
