import type { WorkspaceLeaf } from "obsidian";
import { ItemView, MarkdownRenderer } from "obsidian";

import type { LangchainRag } from "../rag/langchain-rag";
import { MessageHistory } from "./message-history";

export const CHAT_VIEW_TYPE = "yggdrasil-chat";

export class ChatView extends ItemView {
  #messageListEl: HTMLElement | null = null;
  #loadingWrapperEl: HTMLElement | null = null;
  #abortController: AbortController | null = null;
  #sendBtn: HTMLButtonElement | null = null;
  readonly #messageHistory: MessageHistory;

  public constructor(
    leaf: WorkspaceLeaf,
    private readonly getRag: () => LangchainRag,
  ) {
    super(leaf);
    this.#messageHistory = new MessageHistory();
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

    const sendBtn: HTMLButtonElement = inputRow.createEl("button", {
      text: "Send",
      cls: "mod-cta",
    });
    this.#sendBtn = sendBtn;

    // Auto-resize textarea height on input
    input.addEventListener("input", (): void => {
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight}px`;
    });

    input.addEventListener("keydown", (evt: KeyboardEvent): void => {
      if (evt.key === "Enter" && !evt.shiftKey) {
        evt.preventDefault();
        this.#onSend(input);
        return;
      }

      if (input.disabled) {
        return;
      }

      if (evt.key === "ArrowUp") {
        evt.preventDefault();
        if (this.#messageHistory.atDefaultPosition) {
          this.#messageHistory.setDraft(input.value);
        }
        input.value = this.#messageHistory.previous();
        input.selectionStart = input.value.length;
        input.selectionEnd = input.selectionStart;
        return;
      }

      if (evt.key === "ArrowDown") {
        evt.preventDefault();
        input.value = this.#messageHistory.next();
        input.selectionStart = input.value.length;
        input.selectionEnd = input.selectionStart;
        return;
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
    if (this.#abortController !== null) {
      this.#abortController.abort();
      this.#abortController = null;
    }
    this.#messageListEl = null;
    this.#loadingWrapperEl = null;
    this.#sendBtn = null;
  }

  readonly #messages: Array<{ content: string; role: "user" | "assistant" }> =
    [];

  async #onSend(inputEl: HTMLTextAreaElement): Promise<void> {
    if (this.#abortController !== null) {
      this.#abortController.abort();
      this.#abortController = null;
      this.#setLoadingState(false);
      this.#hideLoading();
      this.#messages.pop();
      inputEl.disabled = false;
      inputEl.focus();
      return;
    }

    const text: string = inputEl.value.trim();
    if (text.length === 0) {
      return;
    }

    this.#messages.push({ content: text, role: "user" });
    this.#messageHistory.push(text);

    inputEl.disabled = true;
    try {
      this.#renderMessage(text, "user");

      inputEl.value = "";
      inputEl.style.height = "auto";

      this.#showLoading();
      this.#setLoadingState(true);

      this.#abortController = new AbortController();
      try {
        const response = await this.getRag().query(
          text,
          this.#messages.slice(0, -1),
          this.#abortController.signal,
        );
        this.#messages.push({ content: response, role: "assistant" });
        this.#renderMessage(response, "assistant");
      } catch (error) {
        this.#messages.pop();
        if (error instanceof DOMException && error.name === "AbortError") {
          this.#renderMessage("Request cancelled.", "assistant");
        } else {
          this.#renderMessage(`Request error: ${error}`, "assistant");
        }
      } finally {
        this.#abortController = null;
      }
    } finally {
      this.#setLoadingState(false);
      this.#hideLoading();
      inputEl.disabled = false;
      inputEl.focus();
    }
  }

  #setLoadingState(isLoading: boolean): void {
    if (this.#sendBtn === null) {
      return;
    }

    if (isLoading) {
      this.#sendBtn.textContent = "Cancel";
      this.#sendBtn.classList.add("yggdrasil-chat-cancel-btn");
    } else {
      this.#sendBtn.textContent = "Send";
      this.#sendBtn.classList.remove("yggdrasil-chat-cancel-btn");
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
    if (this.#abortController !== null) {
      this.#abortController.abort();
      this.#abortController = null;
    }
    this.#messages.length = 0;
    this.#messageHistory.clear();
    if (this.#messageListEl !== null) {
      this.#messageListEl.empty();
    }
  }
}
