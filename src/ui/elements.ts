// Typed lookups for the static skeleton markup in index.html. Every id the app touches is
// registered here, so a renamed or dropped element fails on import (and in the boot smoke test)
// rather than as a null dereference somewhere down the page.
import { required } from "@brain-bbqs/ui";

/**
 * The shell: the version stamp, at @brain-bbqs/ui's default id. Looked up here rather than by that
 * package's getShellElements, which requires a theme toggle this page, dark only like the SLEAP
 * app, does not have.
 */
export function getShell() {
  return {
    versionIndicator: required<HTMLAnchorElement>("version-indicator"),
  };
}
