# PRD 001 - Multi-turn Conversation Support

Date: 2026-07-25
Work item: N/A

## SDLC Stage Tracker

| Stage | Name                               | Status      |
| ----- | ---------------------------------- | ----------- |
| 1     | Requirements Elicitation           | ✅ Complete |
| 2     | Exploration                        | ✅ Complete |
| 3     | Validation (User Review)           | ✅ Complete |
| 4     | Implementation                     | ✅ Complete |
| 5     | Validation (Implementation Review) | ✅ Complete |
| 6     | Cleanup & Refactoring              | ✅ Complete |

**Current stage: Complete**

> Update this tracker at each stage transition. The agent will prompt the user to commit after updating.

## Goal

Enable multi-turn conversations in the Yggdrasil chat interface so the LLM retains context across messages, with a "New conversation" button in the chat header to reset.

## Requirements

1. The chat view shall maintain a conversation history array containing all user messages and assistant responses for the current session.
2. When the user sends a message, the full conversation history (all prior turns) shall be included in the context sent to the LLM, not just the latest message.
3. The chat view header shall display a "New conversation" button.
4. Pressing "New conversation" shall clear all message history from the UI and reset the conversation state in memory.
5. Only one active conversation is supported at a time. There is no conversation list, no switching, and no persistence of cleared conversations.
6. The RAG retrieval step shall continue to use only the current user's message (not full history) for relevance against the vector store, while the LLM prompt receives the full conversation history for context.

## Scope

- Modifying `ChatView` to maintain and render conversation history across turns.
- Adding a "New conversation" button to the chat view header.
- Updating the RAG/agent invocation to pass conversation history to the LLM prompt while keeping retrieval scoped to the current message.
- CSS styling for the new button and multi-turn message rendering.

## Out-of-scope

- Multiple concurrent conversations or conversation switching.
- Persisting conversations across plugin reloads or Obsidian restarts.
- Conversation naming, editing, or deleting individual messages.
- Command palette integration for "new conversation."

## Context

- The current implementation in `ChatView` (`src/ui/chat-view.ts`) effectively creates a new conversation per message, losing prior context.
- The RAG pipeline (`src/rag/langchain-rag.ts`) and agent (`src/rag/adapters/agent.ts`) handle retrieval and LLM calls. The agent's system prompt and message construction will need to accommodate conversation history.
- The plugin follows Obsidian's `ItemView` pattern for the side panel chat interface.

## Technical Specification

### Architecture Overview

The `ChatView` already tracks messages in `#messages` but only for local UI rendering. The `rag.query(text)` call sends only the latest message to the agent, which invokes the LangGraph with a single `HumanMessage`. The fix threads conversation history from the UI through the RAG layer into the agent's message chain.

### Files to Modify

#### 1. `src/rag/interfaces.ts` — `IAgent` interface

Change `invoke` signature to accept conversation history:

```ts
export interface IAgent {
  invoke(
    query: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<string>;
}
```

#### 2. `src/rag/adapters/agent.ts` — `LangchainAgentAdapter`

- Update constructor's `#invoker` to accept `history` parameter
- In the graph invocation, convert history entries into alternating `HumanMessage` / `AIMessage` instances prepended to the current `HumanMessage(input)`
- The `invoke` public method signature updates to match the interface

Key change in the compiled graph invocation (line ~273):

```ts
this.#invoker = async (
  input: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string> => {
  const historyMessages = history.map((entry) =>
    entry.role === "user"
      ? new HumanMessage(entry.content)
      : new AIMessage(entry.content),
  );
  return (
    await compiledGraph.invoke({
      messages: [...historyMessages, new HumanMessage(input)],
    })
  ).finalAnswer;
};
```

#### 3. `src/rag/langchain-rag.ts` — `LangchainRag`

- Update `query` method signature: `query(query: string, history: Array<{ role: "user" | "assistant"; content: string }>): Promise<string>`
- Pass history through to `this.#agent.invoke(query, history)`

#### 4. `src/ui/chat-view.ts` — `ChatView`

**Header bar:** During `onOpen()`, create a header element between `contentEl` and the message list:

