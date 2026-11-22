# User Test Checklist

|            |         |
| ---------- | ------- |
| **Tester** | <enter> |
| **Date**   | <enter> |

A basic manual pass through the app before a release or after a significant change.
Run through this on the deployed site.
Copy this file to `docs/user_tests/<tester>.md`, fill it in, and open it as a PR titled `User test: <Tester>`.

## Opening from EMBER

- [ ] Entering `000398` and pressing "List projects" lists its two `.slp` projects with their sizes
- [ ] Opening `sub-NONE/sub-NONE_sourcedata.slp` shows the project card and the stand-in reads an HDF5 signature
- [ ] A dandiset id with no projects says so, and a nonsense id asks for a real one
- [ ] `?dandiset=000398` in the address bar lists the projects on load
- [ ] "Close project" returns to the picker, asking first if there are unsaved edits

## Saving (needs sign-in, once EMBER has an OAuth app for this page)

- [ ] Signing in shows the account in the header and suggests your own dandisets in the dandiset field
- [ ] On a dandiset you own, "Make an edit" then Ctrl+S inside the app saves to `derivatives/sleap/sub-.../beh/..._desc-labels<Source>_pose.slp`, named after the project (for example `desc-labelsCamTop` for `cam-top.slp`)
- [ ] Saving a second project of the same session writes a labels file of its own
- [ ] Reopening the original project and saving again asks whether to replace, keep both or cancel, and "Keep both" saves as `desc-labels<Source>2`
- [ ] Ctrl+S with focus in the page header does nothing
- [ ] A project whose path has no `sub-` asks for a subject before saving
- [ ] A project under a folder such as `ses-day-1` asks for its session too, offering `day1`
- [ ] On a dandiset flagged for human subjects, saving is refused until "I confirm" is pressed
- [ ] Signing out with unsaved edits asks first

## Training and inference (simulated)

- [ ] "Run on" offers only "EMBER compute (host)"
- [ ] "Train a model" shows a job moving from queued to completed, with epochs in the log
- [ ] "Find models to predict with" then "Predict" runs a second job
- [ ] After training, the trained model is in the model list, and "Predict" with it runs
- [ ] "Cancel job" on a running job ends it as canceled

## Cross-cutting

- [ ] Reloading the page mid-task doesn't leave local state (localStorage) in a way that breaks the next load
- [ ] The app is usable in both light and dark OS/browser theme, and the header toggle flips between them
- [ ] Basic responsiveness: window resized narrower doesn't break layout or hide controls
- [ ] Loading the page shows no unexpected errors in the browser console
- [ ] Can navigate to all hyperlinks in the bottom-left, and "What's New" opens with the current version's entry

## Extra notes
