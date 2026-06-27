/**
 * LanceDB vector store wrapper for storing and managing text embeddings.
 */

import * as lancedb from '@lancedb/lancedb';
import { makeArrowTable } from '@lancedb/lancedb';
import { Field, FixedSizeList, Float32, Int32, Schema, Utf8 } from 'apache-arrow';

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

/** Configuration for the vector store. */
export interface VectorStoreConfig {
	/** The path to the LanceDB database directory. */
	dbPath: string;
	/** The name of the table to use. Default: 'chunks'. */
	tableName?: string;
	/** The embedding vector dimension. */
	dimensions: number;
}

/** Default table name. */
const DEFAULT_TABLE_NAME = 'chunks';

/**
 * LanceDB vector store for managing text embeddings.
 */
export class VectorStore {
	readonly #config: {
		dbPath: string;
		tableName: string;
		dimensions: number;
	};
	#connection: lancedb.Connection | null = null;
	#table: lancedb.Table | null = null;

	public constructor(config: VectorStoreConfig) {
		this.#config = {
			dbPath: config.dbPath,
			tableName: config.tableName ?? DEFAULT_TABLE_NAME,
			dimensions: config.dimensions,
		};
	}

	/**
	 * Initialize the connection and ensure the table exists.
	 * Creates the table if it doesn't exist, or opens it if it does.
	 */
	public async initialize(): Promise<void> {
		this.#connection = await lancedb.connect(this.#config.dbPath);
		await this.#ensureTableExists();
	}

	/**
	 * Close the connection and release resources.
	 */
	public async close(): Promise<void> {
		if (this.#table !== null) {
			this.#table.close();
			this.#table = null;
		}
		if (this.#connection !== null) {
			this.#connection.close();
			this.#connection = null;
		}
	}

	/**
	 * Get the underlying LanceDB table.
	 * Must call initialize() first.
	 *
	 * @returns The LanceDB table.
	 */
	public async getTable(): Promise<lancedb.Table> {
		if (this.#table === null) {
			throw new Error('VectorStore not initialized. Call initialize() first.');
		}
		return this.#table;
	}

	/**
	 * Clear all data from the table (keep the table structure).
	 */
	public async clear(): Promise<void> {
		const table = await this.getTable();
		await table.delete('1=1'); // Delete all rows
	}

	/**
	 * Drop the table entirely.
	 */
	public async dropTable(): Promise<void> {
		if (this.#connection === null) {
			throw new Error('VectorStore not initialized. Call initialize() first.');
		}
		await this.#connection.dropTable(this.#config.tableName);
		this.#table = null;
	}

	/**
	 * Insert chunks into the vector store.
	 *
	 * @param chunks - Array of chunks with embeddings to insert.
	 */
	public async addChunks(chunks: Array<StoredChunk>): Promise<void> {
		if (chunks.length === 0) {
			return;
		}

		const table = await this.getTable();

		// Convert to Arrow table format
		const arrowData = chunks.map((chunk) => ({
			id: chunk.id,
			text: chunk.text,
			vector: chunk.embedding,
			source: chunk.source,
			// eslint-disable-next-line @typescript-eslint/naming-convention -- Arrow table column name
			chunk_index: chunk.chunkIndex,
		}));

		const arrowTable = makeArrowTable(arrowData);
		await table.add(arrowTable, { mode: 'append' });
	}

	/**
	 * Replace all data in the table with new chunks.
	 * This is a convenience method for full reindexing.
	 *
	 * @param chunks - Array of chunks with embeddings to insert.
	 */
	public async replaceAll(chunks: Array<StoredChunk>): Promise<void> {
		await this.clear();
		if (chunks.length > 0) {
			await this.addChunks(chunks);
		}
	}

	/**
	 * Check if the table exists in the database.
	 *
	 * @returns True if the table exists.
	 */
	public async tableExists(): Promise<boolean> {
		if (this.#connection === null) {
			throw new Error('VectorStore not initialized. Call initialize() first.');
		}
		const tables = await this.#connection.tableNames();
		return tables.includes(this.#config.tableName);
	}

	/**
	 * Get the number of chunks stored.
	 *
	 * @returns The number of chunks.
	 */
	public async countChunks(): Promise<number> {
		const table = await this.getTable();
		return table.countRows();
	}

	async #ensureTableExists(): Promise<void> {
		if (this.#connection === null) {
			throw new Error('VectorStore not initialized. Call initialize() first.');
		}

		const tables = await this.#connection.tableNames();

		if (tables.includes(this.#config.tableName)) {
			// Table exists, open it
			this.#table = await this.#connection.openTable(this.#config.tableName);
			return;
		}

		// Create the table with the correct schema
		await this.#createTable();
	}

	async #createTable(): Promise<void> {
		if (this.#connection === null) {
			throw new Error('VectorStore not initialized. Call initialize() first.');
		}

		// Create an empty Arrow table with the correct schema
		const schema = new Schema([
			Field.new('id', new Utf8()),
			Field.new('text', new Utf8()),
			Field.new('vector', new FixedSizeList(this.#config.dimensions, new Field('item', new Float32()))),
			Field.new('source', new Utf8()),
			Field.new('chunk_index', new Int32()),
		]);

		this.#table = await this.#connection.createEmptyTable(
			this.#config.tableName,
			schema
		);
	}
}

/**
 * Create a vector store instance.
 *
 * @param dbPath - The path to the LanceDB database directory.
 * @param dimensions - The embedding vector dimension.
 * @returns A new VectorStore instance.
 */
export function createVectorStore(dbPath: string, dimensions: number): VectorStore {
	return new VectorStore({ dbPath, dimensions });
}
