import type { EventRef, TAbstractFile, Vault } from "obsidian";
import { Notice, TFile } from "obsidian";

import type { LangchainRag } from "./langchain-rag";

/** A pending file change operation. */
interface PendingOperation {
  type: "modify" | "delete" | "rename";
  file: TFile;
  oldPath?: string;
}

export interface IVault {
  read: (file: TFile) => Promise<string>;
  getMarkdownFiles: () => Array<TFile>;
}

export class ChangeTracker {
  readonly #onModifyRef: EventRef;
  readonly #onDeleteRef: EventRef;
  readonly #onRenameRef: EventRef;

  #debounceTimer: ReturnType<typeof setTimeout> | null = null;
  #debouncePending: Array<PendingOperation> = [];

  public constructor(
    private readonly vault: Vault,
    private readonly rag: LangchainRag,
  ) {
    this.#onModifyRef = this.vault.on("modify", (file: TAbstractFile): void => {
      if (file instanceof TFile) {
        this.#enqueueFileEvent("modify", file);
      }
    });
    this.#onDeleteRef = this.vault.on("delete", (file: TAbstractFile): void => {
      if (file instanceof TFile) {
        this.#enqueueFileEvent("delete", file);
      }
    });
    this.#onRenameRef = this.vault.on(
      "rename",
      (file: TAbstractFile, oldPath: string): void => {
        if (file instanceof TFile) {
          this.#enqueueFileEvent("rename", file, oldPath);
        }
      },
    );
  }

  public unregisterEventListeners(): void {
    if (this.#debounceTimer !== null) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }

    this.vault.offref(this.#onModifyRef);
    this.vault.offref(this.#onDeleteRef);
    this.vault.offref(this.#onRenameRef);
  }

  #enqueueFileEvent(
    type: "modify" | "delete" | "rename",
    file: TFile,
    oldPath?: string,
  ): void {
    // Clear existing debounce timer
    if (this.#debounceTimer !== null) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }

    // Enqueue the operation
    this.#debouncePending.push({ type, file, oldPath });

    // Set new debounce timer (1 second)
    this.#debounceTimer = setTimeout(async () => {
      this.#debounceTimer = null;
      await this.#processDebounceQueue();
    }, 30000);
  }

  async #processDebounceQueue(): Promise<void> {
    const operations = [...this.#debouncePending];
    this.#debouncePending = [];

    for (const op of operations) {
      try {
        switch (op.type) {
          case "modify": {
            this.rag.delete(op.file.path);
            await this.rag.index(op.file);
            break;
          }

          case "delete": {
            this.rag.delete(op.file.path);
            break;
          }

          case "rename": {
            if (op.oldPath === undefined) {
              console.warn(
                "Yggdrasil: rename event missing old path for",
                op.file.path,
              );
              continue;
            }
            this.rag.delete(op.oldPath);
            await this.rag.index(op.file);
            break;
          }
        }
      } catch (error) {
        const message: string =
          error instanceof Error ? error.message : "Unknown error";
        console.warn(
          `Yggdrasil: incremental operation failed for ${op.file.path}:`,
          message,
        );
        new Notice(`Embedding failed for ${op.file.path}: ${message}`);
      }
    }
  }
}
