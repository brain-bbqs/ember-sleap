# Live Testing

## Live test injections

| URL                  | What it should look like                                                                             | Try it                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `?test&mock_project` | The open-project card, with the SLEAP stand-in showing a mock project whose first bytes read as HDF5 | [Open](https://sleap.brain-bbqs.org/?test&mock_project) |

`?test` alone (without one of the above) is a no-op that never changes anything by itself.

Every fake is obviously fake: the mock project is named `test-injection-mock-project.slp`, lives in a dandiset called `mock`, and the models are named "Test injection model".
Nothing is written to `localStorage` or to the archive, so all of the above are safe to try at any time.

`mock_project` hands a synthesized project to the same open path a project from EMBER takes, served from a `data:` URL that, like an archive link, says nothing about the file's type.
Saves go to an in-memory store that places them exactly where EMBER storage would, the model list is two fixed cards (plus any model trained on the stub since), and jobs run on the in-browser compute stub with short ticks.
The Chromatic project-open snapshot uses this to capture the state deterministically.

## Deep links

`?dandiset=<id>` fills in the dandiset and lists its projects on load, e.g. [`?dandiset=000398`](https://sleap.brain-bbqs.org/?dandiset=000398).
This is a real request to the archive, not a test injection.

## Expected console noise

None at present.
Add a note here for any expected warning or failed request a person might otherwise report as a bug.

Add a row to the injection table for every injection the app grows, and read the `visual-snapshots` skill under `.claude/skills/` before adding one.
