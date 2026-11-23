# User Test Checklist

|            |         |
| ---------- | ------- |
| **Tester** | <enter> |
| **Date**   | <enter> |

A basic manual pass through the app before a release or after a significant change.
Run through this on the deployed site.
Copy this file to `docs/user_tests/<tester>.md`, fill it in, and open it as a PR titled `User test: <Tester>`.

## The page

- [ ] The page shows the header, led by SLEAP's logo with a small EMBER badge in its corner, an empty area filling the window, and a footer holding only the version link (bottom left) and the Talmo Lab and CON marks (bottom right)

## Cross-cutting

- [ ] The app stays dark whatever the OS or browser theme, and has no theme toggle
- [ ] Basic responsiveness: window resized narrower doesn't break layout or hide controls
- [ ] Loading the page shows no unexpected errors in the browser console
- [ ] The bottom-left version link opens the source on GitHub, and the bottom-right marks open the Talmo Lab and CON sites

## Extra notes
