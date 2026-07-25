# PRD 002 - Request Cancellation

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

**Current stage: 6 — Cleanup & Refactoring (complete)**

## Goal

Allow the user to cancel an in-flight chat request by pressing a Cancel button that replaces the Send button while a query is being processed.

## Requirements

### Functional

1. While `rag.query()` is executing, the Send button must transform into a Cancel button
2. Clicking Cancel must abort the ongoing agentic flow
3. After cancellation, the UI must return to the idle state (Send button visible, input re-enabled, loading indicator removed)
4. The cancelled user message must **not** be added to the conversation history
5. The cancelled assistant response must **not** be added to the conversation history

### Non-functional

1. Cancellation must be responsive — the UI should recover within ~100ms of clicking Cancel
2. No memory leaks — abort controllers and event listeners must be cleaned up
3. Must follow existing code conventions (private `#` fields, `Array<T>`, explicit types, no `any`, no `!`)

## Scope

- `src/ui/chat-view.ts` — button state management, abort controller lifecycle
- `src/rag/interfaces.ts` — `IAgent.invoke` accepts optional `AbortSignal`
- `src/rag/adapters/agent.ts` — wire `AbortSignal` into LangGraph stream
- `src/rag/langchain-rag.ts` — pass `AbortSignal` through to agent
- `src/styles.css` — optional cancel button styling

## Out-of-scope

- Cancelling background re-indexing operations
- Streaming partial responses to the user
- Multiple concurrent requests (only one at a time is supported)

## Context

### Current flow (no cancellation)

```
ChatView.#onSend()
  → disables input
  → pushes user message to history
  → shows loading spinner
  → awaits rag.query(text, history)          ← blocking, no escape hatch
  → pushes assistant response to history
  → re-enables input
```

### Key files

| File                                | Role                                           |
| ----------------------------------- | ---------------------------------------------- |
| `src/ui/chat-view.ts:105-143`       | `#onSend` — orchestrates the request lifecycle |
| `src/ui/chat-view.ts:70-73`         | Send button creation                           |
| `src/rag/langchain-rag.ts:70-76`    | `query()` — delegates to agent                 |
| `src/rag/interfaces.ts:24-29`       | `IAgent` interface                             |
| `src/rag/adapters/agent.ts:269-286` | `#invoker` — calls `compiledGraph.invoke()`    |

### LangGraph cancellation

LangGraph's `compiledGraph.invoke()` is blocking and does not support cancellation. However, `compiledGraph.stream()` returns an async generator that can be abandoned. Combined with an `AbortSignal`, we can:

1. Call `compiledGraph.stream()` to get an async iterator
2. Collect streamed state updates until we get `finalAnswer`
3. On cancellation, stop consuming the iterator (which allows the underlying HTTP requests to be garbage-collected and eventually timeout)

For more responsive cancellation, we can pass the `AbortSignal` through langchain's `ChatOpenAI` configuration. The `ChatOpenAI` model respects `signal` in its invocation options, which will abort the underlying HTTP fetch.

## Technical Specification

### 1. `IAgent` interface — add `AbortSignal`

**File:** `src/rag/interfaces.ts`

```typescript
export interface IAgent {
  invoke(
    query: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
    signal?: AbortSignal,
  ): Promise<string>;
}
```

### 2. `LangchainAgentAdapter` — wire abort signal

**File:** `src/rag/adapters/agent.ts`

- Change `#invoker` to accept `AbortSignal | undefined`
- Switch from `compiledGraph.invoke()` to `compiledGraph.stream()`
- Pass `signal` to the graph invocation options:
  ```typescript
  const stream = compiledGraph.stream(
    { messages: [...historyMessages, new HumanMessage(input)] },
    { signal },
  );
  ```
- Iterate the stream, accumulating state, returning `finalAnswer` when available
- If `signal.aborted` is detected, throw an `AbortError`

Key change in `#invoker`:

```typescript
this.#invoker = async (input, history, signal) => {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const stream = compiledGraph.stream(
    { messages: [...historyMessages, new HumanMessage(input)] },
    { signal },
  );

  let finalAnswer = "";
  for await (const update of stream) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    finalAnswer = update.finalAnswer ?? finalAnswer;
  }
  return finalAnswer;
};
```

Update `invoke()` signature to accept `signal?: AbortSignal`.

### 3. `LangchainRag.query()` — pass signal through

**File:** `src/rag/langchain-rag.ts`

```typescript
public async query(
  query: string,
  history: Array<ChatMessage>,
  signal?: AbortSignal,
): Promise<string> {
  console.log("Querying agent with messages:", query);
  return this.#agent.invoke(query, history, signal);
}
```

