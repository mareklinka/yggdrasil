# PRD 004 - Migrate Agent to LangGraph Functional API

Date: 2026-09-25
Work item: Not provided

## SDLC Stage Tracker

| Stage | Name                               | Status       |
| ----- | ---------------------------------- | ------------ |
| 1     | Requirements Elicitation           | ✅ Completed |
| 2     | Exploration                        | ✅ Completed |
| 3     | Validation (User Review)           | ✅ Completed |
| 4     | Implementation                     | ✅ Completed |
| 5     | Validation (Implementation Review) | ✅ Completed |
| 6     | Cleanup & Refactoring              | ✅ Completed |

**Current stage: 6 — Cleanup & Refactoring (complete)**

> Update this tracker at each stage transition. The agent will prompt the user to commit after updating.

## Goal

Re-implement the chat agent in `src/rag/adapters/agent.ts` with the LangGraph Functional API (`entrypoint` / `task`) instead of the Graph API (`StateGraph`), keeping its externally observable behaviour unchanged.

## Requirements

### Functional

1. The agent must be built with `entrypoint()` and `task()` from `@langchain/langgraph`; `StateGraph`, `Annotation`, `MessagesAnnotation` and `ToolNode` must no longer be used by the agent.
2. `LangchainAgentAdapter` must keep its public surface unchanged: same constructor options (`model`, `tools`, `systemPrompt`) and `invoke(query, history, signal?) => Promise<string>` per `IAgent`.
3. The agent flow must be preserved:
   1. Call the tool-bound model with the system prompt plus conversation messages.
   2. While the model response contains tool calls, execute the tools, append results, and call the model again.
   3. When the model returns a response without tool calls, run the evaluator.
   4. If the evaluator rates the answer `poor`, append `HumanMessage("Evaluation result: <reason>")` and repeat from step 1.
   5. Otherwise, return the answer text.
4. The evaluator retry limit must remain `MAX_RETRIEVER_ITERATIONS = 3`; on the final allowed iteration the evaluator LLM call is skipped and the answer is returned.
5. Evaluator behaviour must be unchanged: same `evaluatorPrompt`, same input format (user query, retrieved tool context truncated to `MAX_EVALUATOR_CONTEXT_CHARS = 30_000` keeping the newest results, AI response), same JSON parsing (`extractJson` + Zod `{ quality, reason }`), and the same fallback of ending when parsing fails.
6. The evaluator must keep using a separate model instance with no tools bound.
7. **New tool-round cap:** within a single retriever pass, the model may request tools at most **10** rounds. If the model still requests tools after the 10th round, the agent must call the model once more **without tools bound** to force a text answer, then continue to the evaluator as normal.
8. The image-attachment handling must be preserved: history and query messages map to `HumanMessage`/`AIMessage` with `image_url` content blocks, and the evaluator's `userQuery` notes the number of attached images.
9. Cancellation must be preserved: if the `AbortSignal` is already aborted, or becomes aborted during the run, `invoke` must reject with `DOMException("Aborted", "AbortError")`.
10. Existing `console.log` / `console.warn` diagnostics (retriever turn, evaluation, evaluator result, parse failure) must be kept.
11. The unused `toolCallCount` state and the evaluator's re-emission of the full message list (a workaround for the messages reducer) must be removed.
12. `manifest.json` must set `isDesktopOnly: true`, since the Functional API requires Node's `AsyncLocalStorage`.

### Non-functional

1. Follow project conventions (`#` private fields, `Array<T>`, explicit return types, type-only imports, no `any`, no `!`, curly braces, 120-char lines).
2. `npm run build` and `npm run lint` must pass. `npm run test` is not a gate: it fails on the baseline because no test files exist (see Technical Specification → Exploration findings).
3. No new runtime dependencies.

## Scope

- `src/rag/adapters/agent.ts` — rewrite the graph as an `entrypoint` with `task`s
- `manifest.json` — `isDesktopOnly: true`

## Out-of-scope

