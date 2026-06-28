import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FilePersistence } from '../src/rag/vector-store';
import { VectorStore } from '../src/rag/vector-store';

// In-memory file system mock for tests
function createMockFileSystem(): FilePersistence {
	const files = new Map<string, string>();
	const binaryFiles = new Map<string, ArrayBuffer>();
	return {
		write: async (filePath: string, content: string): Promise<void> => {
			files.set(filePath, content);
		},
		read: async (filePath: string): Promise<string> => {
			const content = files.get(filePath);
			if (content === undefined) {
				throw new Error(`File not found: ${filePath}`);
			}

			return content;
		},
		writeBinary: async (filePath: string, content: ArrayBuffer): Promise<void> => {
			binaryFiles.set(filePath, content);
		},
		readBinary: async (filePath: string): Promise<ArrayBuffer> => {
			const content = binaryFiles.get(filePath);
			if (content === undefined) {
				throw new Error(`File not found: ${filePath}`);
			}

			return content;
		},
		exists: async (filePath: string): Promise<boolean> => files.has(filePath) || binaryFiles.has(filePath),
	};
}

describe('VectorStore', () => {
	let store: VectorStore;
	let mockFileSystem: FilePersistence;
	const mockDimensions = 10; // Small dimension for fast tests
	const mockEmbedding = Array(10).fill(0.1);

	beforeEach(() => {
		mockFileSystem = createMockFileSystem();
		store = new VectorStore(
			{
				dbPath: ':memory:',
				dimensions: mockDimensions,
			},
			mockFileSystem,
		);
	});

	afterEach(async () => {
		await store.close();
	});

	describe('createNew', () => {
		it('should create a new Orama database', async () => {
			await store.createNew();
			expect(store.isInitialized()).toBe(true);
		});

		it('should have correct schema after creation', async () => {
			await store.createNew();

			// Verify we can add and retrieve chunks
			await store.addChunks([
				{
					id: 'test-1',
					text: 'Test chunk',
					embedding: mockEmbedding,
					source: 'test.md',
					chunkIndex: 0,
				},
			]);

			const count = await store.countChunks();
			expect(count).toBe(1);
		});
	});

	describe('addChunks', () => {
		it('should add chunks to the store', async () => {
			await store.createNew();

			await store.addChunks([
				{
					id: 'test-1',
					text: 'First chunk',
					embedding: mockEmbedding,
					source: 'file1.md',
					chunkIndex: 0,
				},
				{
					id: 'test-2',
					text: 'Second chunk',
					embedding: mockEmbedding,
					source: 'file2.md',
					chunkIndex: 1,
				},
			]);

			const count = await store.countChunks();
			expect(count).toBe(2);
		});

		it('should throw if not initialized', async () => {
			await expect(store.addChunks([])).rejects.toThrow('not initialized');
		});
	});

	describe('removeChunk', () => {
		it('should remove a single chunk by ID', async () => {
			await store.createNew();

			await store.addChunks([
				{
					id: 'test-1',
					text: 'Chunk 1',
					embedding: mockEmbedding,
					source: 'file.md',
					chunkIndex: 0,
				},
				{
					id: 'test-2',
					text: 'Chunk 2',
					embedding: mockEmbedding,
					source: 'file.md',
					chunkIndex: 1,
				},
			]);

			await store.removeChunk('test-1');
			const count = await store.countChunks();
			expect(count).toBe(1);
		});

		it('should throw if not initialized', async () => {
			await expect(store.removeChunk('nonexistent')).rejects.toThrow('not initialized');
		});
	});

	describe('clear', () => {
		it('should remove all chunks from the store', async () => {
			await store.createNew();

			await store.addChunks([
				{
					id: 'test-1',
					text: 'Chunk 1',
					embedding: mockEmbedding,
					source: 'file.md',
					chunkIndex: 0,
				},
				{
					id: 'test-2',
					text: 'Chunk 2',
					embedding: mockEmbedding,
					source: 'file.md',
					chunkIndex: 1,
				},
			]);

			await store.clear();
			const count = await store.countChunks();
			expect(count).toBe(0);
		});

		it('should throw if not initialized', async () => {
			await expect(store.clear()).rejects.toThrow('not initialized');
		});
	});

	describe('search', () => {
		it('should find similar chunks by vector similarity', async () => {
			await store.createNew();

			const embedding1 = Array(10).fill(0.1);
			const embedding2 = Array(10).fill(0.1);
			const embedding3 = Array(10).fill(0.9); // Different

			await store.addChunks([
				{
					id: 'similar-1',
					text: 'Similar chunk 1',
					embedding: embedding1,
					source: 'file.md',
					chunkIndex: 0,
				},
				{
					id: 'similar-2',
					text: 'Similar chunk 2',
					embedding: embedding2,
					source: 'file.md',
					chunkIndex: 1,
				},
				{
					id: 'different',
					text: 'Different chunk',
					embedding: embedding3,
					source: 'file.md',
					chunkIndex: 2,
				},
			]);

			const results = await store.search(embedding1, 3);

			expect(results.length).toBeGreaterThan(0);
			expect(results[0].chunk.id).toBe('similar-1');
		});

		it('should respect limit parameter', async () => {
			await store.createNew();

			for (let i = 0; i < 5; i++) {
				await store.addChunks([
					{
						id: `test-${i}`,
						text: `Chunk ${i}`,
						embedding: mockEmbedding,
						source: 'file.md',
						chunkIndex: i,
					},
				]);
			}

			const results = await store.search(mockEmbedding, 2);
			expect(results.length).toBeLessThanOrEqual(2);
		});

		it('should throw if not initialized', async () => {
			await expect(store.search(mockEmbedding)).rejects.toThrow('not initialized');
		});
	});

	describe('countChunks', () => {
		it('should return correct count', async () => {
			await store.createNew();

			expect(await store.countChunks()).toBe(0);

			await store.addChunks([
				{
					id: 'test-1',
					text: 'Chunk 1',
					embedding: mockEmbedding,
					source: 'file.md',
					chunkIndex: 0,
				},
			]);

			expect(await store.countChunks()).toBe(1);
		});

		it('should throw if not initialized', async () => {
			await expect(store.countChunks()).rejects.toThrow('not initialized');
		});
	});

	describe('saveToDisk and loadFromDisk', () => {
		it('should persist and restore data via disk', async () => {
			await store.createNew();

			await store.addChunks([
				{
					id: 'test-1',
					text: 'Persisted chunk',
					embedding: mockEmbedding,
					source: 'file.md',
					chunkIndex: 0,
				},
			]);

			// Save to disk
			await store.saveToDisk();

			// Create new store and load from disk
			const newStore = new VectorStore(
				{
					dbPath: ':memory:',
					dimensions: mockDimensions,
				},
				mockFileSystem,
			);
			await newStore.createNew();
			await newStore.loadFromDisk();

			const count = await newStore.countChunks();
			expect(count).toBe(1);

			await newStore.close();
		});

		it('should throw on loadFromDisk if file does not exist', async () => {
			await store.createNew();

			await expect(store.loadFromDisk()).rejects.toThrow(
				'Failed to load vector store',
			);
		});

		it('should throw on loadFromDisk if not initialized', async () => {
			await expect(store.loadFromDisk()).rejects.toThrow('not initialized');
		});

		it('should throw on saveToDisk if not initialized', async () => {
			await expect(store.saveToDisk()).rejects.toThrow('not initialized');
		});
	});

	describe('close', () => {
		it('should close the store', async () => {
			await store.createNew();
			await store.close();
			expect(store.isInitialized()).toBe(false);
		});

		it('should throw after close', async () => {
			await store.createNew();
			await store.close();

			await expect(store.countChunks()).rejects.toThrow('not initialized');
		});
	});

	describe('isInitialized', () => {
		it('should return false before creation', () => {
			expect(store.isInitialized()).toBe(false);
		});

		it('should return true after creation', async () => {
			await store.createNew();
			expect(store.isInitialized()).toBe(true);
		});
	});
});
