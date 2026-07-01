import type { App, PluginManifest, WorkspaceLeaf } from "obsidian";
import { Notice, Plugin } from "obsidian";

import { ChangeTracker } from "./rag/change-tracker";
import { createLangchainRag } from "./rag/langchain-rag";
import { CHAT_VIEW_TYPE, ChatView } from "./ui/chat-view";
import { ReindexConfirmationModal } from "./ui/reindex-confirmation-modal";

export default class YggdrasilPlugin extends Plugin {
  readonly #rag;
  readonly #changeTracker;

  public constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);

    this.#rag = createLangchainRag(this.app.vault, {
      dbPath: `${this.app.vault.configDir}/plugins/${this.manifest.id}/vector_store.data`,
    });

    this.#changeTracker = new ChangeTracker(this.app.vault, this.#rag);
  }

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

    // Command palette entry
    this.addCommand({
      id: "open-chat",
      name: "Open Chat",
      callback: openChat,
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

  async #showReindexConfirmation(): Promise<void> {
    const modal = new ReindexConfirmationModal(this.app);
    modal.open();

    modal.onConfirmed = async (): Promise<void> => {
      await this.#rag.index(...this.app.vault.getMarkdownFiles());
    };
  }
}