- Automated tests for the agent (explicitly deferred by the user)
- Adding a checkpointer, `interrupt()`, persistence of agent runs, or streaming partial answers to the UI
- Making the tool-round cap or retry limit user-configurable
- Changes to prompts, tools, retrieval, indexing, or UI
- Upgrading LangChain / LangGraph package versions
- Mobile support

## Context

- The current agent (`src/rag/adapters/agent.ts`) is a `StateGraph` with `retriever`, `tools` and `evaluator` nodes, routed by two conditional edge functions. The state is declared with `Annotation.Root` and five reducers.
- The graph's default `recursionLimit` (25 supersteps) is the only thing that currently stops runaway tool calling; the Functional API has no equivalent, so requirement 7 introduces an explicit cap.
- The repo uses no checkpointer, graph visualization, or per-node streaming beyond reading the evaluator's `finalAnswer`, so nothing from those Graph API features is lost.
- `task()` finds its parent `entrypoint` through `AsyncLocalStorage`. Obsidian desktop (Electron) provides it and esbuild targets `platform: 'node'`. `@langchain/langgraph` already imports `node:async_hooks`, so the plugin is effectively desktop-only today; requirement 12 makes that explicit.
- `LangchainAgentAdapter` is only constructed in `createLangchainRag()` (`src/rag/langchain-rag.ts`) and used through `IAgent`.
- Related PRDs: 001 (multi-turn conversation), 002 (request cancellation), 003 (user message history).

## Technical Specification

### Exploration findings

Verified with a throwaway prototype against the installed `@langchain/langgraph` 1.4.7 (Node 24):

| Question                                                   | Finding                                                                                        | Consequence                                                                                                  |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Does `recursionLimit` bound `task()` calls?                | No. 80+ task calls in one `entrypoint` run completed.                                          | The explicit tool-round cap (requirement 7) is required.                                                     |
| Can a `task()` be called outside an `entrypoint`?          | No. It throws `Cannot read properties of undefined (reading 'configurable')`.                  | All tasks are only called from the entrypoint body.                                                          |
| Abort mid-run via `invoke(input, { signal })`              | Rejects with `DOMException`, `name === "AbortError"`, the same as today's `StateGraph.stream`. | `chat-view.ts:286` (`error instanceof DOMException && error.name === "AbortError"`) keeps working unchanged. |
| Already-aborted signal                                     | Rejects with the same `DOMException`.                                                          | The existing pre-check stays for an immediate, explicit rejection.                                           |
| `BaseMessage` instances as entrypoint input or task output | Preserved (`instanceof` still holds); no checkpointer means no serialization.                  | Tasks can pass `AIMessage` / `ToolMessage` directly.                                                         |

Baseline quality gates on `main` (before any change):

- `npm run typecheck`: passes. `npm run lint`: passes.
- `npm run test`: **exits 1 with "No test files found"**. The `tests/` directory is empty, and `tests/obsidian.stub.ts` referenced by `vitest.config.ts` and the instructions does not exist. Per the Stage 3 decision, it is excluded from the quality gate.

### Files to modify

| File                        | Change                                                          |
| --------------------------- | --------------------------------------------------------------- |
| `src/rag/adapters/agent.ts` | Rewrite the agent as an `entrypoint` with four `task`s (below). |
| `manifest.json`             | `"isDesktopOnly": false` → `true`.                              |

`src/rag/langchain-rag.ts`, `src/rag/interfaces.ts` and `src/ui/chat-view.ts` are **not** changed.

### `agent.ts` design

**Imports**

- Remove: `END`, `START`, `StateGraph`, `Annotation`, `MessagesAnnotation` (`@langchain/langgraph`), `ToolNode` (`@langchain/langgraph/prebuilt`).
- Add: `entrypoint`, `task` from `@langchain/langgraph`; `import type { ToolCall } from "@langchain/core/messages/tool"`.
- Remove the module-level `AgentState`, the exported `AgentStateType` (no importers), and the `retrieverNode` / `evaluatorNode` / `toolsNode` constants.

**Module-level types**

```ts
interface AgentInput {
  messages: Array<BaseMessage>;
  userQuery: string;
}

const EvaluationSchema = z.object({
  quality: z.enum(["good", "poor"]),
  reason: z.string(),
});
type Evaluation = z.infer<typeof EvaluationSchema>;
```

