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

    // For modify events, deduplicate: only the latest per file matters
    if (type === "modify") {
      this.#debouncePending = this.#debouncePending.filter(
        (pending) =>
          !(pending.type === "modify" && pending.file.path === file.path),
      );
    }

    // Enqueue the operation
    this.#debouncePending.push({ type, file, oldPath });

    // Set new debounce timer (30 seconds)
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
            await this.rag.reindex(op.file);
            break;
          }

          case "delete": {
            await this.rag.delete(op.file.path);
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
            await this.rag.reindex(op.file, op.oldPath);
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
