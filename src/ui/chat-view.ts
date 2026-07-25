import type { WorkspaceLeaf } from "obsidian";
import { ItemView, MarkdownRenderer } from "obsidian";

import type { LangchainRag } from "../rag/langchain-rag";

export const CHAT_VIEW_TYPE = "yggdrasil-chat";

export class ChatView extends ItemView {
  #messageListEl: HTMLElement | null = null;
  #loadingWrapperEl: HTMLElement | null = null;

  public constructor(
    leaf: WorkspaceLeaf,
    private readonly rag: LangchainRag,
  ) {
    super(leaf);
  }

  public getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  public getDisplayText(): string {
    return "Chat";
  }

  public getIcon(): string {
    return "message-square";
  }

  public async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass("yggdrasil-chat-view");

    // Header bar
    const headerEl: HTMLElement = contentEl.createDiv({
      cls: "yggdrasil-chat-header",
    });

    headerEl.createEl("h2", {
      cls: "yggdrasil-chat-header-title",
      text: "Yggdrasil",
    });

    const newConvBtn: HTMLButtonElement = headerEl.createEl("button", {
      cls: "yggdrasil-chat-new-conversation-btn",
      text: "New conversation",
    });
    newConvBtn.addEventListener("click", (): void => {
      this.#clearConversation();
    });

    // Chat message list area
    const listEl: HTMLElement = contentEl.createDiv({
      cls: "yggdrasil-chat-messages",
    });
    this.#messageListEl = listEl;

    // Input row at bottom
    const inputRow: HTMLElement = contentEl.createDiv({
      cls: "yggdrasil-chat-input-row",
    });

    const input: HTMLTextAreaElement = inputRow.createEl("textarea", {
      cls: "yggdrasil-chat-input",
      placeholder: "Type a message…",
    });
    input.rows = 1;

    const sendBtn: HTMLElement = inputRow.createEl("button", {
      text: "Send",
      cls: "mod-cta",
    });

    // Auto-resize textarea height on input
    input.addEventListener("input", (): void => {
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight}px`;
    });

    input.addEventListener("keydown", (evt: KeyboardEvent): void => {
      if (evt.key === "Enter" && !evt.shiftKey) {
        evt.preventDefault();
        this.#onSend(input);
      }
    });

    sendBtn.addEventListener("click", (): void => {
      this.#onSend(input);
    });

    setTimeout(() => {
      input.focus();
    }, 0);
  }

  public async onClose(): Promise<void> {
    this.#messageListEl = null;
    this.#loadingWrapperEl = null;
  }

  readonly #messages: Array<{ content: string; role: "user" | "assistant" }> =
    [];

  async #onSend(inputEl: HTMLTextAreaElement): Promise<void> {
    const text: string = inputEl.value.trim();
    if (text.length === 0) {
      return;
    }

    this.#messages.push({ content: text, role: "user" });

    // Disable input while rendering canned response
    inputEl.disabled = true;
    try {
      // Append user bubble
      this.#renderMessage(text, "user");

      // Clear input and reset height
      inputEl.value = "";
      inputEl.style.height = "auto";

      // Show loading indicator
      this.#showLoading();

      try {
        const response = await this.rag.query(
          text,
          this.#messages.slice(0, -1),
        );
        this.#messages.push({ content: response, role: "assistant" });
        this.#renderMessage(response, "assistant");
      } finally {
        // Remove loading indicator regardless of outcome
        this.#hideLoading();
      }
    } finally {
      // Re-enable input regardless of outcome
      inputEl.disabled = false;
      // Retain focus for quick follow-up messages
      inputEl.focus();
    }
  }

  #showLoading(): void {
    if (this.#messageListEl === null) {
      return;
    }

    this.#hideLoading(); // Safety: remove any existing indicator

    const wrapper: HTMLElement = this.#messageListEl.createDiv({
      cls: "yggdrasil-chat-row yggdrasil-chat-row--assistant",
    });

    const bubble: HTMLElement = wrapper.createDiv({
      cls: "yggdrasil-chat-bubble yggdrasil-chat-bubble--assistant yggdrasil-chat-loading",
    });

    const content: HTMLElement = bubble.createEl("span", {
      cls: "yggdrasil-chat-loading-content",
    });

    content.createEl("span", {
      cls: "yggdrasil-chat-spinner",
    });

    content.createEl("span", {
      cls: "yggdrasil-chat-loading-dots",
      text: "Thinking",
    });

    this.#loadingWrapperEl = wrapper;
    this.#scrollToBottom();
  }

  #hideLoading(): void {
    if (this.#loadingWrapperEl !== null) {
      this.#loadingWrapperEl.remove();
      this.#loadingWrapperEl = null;
    }
  }

  #renderMessage(text: string, sender: "user" | "assistant"): void {
    if (this.#messageListEl === null) {
      return;
    }

    const wrapper: HTMLElement = this.#messageListEl.createDiv({
      cls: `yggdrasil-chat-row yggdrasil-chat-row--${sender}`,
    });

    // Column container holds bubble + footer, aligned by the row wrapper
    const col: HTMLElement = wrapper.createDiv({
      cls: "yggdrasil-chat-col",
    });

    const bubble: HTMLElement = col.createDiv({
      cls: `yggdrasil-chat-bubble yggdrasil-chat-bubble--${sender}`,
    });

    if (sender === "assistant") {
      MarkdownRenderer.render(this.app, text, bubble, "", this);

      bubble
        .querySelectorAll<HTMLAnchorElement>("a.internal-link")
        .forEach((link) => {
          const path = link.getAttribute("href") || "";
          link.addEventListener("click", (evt: MouseEvent): void => {
            evt.preventDefault();
            this.app.workspace.openLinkText(path, "");
          });
        });
    } else {
      bubble.createEl("div", {
        cls: "yggdrasil-chat-bubble-content",
        text,
      });
    }

    // Footer bar with copy button — below bubble, inside same column
    const footer: HTMLElement = col.createDiv({
      cls: "yggdrasil-chat-bubble-footer",
    });

    const copyBtn: HTMLButtonElement = footer.createEl("button", {
      cls: "yggdrasil-chat-copy-btn",
    });
    copyBtn.innerHTML = "\u2398 Copy message";

    // Hover on the column so cursor can move from bubble to footer without hiding
    col.addEventListener("mouseenter", (): void => {
      footer.style.opacity = "1";
    });
    col.addEventListener("mouseleave", (): void => {
      footer.style.opacity = "0";
    });

    copyBtn.addEventListener("click", (evt: MouseEvent): void => {
      evt.stopPropagation();
      const clipboard = navigator.clipboard;
      if (clipboard === undefined) {
        return;
      }

      clipboard
        .writeText(text)
        .then(() => {
          copyBtn.innerHTML = "\u2713 Copied";
          setTimeout(() => {
            copyBtn.innerHTML = "\u2398 Copy message";
          }, 1000);
        })
        .catch((): void => {
          // Clipboard write failed silently
        });
    });

    this.#scrollToBottom();
  }

  #scrollToBottom(): void {
    if (this.#messageListEl === null) {
      return;
    }

    this.#messageListEl.scrollTop = this.#messageListEl.scrollHeight;
  }

  #clearConversation(): void {
    this.#messages.length = 0;
    if (this.#messageListEl !== null) {
      this.#messageListEl.empty();
    }
  }
}