**Constants** (inside the constructor, as now): `MAX_RETRIEVER_ITERATIONS = 3`, `MAX_EVALUATOR_CONTEXT_CHARS = 30_000`, new `MAX_TOOL_ROUNDS = 10`.

**Model instances**

- `llm = options.model.bindTools(langchainTools)`: unchanged.
- `plainLlm = options.model.bindTools([])`: renamed from `evaluationLlm`. It is used by both the evaluator and the forced answer, and its old comment about graph-stream leakage no longer applies.
- `toolsByName = new Map(langchainTools.map((t) => [t.name, t]))`.

**Helpers kept verbatim:** `extractText`, `collectToolContext`, `extractJson`, `toLangchainMessage`.

**Tasks** (created in the constructor so they close over the models and tools):

```ts
// Retriever turn: tool-bound model call
const callModel = task(
  "callModel",
  async (messages: Array<BaseMessage>, retrieverRound: number): Promise<AIMessage> => {
    console.log(
      `Retriever turn (evaluation round ${retrieverRound + 1} of ${MAX_RETRIEVER_ITERATIONS})`,
      messages,
    );
    return llm.invoke([new SystemMessage(options.systemPrompt), ...messages]);
  },
);

// Tool budget exhausted: same prompt, no tools bound, so the model must answer in text
const forceAnswer = task(
  "forceAnswer",
  async (messages: Array<BaseMessage>): Promise<AIMessage> =>
    plainLlm.invoke([new SystemMessage(options.systemPrompt), ...messages]),
);

// Runs one tool call; failures become error ToolMessages, like ToolNode's default handleToolErrors
const callTool = task("callTool", async (toolCall: ToolCall): Promise<ToolMessage> => { ... });

// Returns undefined when the evaluator output cannot be parsed
const evaluate = task(
  "evaluate",
  async (userQuery: string, messages: Array<BaseMessage>, answerText: string): Promise<Evaluation | undefined> => { ... },
);
```

`callTool` details, matching `ToolNode` behaviour:

- Tool found: `await tool.invoke(toolCall)`. Invoking a LangChain tool with a `ToolCall` returns a `ToolMessage` carrying `tool_call_id` and `name`. If the result is not a `ToolMessage`, it is wrapped in one.
- Tool not found or tool throws: return `new ToolMessage({ content: "Error: <message>\n Please fix your mistakes.", name, tool_call_id, status: "error" })`. The `tool_call_id` key needs the same `eslint-disable-next-line @typescript-eslint/naming-convention` used today for `image_url`.
- Multiple tool calls in one response run concurrently with `Promise.all`, as `ToolNode` does today.

`evaluate` details: it logs `"Evaluating answer quality"` with `{ userQuery, answerText }` and builds the same `[SystemMessage(evaluatorPrompt), HumanMessage("User query: …\n\nRetrieved context:\n…\n\nAI response: …")]`. It calls `plainLlm`, runs `extractText` → `extractJson` → `JSON.parse` → `EvaluationSchema.safeParse`, and returns `parsed.data`. On an unsuccessful parse or a throw, it logs the existing `console.warn("Failed to parse evaluation response, defaulting to end", e)` and returns `undefined`.

**Entrypoint**

```ts
const agent = entrypoint(
  { name: "agent" },
  async (input: AgentInput): Promise<string> => {
    let messages = input.messages;
    for (let retrieverRound = 0; ; retrieverRound++) {
      let response = await callModel(messages, retrieverRound);
      for (let toolRound = 0; hasToolCalls(response); toolRound++) {
        if (toolRound >= MAX_TOOL_ROUNDS) {
          console.warn(
            `Tool round limit (${MAX_TOOL_ROUNDS}) reached, forcing an answer`,
          );
          response = await forceAnswer(messages);
          break;
        }
        const results = await Promise.all(
          response.tool_calls.map((tc) => callTool(tc)),
        );
        messages = [...messages, response, ...results];
        response = await callModel(messages, retrieverRound);
      }
      messages = [...messages, response];

      const answerText = extractText(response.content).trim();
      if (retrieverRound >= MAX_RETRIEVER_ITERATIONS) {
        return answerText; // final allowed pass: skip evaluator
      }
      const evaluation = await evaluate(input.userQuery, messages, answerText);
      const decision = evaluation?.quality === "poor" ? "retriever" : "end";
      console.log("Evaluator result:", decision, {
        decision,
        answer: answerText,
      });
      if (decision === "end") {
        return answerText;
      }
      messages = [
        ...messages,
        new HumanMessage("Evaluation result: " + evaluation.reason),
      ];
    }
  },
);
```

