// Typed lookups for the static skeleton markup in index.html. Every id the app touches is
// registered here, so a renamed or dropped element fails on import (and in the boot smoke test)
// rather than as a null dereference somewhere down the page.
import { required } from "@brain-bbqs/ui";

/**
 * The shell: the version stamp and the EMBER account menu, at @brain-bbqs/ui's default ids. Looked
 * up here rather than by that package's getShellElements, which requires a theme toggle this page,
 * dark only like the SLEAP app, does not have.
 */
export function getShell() {
  return {
    versionIndicator: required<HTMLAnchorElement>("version-indicator"),
    account: {
      oauthSigninBtn: required<HTMLButtonElement>("oauthSigninBtn"),
      oauthSignedIn: required<HTMLElement>("oauthSignedIn"),
      oauthAvatar: required<HTMLElement>("oauthAvatar"),
      oauthUsername: required<HTMLElement>("oauthUsername"),
      oauthSignoutBtn: required<HTMLButtonElement>("oauthSignoutBtn"),
    },
  };
}

export function getElements() {
  return {
    humanSubjects: {
      banner: required<HTMLElement>("humanSubjectsBanner"),
      unconfirmed: required<HTMLElement>("humanSubjectsUnconfirmed"),
      confirmBtn: required<HTMLButtonElement>("humanSubjectsConfirmBtn"),
      confirmed: required<HTMLElement>("humanSubjectsConfirmed"),
    },
    emberBar: required<HTMLDivElement>("ember-bar"),
    projectTitle: required<HTMLSpanElement>("project-title"),
    projectLocation: required<HTMLSpanElement>("project-location"),
    hostStatus: required<HTMLSpanElement>("host-status"),
    closeProjectBtn: required<HTMLButtonElement>("close-project-btn"),
    sleapRoot: required<HTMLDivElement>("sleap-root"),
    openDialog: {
      dialog: required<HTMLDialogElement>("open-dialog"),
      title: required<HTMLHeadingElement>("open-dialog-title"),
      close: required<HTMLButtonElement>("open-dialog-close"),
      intro: required<HTMLParagraphElement>("open-dialog-intro"),
    },
    openForm: required<HTMLFormElement>("open-form"),
    dandisetInput: required<HTMLInputElement>("dandiset-input"),
    dandisetOptions: required<HTMLDataListElement>("dandiset-options"),
    listProjectsBtn: required<HTMLButtonElement>("list-projects-btn"),
    openStatus: required<HTMLParagraphElement>("open-status"),
    projectList: required<HTMLUListElement>("project-list"),
    newProjectBtn: required<HTMLButtonElement>("new-project-btn"),
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
  };
}

export type AppElements = ReturnType<typeof getElements>;
