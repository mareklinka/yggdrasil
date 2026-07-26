import type { App, PluginManifest, WorkspaceLeaf } from "obsidian";
import { Notice, Plugin } from "obsidian";

import { ChangeTracker } from "./rag/change-tracker";
import type { LangchainRag } from "./rag/langchain-rag";
import { createLangchainRag } from "./rag/langchain-rag";
import type { YggdrasilSettings } from "./settings";
import { DEFAULT_SETTINGS } from "./settings";
import { CHAT_VIEW_TYPE, ChatView } from "./ui/chat-view";
import { ReindexConfirmationModal } from "./ui/reindex-confirmation-modal";
import { YggdrasilSettingTab } from "./ui/settings-tab";

export default class YggdrasilPlugin extends Plugin {
  #rag!: LangchainRag;
  #changeTracker!: ChangeTracker;
  #data: YggdrasilSettings = DEFAULT_SETTINGS;

  readonly #embeddingErrorHandler: (e: unknown) => void = (e) => {
    throw e;
  };

  public constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
  }

  public async onload(): Promise<void> {
    this.addSettingTab(new YggdrasilSettingTab(this.app, this));

    // Load persisted settings and merge with defaults
    const loaded: YggdrasilSettings | null = await this.loadData();
    this.#data = { ...DEFAULT_SETTINGS, ...(loaded ?? {}) };

    // Create RAG pipeline and change tracker
    this.#rag = createLangchainRag(
      this.app.vault,
      this.#data,
      this.#getDbPath(),
      this.#embeddingErrorHandler,
    );
    this.#changeTracker = new ChangeTracker(this.app.vault, this.#rag);

    // Register chat view
    this.registerView(
      CHAT_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new ChatView(leaf, this.#rag),
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

    this.addCommand({
      id: "yggdrasil-open-chat",
      name: "Open Chat",
      callback: openChat,
    });

    this.addCommand({
      id: "yggdrasil-reindex",
      name: "Re-index Vault",
      callback: () => this.triggerReindex(),
    });

    console.log("Yggdrasil plugin loaded");
  }

  public onunload(): void {
    // Detach all chat view leaves
    const chatLeaves: Array<WorkspaceLeaf> =
      this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    chatLeaves.forEach((leaf: WorkspaceLeaf): void => {
      leaf.detach();
    });

    this.#changeTracker.unregisterEventListeners();
    console.log("Yggdrasil plugin unloaded");
  }

  public getSettings(): YggdrasilSettings {
    return this.#data;
  }

  public async setSettings(settings: YggdrasilSettings): Promise<void> {
    this.#data = settings;
    await this.saveData(this.#data);
    this.#recreateRag();
  }

  public async triggerReindex(): Promise<void> {
    const modal = new ReindexConfirmationModal(this.app);
    modal.open();

    modal.onConfirmed = async (): Promise<void> => {
      try {
        await this.#rag.clear();
        await this.#rag.index(...this.app.vault.getMarkdownFiles());
        new Notice('Re-indexing complete')
      } catch (error) {
        const message: string =
          error instanceof Error ? error.message : "Unknown error";
        new Notice(`Re-indexing failed: ${message}`);
      }
    };
  }

  #recreateRag(): void {
    this.#changeTracker.unregisterEventListeners();
    this.#rag = createLangchainRag(
      this.app.vault,
      this.#data,
      this.#getDbPath(),
      this.#embeddingErrorHandler,
    );
    this.#changeTracker = new ChangeTracker(this.app.vault, this.#rag);
  }

  #getDbPath(): string {
    return (
      `${this.app.vault.configDir}/plugins/${this.manifest.id}/` +
      "vector_store.data"
    );
  }

  public async loadData(): Promise<YggdrasilSettings | null> {
    return (await super.loadData()) as YggdrasilSettings | null;
  }

  public async saveData(data: YggdrasilSettings): Promise<void> {
    await super.saveData(data);
  }
}