```ts
const headerEl: HTMLElement = contentEl.createDiv({
  cls: "yggdrasil-chat-header",
});
const titleEl: HTMLElement = headerEl.createEl("h2", {
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
```

**Message sending:** In `#onSend()`, pass conversation history (all messages except the one just pushed) to `rag.query()`:

```ts
const history: Array<{ content: string; role: "user" | "assistant" }> =
  this.#messages.slice(0, -1);
const response = await this.rag.query(text, history);
```

**Clear method:** New private method:

```ts
#clearConversation(): void {
  this.#messages.length = 0;
  if (this.#messageListEl !== null) {
    this.#messageListEl.empty();
  }
}
```

#### 5. `src/styles.css` — Header and button styles

```css
/* ── Chat Header ─────────────────────────────────────────────────────────────── */

.yggdrasil-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--size-4-2) var(--size-4-4);
  border-bottom: 1px solid var(--background-modifier-border);
}

.yggdrasil-chat-header-title {
  margin: 0;
  font-size: var(--font-ui-medium);
  font-weight: var(--font-medium);
}

.yggdrasil-chat-new-conversation-btn {
  font-size: var(--font-ui-smaller);
  padding: var(--size-2-1) var(--size-2-3);
  flex-shrink: 0;
}
```

### Data Flow

```
User types message → ChatView.#onSend()
  → pushes message to #messages
  → renders user bubble
  → calls rag.query(currentMessage, #messages.slice(0, -1))
    → LangchainRag.query() forwards to agent.invoke(query, history)
      → LangchainAgentAdapter maps history → [HumanMessage, AIMessage, ...]
      → Graph receives [...historyMessages, HumanMessage(current)]
      → Agent processes, returns finalAnswer
    → LangchainRag returns response
  → ChatView pushes assistant message to #messages
  → renders assistant bubble
```

### Backward Compatibility

The `IAgent.invoke` and `LangchainRag.query` signatures change. No external consumers exist beyond `ChatView`, so this is safe.

## Test Plan

### Unit Tests

1. **`LangchainAgentAdapter` history injection** — Verify that when `invoke("current question", [{role: "user", content: "prior question"}, {role: "assistant", content: "prior answer"}])` is called, the graph receives three messages in order: HumanMessage("prior question"), AIMessage("prior answer"), HumanMessage("current question"). Mock the compiled graph's `invoke` to capture input.

2. **`LangchainAgentAdapter` empty history** — Verify that `invoke("question", [])` produces a single-element messages array `[HumanMessage("question")]`.

3. **`ChatView.#clearConversation`** — Verify that calling the method empties `#messages` array and `#messageListEl` DOM children.

4. **`ChatView` history passing** — Verify that after two user/assistant exchanges, the third `rag.query()` call receives the prior two turns as history. Mock `rag.query` to capture arguments.

### Integration / Manual Tests

5. Send three sequential messages and verify the LLM references earlier context in its response.
6. Press "New conversation" and verify subsequent messages have no prior context.
7. Verify UI renders all messages correctly across multiple turns.

## Implementation Checklist

- [ ] Update `IAgent.invoke` signature in `src/rag/interfaces.ts`
- [ ] Update `LangchainAgentAdapter` to accept and inject history in `src/rag/adapters/agent.ts`
- [ ] Update `LangchainRag.query` signature in `src/rag/langchain-rag.ts`
- [ ] Add chat header with "New conversation" button in `src/ui/chat-view.ts`
- [ ] Add `#clearConversation()` method in `src/ui/chat-view.ts`
- [ ] Pass conversation history to `rag.query()` in `#onSend()`
- [ ] Add header and button CSS in `src/styles.css`
- [ ] Create `tests/obsidian.stub.ts` (required by vitest config)
- [ ] Write unit tests for history injection and clearing
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run test`

## Validation Checklist

- [ ] Sending multiple messages preserves conversation context (LLM references earlier turns)
- [ ] "New conversation" button appears in the chat header
- [ ] Pressing "New conversation" clears all messages from UI and memory
- [ ] After clearing, the next message has no prior context
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run lint` passes with no errors
- [ ] All unit tests pass
- [ ] No regressions in single-message queries
