import { isBidsLabel, type BidsEntities } from "../lib/bidsDerivatives";
import type { AppElements } from "./elements";

/**
 * Asks for the subject (and optionally the session) a save belongs under, for a source path that
 * names neither. Resolves to null when the person cancels or dismisses the dialog.
 */
export function createEntitiesPrompt(els: AppElements["entities"]) {
  return (sourcePath: string) =>
    new Promise<BidsEntities | null>((resolve) => {
      els.source.textContent = sourcePath;
      els.sub.value = "";
      els.ses.value = "";

      const finish = (value: BidsEntities | null) => {
        els.form.removeEventListener("submit", onSubmit);
        els.cancel.removeEventListener("click", onCancel);
        els.dialog.removeEventListener("close", onClose);
        if (els.dialog.open) els.dialog.close();
        resolve(value);
      };
      const onSubmit = (e: SubmitEvent) => {
        e.preventDefault();
        const sub = els.sub.value.trim();
        const ses = els.ses.value.trim();
        if (!isBidsLabel(sub)) return void els.sub.focus();
        if (ses && !isBidsLabel(ses)) return void els.ses.focus();
        finish(ses ? { sub, ses } : { sub });
      };
      const onCancel = () => finish(null);
      const onClose = () => finish(null);

      els.form.addEventListener("submit", onSubmit);
      els.cancel.addEventListener("click", onCancel);
      els.dialog.addEventListener("close", onClose);
      els.dialog.showModal();
    });
}
