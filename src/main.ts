import type { TFile, WorkspaceLeaf } from "obsidian";
import { Notice, Plugin } from "obsidian";

import { getChangeTracker, initChangeTracker } from "./rag/change-tracker";
import { initEmbedder } from "./rag/embedder";
import { getIndexer, type IndexerConfig,initIndexer } from "./rag/indexer";
import {
  getVaultFileSystem,
  initVaultFileSystem,
} from "./rag/vault-file-system";
import { getVectorStore, initVectorStoreStore } from "./rag/vector-store";
import { CHAT_VIEW_TYPE, ChatView } from "./ui/chat-view";
import { ReindexConfirmationModal } from "./ui/reindex-confirmation-modal";

const EMBEDDING_DIMENSIONS = 1024;
const VECTOR_DB_FILE = "vectors.json";

export default class YggdrasilPlugin extends Plugin {
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

    // Register chat view
    this.registerView(
      CHAT_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new ChatView(leaf),
    );

    const openChat = (): void => {
      const leaves: Array<WorkspaceLeaf> =
        this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
      if (leaves.length > 0) {
        // Reveal existing leaf (handles minimized/collapsed panes correctly)
        this.app.workspace.revealLeaf(leaves[0]);
      } else {
        const leaf: WorkspaceLeaf | null =
          this.app.workspace.getRightLeaf(false);
        if (leaf !== null) {
          leaf.setViewState({ type: CHAT_VIEW_TYPE });
          this.app.workspace.revealLeaf(leaf);
        }
      }
    };

    // Chat ribbon icon
    this.addRibbonIcon("message-square", "Open Chat", openChat);

    // Command palette entry
    this.addCommand({
      id: "open-chat",
      name: "Open Chat",
      callback: openChat,
    });

    await this.#initialize();

    console.log("Yggdrasil plugin loaded");
  }

  public onunload(): void {
    // Detach all chat view leaves
    const chatLeaves: Array<WorkspaceLeaf> =
      this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    chatLeaves.forEach((leaf: WorkspaceLeaf): void => {
      leaf.detach();
    });

    getChangeTracker().unregisterEventListeners(this.app.vault);
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

      const indexer = getIndexer();

      indexer.cancelPending();
      getVectorStore().clear();
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

    initVaultFileSystem(this.app.vault);
    const vectorStore = initVectorStoreStore(config, getVaultFileSystem());
    const embedder = initEmbedder({
      endpoint: "http://127.0.0.1:10001",
      model: "v5-small-retrieval-Q8_0.gguf",
      dimensions: 1024,
      batchSize: 1000,
      requestDelayMs: 0,
    });

    try {
      await vectorStore.initialize();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Yggdrasil: Failed to initialize vector store:", message);
      new Notice(`Failed to load vector store: ${message}`, 10000);
      return;
    }

    const indexer = initIndexer(this.app.vault, embedder, vectorStore);

    const changeTracker = initChangeTracker(indexer, {
      read: async (file: TFile): Promise<string> => this.app.vault.read(file),
      getMarkdownFiles: (): Array<TFile> => this.app.vault.getMarkdownFiles(),
    });

    // Register file event listeners as the last step of initialization
    changeTracker.registerEventListeners(this.app.vault);
  }
}
