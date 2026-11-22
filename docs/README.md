# Live Testing

## Live test injections

| URL                                                            | What it should look like                                                                                             | Try it                                                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `?test&mock_project`                                           | The open-project card, with the SLEAP stand-in showing a mock project whose first bytes read as HDF5                 | [Open](https://sleap.brain-bbqs.org/?test&mock_project)                                           |
| `?test&mock_project&mock_predictions`                          | The same, with one file under "Predictions" below the app (after about a second): the mock project's own predictions | [Open](https://sleap.brain-bbqs.org/?test&mock_project&mock_predictions)                          |
| `?test&mock_project&mock_predictions&mock_predictions_missing` | The same; clicking the listed file says it is not on EMBER yet, with "Try again"                                     | [Open](https://sleap.brain-bbqs.org/?test&mock_project&mock_predictions&mock_predictions_missing) |

`?test` alone (without one of the above) is a no-op that never changes anything by itself, and so are `mock_predictions` and `mock_predictions_missing` without `mock_project`.

Every fake is obviously fake: the mock project is named `test-injection-mock-project.slp`, lives in a dandiset called `mock`, and the models are named "Test injection model".
Nothing is written to `localStorage` or to the archive, so all of the above are safe to try at any time.

`mock_project` hands a synthesized project to the same open path a project from EMBER takes, served from a `data:` URL that, like an archive link, says nothing about the file's type.
Saves go to an in-memory store that places them exactly where EMBER storage would, the model list is two fixed cards (plus any model trained on the stub since), and jobs run on the in-browser compute stub with short ticks.
Training after "Make an edit" keeps the edits in that store as a training package, so it runs offline too; saved files are named by `memory://` links that nothing fetches.
The Chromatic project-open snapshot uses this to capture the state deterministically.

`mock_predictions` runs inference on the mock project once it is open, submitted and followed through the host and the compute stub as "Predict" is, but without the stand-in's job pane.
The file the stub reports, `derivatives/sleap/sub-mock/beh/sub-mock_desc-predictionsTestInjectionMockProject_pose.slp`, then reaches the list through the same checks a finished job's predictions go through.
The stub writes nothing, so opening a listed file serves another synthesized project like the mock one from a `data:` URL, and saving it after "Make an edit" lands as `desc-labelsTestInjectionMockProject` beside it.
`mock_predictions_missing` makes opening any listed file find nothing there instead, as EMBER does before a worker has written it.
The Chromatic predictions snapshots use these.

## Deep links

`?dandiset=<id>` fills in the dandiset and lists its projects on load, e.g. [`?dandiset=000398`](https://sleap.brain-bbqs.org/?dandiset=000398).
This is a real request to the archive, not a test injection.

## Expected console noise

None at present.
Add a note here for any expected warning or failed request a person might otherwise report as a bug.

Add a row to the injection table for every injection the app grows, and read the `visual-snapshots` skill under `.claude/skills/` before adding one.
