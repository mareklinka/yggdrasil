import type { WorkspaceLeaf } from "obsidian";
import { ItemView } from "obsidian";

export const CHAT_VIEW_TYPE = "yggdrasil-chat";
export const CANNED_RESPONSE = "This functionality is under development";

export class ChatView extends ItemView {
  #messageListEl: HTMLElement | null = null;

  public constructor(leaf: WorkspaceLeaf) {
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

    // Set root container styles
    contentEl.setCssStyles({
      display: "flex",
      flexDirection: "column",
      height: "100%",
    });

    // Chat message list area
    const listEl: HTMLElement = contentEl.createDiv({ cls: "yggdrasil-chat-messages" });
    listEl.setCssStyles({
      flex: "1",
      overflowY: "auto",
      padding: "12px 16px",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
    });
    this.#messageListEl = listEl;

    // Input row at bottom
    const inputRow: HTMLElement = contentEl.createDiv({ cls: "yggdrasil-chat-input-row" });
    inputRow.setCssStyles({
      display: "flex",
      gap: "4px",
      padding: "8px",
      backgroundColor: "var(--background-primary)",
      borderTop: "1px solid var(--background-modifier-border)",
      flexWrap: "wrap",
    });

    const input: HTMLInputElement = inputRow.createEl("input", {
      type: "text",
      cls: "yggdrasil-chat-input",
      placeholder: "Type a message…",
    });
    input.setCssStyles({
      flex: "1",
      marginBottom: "0",
      marginTop: "0",
    });

    const sendBtn: HTMLElement = inputRow.createEl("button", {
      text: "Send",
      cls: "mod-cta",
    });
    sendBtn.setCssStyles({
      flexShrink: "0",
      marginBottom: "0",
      marginTop: "0",
      padding: "6px 12px",
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
    }, 0, 0);
  }

  public async onClose(): Promise<void> {
    this.#messageListEl = null;
  }

  #onSend(inputEl: HTMLInputElement): void {
    const text: string = inputEl.value.trim();
    if (text.length === 0) {
      return;
    }

    // Disable input while rendering canned response
    inputEl.disabled = true;
    try {
      // Append user bubble
      this.#renderMessage(text, "user");

      // Clear input
      inputEl.value = "";

      // Append assistant bubble (canned response)
      this.#renderMessage(CANNED_RESPONSE, "assistant");

      // Auto-scroll
      this.#scrollToBottom();
    } finally {
      // Re-enable input regardless of outcome
      inputEl.disabled = false;
      // Retain focus for quick follow-up messages
      inputEl.focus();
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
    wrapper.setCssStyles({
      display: "flex",
      flexDirection: sender === "user" ? "row-reverse" : "row",
      gap: "6px",
      alignItems: "flex-start",
    });

    // Copy button — hidden by default, shown on hover
    const copyBtn: HTMLButtonElement = wrapper.createEl("button", {
      cls: "yggdrasil-chat-copy-btn",
      attr: { title: "Copy message" },
    });
    copyBtn.textContent = "\u2398"; // ⌘ symbol as copy icon
    copyBtn.setCssStyles({
      width: "20px",
      height: "20px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "12px",
      backgroundColor: "transparent",
      border: "none",
      cursor: "pointer",
      opacity: "0",
      transition: "opacity 0.15s ease",
      padding: "0",
      flexShrink: "0",
    });

    // The actual message bubble
    const bubble: HTMLElement = wrapper.createDiv({
      cls: `yggdrasil-chat-bubble yggdrasil-chat-bubble--${sender}`,
    });

    // Style the bubble based on sender
    if (sender === "user") {
      bubble.setCssStyles({
        backgroundColor: "var(--interactive-accent)",
        color: "var(--text-on-accent)",
        borderRadius: "12px",
        padding: "8px 12px",
        fontSize: "var(--font-text)",
        lineHeight: "1.4",
      });
      copyBtn.setCssStyles({
        color: "var(--text-on-accent)",
      });
    } else {
      bubble.setCssStyles({
        backgroundColor: "var(--background-modifier-hover)",
        color: "var(--text-normal)",
        borderRadius: "12px",
        padding: "8px 12px",
        fontSize: "var(--font-text)",
        lineHeight: "1.4",
        border: "1px solid var(--background-modifier-border)",
      });
      copyBtn.setCssStyles({
        color: "var(--text-muted)",
      });
    }

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
      navigator.clipboard.writeText(text).then(() => {
        // Brief visual feedback
        copyBtn.textContent = "\u2713"; // ✓ checkmark
        setTimeout(() => {
          copyBtn.textContent = "\u2398";
        }, 1000);
      });
    });

    const contentEl = bubble.createEl("div", {
      cls: "yggdrasil-chat-bubble-content",
      text,
    });
    contentEl.setCssStyles({
      wordWrap: "break-word",
      whiteSpace: "pre-wrap",
      userSelect: "text",
    });

    this.#scrollToBottom();
  }

  #scrollToBottom(): void {
    if (this.#messageListEl === null) {
      return;
    }

    this.#messageListEl.scrollTop = this.#messageListEl.scrollHeight;
  }
}
