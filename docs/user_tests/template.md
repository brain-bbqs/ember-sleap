# User Test Checklist

|            |         |
| ---------- | ------- |
| **Tester** | <enter> |
| **Date**   | <enter> |

A basic manual pass through the app before a release or after a significant change.
Run through this on the deployed site.
Copy this file to `docs/user_tests/<tester>.md`, fill it in, and open it as a PR titled `User test: <Tester>`.

## Opening from EMBER

- [ ] "Open Project", then `000398` and "List projects", lists its two `.slp` projects with their sizes
- [ ] Opening `sub-NONE/sub-NONE_sourcedata.slp` shows it in the SLEAP app and the stand-in reads an HDF5 signature
- [ ] A dandiset id with neither projects nor videos says so, and a nonsense id asks for a real one
- [ ] `?dandiset=000398` in the address bar opens the picker and lists the projects on load
- [ ] "Close project" returns to the SLEAP start screen, asking first if there are unsaved edits

## Starting a new project

- [ ] The page opens on the SLEAP app's start screen, between the header and a footer holding only the version link (bottom left) and the Talmo Lab and CON marks (bottom right)
- [ ] "Open Project" on a dandiset with videos but no `.slp` starts a new project on its videos in the SLEAP app, listed in its Videos panel, with frames showing
- [ ] Labeling works on it as in the SLEAP web app: define a skeleton, add an instance, drag its nodes
- [ ] "New Project" on a dandiset that has projects still starts a new one
- [ ] Saving a new project (signed in, on a dandiset you own) writes `derivatives/sleap/sub-.../beh/..._desc-labels<FirstVideo>_pose.slp`, which the SLEAP desktop app opens with the videos listed

## Saving (needs sign-in)

- [ ] "Sign in" goes to EMBER's GitHub sign-in and comes back to this page signed in
- [ ] Signing in shows the account in the header and suggests your own dandisets in the dandiset field
- [ ] On a dandiset you own, "Make an edit" then Ctrl+S inside the app saves to `derivatives/sleap/sub-.../beh/..._desc-labels<Source>_pose.slp`, named after the project (for example `desc-labelsCamTop` for `cam-top.slp`)
- [ ] Saving a second project of the same session writes a labels file of its own
- [ ] Reopening the original project and saving again asks whether to replace, keep both or cancel, and "Keep both" saves as `desc-labels<Source>2`
- [ ] Ctrl+S with focus in the page header does nothing
- [ ] A project whose path has no `sub-` asks for a subject before saving
- [ ] A project under a folder such as `ses-day-1` asks for its session too, offering `day1`
- [ ] On a dandiset flagged for human subjects, saving is refused until "I confirm" is pressed
- [ ] Signing out with unsaved edits asks first

## Cross-cutting

- [ ] Reloading the page mid-task doesn't leave local state (localStorage) in a way that breaks the next load
- [ ] The app stays dark whatever the OS or browser theme, and has no theme toggle
- [ ] Basic responsiveness: window resized narrower doesn't break layout or hide controls
- [ ] Loading the page shows no unexpected errors in the browser console
- [ ] The bottom-left version link opens the source on GitHub, and the bottom-right marks open the Talmo Lab and CON sites

## Extra notes
