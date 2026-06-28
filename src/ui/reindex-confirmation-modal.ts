import type { App } from "obsidian";
import { Modal } from "obsidian";

export class ReindexConfirmationModal extends Modal {
  public onConfirmed: (() => void) | null = null;

  public constructor(app: App) {
    super(app);
  }

  public onOpen(): void {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: "Reindex Vault" });
    contentEl.createEl("p", {
      text: "This will clear all embeddings and rebuild the index. This may take a while.",
    });

    const buttonContainer = contentEl.createDiv({ cls: "mod-footer" });

    const cancelButton = buttonContainer.createEl("button", {
      text: "Cancel",
    });
    cancelButton.addEventListener("click", () => {
      this.close();
    });

    const confirmButton = buttonContainer.createEl("button", {
      text: "Reindex",
    });
    confirmButton.classList.add("mod-warning");
    confirmButton.addEventListener("click", () => {
      this.close();
      if (this.onConfirmed) {
        this.onConfirmed();
      }
    });
  }

  public onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
