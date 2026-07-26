# PRD 003 - User Message History

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

**Current stage: 6 — Cleanup & Refactoring (Complete)**

## Goal

Enable users to navigate their recent user messages via Arrow Up/Down in the chat input, with in-memory FIFO-capped history of 100 entries.

## Requirements

1. **History storage**: Maintain an in-memory array of the last 100 user-submitted messages. No persistence across sessions or view lifecycle.
2. **FIFO eviction**: When the history exceeds 100 entries, evict the oldest entry (first inserted). Navigation via Arrow Up/Down does not affect eviction order.
3. **Recording messages**: Every user message sent via `#onSend` is added to the history.
4. **Arrow Up navigation**:
   - Shows the previous entry in history (newest first).
   - On first press from the default (draft) position, saves the current input text as the draft.
   - Subsequent presses while browsing history do NOT overwrite the draft.
   - At the oldest entry (index 0), stops — no wrapping.
5. **Arrow Down navigation**:
   - Shows the next entry in history.
   - When past the last entry, returns to the saved draft text and resets cursor to default position.
   - At the default position, returns the draft text (no-op).
6. **Draft preservation**: The text in the input field is saved as the draft only when Arrow Up is pressed from the default position. The draft is recovered when navigating back down past the last history entry.
7. **Duplicate handling**: Duplicates are allowed in history.
8. **Disabled during loading**: Arrow Up/Down are no-ops while a request is in flight (input element is disabled).
9. **Empty input**: Arrow Up from an empty input shows the last submitted message. Arrow Down from an empty input at the default position returns empty string.
10. **Send resets cursor**: Hitting Send pushes the message to history and resets the cursor to the default position.
11. **Conversation clear**: Clearing the conversation (`#clearConversation`) also clears the message history and draft.

## Scope

- New file: `src/ui/message-history.ts` — pure history manager class
- Modification of `src/ui/chat-view.ts` — keyboard handler + history integration
- New file: `tests/message-history.test.ts` — unit tests for history manager
- New file: `tests/obsidian.stub.ts` — Obsidian API stubs (first test infrastructure)

## Out-of-scope

- Persistence of history across sessions or plugin reloads
- Sharing history across multiple chat view instances
- Search/filter within history
- UI indicator showing history position (e.g., "3/100")
- Configuration of history size limit
- CSS changes (no new visual elements)
- Cursor-position gating (Arrow Up always navigates, regardless of selectionStart)

## Context

- The chat input lives in `ChatView` (`src/ui/chat-view.ts`), created in `onOpen()`.
- Messages are recorded in `#onSend` via `this.#messages.push({ content: text, role: "user" })` followed by `this.#messageHistory.push(text)`.
- The input's keydown listener handles Enter, ArrowUp, and ArrowDown.
- The input is disabled during requests and re-enabled in the `finally` block.
- `#clearConversation` resets `#messages`, empties the message list DOM, and calls `this.#messageHistory.clear()`.

## Technical Specification

### New file: `src/ui/message-history.ts`

Pure class, zero Obsidian dependencies. Manages the history array, cursor position, and draft text.

```typescript
export interface IMessageHistory {
  push(message: string): void;
  setDraft(text: string): void;
  previous(): string;
  next(): string;
  clear(): void;
  readonly size: number;
  readonly atDefaultPosition: boolean;
}

export class MessageHistory implements IMessageHistory {
  readonly #entries: Array<string>;
  readonly #maxSize: number;
  #cursor: number; // -1 = at draft position, 0..N-1 = index into #entries
  #draft: string;

  constructor(maxSize: number = 100);
  push(message: string): void; // appends entry, FIFO evicts if over #maxSize, resets cursor to -1
  setDraft(text: string): void; // stores draft text (called by ChatView only when atDefaultPosition)
  previous(): string; // moves cursor back, stops at index 0 (no wrap)
  next(): string; // moves cursor forward, returns #draft and resets cursor to -1 when past last entry
  clear(): void; // resets entries, cursor, draft
  readonly size: number; // returns #entries.length
  readonly atDefaultPosition: boolean; // true when #cursor === -1
}
```

**State machine:**

