import type { TFile } from "obsidian";
import { Notice, Plugin } from "obsidian";

import { ChangeTracker } from "./rag/change-tracker";
import { Embedder } from "./rag/embedder";
import { Indexer, type IndexerConfig } from "./rag/indexer";
import { VaultFileSystem } from "./rag/vault-file-system";
import { ReindexConfirmationModal } from "./ui/reindex-confirmation-modal";

const EMBEDDING_DIMENSIONS = 1024;
const VECTOR_DB_FILE = "vectors.json";

export default class YggdrasilPlugin extends Plugin {
  #indexer: Indexer | null = null;
  #changeTracker: ChangeTracker | null = null;
  #isReindexing = false;

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
    this.#changeTracker?.unregisterEventListeners(this.app.vault);
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
    if (this.#isReindexing) {
      // A full reindex is already in progress, skip
      return;
    }

    try {
      this.#isReindexing = true;
      const tracker = this.#changeTracker;
      if (tracker === null) {
        throw new Error("Change tracker not initialized");
      }

      const indexer = this.#indexer;
      if (indexer === null) {
        throw new Error("Indexer not initialized");
      }

      this.#indexer?.cancelPending();
      this.#indexer?.vectorStore.clear();
      this.app.vault.getMarkdownFiles().forEach((file) => {
        indexer.enqueueEdit(file);
      });
    } finally {
      // Signal that reindex completed
      this.#isReindexing = false;
    }
  }

  async #initialize(): Promise<void> {
    const basePath = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    const dbPath = `${basePath}/${VECTOR_DB_FILE}`;

    const config: IndexerConfig = {
      dbPath,
      dimensions: EMBEDDING_DIMENSIONS,
    };

    this.#indexer = new Indexer(
      config,
      {
        getMarkdownFiles: (): Array<TFile> => this.app.vault.getMarkdownFiles(),
        read: async (file: TFile): Promise<string> => this.app.vault.read(file),
      },
      new Embedder({
        endpoint: "http://127.0.0.1:10001",
        model: "v5-small-retrieval-Q8_0.gguf",
        dimensions: 1024,
        batchSize: 1000,
        requestDelayMs: 0,
      }),
      new VaultFileSystem(this.app.vault),
    );
    try {
      await this.#indexer.initialize();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Yggdrasil: Failed to initialize vector store:", message);
      new Notice(`Failed to load vector store: ${message}`, 10000);
      return;
    }

    // Create and register the change tracker
    this.#changeTracker = new ChangeTracker(this.#indexer, {
      read: async (file: TFile): Promise<string> => this.app.vault.read(file),
      getMarkdownFiles: (): Array<TFile> => this.app.vault.getMarkdownFiles(),
    });

    // Register file event listeners as the last step of initialization
    this.#changeTracker.registerEventListeners(this.app.vault);
  }
}