### 4. `ChatView` — cancel button + abort controller lifecycle

**File:** `src/ui/chat-view.ts`

Add private fields:

```typescript
#abortController: AbortController | null = null;
#sendBtn: HTMLButtonElement | null = null;
```

Store `sendBtn` reference during `onOpen()`.

New methods:

```typescript
#setLoadingState(isLoading: boolean): void {
  if (this.#sendBtn === null) return;

  if (isLoading) {
    this.#sendBtn.textContent = "Cancel";
    this.#sendBtn.classList.add("yggdrasil-chat-cancel-btn");
  } else {
    this.#sendBtn.textContent = "Send";
    this.#sendBtn.classList.remove("yggdrasil-chat-cancel-btn");
  }
}
```

Refactored `#onSend()`:

```typescript
async #onSend(inputEl: HTMLTextAreaElement): Promise<void> {
  // If a request is in-flight, cancel it
  if (this.#abortController !== null) {
    this.#abortController.abort();
    this.#abortController = null;
    this.#setLoadingState(false);
    this.#hideLoading();
    // Remove the user message that was pushed before cancellation
    this.#messages.pop(); // assistant (if partial)
    this.#messages.pop(); // user
    inputEl.disabled = false;
    inputEl.focus();
    return;
  }

  const text: string = inputEl.value.trim();
  if (text.length === 0) return;

  this.#messages.push({ content: text, role: "user" });
  inputEl.disabled = true;

  try {
    this.#renderMessage(text, "user");
    inputEl.value = "";
    inputEl.style.height = "auto";
    this.#showLoading();
    this.#setLoadingState(true);

    this.#abortController = new AbortController();
    try {
      const response = await this.rag.query(
        text,
        this.#messages.slice(0, -1),
        this.#abortController.signal,
      );
      this.#messages.push({ content: response, role: "assistant" });
      this.#renderMessage(response, "assistant");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        // User cancelled — remove the user message from history
        this.#messages.pop();
        // Show a brief cancelled indicator
        this.#renderMessage("Request cancelled.", "assistant");
      } else {
        throw error;
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
```

Also clean up `#abortController` in `onClose()` and `#clearConversation()`:

```typescript
public async onClose(): Promise<void> {
  if (this.#abortController !== null) {
    this.#abortController.abort();
    this.#abortController = null;
  }
  this.#messageListEl = null;
  this.#loadingWrapperEl = null;
  this.#sendBtn = null;
}
```

### 5. CSS — cancel button styling

**File:** `src/styles.css`

```css
/* ── Cancel Button ───────────────────────────────────────────────────────────── */

.yggdrasil-chat-cancel-btn {
  background-color: var(--interactive-accent);
  color: var(--text-on-accent);
}

.yggdrasil-chat-cancel-btn:hover {
  background-color: var(--interactive-hover);
}
```

## Test Plan

No existing test infrastructure for UI components (no test files found). Tests would require:

1. **Unit test** for `LangchainAgentAdapter` — verify that `invoke()` throws `AbortError` when signal is aborted
2. **Unit test** for `ChatView` — mock `rag.query()` to verify button state transitions and message history cleanup on cancellation

Given the current lack of test files, these can be added as new `tests/chat-view.test.ts` and `tests/agent-cancellation.test.ts` files using the obsidian stub.

## Implementation Checklist

- [ ] 1. Update `IAgent.invoke()` signature to accept `signal?: AbortSignal`
- [ ] 2. Refactor `LangchainAgentAdapter.#invoker` to use `stream()` + abort signal
- [ ] 3. Update `LangchainRag.query()` to pass signal through
- [ ] 4. Add `#abortController`, `#sendBtn` fields to `ChatView`
- [ ] 5. Implement `#setLoadingState()` method
- [ ] 6. Refactor `#onSend()` to handle cancel toggle
- [ ] 7. Update `onClose()` and `#clearConversation()` for cleanup
- [ ] 8. Add cancel button CSS
- [ ] 9. Run `npm run typecheck` and `npm run lint`
- [ ] 10. Manual test in Obsidian

## Validation Checklist

- [ ] Send button changes to "Cancel" while request is in-flight
- [ ] Clicking Cancel stops the agentic flow
- [ ] UI returns to idle state after cancellation (Send button, input enabled)
- [ ] Cancelled messages are not persisted in conversation history
- [ ] "Request cancelled." message appears in chat
- [ ] No console errors after cancellation
- [ ] Multiple rapid cancel clicks are safe (idempotent)
- [ ] Closing the view during a request does not crash
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
