import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted() to define mock before vi.mock() hoisting
const { mockRequestUrl } = vi.hoisted(() => ({
	mockRequestUrl: vi.fn(),
}));

vi.mock('obsidian', () => ({
	requestUrl: mockRequestUrl,
	App: class { mock = true; },
	Modal: class {
		constructor(public app: unknown) {}
		open() {}
		close() {}
	},
	Notice: class {
		constructor(public message: string, public timeout?: number) {}
		setMessage(_msg: string) {}
		hide() {}
	},
	Plugin: class { mock = true; },
	SettingTab: class {
		constructor(public app: unknown, public plugin: unknown) {}
	},
	ItemView: class { constructor(public app: unknown) {} },
	MarkdownRenderer: { render() {} },
	MetadataCache: { on() {}, getFileCache() { return null; } },
	Vault: { on() {}, getMarkdownFiles() { return []; } },
	Workspace: { onLayoutReady() {} },
	Platform: { electron: false, desktop: true, mobile: false },
	TAbstractFile: class {},
	TFile: class { path = ''; },
	TFolder: class { path = ''; },
}));

// Import the init/get singleton functions and type
import { type EmbedderConfig } from '../src/rag/embedder';

describe('Embedder', () => {
	const mockEndpoint = 'http://localhost:10001';
	const mockModel = 'v5-small-retrieval-Q8_0.gguf';
	const mockDimensions = 1024;

	function getEmbedderConfig(overrides?: Partial<EmbedderConfig>): EmbedderConfig {
		return {
			endpoint: mockEndpoint,
			model: mockModel,
			dimensions: mockDimensions,
			...overrides,
		};
	}

	beforeEach(() => {
		vi.clearAllMocks();
		// Reset singleton between tests by clearing the module cache
		vi.resetModules();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('embedSingle', () => {
		it('should embed a single text successfully', async () => {
			const mockEmbedding = Array(1024).fill(0.01);
			mockRequestUrl.mockResolvedValue({
				status: 200,
				json: {
					data: [{ embedding: mockEmbedding, index: 0 }],
					model: mockModel,
				},
			});

			// Re-import after resetModules to get fresh singleton
			const mod = await import('../src/rag/embedder');
			const embedder = mod.initEmbedder(getEmbedderConfig());

			const result = await embedder.embedSingle('Hello world');

			expect(result).toEqual(mockEmbedding);
			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					url: `${mockEndpoint}/v1/embeddings`,
					method: 'POST',
				})
			);
		});

		it('should throw on empty embedding response', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				json: {
					data: [],
					model: mockModel,
				},
			});

			const mod = await import('../src/rag/embedder');
			mod.initEmbedder(getEmbedderConfig());
			const embedder = mod.getEmbedder();

			await expect(embedder.embedSingle('Hello')).rejects.toThrow('Empty embedding response');
		});

		it('should throw on API error response', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 500,
				json: {
					error: { message: 'Internal server error' },
				},
			});

			const mod = await import('../src/rag/embedder');
			const embedder = mod.initEmbedder(getEmbedderConfig());

			await expect(embedder.embedSingle('Hello')).rejects.toThrow('Embedding API error (500)');
		});
	});

	describe('embedMany', () => {
		it('should embed multiple texts successfully', async () => {
			const mockEmbedding = Array(1024).fill(0.01);
			mockRequestUrl.mockResolvedValue({
				status: 200,
				json: {
					data: [
						{ embedding: mockEmbedding, index: 0 },
						{ embedding: mockEmbedding, index: 1 },
					],
					model: mockModel,
				},
			});

			const mod = await import('../src/rag/embedder');
			const embedder = mod.initEmbedder(getEmbedderConfig());

			const { results, errors } = await embedder.embedMany(['Hello', 'World']);

			expect(results).toHaveLength(2);
			expect(errors).toHaveLength(0);
			expect(results[0].text).toBe('Hello');
			expect(results[1].text).toBe('World');
		});

		it('should handle partial failures gracefully', async () => {
			const mockEmbedding = Array(1024).fill(0.01);

			// First call succeeds, second call fails
			mockRequestUrl
				.mockResolvedValueOnce({
					status: 200,
					json: {
						data: [{ embedding: mockEmbedding, index: 0 }],
						model: mockModel,
					},
				})
				.mockResolvedValueOnce({
					status: 500,
					json: { error: { message: 'Server error' } },
				});

			const mod = await import('../src/rag/embedder');
			const embedder = mod.initEmbedder(getEmbedderConfig({ batchSize: 1 }));

			const { results, errors } = await embedder.embedMany(['Text 1', 'Text 2']);

			expect(results).toHaveLength(1);
			expect(errors).toHaveLength(1);
			expect(errors[0].text).toBe('Text 2');
		});

		it('should throw on dimension mismatch', async () => {
			const wrongDimensions = Array(512).fill(0.01);
			mockRequestUrl.mockResolvedValue({
				status: 200,
				json: {
					data: [{ embedding: wrongDimensions, index: 0 }],
					model: mockModel,
				},
			});

			const mod = await import('../src/rag/embedder');
			const embedder = mod.initEmbedder(getEmbedderConfig());

			await expect(embedder.embedSingle('Hello')).rejects.toThrow('Dimension mismatch: expected 1024, got 512');
		});

		it('should apply delay between batch requests', async () => {
			const mockEmbedding = Array(1024).fill(0.01);
			mockRequestUrl.mockResolvedValue({
				status: 200,
				json: {
					data: [{ embedding: mockEmbedding, index: 0 }],
					model: mockModel,
				},
			});

			const mod = await import('../src/rag/embedder');
			const embedder = mod.initEmbedder(getEmbedderConfig({ batchSize: 1, requestDelayMs: 50 }));

			// Embed 3 texts with batch size 1 = 3 requests
			await embedder.embedMany(['Text 1', 'Text 2', 'Text 3']);

			expect(mockRequestUrl).toHaveBeenCalledTimes(3);
		});

		it('should batch texts according to batch size', async () => {
			const mockEmbedding = Array(1024).fill(0.01);
			mockRequestUrl.mockResolvedValue({
				status: 200,
				json: {
					data: [
						{ embedding: mockEmbedding, index: 0 },
						{ embedding: mockEmbedding, index: 1 },
					],
					model: mockModel,
				},
			});

			const mod = await import('../src/rag/embedder');
			const embedder = mod.initEmbedder(getEmbedderConfig({ batchSize: 100 }));

			// Embed 50 texts with batch size 100 = 1 request
			const texts = Array(50).fill('Test text');
			await embedder.embedMany(texts);

			expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		});
	});
});
