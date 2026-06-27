/**
 * Chunking utilities for splitting markdown notes into semantic chunks
 * for embedding and vector storage.
 */

const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_OVERLAP = 100;

/** Represents a single chunk of text with its metadata. */
export interface Chunk {
	/** The chunk text content. */
	text: string;
	/** The source file path (vault-relative). */
	source: string;
	/** The position index of this chunk within the source file. */
	chunkIndex: number;
}

/** Options for controlling chunking behavior. */
export interface ChunkerOptions {
	/** Target chunk size in tokens. Default: 500. */
	chunkSize?: number;
	/** Overlap between adjacent chunks in tokens. Default: 100. */
	overlap?: number;
}

/**
 * Estimate the number of tokens in a string using a simple whitespace-based heuristic.
 * This is a rough approximation — adequate for chunking boundaries.
 *
 * @param text - The text to estimate token count for.
 * @returns The approximate token count.
 */
export function estimateTokenCount(text: string): number {
	// Split on whitespace and filter empty strings
	const words = text.split(/\s+/).filter((w) => w.length > 0);
	// Rough heuristic: ~1.3 tokens per word (English average)
	return Math.ceil(words.length * 1.3);
}

/**
 * Split a string into sentences using common punctuation boundaries.
 * Handles periods, exclamation marks, question marks, and other sentence terminators.
 *
 * @param text - The text to split into sentences.
 * @returns An array of sentences.
 */
export function splitIntoSentences(text: string): Array<string> {
	// Match sentences ending with punctuation followed by whitespace or end of string
	const matches = text.match(/[^.!?]+[.!?]+[\s]*/g);
	if (!matches) {
		return text.length > 0 ? [text] : [];
	}
	return matches.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Split text into chunks based on paragraph boundaries first,
 * then by token count, with overlap between adjacent chunks.
 *
 * Strategy:
 * 1. Split by double-newline (paragraph boundary)
 * 2. Accumulate paragraphs into chunks until ~chunkSize tokens is reached
 * 3. If a single paragraph exceeds chunkSize, split by sentence boundary
 * 4. Each chunk stores its overlap suffix as context for the next chunk
 *
 * @param text - The full text content of a file.
 * @param source - The vault-relative file path.
 * @param options - Chunking options.
 * @returns An array of Chunk objects.
 */
export function chunkText(
	text: string,
	source: string,
	options: ChunkerOptions = {}
): Array<Chunk> {
	const { chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_OVERLAP } = options;

	if (!text || text.trim().length === 0) {
		return [];
	}

	// Split into paragraphs by double-newline
	const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

	if (paragraphs.length === 0) {
		return [];
	}

	const chunks: Array<Chunk> = [];
	let currentChunk = '';
	let chunkIndex = 0;

	for (const paragraph of paragraphs) {
		const paragraphTokenCount = estimateTokenCount(paragraph);

		// If a single paragraph exceeds chunkSize, split it by sentences
		if (paragraphTokenCount > chunkSize) {
			// First, flush the current chunk if it has content
			if (currentChunk.trim().length > 0) {
				chunks.push({
					text: currentChunk.trim(),
					source,
					chunkIndex: chunkIndex++,
				});
				currentChunk = '';
			}

			// Split the oversized paragraph into sentences
			const sentences = splitIntoSentences(paragraph);
			let sentenceChunk = '';

			for (const sentence of sentences) {
				// If adding this sentence exceeds chunkSize, start a new chunk
				if (sentenceChunk && estimateTokenCount(sentenceChunk + ' ' + sentence) > chunkSize) {
					chunks.push({
						text: sentenceChunk.trim(),
						source,
						chunkIndex: chunkIndex++,
					});
					sentenceChunk = sentence;
				} else {
					sentenceChunk = sentenceChunk ? sentenceChunk + ' ' + sentence : sentence;
				}
			}

			if (sentenceChunk.trim().length > 0) {
				chunks.push({
					text: sentenceChunk.trim(),
					source,
					chunkIndex: chunkIndex++,
				});
			}
		} else if (currentChunk && estimateTokenCount(currentChunk + ' ' + paragraph) > chunkSize) {
			// Current chunk is full, push it with overlap handling
			chunks.push({
				text: currentChunk.trim(),
				source,
				chunkIndex: chunkIndex++,
			});

			// Calculate overlap: take the last N tokens from the current chunk
			const overlapTokens = Math.floor(overlap * 1.3); // Convert tokens back to word count approx
			const currentWords = currentChunk.trim().split(/\s+/).filter((w) => w.length > 0);
			const overlapWords = Math.min(overlapTokens, currentWords.length);

			if (overlapWords > 0 && currentWords.length > overlapWords) {
				// Keep the last overlapWords words as context for the next chunk
				currentChunk = currentWords.slice(-overlapWords).join(' ');
			} else {
				currentChunk = '';
			}

			currentChunk = currentChunk ? currentChunk + ' ' + paragraph : paragraph;
		} else {
			// Add paragraph to current chunk
			currentChunk = currentChunk ? currentChunk + ' ' + paragraph : paragraph;
		}
	}

	// Flush any remaining content
	if (currentChunk.trim().length > 0) {
		chunks.push({
			text: currentChunk.trim(),
			source,
			chunkIndex: chunkIndex,
		});
		// chunkIndex incremented but not used further (end of function)
		void chunkIndex;
	}

	return chunks;
}
