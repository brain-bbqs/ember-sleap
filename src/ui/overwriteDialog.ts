import type { OverwriteChoice } from "../lib/emberStorage";
import type { AppElements } from "./elements";

/**
 * Asks what to do when the labels file a save would create already exists: replace it, keep both
 * (the save goes beside it under a numbered name), or cancel. Keeping both is the default, since it
 * loses nothing; dismissing the dialog cancels.
 */
export function createOverwritePrompt(els: AppElements["overwrite"]) {
  return (path: string) =>
    new Promise<OverwriteChoice>((resolve) => {
      els.path.textContent = path;

      const finish = (choice: OverwriteChoice) => {
        els.form.removeEventListener("submit", onKeep);
        els.replace.removeEventListener("click", onReplace);
        els.cancel.removeEventListener("click", onCancel);
        els.dialog.removeEventListener("close", onCancel);
        if (els.dialog.open) els.dialog.close();
        resolve(choice);
      };
      const onKeep = (e: SubmitEvent) => {
        e.preventDefault();
        finish("keep-both");
      };
      const onReplace = () => finish("replace");
      const onCancel = () => finish("cancel");

      els.form.addEventListener("submit", onKeep);
      els.replace.addEventListener("click", onReplace);
      els.cancel.addEventListener("click", onCancel);
      els.dialog.addEventListener("close", onCancel);
      els.dialog.showModal();
    });
}
