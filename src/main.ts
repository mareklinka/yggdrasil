import type { App, TFile } from "obsidian";
import { Modal, Notice, Plugin } from "obsidian";

import { Embedder } from "./rag/embedder";
import {
  Indexer,
  type IndexerConfig,
  type IndexProgress,
  type IndexResult,
} from "./rag/indexer";

const EMBEDDING_DIMENSIONS = 1024;
const VECTOR_DB_FILE = "vectors.json";

export default class YggdrasilPlugin extends Plugin {
  #indexer: Indexer | null = null;

  public async onload(): Promise<void> {
    this.addCommand({
      id: "hello-yggdrasil",
      name: "Say Hello",
      callback: () => {
        new Notice("Yggdrasil plugin loaded successfully!");
      },
    });

    this.addRibbonIcon("sparkles", "Yggdrasil", () => {
      this.#showReindexConfirmation();
    });

    await this.#initialize();

    console.log("Yggdrasil plugin loaded");
  }

  public onunload(): void {
    console.log("Yggdrasil plugin unloaded");
  }

  async #showReindexConfirmation(): Promise<void> {
    const modal = new ReindexConfirmationModal(this.app);
    modal.open();

    modal.onConfirmed = async (): Promise<void> => {
      await this.#runReindex();
    };
  }

  async #runReindex(): Promise<void> {
    const notice = new Notice("", 0);

    const onUpdate = (progress: IndexProgress): void => {
      let message = "";

      switch (progress.phase) {
        case "scanning":
          message = "🔍 Scanning vault for markdown files...";
          break;
        case "indexing":
          if (progress.total > 0) {
            message = `📝 Indexing: ${progress.current}/${progress.total} notes`;
            if (progress.currentFile) {
              message += `\n${progress.currentFile}`;
            }
          } else {
            message = "📝 No markdown files found.";
          }
          break;
        case "storing":
          message = `💾 Storing ${progress.chunksCreated} chunks...`;
          break;
        case "complete":
          message = `✅ Indexing complete: ${progress.chunksCreated} chunks from ${progress.current} notes`;
          notice.hide();
          break;
        case "error":
          message = `❌ Indexing failed: ${progress.errorMessage}`;
          notice.hide();
          break;
      }

      if (
        progress.errors.length > 0 &&
        progress.phase !== "complete" &&
        progress.phase !== "error"
      ) {
        message += `\n⚠ ${progress.errors.length} error(s)`;
      }

      notice.setMessage(message);
    };

    const indexer = this.#indexer;
    if (indexer === null) {
      throw new Error("Indexer not initialized");
    }
    const result: IndexResult = await indexer.reindex(onUpdate);

    if (!result.success) {
      new Notice(`❌ Indexing failed: ${result.errors.join("; ")}`, 10000);
    } else if (result.errors.length > 0) {
      new Notice(
        `⚠ Indexing complete with ${result.errors.length} error(s). Check console for details.`,
        10000,
      );
      for (const error of result.errors) {
        console.warn("Yggdrasil indexing error:", error);
      }
    }
  }

  async #initialize(): Promise<void> {
    const basePath = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    const dbPath = `${basePath}/${VECTOR_DB_FILE}`;

    const config: IndexerConfig = {
      dbPath,
      dimensions: EMBEDDING_DIMENSIONS,
    };

    // Create the Vault-based file persistence adapter for the vector store
    const vault = this.app.vault;
    const fileSystem = {
      write: async (filePath: string, content: string): Promise<void> => {
        // Check if the file exists; if not, create parent directories first
        const parentPath = filePath.substring(0, filePath.lastIndexOf("/"));
        if (parentPath && !(await vault.adapter.exists(parentPath))) {
          // Recursively create parent folders
          const parts = parentPath.split("/");
          let currentPath = "";
          for (const part of parts) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            if (!(await vault.adapter.exists(currentPath))) {
              await vault.createFolder(currentPath);
            }
          }
        }

        await vault.adapter.write(filePath, content);
      },
      writeBinary: async (filePath: string, content: ArrayBuffer): Promise<void> => {
        // Check if the file exists; if not, create parent directories first
        const parentPath = filePath.substring(0, filePath.lastIndexOf("/"));
        if (parentPath && !(await vault.adapter.exists(parentPath))) {
          // Recursively create parent folders
          const parts = parentPath.split("/");
          let currentPath = "";
          for (const part of parts) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            if (!(await vault.adapter.exists(currentPath))) {
              await vault.createFolder(currentPath);
            }
          }
        }

        await vault.adapter.writeBinary(filePath, content);
      },
      read: async (filePath: string): Promise<string> =>
        await vault.adapter.read(filePath),
      readBinary: async (filePath: string): Promise<ArrayBuffer> =>
        await vault.adapter.readBinary(filePath),
      exists: async (filePath: string): Promise<boolean> =>
        await vault.adapter.exists(filePath),
    };

    this.#indexer = new Indexer(
      config,
      {
        getMarkdownFiles: (): Array<TFile> => this.app.vault.getMarkdownFiles(),
        read: async (file: TFile): Promise<string> => this.app.vault.read(file),
      },
      new Embedder(
        {
          endpoint: "http://127.0.0.1:10001",
          model: "v5-small-retrieval-Q8_0.gguf",
          dimensions: 1024,
        },
        1000,
        0,
      ),
      fileSystem,
    );
    try {
      await this.#indexer.initialize();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Yggdrasil: Failed to initialize vector store:", message);
      new Notice(`Failed to load vector store: ${message}`, 10000);
      return;
    }
  }
}

class ReindexConfirmationModal extends Modal {
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