`hasToolCalls(m)` is `m.tool_calls !== undefined && m.tool_calls.length > 0` (a local type guard). `evaluation.reason` is narrowed through the `decision` check. The final code will narrow explicitly, with no `!`.

**Iteration semantics, identical to today:** pass 0 is the initial answer, and passes 1–3 are retries after a `poor` rating. The evaluator runs after passes 0–2 (at most 3 evaluator calls). Pass 3 is returned without evaluation, so there are at most 4 retriever passes in total. The tool-round cap applies to each pass separately.

**`invoke`**

```ts
if (signal?.aborted) {
  throw new DOMException("Aborted", "AbortError");
}
// historyMessages + userQuery construction unchanged
const answer = await agent.invoke(
  { messages: [...historyMessages, toLangchainMessage(query)], userQuery },
  { signal },
);
if (signal?.aborted) {
  throw new DOMException("Aborted", "AbortError");
}
return answer;
```

The post-invoke check replaces the per-update check in today's stream loop. It covers an abort that lands after the last task finished but before `invoke` resolves.

### Data flow

```
ChatView → LangchainRag.query → LangchainAgentAdapter.invoke(query, history, signal)
  → agent.invoke({ messages, userQuery }, { signal })
      loop: callModel → [callTool × n → callModel]* (≤10 rounds, else forceAnswer)
            → evaluate (skipped on final pass) → return | append feedback & retry
  → string answer
```

### Behaviour changes (intentional)

1. Tool loop is bounded at 10 rounds per pass and then forces an answer, instead of throwing `GraphRecursionError` at 25 supersteps.
2. Log payloads change shape: they log the message list or `{ userQuery, answerText }` instead of the whole graph state object. The log messages themselves are kept.
3. `toolCallCount` and the `finalAnswer` / `evaluatorDecision` / `retrieverCallCount` state fields no longer exist; they were internal only.
4. Plugin is marked desktop-only in `manifest.json`.

### Risks

- **Forced answer with tool history but no tools bound:** OpenAI accepts this. Some OpenAI-compatible local servers may reject tool messages when no `tools` are sent. This only happens on the (rare) cap path, and the error surfaces as a normal chat error.
- **Log noise:** logging the full message list on every `callModel` matches today's state logging, so volume is unchanged.

### Resolved questions (Stage 3)

1. **Test gate:** option (a) chosen. The quality gate is `npm run build` + `npm run lint` only. `npm run test` is not run as a gate and `package.json` is not changed.

## Test Plan

Automated tests are out of scope (user decision).

**Static checks**

- `npm run build` (runs `tsc -noEmit` and the production esbuild bundle) succeeds.
- `npm run lint` reports no errors.
- `npm run test` is not part of the gate (Resolved question 1).

**Manual smoke test** (performed by the user in `test-vault` with a real model, with the dev console open):

| #   | Scenario                                                                         | Expected                                                                                                       |
| --- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| M1  | Ask a question answerable from the vault                                         | Tool calls are logged, `Evaluator result: end`, and a sensible answer is shown.                                |
| M2  | Ask a question the vault cannot answer well (e.g. about a non-existent creature) | At least one `Evaluator result: retriever`, then an answer after at most 4 retriever passes.                   |
| M3  | Send a query and press Cancel while it is running                                | UI returns to idle, no error message, and the cancelled messages are not added to history (PRD 002 behaviour). |
| M4  | Follow-up question in the same chat                                              | History is respected (PRD 001 behaviour).                                                                      |
| M5  | Send a message with an image attachment                                          | Answer references the image, and the evaluator log shows `[User attached 1 image(s)]`.                         |

