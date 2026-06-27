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

import { Embedder } from '../src/rag/embedder';

describe('Embedder', () => {
	const mockEndpoint = 'http://localhost:10001';
	const mockModel = 'v5-small-retrieval-Q8_0.gguf';
	const mockDimensions = 1024;

	beforeEach(() => {
		vi.clearAllMocks();
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

			const embedder = new Embedder({
				endpoint: mockEndpoint,
				model: mockModel,
				dimensions: mockDimensions,
			});

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

			const embedder = new Embedder({
				endpoint: mockEndpoint,
				model: mockModel,
				dimensions: mockDimensions,
			});

			await expect(embedder.embedSingle('Hello')).rejects.toThrow('Empty embedding response');
		});

		it('should throw on API error response', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 500,
				json: {
					error: { message: 'Internal server error' },
				},
			});

			const embedder = new Embedder({
				endpoint: mockEndpoint,
				model: mockModel,
				dimensions: mockDimensions,
			});

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

			const embedder = new Embedder({
				endpoint: mockEndpoint,
				model: mockModel,
				dimensions: mockDimensions,
			});

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

			const embedder = new Embedder(
				{
					endpoint: mockEndpoint,
					model: mockModel,
					dimensions: mockDimensions,
				},
				1 // batch size of 1 to process each text separately
			);

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

			const embedder = new Embedder({
				endpoint: mockEndpoint,
				model: mockModel,
				dimensions: mockDimensions,
			});

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

			const embedder = new Embedder(
				{
					endpoint: mockEndpoint,
					model: mockModel,
					dimensions: mockDimensions,
				},
				1, // batch size of 1
				50 // 50ms delay
			);

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

			const embedder = new Embedder(
				{
					endpoint: mockEndpoint,
					model: mockModel,
					dimensions: mockDimensions,
				},
				100 // batch size of 100
			);

			// Embed 50 texts with batch size 100 = 1 request
			const texts = Array(50).fill('Test text');
			await embedder.embedMany(texts);

			expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		});
	});

	describe('constructor', () => {
		it('should use default configuration when no args provided', () => {
			const embedder = new Embedder();
			// Should not throw - just verify it can be constructed
			expect(embedder).toBeDefined();
		});

		it('should allow overriding configuration', () => {
			const customEndpoint = 'http://custom:8080';
			const customModel = 'custom-model';
			const customDimensions = 512;

			const embedder = new Embedder({
				endpoint: customEndpoint,
				model: customModel,
				dimensions: customDimensions,
			});

			expect(embedder).toBeDefined();
		});
	});
});
