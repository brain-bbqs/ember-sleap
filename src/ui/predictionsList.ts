import { button, h } from "@brain-bbqs/ui";
import { toHostRef, type EmberLocation } from "../lib/hostRef";

export interface PredictionsElements {
  section: HTMLElement;
  list: HTMLUListElement;
  status: HTMLParagraphElement;
  retry: HTMLButtonElement;
}

/** The predictions files inference wrote, as buttons that open them, and how the latest open went. */
export interface PredictionsList {
  /** Lists each file not listed yet, after the ones that are, and shows the list. */
  add(files: readonly EmberLocation[]): void;
  /** Empties and hides the list, as closing the project does. */
  clear(): void;
  /** Says `file` is opening. */
  opening(file: EmberLocation): void;
  /** Clears what the latest open said, once it has opened or been called off. */
  done(): void;
  /** Says why `file` did not open, with a button that tries again. */
  failed(file: EmberLocation, message: string): void;
}

const keyOf = (file: EmberLocation) => toHostRef(file).key;

export function createPredictionsList(
  els: PredictionsElements,
  onOpen: (file: EmberLocation) => void,
): PredictionsList {
  // By dandiset and path, since two jobs on one project write the same file.
  const listed = new Map<string, HTMLButtonElement>();
  let retrying: EmberLocation | null = null;

  function say(text: string, failed = false): void {
    els.status.textContent = text;
    els.status.classList.toggle("err", failed);
  }

  function offerRetry(file: EmberLocation | null): void {
    // Hiding the focused button would drop keyboard focus to the page, so it goes to the file's own.
    if (!file && retrying && els.retry.ownerDocument.activeElement === els.retry) {
      listed.get(keyOf(retrying))!.focus();
    }
    retrying = file;
    els.retry.hidden = !file;
  }

  els.retry.addEventListener("click", () => {
    if (retrying) onOpen(retrying);
  });

  return {
    add(files) {
      for (const file of files) {
        const key = keyOf(file);
        if (listed.has(key)) continue;
        const open = button("predictions-open", file.path);
        open.dataset.path = file.path;
        open.addEventListener("click", () => onOpen(file));
        listed.set(key, open);
        const item = h("li", "predictions-item");
        item.append(open);
        els.list.append(item);
      }
      els.section.hidden = listed.size === 0;
    },
    clear() {
      retrying = null;
      els.retry.hidden = true;
      listed.clear();
      els.list.replaceChildren();
      els.section.hidden = true;
      say("");
    },
    opening(file) {
      say(`Opening ${file.path}…`);
      offerRetry(null);
    },
    done() {
      say("");
      offerRetry(null);
    },
    failed(file, message) {
      say(message, true);
      offerRetry(file);
    },
  };
}
