<p align="center">
  <img src="src/assets/app-logo.svg" width="120" alt="EMBER SLEAP logo"/>
  <h1 align="center">EMBER SLEAP</h1>
  <p align="center">
    <a href="https://codecov.io/github/brain-bbqs/ember-sleap?branch=main"><img src="https://codecov.io/github/brain-bbqs/ember-sleap/coverage.svg?branch=main" alt="codecov"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="License: MIT"></a>
    <a href="https://github.com/prettier/prettier"><img alt="code style: prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat"></a>
  </p>
</p>

Label, train and predict with [SLEAP](https://sleap.ai) on data in the [EMBER archive](https://dandi.emberarchive.org): the SLEAP web app embedded in a BBQS page that opens and saves projects on EMBER.

---

Built & maintained by the [Center for Open Neuroscience](https://centerforopenneuroscience.org).

Funded by the [National Institutes of Health (NIH)](https://www.nih.gov/brain/research/data-knowledge-resources) grant [R24 MH136632](https://reporter.nih.gov/search/kDbcoCvju0ymZz0fI3zvhA/project-details/10888659) as a part of the [Brain Behavior Quantification and Synchronization (BBQS)](https://brain-bbqs.org/) consortium.

## Status: prototype

This is the ember-sleap side of [the development plan](docs/DEVELOPMENT_PLAN.md).
The SLEAP web app does not publish an embeddable component yet, so a **stand-in** (`src/ui/sleapStandIn.ts`) mounts in its place.
The stand-in does none of SLEAP's work.
It drives the same host callbacks the real component will, through the contract proposed upstream (`src/lib/sleapContract.ts`, [docs/UPSTREAM_PROPOSAL.md](docs/UPSTREAM_PROPOSAL.md)).
Swapping in the real package is a change to one function, `loadSleapComponent` in `src/ui/sleapComponent.ts`.

| Piece                                                  | State                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Open a `.slp` or `.pkg.slp` from any readable dandiset | Works against the live archive                                                                                            |
| Save to `derivatives/sleap/` as a BIDS derivative      | Works end to end against a mocked archive; needs sign-in                                                                  |
| EMBER sign-in                                          | Wired, but off until EMBER registers an OAuth app for this page                                                           |
| Model catalogue (Hugging Face, EMBER, central index)   | Sources written and unit-tested; the index dandiset does not exist yet                                                    |
| Training and inference                                 | Run on an in-browser stub until the central Pennsieve proxy's job API exists ([docs/COMPUTE_API.md](docs/COMPUTE_API.md)) |

Try it with [`?dandiset=000398`](https://brain-bbqs.github.io/ember-sleap/?dandiset=000398) (a public SLEAP example) or offline with [`?test&mock_project`](https://brain-bbqs.github.io/ember-sleap/?test&mock_project).

## Local development

```bash
npm ci
npm run dev              # the app, with hot reload
npm test                 # unit tests (add `:coverage`, or `:watch`)
npm run test:integration # Playwright, against a fresh build
npm run lint && npm run typecheck
```

Set `PLAYWRIGHT_CHROMIUM_PATH` to reuse a browser already on the machine instead of `npx playwright install`.
Live test injections are listed in [docs/README.md](docs/README.md).
