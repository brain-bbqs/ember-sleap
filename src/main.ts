import "./style.css";
import { renderVersion } from "@brain-bbqs/ui";
import { getShell } from "./ui/elements";

const shell = getShell();

// ---------------------------------------------------------------------------------------------
// The shared shell: the footer's version stamp, wired as every BBQS companion app wires it. The
// page is dark only, like the SLEAP app it is for, so it has no light/dark toggle, and its footer
// carries no "What's New" or issue links.
// ---------------------------------------------------------------------------------------------

renderVersion(shell.versionIndicator, __APP_VERSION__);
