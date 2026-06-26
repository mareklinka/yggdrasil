# Yggdrasil

RAG-powered AI assistance for dungeon masters and world-builders in Obsidian.

## Project Structure

```
src/
├── main.ts              # Plugin entry point
├── settings.ts          # PluginSettings interface + SettingTab
├── index/
│   ├── manager.ts       # IndexManager: full/incremental indexing
│   ├── chunker.ts       # Heading-aware markdown chunker
│   └── schema.ts        # TypeScript types for indexed documents
├── rag/
│   ├── embedder.ts      # Embedding client
│   ├── retriever.ts     # Hybrid search
│   ├── prompt.ts        # Prompt assembly
│   └── llm.ts           # LLM response generation
├── store/
│   └── vector-store.ts  # LanceDB integration
├── ui/
│   ├── sidebar.ts       # Chat sidebar view
│   ├── chat-panel.ts    # Chat UI component
│   └── components/      # Reusable UI components
└── utils/               # Helper functions
tests/                   # Vitest unit tests
```

## Getting Started

```bash
npm install
npm run dev          # Development mode (hot reload)
npm run build        # Production build
npm test             # Run unit tests
```

## SDLC

This project follows the mandatory 6-stage SDLC workflow defined in [`.github/sdlc.md`](.github/sdlc.md). All development is guided by PRDs in `docs/prds/`.
