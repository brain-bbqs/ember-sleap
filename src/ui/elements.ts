// Typed lookups for the static skeleton markup in index.html. Every id the app touches is
// registered here, so a renamed or dropped element fails on import (and in the boot smoke test)
// rather than as a null dereference somewhere down the page.
import { getShellElements, getWhatsNewElements, required } from "@brain-bbqs/ui";

/** The shell: theme toggle, version stamp and the EMBER account menu, looked up by @brain-bbqs/ui. */
export function getShell() {
  return getShellElements({ themeToggle: "theme-toggle" });
}

export function getElements() {
  return {
    humanSubjects: {
      banner: required<HTMLElement>("humanSubjectsBanner"),
      unconfirmed: required<HTMLElement>("humanSubjectsUnconfirmed"),
      confirmBtn: required<HTMLButtonElement>("humanSubjectsConfirmBtn"),
      confirmed: required<HTMLElement>("humanSubjectsConfirmed"),
    },
    openCard: required<HTMLElement>("open-card"),
    openForm: required<HTMLFormElement>("open-form"),
    dandisetInput: required<HTMLInputElement>("dandiset-input"),
    dandisetOptions: required<HTMLDataListElement>("dandiset-options"),
    listProjectsBtn: required<HTMLButtonElement>("list-projects-btn"),
    openStatus: required<HTMLParagraphElement>("open-status"),
    projectList: required<HTMLUListElement>("project-list"),
    appCard: required<HTMLElement>("app-card"),
    projectTitle: required<HTMLHeadingElement>("project-title"),
    closeProjectBtn: required<HTMLButtonElement>("close-project-btn"),
    projectLocation: required<HTMLParagraphElement>("project-location"),
    sleapRoot: required<HTMLDivElement>("sleap-root"),
    hostStatus: required<HTMLParagraphElement>("host-status"),
    predictions: {
      section: required<HTMLDivElement>("predictions"),
      list: required<HTMLUListElement>("predictions-list"),
      status: required<HTMLParagraphElement>("predictions-status"),
      retry: required<HTMLButtonElement>("predictions-retry"),
    },
    entities: {
      dialog: required<HTMLDialogElement>("entities-dialog"),
      form: required<HTMLFormElement>("entities-form"),
      title: required<HTMLHeadingElement>("entities-dialog-title"),
      source: required<HTMLSpanElement>("entities-source"),
      reason: required<HTMLSpanElement>("entities-reason"),
      sub: required<HTMLInputElement>("entities-sub"),
      sesLabel: required<HTMLLabelElement>("entities-ses-label"),
      ses: required<HTMLInputElement>("entities-ses"),
      cancel: required<HTMLButtonElement>("entities-cancel"),
      save: required<HTMLButtonElement>("entities-save"),
    },
    overwrite: {
      dialog: required<HTMLDialogElement>("overwrite-dialog"),
      form: required<HTMLFormElement>("overwrite-form"),
      title: required<HTMLHeadingElement>("overwrite-dialog-title"),
      path: required<HTMLSpanElement>("overwrite-path"),
      cancel: required<HTMLButtonElement>("overwrite-cancel"),
      replace: required<HTMLButtonElement>("overwrite-replace"),
      keep: required<HTMLButtonElement>("overwrite-keep"),
    },
    whatsNew: getWhatsNewElements(),
  };
}

export type AppElements = ReturnType<typeof getElements>;
