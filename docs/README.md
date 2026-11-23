# Live Testing

## Live test injections

| URL                                                            | What it should look like                                                                                             | Try it                                                                                                        |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `?test&mock_project`                                           | The SLEAP stand-in with a mock project open, whose first bytes read as HDF5                                          | [Open](https://brain-bbqs.github.io/ember-sleap/?test&mock_project)                                           |
| `?test&mock_project&mock_predictions`                          | The same, with one file under "Predictions" above the app (after about a second): the mock project's own predictions | [Open](https://brain-bbqs.github.io/ember-sleap/?test&mock_project&mock_predictions)                          |
| `?test&mock_project&mock_predictions&mock_predictions_missing` | The same; clicking the listed file says it is not on EMBER yet, with "Try again"                                     | [Open](https://brain-bbqs.github.io/ember-sleap/?test&mock_project&mock_predictions&mock_predictions_missing) |
| `?test&mock_new_project`                                       | A new, unsaved project on two mock videos, as choosing a dandiset with no SLEAP project starts                       | [Open](https://brain-bbqs.github.io/ember-sleap/?test&mock_new_project)                                       |
| `?test&stand_in`                                               | The SLEAP stand-in in place of the real app, against the real archive (add `&dandiset=<id>` to list one)             | [Open](https://brain-bbqs.github.io/ember-sleap/?test&stand_in)                                               |

`?test` alone (without one of the above) opens on the SLEAP app's start screen as the page always does, and is a no-op that never changes anything by itself, and so are `mock_predictions` and `mock_predictions_missing` without `mock_project`.

Every fake is obviously fake: the mock project is named `test-injection-mock-project.slp`, lives in a dandiset called `mock`, and the models are named "Test injection model".
Nothing is written to `localStorage` or to the archive, so all of the above are safe to try at any time.

`mock_project` hands a synthesized project to the same open path a project from EMBER takes, served from a `data:` URL that, like an archive link, says nothing about the file's type.
Saves go to an in-memory store that places them exactly where EMBER storage would, the model list is two fixed cards, a single-instance model and a two-folder top-down one (plus any model trained on the stub since), and jobs run on the in-browser compute stub with short ticks.
Training after "Make an edit" keeps the edits in that store as a training package, so it runs offline too; saved files are named by `memory://` links that nothing fetches.
The Chromatic project-open snapshot uses this to capture the state deterministically.

`mock_predictions` runs inference on the mock project once it is open, submitted and followed through the host and the compute stub as "Predict" is, but without the stand-in's job pane.
The file the stub reports, `derivatives/sleap/sub-mock/beh/sub-mock_desc-predictionsTestInjectionMockProject_pose.slp`, then reaches the list through the same checks a finished job's predictions go through.
The stub writes nothing, so opening a listed file serves another synthesized project like the mock one from a `data:` URL, and saving it after "Make an edit" lands as `desc-labelsTestInjectionMockProject` beside it.
`mock_predictions_missing` makes opening any listed file find nothing there instead, as EMBER does before a worker has written it.
The Chromatic predictions snapshots use these.

Every mock mounts the SLEAP stand-in (`src/ui/sleapStandIn.ts`) rather than the real app: the mocks' synthesized files are not real `.slp` projects or videos, and the stand-in's controls are what the specs drive.
`stand_in` mounts the stand-in on its own, with the real archive, sign-in and compute, which is how `tests/integration/ember.spec.ts` drives the host's save sequence.

`mock_new_project` hands a synthesized new project to the same `create` path a dandiset with no SLEAP project takes, with the same in-memory saves, models and compute stub as `mock_project`.
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
