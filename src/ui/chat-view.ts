import type { WorkspaceLeaf } from "obsidian";
import { ItemView, MarkdownRenderer, Notice } from "obsidian";

import type { ChatAttachment, ChatMessage } from "../rag/interfaces";
import type { LangchainRag } from "../rag/langchain-rag";
import type { YggdrasilSettings } from "../settings";
import { MessageHistory } from "./message-history";

const MAX_ATTACHMENT_SIZE = 1 * 1024 * 1024;
const MAX_ATTACHMENTS = 3;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif"]);

export const CHAT_VIEW_TYPE = "yggdrasil-chat";

export class ChatView extends ItemView {
  #messageListEl: HTMLElement | null = null;
  #loadingWrapperEl: HTMLElement | null = null;
  #abortController: AbortController | null = null;
  #sendBtn: HTMLButtonElement | null = null;
  #attachmentTrayEl: HTMLElement | null = null;
  #pendingAttachments: Array<ChatAttachment> = [];
  readonly #messageHistory: MessageHistory;

  public constructor(
    leaf: WorkspaceLeaf,
    private readonly getRag: () => LangchainRag,
    private readonly getSettings: () => YggdrasilSettings,
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

    // Attachment tray
    const trayEl: HTMLElement = contentEl.createDiv({
      cls: "yggdrasil-chat-attachment-tray",
    });
    this.#attachmentTrayEl = trayEl;

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

    // Paste handler for images
    input.addEventListener("paste", (evt: ClipboardEvent): void => {
      if (!this.getSettings().chatModelHasVision) {
        new Notice("Attachments are only supported for vision models");
        return;
      }
      const items = evt.clipboardData?.items;
      if (items === null || items === undefined) {
        return;
      }
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!SUPPORTED_IMAGE_TYPES.has(item.type)) {
          new Notice("Only JPEG, PNG, and GIF images are supported");
          continue;
        }
        evt.preventDefault();
        const file = item.getAsFile();
        if (file === null) {
          continue;
        }
        this.#addFile(file);
      }
    });

    // Drag-and-drop handlers
    inputRow.addEventListener("dragover", (evt: DragEvent): void => {
      if (!this.getSettings().chatModelHasVision) {
        return;
      }
      evt.preventDefault();
      inputRow.addClass("yggdrasil-chat-input-row--drag-over");
    });

    inputRow.addEventListener("dragleave", (evt: DragEvent): void => {
      if (
        evt.relatedTarget !== null &&
        inputRow.contains(evt.relatedTarget as Node)
      ) {
        return;
      }
      inputRow.removeClass("yggdrasil-chat-input-row--drag-over");
    });

    inputRow.addEventListener("drop", (evt: DragEvent): void => {
      evt.preventDefault();
      if (!this.getSettings().chatModelHasVision) {
        new Notice("Attachments are only supported for vision models");
        return;
      }
      inputRow.removeClass("yggdrasil-chat-input-row--drag-over");
      const files = evt.dataTransfer?.files;
      if (files === null || files === undefined) {
        return;
      }
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (SUPPORTED_IMAGE_TYPES.has(file.type)) {
          this.#addFile(file);
        } else {
          new Notice("Only JPEG, PNG, and GIF images are supported");
        }
      }
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

      if (evt.key === "ArrowUp" && this.#messageHistory.size > 0) {
        evt.preventDefault();
        if (this.#messageHistory.atDefaultPosition) {
          this.#messageHistory.setDraft(input.value);
        }
        const entry = this.#messageHistory.previous();
        if (entry !== undefined) {
          input.value = entry.content;
          this.#pendingAttachments =
            entry.attachments !== undefined ? [...entry.attachments] : [];
          this.#renderAttachmentTray();
        }
        input.selectionStart = input.value.length;
        input.selectionEnd = input.selectionStart;
        return;
      }

      if (evt.key === "ArrowDown" && this.#messageHistory.size > 0) {
        evt.preventDefault();
        input.value = this.#messageHistory.next();
        this.#pendingAttachments = [];
        this.#renderAttachmentTray();
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
    this.#attachmentTrayEl = null;
  }

  readonly #messages: Array<ChatMessage> = [];

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
    if (text.length === 0 && this.#pendingAttachments.length === 0) {
      return;
    }

    const attachments =
      this.#pendingAttachments.length > 0
        ? [...this.#pendingAttachments]
        : undefined;

    this.#messages.push({
      content: text,
      role: "user",
      attachments: attachments,
    });

    this.#messageHistory.push({
      content: text,
      role: "user",
      attachments: attachments,
    });

    inputEl.disabled = true;
    try {
      this.#renderMessage(text, "user", attachments);

      inputEl.value = "";
      inputEl.style.height = "auto";
      this.#pendingAttachments = [];
      this.#renderAttachmentTray();

      this.#showLoading();
      this.#setLoadingState(true);

      this.#abortController = new AbortController();
      try {
        const response = await this.getRag().query(
          text,
          attachments,
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

  #renderMessage(
    text: string,
    sender: "user" | "assistant",
    attachments?: Array<ChatAttachment>,
  ): void {
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
      if (attachments !== undefined && attachments.length > 0) {
        const imageContainer: HTMLElement = bubble.createDiv({
          cls: "yggdrasil-chat-bubble-images",
        });
        for (let i = 0; i < attachments.length; i++) {
          imageContainer.createEl("img", {
            cls: "yggdrasil-chat-bubble-image",
            attr: {
              src: attachments[i].dataUrl,
              alt: "Attached image",
            },
          });
        }
      }
      if (text.length > 0) {
        bubble.createEl("div", {
          cls: "yggdrasil-chat-bubble-content",
          text,
        });
      }
    }

    // Footer bar with copy button — below bubble, inside same column
    const footer: HTMLElement = col.createDiv({
      cls: "yggdrasil-chat-bubble-footer",
    });

    const copyBtn: HTMLButtonElement = footer.createEl("button", {
      cls: "yggdrasil-chat-copy-btn",
    });
    copyBtn.textContent = "\u2398 Copy message";

    // Hover on the column so cursor can move from bubble to footer without hiding
    col.addEventListener("mouseenter", (): void => {
      footer.addClass("yggdrasil-chat-bubble-footer--visible");
    });
    col.addEventListener("mouseleave", (): void => {
      footer.removeClass("yggdrasil-chat-bubble-footer--visible");
    });

    copyBtn.addEventListener(
      "click",
      async (evt: MouseEvent): Promise<void> => {
        evt.stopPropagation();
        const clipboard = navigator.clipboard;
        if (clipboard === undefined) {
          return;
        }

        try {
          await clipboard.writeText(text);
          copyBtn.textContent = "\u2713 Copied";
          setTimeout(() => {
            copyBtn.textContent = "\u2398 Copy message";
          }, 1000);
        } catch {
          // Clipboard write failed silently
        }
      },
    );

    this.#scrollToBottom();
  }

  #scrollToBottom(): void {
    if (this.#messageListEl === null) {
      return;
    }

    this.#messageListEl.scrollTop = this.#messageListEl.scrollHeight;
  }

  #addFile(file: File): void {
    if (!this.getSettings().chatModelHasVision) {
      new Notice("Attachments are only supported for vision models");
      return;
    }
    if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
      new Notice("Only JPEG, PNG, and GIF images are supported");
      return;
    }
    if (this.#pendingAttachments.length >= MAX_ATTACHMENTS) {
      new Notice(`Maximum ${MAX_ATTACHMENTS} attachments allowed`);
      return;
    }
    if (file.size > MAX_ATTACHMENT_SIZE) {
      new Notice("Image must be under 1 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = (): void => {
      const result = reader.result;
      if (typeof result !== "string") {
        return;
      }
      this.#pendingAttachments.push({
        dataUrl: result,
        mimeType: file.type,
      });
      this.#renderAttachmentTray();
    };
    reader.onerror = (): void => {
      new Notice("Failed to read image");
    };
    reader.readAsDataURL(file);
  }

  #renderAttachmentTray(): void {
    if (this.#attachmentTrayEl === null) {
      return;
    }
    if (!this.getSettings().chatModelHasVision) {
      this.#attachmentTrayEl.empty();
      this.#attachmentTrayEl.addClass("yggdrasil-chat-attachment-tray--hidden");
      this.#pendingAttachments = [];
      return;
    }
    this.#attachmentTrayEl.removeClass(
      "yggdrasil-chat-attachment-tray--hidden",
    );
    this.#attachmentTrayEl.empty();
    for (let i = 0; i < this.#pendingAttachments.length; i++) {
      const idx = i;
      const item: HTMLElement = this.#attachmentTrayEl.createDiv({
        cls: "yggdrasil-chat-attachment-item",
      });
      item.createEl("img", {
        cls: "yggdrasil-chat-attachment-thumb",
        attr: {
          src: this.#pendingAttachments[idx].dataUrl,
          alt: "Attached image",
        },
      });
      const removeBtn: HTMLButtonElement = item.createEl("button", {
        cls: "yggdrasil-chat-attachment-remove",
        text: "✕",
      });
      removeBtn.addEventListener("click", (): void => {
        this.#pendingAttachments.splice(idx, 1);
        this.#renderAttachmentTray();
      });
    }
  }

  #clearConversation(): void {
    if (this.#abortController !== null) {
      this.#abortController.abort();
      this.#abortController = null;
    }
    this.#messages.length = 0;
    this.#pendingAttachments = [];
    this.#messageHistory.clear();
    if (this.#messageListEl !== null) {
      this.#messageListEl.empty();
    }
    this.#renderAttachmentTray();
  }
}
