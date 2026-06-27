# Yggdrasil

RAG-powered AI assistance for dungeon masters and world-builders in Obsidian.

## Project Structure

```
src/
├── main.ts              # Plugin entry point
├── rag/
│   ├── chunker.ts       # Token-aware markdown chunking
│   ├── embedder.ts      # Embedding client (LiteLLM proxy)
│   ├── indexer.ts       # Indexing orchestrator
│   └── vector-store.ts  # Orama vector store
tests/                   # Vitest unit tests
test-vault/              # Test Obsidian vault
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
