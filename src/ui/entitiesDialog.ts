import { isBidsLabel, namesEntity, suggestedEntities, type BidsEntities } from "../lib/bidsDerivatives";
import type { AppElements } from "./elements";

/**
 * Asks for the subject (and session) a save belongs under, for a source path that names no subject,
 * or names its subject or session in a form a BIDS label cannot hold. What the path does name is
 * offered as a starting point, and a session it names must be given. Resolves to null when the
 * person cancels or dismisses the dialog.
 */
export function createEntitiesPrompt(els: AppElements["entities"]) {
  return (sourcePath: string) =>
    new Promise<BidsEntities | null>((resolve) => {
      const suggested = suggestedEntities(sourcePath);
      const needsSession = namesEntity(sourcePath, "ses");
      els.title.textContent = needsSession ? "Which subject and session is this?" : "Which subject is this?";
      els.source.textContent = sourcePath;
      els.reason.textContent = namesEntity(sourcePath, "sub")
        ? "names its subject or session in a form BIDS labels cannot hold, so check what is filled in below."
        : "names no subject.";
      els.sesLabel.textContent = needsSession ? "Session" : "Session (optional)";
      els.ses.required = needsSession;
      els.sub.value = suggested.sub ?? "";
      els.ses.value = suggested.ses ?? "";

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
        if ((ses || needsSession) && !isBidsLabel(ses)) return void els.ses.focus();
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
