<p align="center">
  <img src="src/assets/sleap-logo.png" width="120" alt="SLEAP logo"/>
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
The page mounts the real SLEAP web app, built as a component on our fork, [brain-bbqs/sleap-app](https://github.com/brain-bbqs/sleap-app) (`embed/integration`), through the contract proposed upstream (`src/lib/sleapContract.ts`, [docs/UPSTREAM_PROPOSAL.md](docs/UPSTREAM_PROPOSAL.md)).
It is installed from the fork's `embed/package` branch as `@talmolab/sleap-app`, pinned to a commit in `package.json`, and served beside the page at `sleap-app/` (`configs/sleapAppPackage.ts`).
Nothing has been sent upstream: this is a test run of that path.
A **stand-in** (`src/ui/sleapStandIn.ts`) still drives the host's callbacks for the `?test` mocks and the unit tests, and for what the real app does not reach through the host yet (model catalogue, compute, predictions).

| Piece                                                  | State                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| The page                                               | The real SLEAP app (labeling included) between a BBQS header and footer, dark only                                        |
| Open a `.slp` or `.pkg.slp` from any readable dandiset | Works against the live archive                                                                                            |
| Start a new project on a dandiset's videos             | Picking a dandiset with no SLEAP project, or New Project, starts one in the SLEAP app, which reads the videos from EMBER  |
| Save to `derivatives/sleap/` as a BIDS derivative      | Works end to end against a mocked archive; needs sign-in                                                                  |
| EMBER sign-in                                          | On, with ember-sleap's own OAuth app on EMBER; redirect URIs still to confirm                                             |
| Model catalogue (Hugging Face, EMBER, central index)   | Sources written and unit-tested, top-down models included; the index dandiset does not exist yet                          |
| Training and inference                                 | Run on an in-browser stub until the central Pennsieve proxy's job API exists ([docs/COMPUTE_API.md](docs/COMPUTE_API.md)) |
| Models and compute in the real app                     | Not wired through the host yet (plan PRs 7b and 7c): the real app offers its own, the stand-in the host's                 |

Try it with [`?dandiset=000398`](https://brain-bbqs.github.io/ember-sleap/?dandiset=000398) (a public SLEAP example) or offline with [`?test&mock_project`](https://brain-bbqs.github.io/ember-sleap/?test&mock_project) and [`?test&mock_new_project`](https://brain-bbqs.github.io/ember-sleap/?test&mock_new_project).

## Local development

```bash
npm ci
npm run dev              # the app, with hot reload
npm test                 # unit tests (add `:coverage`, or `:watch`)
npm run test:integration # Playwright, against a fresh build
npm run lint && npm run typecheck
npm run check-model-index -- docs/examples/models.json
```

Set `PLAYWRIGHT_CHROMIUM_PATH` to reuse a browser already on the machine instead of `npx playwright install`.
Live test injections are listed in [docs/README.md](docs/README.md).
