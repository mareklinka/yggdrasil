/**
 * Orama-based vector store for storing and managing text embeddings.
 * Orama is a pure JavaScript vector database that works in browsers,
 * Electron, and Node.js — no native modules required.
 */

import type { RawData } from "@orama/orama";
import {
  type AnyOrama,
  count,
  create,
  insertMultiple,
  load,
  remove,
  save,
  search,
} from "@orama/orama";

/** Represents a stored chunk with its embedding. */
export interface StoredChunk {
  /** Unique identifier: "<source>__<chunkIndex>". */
  id: string;
  /** The chunk text content. */
  text: string;
  /** The embedding vector. */
  embedding: Array<number>;
  /** The source file path (vault-relative). */
  source: string;
  /** The position index within the source file. */
  chunkIndex: number;
}

/** Result of a vector similarity search. */
export interface SearchMatch {
  /** The stored chunk that matched. */
  chunk: StoredChunk;
  /** Cosine similarity score (higher = more similar). */
  score: number;
}

/** Interface for file persistence (Obsidian Vault or mock). */
export interface FilePersistence {
  /** Write text content to a file, creating parent directories as needed. */
  write(filePath: string, content: string): Promise<void>;
  /** Read text content from a file. */
  read(filePath: string): Promise<string>;
  /** Check whether a file exists. */
  exists(filePath: string): Promise<boolean>;
}

/** Configuration for the vector store. */
export interface VectorStoreConfig {
  /** The path to the Orama index JSON file. */
  dbPath: string;
  /** The embedding vector dimension. */
  dimensions: number;
}

/** Default embedding dimensions. */
const DEFAULT_DIMENSIONS = 1024;

/**
 * Orama vector store for managing text embeddings.
 * Uses Orama's save/load for persistence to a JSON file.
 */
export class VectorStore {
  readonly #config: {
    dbPath: string;
    dimensions: number;
  };
  readonly #fileSystem: FilePersistence;
  #orama: AnyOrama | null = null;

  public constructor(config: VectorStoreConfig, fileSystem: FilePersistence) {
    this.#config = {
      dbPath: config.dbPath,
      dimensions: config.dimensions ?? DEFAULT_DIMENSIONS,
    };
    this.#fileSystem = fileSystem;
  }

  /**
   * Check if the database has been initialized.
   * @returns True if the Orama instance is available.
   */
  public isInitialized(): boolean {
    return this.#orama !== null;
  }

  /**
   * Create and initialize a new Orama database with the correct schema.
   */
  public async createNew(): Promise<void> {
    this.#orama = await create({
      schema: {
        id: "string",
        text: "string",
        source: "string",
        chunkIndex: "number",
        embedding: `vector[${this.#config.dimensions}]`,
      },
    });
  }

  /**
   * Initialize the vector store by attempting to load from disk.
   * If the database file is missing (e.g., first installation), creates a new empty store.
   * Throws only if the file exists but is corrupted or unreadable.
   */
  public async initialize(): Promise<void> {
    if (this.#orama === null) {
      await this.createNew();
    }

    const exists = await this.#fileSystem.exists(this.#config.dbPath);
    if (exists) {
      await this.loadFromDisk();
    }
  }

  /**
   * Load an existing database from the persisted JSON file.
   * Reads from `dbPath` and deserializes it into the Orama instance.
   */
  public async loadFromDisk(): Promise<void> {
    if (this.#orama === null) {
      throw new Error("VectorStore not initialized. Call createNew() first.");
    }

    try {
      const rawJson = await this.#fileSystem.read(this.#config.dbPath);
      const raw = JSON.parse(rawJson) as RawData;
      load(this.#orama, raw);
      console.log(`Vector store loaded from ${this.#config.dbPath}, containing ${await this.countChunks()} chunk(s).`);
    } catch {
      throw new Error(
        `Failed to load vector store from ${this.#config.dbPath}. ` +
          "The file may be missing or corrupted.",
      );
    }
  }

  /**
   * Save the current database state to the persisted JSON file.
   * Serializes the Orama instance and writes it to `dbPath`.
   */
  public async saveToDisk(): Promise<void> {
    const raw = save(this.getOrama());
    const json = JSON.stringify(raw, null, 2);
    await this.#fileSystem.write(this.#config.dbPath, json);
    console.log(`Vector store persisted to ${this.#config.dbPath}, containing ${await this.countChunks()} chunk(s).`);
  }

  /**
   * Get the underlying Orama instance.
   * Must  createNew() first.
   *
   * @returns The Orama instance.
   */
  public getOrama(): AnyOrama {
    if (this.#orama === null) {
      throw new Error("VectorStore not initialized. Call createNew() first.");
    }
    return this.#orama;
  }

  /**
   * Insert chunks into the vector store.
   *
   * @param chunks - Array of chunks with embeddings to insert.
   */
  public async addChunks(chunks: Array<StoredChunk>): Promise<void> {
    const orama = this.getOrama();
    const docs = chunks.map((chunk) => ({
      id: chunk.id,
      text: chunk.text,
      source: chunk.source,
      chunkIndex: chunk.chunkIndex,
      embedding: chunk.embedding,
    }));
    await insertMultiple(orama, docs);
  }

  /**
   * Remove a chunk by its ID.
   *
   * @param id - The chunk ID to remove.
   */
  public async removeChunk(id: string): Promise<void> {
    const orama = this.getOrama();
    await remove(orama, id);
  }

  /**
   * Remove all chunks from the store.
   */
  public async clear(): Promise<void> {
    const orama = this.getOrama();
    // Get all document IDs via fulltext search and remove them
    const allDocs = await search(orama, {
      mode: "fulltext",
      term: "",
      limit: 10000,
    });
    for (const hit of allDocs.hits) {
      await remove(orama, hit.id);
    }
  }

  /**
   * Perform a vector similarity search.
   *
   * @param vector - The embedding vector to search with.
   * @param limit - Maximum number of results.
   * @param similarity - Minimum similarity threshold (0-1).
   * @returns Array of matching chunks with similarity scores.
   */
  public async search(
    vector: Array<number>,
    limit: number = 10,
    similarity: number = 0,
  ): Promise<Array<SearchMatch>> {
    const orama = this.getOrama();
    const results = await search(orama, {
      mode: "vector",
      vector: {
        value: vector,
        property: "embedding" as const,
      },
      limit,
      similarity,
      includeVectors: false,
    });

    return results.hits.map((hit) => ({
      chunk: hit.document as unknown as StoredChunk,
      score: hit.score,
    }));
  }

  /**
   * Get the number of chunks stored.
   *
   * @returns The number of chunks.
   */
  public async countChunks(): Promise<number> {
    return count(this.getOrama());
  }

  /**
   * Close the store and release resources.
   */
  public async close(): Promise<void> {
    this.#orama = null;
  }
}
