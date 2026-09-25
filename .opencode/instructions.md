## Yggdrasil plugin for Obsidian – AI Contributor Quick Guide

Purpose: Provide AI agents with the context needed to work effectively on this Obsidian community plugin that provides an agentic RAG capability to Obsidian.

### Air-Gapped Environment (with Squid Proxy)

This agent runs in a restricted environment with **no direct internet access**. Outbound traffic is routed through a **Squid proxy** (`squid`, port 3128) that only permits connections to a **whitelisted set of domains**. In case a domain needs to be whitelisted, the user must make changes to the squid configuration file.

You **can** fetch web pages, search the internet, or retrieve external documentation — but **only if the target URL resolves to one of the whitelisted domains**. If you need information from a non-whitelisted domain (e.g., GitHub, Stack Overflow, npmjs.com, etc.), you must ask the user to provide it directly.

### Git Metadata is Read-Only

The `.git` directory is mounted read-only inside the container. Any operation that requires write access to git metadata (e.g. `git add`, `git commit`, `git push`, `git stash`) **must be done by the user outside the container**. The agent cannot perform these operations.

### Mandatory SDLC Workflow

All AI agents MUST follow the structured SDLC defined in [.opencode/sdlc.md](./sdlc.md). The workflow consists of six hard-transition stages:

1. **Requirements Elicitation** — gather requirements, define scope/boundaries, produce draft PRD in `docs/prds/`. No coding.
2. **Exploration** — explore codebase, create technical plan, expand PRD with implementation details. No coding.
3. **Validation (User Review)** — present PRD to user, incorporate feedback, finalize.
4. **Implementation** — write code strictly according to the finalized PRD.
5. **Validation (Implementation Review)** — verify implementation against PRD, run tests, fix issues.
6. **Cleanup & Refactoring** — clean up code, ensure conventions, run linters/formatters.

**Phase transitions are HARD.** Never skip, merge, or bypass stages. The agent MUST enforce this workflow even without explicit user prompting.

### Architecture Essentials

The project is an Obsidian community plugin (`YggdrasilPlugin extends Plugin` in `src/main.ts`). Core architecture:

- **RAG pipeline** (`src/rag/`): `LangchainRag` is the central class, composed of a document splitter, vector store, and agent. All are wired together by the `createLangchainRag()` factory function (composition root).
- **Interface segregation** (`src/rag/interfaces.ts`): Small, focused interfaces (`IDocumentSplitter`, `IEmbeddings`, `IVectorStore`, `IRetrieveTool`, `IAgent`). Adapters implement these interfaces to wrap langchain components.
- **LangGraph agent** (`src/rag/adapters/agent.ts`): Functional API `entrypoint` looping over `task`s: model call → tools (max 10 rounds per pass, then a forced tool-less answer) → evaluator. The evaluator uses an LLM call to decide whether the answer is good or needs re-retrieval (max 3 retries).
- **Change tracking** (`src/rag/change-tracker.ts`): Debounced (30s) Obsidian vault event listeners for modify/delete/rename, triggering incremental re-indexing.
- **UI** (`src/ui/`): `ChatView` extends `ItemView` (side panel chat interface). `ReindexConfirmationModal` extends `Modal`. Both follow standard Obsidian lifecycle methods.
- **Persistence**: Vector store serialized to JSON, compressed with pako (deflate/inflate), written as binary via `Vault.adapter.writeBinary`.

### Common Development Workflows

- **Development**: `npm run dev` — esbuild in watch mode, hot-reloads into Obsidian dev plugin folder.
- **Production build**: `npm run build` — runs `tsc -noEmit` for typechecking, then esbuild in production mode.
- **Tests**: `npm run test` — vitest run (jsdom env). `npm run test:watch` — vitest watch mode.
- **Linting**: `npm run lint` — eslint on `src/`. `npm run lint:fix` — auto-fix where possible.
- **Typecheck**: `npm run typecheck` — `tsc -noEmit`. Run after any type changes.
- **Obsidian stub**: Tests import `obsidian` which is aliased to `tests/obsidian.stub.ts` via vitest config. Do not import `obsidian` directly in tests.

### Patterns & Conventions

- **Private fields**: `#` syntax only (e.g. `#vault`). The `private` keyword is forbidden by eslint `no-restricted-syntax`.
- **Arrays**: `Array<T>` generic syntax only. `T[]` is forbidden by `@typescript-eslint/array-type`.
- **Explicit types**: Every parameter and return type must be annotated (`@typescript-eslint/explicit-function-return-type`).
- **Type-only imports**: `import type { Foo }` for types (`@typescript-eslint/consistent-type-imports`).
- **Strict equality**: `===` / `!==` only (`eqeqeq: 'always'`).
- **No `any`**: `@typescript-eslint/no-explicit-any` is an error.
- **No non-null assertions**: `!` postfix is forbidden (`@typescript-eslint/no-non-null-assertion`).
- **Throw `Error` instances**: Never throw strings or literals (`no-throw-literal`).
- **Curly braces**: Always required (`curly: 'error'`).
- **`prefer-const`**: `var` is forbidden (`no-var: error`).
- **Naming**: `strictCamelCase` for properties.
- **CSS**: All classes use `yggdrasil-` prefix, organized by section with comment headers.
- **Test files**: `tests/**/*.test.ts`. Use the obsidian stub via vitest alias.
- **Line length**: 120 chars max (import lines exempt).

### Fast Reference Paths

| Concern                 | Path                                   |
| ----------------------- | -------------------------------------- |
| Plugin entry point      | `src/main.ts`                          |
| RAG core class          | `src/rag/langchain-rag.ts`             |
| Interface definitions   | `src/rag/interfaces.ts`                |
| Adapter implementations | `src/rag/adapters/*.ts`                |
| Agent loop              | `src/rag/adapters/agent.ts`            |
| Change tracker          | `src/rag/change-tracker.ts`            |
| System prompt           | `src/rag/prompts.ts`                   |
| Chat UI                 | `src/ui/chat-view.ts`                  |
| Modal UI                | `src/ui/reindex-confirmation-modal.ts` |
| Chat CSS                | `src/styles.css`                       |
| ESLint config           | `eslint.config.mjs`                    |
| Vitest config           | `vitest.config.ts`                     |
| TypeScript config       | `tsconfig.json`                        |
| PRD template            | `docs/prds/_template.md`               |
| SDLC definition         | `.opencode/sdlc.md`                    |
| Obsidian test stub      | `tests/obsidian.stub.ts`               |

Keep additions minimal, consistent, and test-backed.
