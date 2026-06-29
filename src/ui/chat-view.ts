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

    // Chat message list area
    const listEl: HTMLElement = contentEl.createDiv({
      cls: "yggdrasil-chat-messages",
    });
    this.#messageListEl = listEl;

    // Input row at bottom
    const inputRow: HTMLElement = contentEl.createDiv({
      cls: "yggdrasil-chat-input-row",
    });

    const input: HTMLInputElement = inputRow.createEl("input", {
      type: "text",
      cls: "yggdrasil-chat-input",
      placeholder: "Type a message…",
    });

    const sendBtn: HTMLElement = inputRow.createEl("button", {
      text: "Send",
      cls: "mod-cta",
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

    // Focus input when pane first opens — defer until after render
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

  async #onSend(inputEl: HTMLInputElement): Promise<void> {
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

      // Clear input
      inputEl.value = "";

      // Show loading indicator
      this.#showLoading();

      try {
        const response = await this.rag.query(this.#messages);
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

    // Wrapper row: [copy button] [bubble content]
    const wrapper: HTMLElement = this.#messageListEl.createDiv({
      cls: `yggdrasil-chat-row yggdrasil-chat-row--${sender}`,
    });

    // Copy button — hidden by default, shown on hover
    const copyBtn: HTMLButtonElement = wrapper.createEl("button", {
      cls: "yggdrasil-chat-copy-btn",
      attr: { title: "Copy message" },
    });
    copyBtn.textContent = "\u2398"; // ⌘ symbol as copy icon

    // The actual message bubble
    const bubble: HTMLElement = wrapper.createDiv({
      cls: `yggdrasil-chat-bubble yggdrasil-chat-bubble--${sender}`,
    });

    // Show/hide copy button on hover
    wrapper.addEventListener("mouseenter", (): void => {
      copyBtn.style.opacity = "1";
    });
    wrapper.addEventListener("mouseleave", (): void => {
      copyBtn.style.opacity = "0";
    });

    // Copy on click
    copyBtn.addEventListener("click", (evt: MouseEvent): void => {
      evt.stopPropagation();
      const clipboard = navigator.clipboard;
      if (clipboard === undefined) {
        return;
      }

      clipboard
        .writeText(text)
        .then(() => {
          // Brief visual feedback
          copyBtn.textContent = "\u2713"; // ✓ checkmark
          setTimeout(() => {
            copyBtn.textContent = "\u2398";
          }, 1000);
        })
        .catch((): void => {
          // Clipboard write failed silently — non-critical UX feature
        });
    });

    if (sender === "assistant") {
      MarkdownRenderer.render(this.app, text, bubble, "", this);
    } else {
      bubble.createEl("div", {
        cls: "yggdrasil-chat-bubble-content",
        text,
      });
    }

    this.#scrollToBottom();
  }

  #scrollToBottom(): void {
    if (this.#messageListEl === null) {
      return;
    }

    this.#messageListEl.scrollTop = this.#messageListEl.scrollHeight;
  }
}