- `#cursor === -1` (default position): user is at draft. `previous()` moves cursor to `entries.length - 1` and returns that entry. `next()` returns `#draft` (no-op). ChatView saves draft via `setDraft()` before calling `previous()` (only when `atDefaultPosition` is true).
- `#cursor >= 0`: user is browsing history. `previous()` decrements cursor, stops at 0 (no wrap). `next()` increments cursor. If cursor exceeds `entries.length - 1`, resets cursor to -1 and returns `#draft`.
- `push()` from `#onSend`: appends to entries, evicts oldest if over max, resets cursor to -1.

### Modified file: `src/ui/chat-view.ts`

**New private field:**

```typescript
readonly #messageHistory: MessageHistory;
```

**Constructor:** initialize `#messageHistory = new MessageHistory()`.

**`#onSend`**: after pushing to `#messages`, call `this.#messageHistory.push(text)`.

**`keydown` listener**: extended to handle ArrowUp/ArrowDown:

```typescript
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
```

**`#clearConversation`**: add `this.#messageHistory.clear()`.

**`onClose`**: no cleanup needed (in-memory, no event refs to detach).

### New file: `tests/obsidian.stub.ts`

Minimal stub providing Obsidian API classes/types so tests can import `obsidian`. At minimum:

- `ItemView` with `contentEl` (jsdom HTMLElement), `app`, `leaf`
- `Plugin`, `Modal`, `Notice`, `TFile`, `TFolder`
- `MarkdownRenderer.render()` (no-op static method)
- Type exports: `App`, `Vault`, `WorkspaceLeaf`, `PluginManifest`, `TAbstractFile`, `EventRef`

### New file: `tests/message-history.test.ts`

| Category                    | Tests                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| **Constructor**             | Default maxSize=100, custom maxSize, empty initial state                                     |
| **push()**                  | Single push, multiple pushes, size tracking, FIFO eviction, cursor resets to -1              |
| **previous() from draft**   | Returns last entry, empty history returns "", stops at oldest (no wrap)                      |
| **next() from draft**       | No-op, returns empty string (default draft)                                                  |
| **previous() from history** | Moves to previous entry, stops at index 0                                                    |
| **next() from history**     | Moves forward, returns draft when past last entry                                            |
| **Draft preservation**      | Draft recovered after full up-then-down cycle                                                |
| **atDefaultPosition**       | True initially, false after up, true after down past last, true after push, true after clear |
| **Draft saving at default** | Draft saved only when atDefaultPosition, not overwritten during history navigation           |
| **Duplicates**              | Two identical entries coexist                                                                |
| **clear()**                 | Resets entries, cursor, draft                                                                |
| **Edge cases**              | previous/next on empty history, single entry, max capacity boundary                          |

## Implementation Checklist

- [x] Create `tests/obsidian.stub.ts` with minimal Obsidian API stubs
- [x] Create `src/ui/message-history.ts` with `IMessageHistory` interface and `MessageHistory` class
- [x] Create `tests/message-history.test.ts` with full unit test coverage
- [x] Run `npm run test` — verify all history manager tests pass
- [x] Modify `src/ui/chat-view.ts`:
  - [x] Add `#messageHistory` field, initialize in constructor
  - [x] Add `#messageHistory.push(text)` in `#onSend`
  - [x] Extend keydown listener for ArrowUp/ArrowDown
  - [x] Add `#messageHistory.clear()` in `#clearConversation`
- [x] Run `npm run test` — verify all tests pass
- [x] Run `npm run lint` — verify no lint errors
- [x] Run `npm run typecheck` — verify no type errors

## Validation Checklist

- [x] Arrow Up from empty input shows last submitted message
- [x] Arrow Down at default position returns draft text
- [x] Arrow Up navigates through history entries in reverse order (newest to oldest)
- [x] Arrow Up at oldest entry stops (no wrap)
- [x] Arrow Down returns to draft text after navigating past last entry
- [x] Draft text is saved only when Arrow Up is pressed from default position
- [x] Draft is not overwritten while browsing history
- [x] Duplicate messages are allowed in history
- [x] History caps at 100 entries, oldest evicted first
- [x] Send resets cursor to default position
- [x] Clearing conversation clears history
- [x] Arrow keys are no-ops while input is disabled (request in flight)
- [x] Enter key behavior is unchanged
- [x] `npm run test` passes
- [x] `npm run lint` passes
- [x] `npm run typecheck` passes
