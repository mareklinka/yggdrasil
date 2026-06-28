import type { TAbstractFile } from "obsidian";
import { TFile } from "obsidian";

import type { Indexer } from "./indexer";

/** A pending file change operation. */
interface PendingOperation {
  type: "modify" | "delete" | "rename";
  file: TFile;
  oldPath?: string;
}

/**
 * Encapsulates file change tracking, debouncing, and incremental reindexing.
 *
 * Listens to Obsidian vault events, debounces them, and dispatches
 * incremental reindex operations to the indexer.
 */
export class ChangeTracker {
  readonly #indexer: Indexer;
  readonly #vault: {
    read: (file: TFile) => Promise<string>;
    getMarkdownFiles: () => Array<TFile>;
  };
  #debounceTimer: ReturnType<typeof setTimeout> | null = null;
  #debouncePending: Array<PendingOperation> = [];
  #onModifyRef: ((file: TAbstractFile) => void) | null = null;
  #onDeleteRef: ((file: TAbstractFile) => void) | null = null;
  #onRenameRef: ((file: TAbstractFile, oldPath: string) => void) | null = null;

  public constructor(
    indexer: Indexer,
    vault: {
      read: (file: TFile) => Promise<string>;
      getMarkdownFiles: () => Array<TFile>;
    },
  ) {
    this.#indexer = indexer;
    this.#vault = vault;
  }

  /**
   * Register file event listeners for incremental reindexing.
   * Must be called after the indexer is fully initialized.
   */
  public registerEventListeners(appVault: unknown): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vault = appVault as any;
    const onModify = (file: TAbstractFile): void => {
      if (file instanceof TFile) {
        this.#enqueueFileEvent("modify", file);
      }
    };
    const onDelete = (file: TAbstractFile): void => {
      if (file instanceof TFile) {
        this.#enqueueFileEvent("delete", file);
      }
    };
    const onRename = (file: TAbstractFile, oldPath: string): void => {
      if (file instanceof TFile) {
        this.#enqueueFileEvent("rename", file, oldPath);
      }
    };

    this.#onModifyRef = onModify;
    this.#onDeleteRef = onDelete;
    this.#onRenameRef = onRename;

    vault.on("modify", onModify);
    vault.on("delete", onDelete);
    vault.on("rename", onRename);
  }

  /**
   * Remove all registered event listeners and clear the debounce timer.
   */
  public unregisterEventListeners(appVault: unknown): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vault = appVault as any;

    if (this.#debounceTimer !== null) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }

    if (this.#onModifyRef !== null) {
      vault.off("modify", this.#onModifyRef);
    }
    if (this.#onDeleteRef !== null) {
      vault.off("delete", this.#onDeleteRef);
    }
    if (this.#onRenameRef !== null) {
      vault.off("rename", this.#onRenameRef);
    }
  }

  /**
   * Cancel any pending debounce operations before starting a full reindex.
   */
  public cancelPending(): void {
     if (this.#debounceTimer !== null) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }

    this.#debouncePending = [];
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
    }, 1000);
  }

  async #processDebounceQueue(): Promise<void> {
    const operations = [...this.#debouncePending];
    this.#debouncePending = [];

    for (const op of operations) {
      try {
        switch (op.type) {
          case "modify": {
            this.#indexer.enqueueEdit(op.file);
            break;
          }

          case "delete": {
            this.#indexer.enqueueDelete(op.file);
            break;
          }

          case "rename": {
            if (op.oldPath === undefined) {
              console.warn("Yggdrasil: rename event missing old path for", op.file.path);
              continue;
            }
            const content = await this.#vault.read(op.file);
            this.#indexer.enqueueRename(op.oldPath, op.file, content);
            break;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.warn(`Yggdrasil: incremental operation failed for ${op.file.path}:`, message);
      }
    }
  }
}
