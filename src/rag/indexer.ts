/**
 * Indexing orchestrator that coordinates vault scanning, chunking,
 * embedding, and vector storage for the RAG pipeline.
 *
 * Uses a unified queue-based processor: both full reindex and
 * incremental file operations enqueue work items that are processed
 * sequentially by a single async processor loop.
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

/** Internal queue item for a file indexing operation. */
interface QueueItem {
  /** The file to process. */
  file: TFile;
  /** The file content (for modify/rename operations). */
  content?: string;
  /** The operation type. */
  operation: "modify" | "delete" | "rename";
  /** Previous path for rename operations. */
  oldPath?: string;
}

/**
 * RAG indexer that orchestrates the full indexing pipeline.
 *
 * Uses a unified queue-based processor: both full reindex and
 * incremental file operations enqueue work items that are processed
 * sequentially by a single async processor loop.
 */
export class Indexer {
  readonly #config: IndexerConfig;
  readonly #embedder: Embedder;
  readonly #vault: VaultAdapter;
  readonly #fileSystem: FilePersistence;
  readonly #store: VectorStore;

  // Queue management
  #queue: Array<QueueItem> = [];
  #processing = false;

  public get vectorStore(): VectorStore {
    return this.#store;
  }

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

    const store = new VectorStore(
      {
        dbPath: this.#config.dbPath,
        dimensions: this.#config.dimensions,
      },
      this.#fileSystem,
    );
    this.#store = store;
  }

  /**
   * Initialize the vector store by loading from disk, or creating a new one.
   */
  public async initialize(): Promise<void> {
    await this.#store.initialize();
  }

  /**
   * Enqueue a single file for incremental reindexing.
   * If the file is already pending in the queue, it is not added again.
   *
   * @param file - The file to enqueue.
   */
  public enqueueEdit(file: TFile): void {
    // Skip if already pending or currently being processed
    if (
      this.#queue.some(
        (item) => item.file.path === file.path && item.operation === "modify",
      )
    ) {
      console.info("Skipping file indexing for file", file.path);
      return;
    }

    this.#enqueueFile(file, "modify");
    this.#startProcessorIfNeeded();
  }

  /**
   * Enqueue a file deletion.
   *
   * @param file - The file to delete.
   */
  public enqueueDelete(file: TFile): void {
    this.#enqueueFile(file, "delete");
    this.#startProcessorIfNeeded();
  }

  /**
   * Enqueue a file rename operation.
   *
   * @param oldPath - The previous vault-relative path.
   * @param newFile - The file object at the new path.
   * @param newContent - The current file content at the new path.
   */
  public enqueueRename(
    oldPath: string,
    newFile: TFile,
    newContent: string,
  ): void {
    this.#enqueueFile(newFile, "rename", newContent, oldPath);
    this.#startProcessorIfNeeded();
  }

  /**
   * Cancel all pending queue operations.
   * Called when a full reindex is about to start.
   */
  public cancelPending(): void {
    this.#queue = [];
    this.#processing = false;
  }

  /**
   * Check if the queue is currently being processed.
   */
  public isProcessing(): boolean {
    return this.#processing;
  }

  /**
   * Get the current number of items in the queue.
   */
  public getQueueLength(): number {
    return this.#queue.length;
  }

  #enqueueFile(
    file: TFile,
    operation: "modify" | "delete" | "rename",
    content?: string,
    oldPath?: string,
  ): void {
    this.#queue.push({ file, content, operation, oldPath });
  }

  #startProcessorIfNeeded(): void {
    if (!this.#processing && this.#queue.length > 0) {
      this.#processing = true;
      this.#processNext();
    }
  }

  async #processNext(): Promise<void> {
    while (this.#queue.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const item = this.#queue.shift()!;

      try {
        switch (item.operation) {
          case "modify": {
            await this.#processFileModify(item.file, item.content);
            break;
          }
          case "delete": {
            await this.#processFileDelete(item.file.path);
            break;
          }
          case "rename": {
            if (item.oldPath !== undefined && item.content !== undefined) {
              await this.#processFileRename(
                item.oldPath,
                item.file,
                item.content,
              );
            }
            break;
          }
        }
        this.#store?.saveToDisk();
      } catch (error) {
        console.error(
          `Error processing ${item.operation} for ${item.file.path}:`,
          error,
        );
      }
    }

    this.#processing = false;
  }

  async #processFileModify(file: TFile, content?: string): Promise<void> {
    // Read content from vault if not pre-provided (full reindex path)
    if (content === undefined) {
      try {
        content = await this.#vault.read(file);
      } catch {
        console.error(`Failed to read file content for ${file.path}`);
        return;
      }
    }

    // Skip empty files
    if (!content || content.trim().length === 0) {
      return;
    }

    // Chunk the content
    const chunks = chunkText(content, file.path);
    if (chunks.length === 0) {
      return;
    }

    // Embed the chunks
    const chunkTexts = chunks.map((c) => c.text);
    const { results: embeddings, errors: embedErrors } =
      await this.#embedder.embedMany(chunkTexts);

    if (embedErrors.length > 0) {
      for (const err of embedErrors) {
        const snippet = err.text.slice(0, 50);
        console.error(
          `Embedding failed for ${file.path} (chunk ${snippet}...): ${err.message}`,
        );
      }
    }

    // Store the embeddings
    if (embeddings.length > 0) {
      const storedChunks: Array<StoredChunk> = embeddings.map((emb, idx) => ({
        id: `${file.path}__${chunks[idx].chunkIndex}`,
        text: emb.text,
        embedding: emb.embedding,
        source: file.path,
        chunkIndex: chunks[idx].chunkIndex,
      }));

      await this.#store.removeBySource(file.path);
      await this.#store.addChunks(storedChunks);
    }
  }

  async #processFileDelete(filePath: string): Promise<void> {
    await this.#store.removeBySource(filePath);
  }

  async #processFileRename(
    oldPath: string,
    newFile: TFile,
    newContent: string,
  ): Promise<void> {
    const vectorStore = this.#store;
    if (vectorStore === null) {
      throw new Error("Indexer not initialized. Call initialize() first.");
    }

    // Remove old chunks
    await vectorStore.removeBySource(oldPath);

    // Re-index at new path
    await this.#processFileModify(newFile, newContent);
  }
}