## Implementation Checklist

- [x] Replace the LangGraph imports in `agent.ts` (remove `StateGraph`, `Annotation`, `MessagesAnnotation`, `START`, `END`, `ToolNode`; add `entrypoint`, `task`, `ToolCall` type).
- [x] Delete `AgentState`, `AgentStateType` and the node-name constants; add `AgentInput`, `EvaluationSchema`, `Evaluation`.
- [x] Add `MAX_TOOL_ROUNDS = 10`; rename `evaluationLlm` → `plainLlm`; build `toolsByName`.
- [x] Implement the `callModel`, `forceAnswer`, `callTool` and `evaluate` tasks.
- [x] Implement the `agent` entrypoint loop.
- [x] Rewrite `invoke` to use `agent.invoke(…, { signal })` with pre- and post-abort checks.
- [x] Delete `callModel` / `evaluateAnswer` node functions, both routers, the graph builder, and the stream loop.
- [x] Set `isDesktopOnly: true` in `manifest.json`.
- [x] `npm run build` and `npm run lint` pass.

**Implementation notes (deviations from the sketch above):**

- `hasToolCalls` became `toolCallsOf(message): Array<ToolCall>` (it returns `[]` for non-AI messages). This avoids a type-guard narrowing problem on the `let response` loop variable, and the behaviour is the same.
- `evaluate` only logs the `console.warn` when `JSON.parse` throws. A JSON value that fails the Zod schema ends silently, exactly as the old evaluator did (requirement F5 parity). The spec text above said it would warn in both cases.
- Scratchpad smoke check (fake scripted model, not committed): happy path, one retry, retry cap (4 passes / 3 evaluations), unparseable evaluation, tool-round cap (11 tool-bound calls → forced answer → evaluation), pre-abort and mid-run abort (`DOMException` `AbortError`). All behaved as specified.

## Validation Checklist

- [x] Requirements F1–F12 and NF1–NF3 each verified against the code.
- [x] No references to `StateGraph`, `Annotation`, `MessagesAnnotation` or `ToolNode` remain in `src/`.
- [x] `LangchainAgentAdapter` constructor and `invoke` signatures are unchanged; `langchain-rag.ts` and `chat-view.ts` are untouched.
- [x] Prompts, `MAX_RETRIEVER_ITERATIONS`, `MAX_EVALUATOR_CONTEXT_CHARS`, `extractText`, `collectToolContext` and `extractJson` are unchanged.
- [x] `npm run build` and `npm run lint` pass.
- [x] User has completed manual smoke tests M1–M5.

**Validation results (Stage 5):**

- F1–F11: verified in `src/rag/adapters/agent.ts`. The only mention of `ToolNode` is a comment describing the error-message format that `callTool` mirrors.
- F12: `isDesktopOnly: true` is set in `manifest.json`, but the change was missing from the Stage 4 commit and is included in the Stage 5 commit.
- NF1: lint clean, no lines over 120 characters, no `private`, `T[]`, `any` or `!`. NF2: `npm run build` and `npm run lint` pass. NF3: `package.json` / `package-lock.json` unchanged.
- The commit touched only `agent.ts` and this PRD; `langchain-rag.ts`, `interfaces.ts`, `chat-view.ts` and `prompts.ts` are unchanged.
- Manual smoke tests M1–M5: passed (reported by the user).
- No issues required code changes.

**Cleanup (Stage 6):**

- `agent.ts`: the tool loop now reads the tool calls once per round instead of twice. The evaluator decision check relies on optional-chain narrowing, which removes a redundant `undefined` check. The log object uses shorthand (`{ decision, … }`). There is no behaviour change; build, lint and the scratchpad fake-model check were re-run and all pass.
- `.opencode/instructions.md`: the architecture bullet and fast-reference row now describe the Functional API agent instead of a StateGraph.
- Pre-existing and out of scope: `tests/obsidian.stub.ts`, referenced by `vitest.config.ts` and the instructions, does not exist, and `npm run test` finds no test files.
