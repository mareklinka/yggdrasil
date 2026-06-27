/**
 * Embedding client for calling the LiteLLM proxy (OpenAI-compatible API).
 * Uses Obsidian's requestUrl() for HTTP requests.
 */

/* eslint-disable @typescript-eslint/naming-convention -- API property names use snake_case */
import { requestUrl } from 'obsidian';

/** Configuration for the embedding endpoint. */
export interface EmbedderConfig {
	/** The LiteLLM proxy endpoint URL. */
	endpoint: string;
	/** The embedding model name. */
	model: string;
	/** The expected embedding vector dimension. */
	dimensions: number;
}

/** Default hard-coded configuration for this version. */
const DEFAULT_CONFIG: EmbedderConfig = {
	endpoint: 'http://localhost:10001',
	model: 'v5-small-retrieval-Q8_0.gguf',
	dimensions: 1024,
};

/** Request body for the embedding API. */
interface EmbeddingRequest {
	model: string;
	input: Array<string>;
	dimensions?: number;
	encoding_type?: string;
}

/** Response from the embedding API (OpenAI-compatible format). */
interface EmbeddingResponse {
	data: Array<{
		embedding: Array<number>;
		index: number;
	}>;
	model: string;
	usage?: {
		prompt_tokens: number;
		total_tokens: number;
	};
}

/** Error response from the embedding API. */
interface EmbeddingErrorResponse {
	error?: {
		message: string;
		type?: string;
		code?: number;
	};
}

/** Result of embedding a single text. */
export interface EmbeddingResult {
	/** The input text. */
	text: string;
	/** The embedding vector. */
	embedding: Array<number>;
}

/** Error that occurred during embedding. */
export interface EmbeddingError {
	/** The input text that failed. */
	text: string;
	/** The error message. */
	message: string;
}

/**
 * Embedder class that handles calling the embedding API.
 * Uses Obsidian's requestUrl() which works in the plugin context.
 */
export class Embedder {
	readonly #config: EmbedderConfig;
	readonly #batchSize: number;
	readonly #requestDelayMs: number;

	public constructor(
		config: Partial<EmbedderConfig> = {},
		batchSize: number = 100,
		requestDelayMs: number = 100
	) {
		this.#config = { ...DEFAULT_CONFIG, ...config };
		this.#batchSize = batchSize;
		this.#requestDelayMs = requestDelayMs;
	}

	/**
	 * Embed a single text using the configured endpoint.
	 *
	 * @param text - The text to embed.
	 * @returns The embedding vector.
	 * @throws Error if the API request fails.
	 */
	public async embedSingle(text: string): Promise<Array<number>> {
		const response = await this.#requestEmbeddings([text]);
		if (response.data.length === 0) {
			throw new Error('Empty embedding response');
		}
		return response.data[0].embedding;
	}

	/**
	 * Embed multiple texts in batches using the configured endpoint.
	 *
	 * @param texts - The texts to embed.
	 * @returns An array of EmbeddingResult objects.
	 * @returns An array of EmbeddingResult objects and any errors that occurred.
	 */
	public async embedMany(texts: Array<string>): Promise<{
		results: Array<EmbeddingResult>;
		errors: Array<EmbeddingError>;
	}> {
		const results: Array<EmbeddingResult> = [];
		const errors: Array<EmbeddingError> = [];

		// Process in batches
		for (let i = 0; i < texts.length; i += this.#batchSize) {
			const batch = texts.slice(i, i + this.#batchSize);

			try {
				const response = await this.#requestEmbeddings(batch);

				for (let j = 0; j < response.data.length; j++) {
					const actualDim = response.data[j].embedding.length;
					if (actualDim !== this.#config.dimensions) {
						throw new Error(
							`Dimension mismatch: expected ${this.#config.dimensions}, got ${actualDim}`
						);
					}
					results.push({
						text: batch[j],
						embedding: response.data[j].embedding,
					});
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Unknown error';

				// If it's a dimension mismatch, throw immediately
				if (message.includes('Dimension mismatch')) {
					throw error;
				}

				// Otherwise, log errors for each text in the batch and continue
				for (const text of batch) {
					errors.push({ text, message });
				}
			}

			// Apply delay between requests to avoid overwhelming the proxy
			if (i + this.#batchSize < texts.length) {
				await this.#delay(this.#requestDelayMs);
			}
		}

		return { results, errors };
	}

	/**
	 * Make an HTTP request to the embedding endpoint.
	 *
	 * @param texts - The texts to embed (batch).
	 * @returns The parsed API response.
	 * @throws Error if the request fails or returns an error status.
	 */
	async #requestEmbeddings(texts: Array<string>): Promise<EmbeddingResponse> {
		const requestBody: EmbeddingRequest = {
			model: this.#config.model,
			input: texts,
			dimensions: this.#config.dimensions,
			encoding_type: 'float',
		};

		try {
			const response = await requestUrl({
				url: this.#config.endpoint + '/v1/embeddings',
				method: 'POST',
				contentType: 'application/json',
				body: JSON.stringify(requestBody),
				throw: false, // We handle errors ourselves
			});

			if (response.status >= 400) {
				const errorBody = response.json as EmbeddingErrorResponse;
				const errorMessage = errorBody.error?.message ?? `HTTP ${response.status}`;
				throw new Error(`Embedding API error (${response.status}): ${errorMessage}`);
			}

			const parsedResponse = response.json as EmbeddingResponse;
			return parsedResponse;
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Embedding request failed: ${error.message}`, {
					cause: error,
				});
			}
			throw new Error('Embedding request failed: Unknown error', {
				cause: error,
			});
		}
	}

	/**
	 * Sleep for the specified number of milliseconds.
	 *
	 * @param ms - The delay in milliseconds.
	 * @returns A promise that resolves after the delay.
	 */
	#delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Get the current configuration.
	 *
	 * @returns The embedder configuration.
	 */
	public getConfig(): EmbedderConfig {
		return { ...this.#config };
	}
}

/**
 * Create a default embedder instance.
 *
 * @returns A new Embedder instance with default configuration.
 */
export function createEmbedder(): Embedder {
	return new Embedder();
}
