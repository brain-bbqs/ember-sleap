# Live Testing

## Live test injections

| URL                      | What it should look like                                                                                 | Try it                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `?test&mock_project`     | The SLEAP stand-in with a mock project open, whose first bytes read as HDF5                              | [Open](https://brain-bbqs.github.io/ember-sleap/?test&mock_project)     |
| `?test&mock_new_project` | A new, unsaved project on two mock videos, as choosing a dandiset with no SLEAP project starts           | [Open](https://brain-bbqs.github.io/ember-sleap/?test&mock_new_project) |
| `?test&stand_in`         | The SLEAP stand-in in place of the real app, against the real archive (add `&dandiset=<id>` to list one) | [Open](https://brain-bbqs.github.io/ember-sleap/?test&stand_in)         |

`?test` alone (without one of the above) opens on the SLEAP app's start screen as the page always does, and is a no-op that never changes anything by itself.

Every fake is obviously fake: the mock project is named `test-injection-mock-project.slp` and lives in a dandiset called `mock`.
Nothing is written to `localStorage` or to the archive, so all of the above are safe to try at any time.

`mock_project` hands a synthesized project to the same open path a project from EMBER takes, served from a `data:` URL that, like an archive link, says nothing about the file's type.
Saves go to an in-memory store that places them exactly where EMBER storage would, named by `memory://` links that nothing fetches.
The Chromatic project-open snapshot uses this to capture the state deterministically.

Every mock mounts the SLEAP stand-in (`src/ui/sleapStandIn.ts`) rather than the real app: the mocks' synthesized files are not real `.slp` projects or videos, and the stand-in's controls are what the specs drive.
`stand_in` mounts the stand-in on its own, with the real archive and sign-in, which is how `tests/integration/ember.spec.ts` drives the host's save sequence.

`mock_new_project` hands a synthesized new project to the same `create` path a dandiset with no SLEAP project takes, with the same in-memory saves as `mock_project`.
Its two videos sit at `sub-mock/beh/sub-mock_test-injection-mock-video-{1,2}.mp4` and are empty `data:` URLs no player can show, so the canvas is the same on every run.
Saving writes the new project's real `.slp` in the browser and lands it as `derivatives/sleap/sub-mock/beh/sub-mock_desc-labelsTestInjectionMockVideo1_pose.slp` in memory.
The Chromatic new-project snapshot uses this.

## Deep links

`?dandiset=<id>` opens the project picker with the dandiset filled in and lists its projects on load (or, when it has none, starts a new project on its videos), e.g. [`?dandiset=000398`](https://brain-bbqs.github.io/ember-sleap/?dandiset=000398).
This is a real request to the archive, not a test injection.

## Expected console noise

None at present.
Add a note here for any expected warning or failed request a person might otherwise report as a bug.

Add a row to the injection table for every injection the app grows, and read the `visual-snapshots` skill under `.claude/skills/` before adding one.
