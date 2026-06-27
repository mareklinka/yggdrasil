/**
 * Indexing orchestrator that coordinates vault scanning, chunking,
 * embedding, and vector storage for the RAG pipeline.
 */

import type { TFile } from "obsidian";

import { chunkText } from "./chunker";
import type { Embedder } from "./embedder";
import type { FilePersistence } from "./vector-store";
import type { StoredChunk } from "./vector-store";
import { VectorStore } from "./vector-store";

/** Progress callback for reporting indexing status. */
export interface IndexProgress {
  /** Current note being processed (0-indexed). */
  current: number;
  /** Total notes to process. */
  total: number;
  /** Current note file path. */
  currentFile: string;
  /** Chunks created from this note. */
  chunksCreated: number;
  /** Embeddings successfully generated. */
  embeddingsGenerated: number;
  /** Errors encountered. */
  errors: Array<string>;
  /** Current phase: 'scanning', 'indexing', 'storing', 'complete', 'error'. */
  phase: "scanning" | "indexing" | "storing" | "complete" | "error";
  /** Error message if phase is 'error'. */
  errorMessage?: string;
}

/** Callback function type for progress updates. */
export type ProgressCallback = (progress: IndexProgress) => void;

/** Configuration for the indexer. */
export interface IndexerConfig {
  /** The vector store database path. */
  dbPath: string;
  /** Embedding dimensions. */
  dimensions: number;
  /** Embedding endpoint URL (optional, uses default if not provided). */
  embedEndpoint?: string;
  /** Embedding model name (optional, uses default if not provided). */
  embedModel?: string;
}

/** Result of a full reindex operation. */
export interface IndexResult {
  /** Total markdown files scanned. */
  filesScanned: number;
  /** Total chunks created. */
  chunksCreated: number;
  /** Total embeddings generated successfully. */
  embeddingsGenerated: number;
  /** Total errors encountered. */
  errors: Array<string>;
  /** Whether the operation completed successfully. */
  success: boolean;
}

/** Vault interface for file operations (Obsidian dependency). */
export interface VaultAdapter {
  /** Get all markdown files in the vault. */
  getMarkdownFiles: () => Array<TFile>;
  /** Read the content of a file. */
  read: (file: TFile) => Promise<string>;
}

/**
 * RAG indexer that orchestrates the full indexing pipeline.
 */
export class Indexer {
  readonly #config: IndexerConfig;
  readonly #embedder: Embedder;
  readonly #vault: VaultAdapter;
  readonly #fileSystem: FilePersistence;
  #store: VectorStore | null = null;

  public constructor(
    config: IndexerConfig,
    vault: VaultAdapter,
    embedder: Embedder,
    fileSystem: FilePersistence,
  ) {
    this.#config = config;
    this.#vault = vault;
    this.#embedder = embedder;
    this.#fileSystem = fileSystem;
  }

  /**
   * Initialize the vector store by loading from disk, or creating a new one.
   */
  public async initialize(): Promise<void> {
    const store = new VectorStore(
      {
        dbPath: this.#config.dbPath,
        dimensions: this.#config.dimensions,
      },
      this.#fileSystem,
    );
    await store.initialize();
    this.#store = store;
  }

  /**
   * Perform a full reindex of the vault.
   *
   * This method:
   * 1. Scans the vault for markdown files
   * 2. Reads each file's content
   * 3. Chunks the content
   * 4. Embeds the chunks
   * 5. Stores them in Orama
   *
   * @param onProgress - Callback for progress updates.
   * @returns The index result.
   */
  public async reindex(onProgress: ProgressCallback): Promise<IndexResult> {
    const progress: IndexProgress = {
      current: 0,
      total: 0,
      currentFile: "",
      chunksCreated: 0,
      embeddingsGenerated: 0,
      errors: [],
      phase: "scanning",
    };

    let filesScanned = 0;
    let totalChunks = 0;
    let totalEmbeddings = 0;
    const allErrors: Array<string> = [];

    try {
      // Phase 1: Scan vault for markdown files
      onProgress({ ...progress });

      const files = this.#vault.getMarkdownFiles();
      progress.total = files.length;
      progress.phase = "indexing";
      onProgress({ ...progress });

      // Phase 2: Clear the vector store to start fresh
      const vectorStore = this.#store;
      if (vectorStore === null) {
        throw new Error("Indexer not initialized. Call initialize() first.");
      }
      await vectorStore.clear();
      onProgress({ ...progress, phase: "storing" });

      // Phase 3: Process each file
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const filePath = file.path;

        // Read file content
        let content: string;
        try {
          content = await this.#vault.read(file);
        } catch {
          const errorMsg = `Failed to read: ${filePath}`;
          allErrors.push(errorMsg);
          progress.errors = [...allErrors];
          progress.current = i + 1;
          progress.currentFile = filePath;
          onProgress({ ...progress });
          continue;
        }

        filesScanned++;

        // Skip empty files
        if (!content || content.trim().length === 0) {
          progress.current = i + 1;
          progress.currentFile = filePath;
          onProgress({ ...progress });
          continue;
        }

        // Chunk the content
        const chunks = chunkText(content, filePath);
        if (chunks.length === 0) {
          progress.current = i + 1;
          progress.currentFile = filePath;
          onProgress({ ...progress });
          continue;
        }

        totalChunks += chunks.length;
        progress.chunksCreated = totalChunks;
        progress.current = i + 1;
        progress.currentFile = filePath;
        onProgress({ ...progress });

        // Embed the chunks
        const chunkTexts = chunks.map((c) => c.text);
        const { results: embeddings, errors: embedErrors } =
          await this.#embedder.embedMany(chunkTexts);

        totalEmbeddings += embeddings.length;
        progress.embeddingsGenerated = totalEmbeddings;

        if (embedErrors.length > 0) {
          for (const err of embedErrors) {
            const snippet = err.text.slice(0, 50);
            allErrors.push(
              `Embedding failed for ${filePath} (chunk ${snippet}...): ${err.message}`,
            );
          }
          progress.errors = [...allErrors];
        }

        // Store the embeddings
        if (embeddings.length > 0) {
          const storedChunks: Array<StoredChunk> = embeddings.map(
            (emb, idx) => ({
              id: `${filePath}__${chunks[idx].chunkIndex}`,
              text: emb.text,
              embedding: emb.embedding,
              source: filePath,
              chunkIndex: chunks[idx].chunkIndex,
            }),
          );

          await vectorStore.addChunks(storedChunks);
        }

        // Report progress
        onProgress({ ...progress });
      }

      // Phase 4: Persist the vector store to disk
      await vectorStore.saveToDisk();
      await vectorStore.close();

      progress.phase = "complete";
      onProgress({ ...progress });

      return {
        filesScanned,
        chunksCreated: totalChunks,
        embeddingsGenerated: totalEmbeddings,
        errors: allErrors,
        success: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      progress.phase = "error";
      progress.errorMessage = errorMessage;
      onProgress({ ...progress });

      return {
        filesScanned,
        chunksCreated: totalChunks,
        embeddingsGenerated: totalEmbeddings,
        errors: [...allErrors, errorMessage],
        success: false,
      };
    }
  }
}

