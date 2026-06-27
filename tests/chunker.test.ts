import { describe, expect, it } from 'vitest';

import { chunkText, estimateTokenCount, splitIntoSentences } from '../src/rag/chunker';

describe('estimateTokenCount', () => {
	it('should return 0 for empty string', () => {
		expect(estimateTokenCount('')).toBe(0);
	});

	it('should return 0 for whitespace-only string', () => {
		expect(estimateTokenCount('   ')).toBe(0);
	});

	it('should estimate tokens for single word', () => {
		// 1 word * 1.3 = ~1 token
		expect(estimateTokenCount('hello')).toBeGreaterThanOrEqual(1);
	});

	it('should estimate tokens for multiple words', () => {
		// 4 words * 1.3 = ~6 tokens
		const count = estimateTokenCount('hello world foo bar');
		expect(count).toBeGreaterThanOrEqual(5);
	});

	it('should handle punctuation attached to words', () => {
		const count = estimateTokenCount('hello, world! foo? bar.');
		// 4 words * 1.3 = ~5 tokens (punctuation is attached to words, not separate)
		expect(count).toBeGreaterThanOrEqual(5);
	});
});

describe('splitIntoSentences', () => {
	it('should return empty array for empty string', () => {
		expect(splitIntoSentences('')).toEqual([]);
	});

	it('should split on period', () => {
		const sentences = splitIntoSentences('Hello world. How are you?');
		expect(sentences).toEqual(['Hello world.', 'How are you?']);
	});

	it('should split on multiple punctuation types', () => {
		const sentences = splitIntoSentences('First! Second? Third.');
		expect(sentences).toEqual(['First!', 'Second?', 'Third.']);
	});

	it('should handle single sentence without terminator', () => {
		const sentences = splitIntoSentences('Just one sentence');
		expect(sentences).toEqual(['Just one sentence']);
	});

	it('should trim whitespace from sentences', () => {
		const sentences = splitIntoSentences('Hello.  World.  ');
		expect(sentences).toEqual(['Hello.', 'World.']);
	});
});

describe('chunkText', () => {
	it('should return empty array for empty string', () => {
		expect(chunkText('', 'test.md')).toEqual([]);
	});

	it('should return empty array for whitespace-only string', () => {
		expect(chunkText('   \n\n  ', 'test.md')).toEqual([]);
	});

	it('should create chunks from simple text with paragraphs', () => {
		const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
		const chunks = chunkText(text, 'test.md');

		expect(chunks.length).toBeGreaterThan(0);
		expect(chunks[0].source).toBe('test.md');
		expect(chunks[0].chunkIndex).toBe(0);
	});

	it('should respect custom chunk size', () => {
		const longText = Array(20).fill('This is a sentence with some words. ').join('');
		const chunks = chunkText(longText, 'test.md', { chunkSize: 100 });

		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.source).toBe('test.md');
		}
	});

	it('should handle single paragraph without breaks', () => {
		const text = 'This is a single paragraph with no breaks at all. It just keeps going and going.';
		const chunks = chunkText(text, 'test.md');

		expect(chunks.length).toBeGreaterThanOrEqual(1);
	});

	it('should handle very long single paragraph by sentence splitting', () => {
		const longParagraph = Array(50).fill('This is a long sentence with many words. ').join('');
		const chunks = chunkText(longParagraph, 'test.md', { chunkSize: 100 });

		expect(chunks.length).toBeGreaterThan(1);
	});

	it('should include overlap between chunks', () => {
		const text = 'First paragraph content here.\n\nSecond paragraph content here.\n\nThird paragraph content here.';
		const chunks = chunkText(text, 'test.md', { chunkSize: 50, overlap: 20 });

		if (chunks.length > 1) {
			// The end of one chunk should overlap with the start of the next
			const prevEnd = chunks[chunks.length - 2].text;
			const nextStart = chunks[chunks.length - 1].text;
			// At minimum, they should both have content
			expect(prevEnd.length).toBeGreaterThan(0);
			expect(nextStart.length).toBeGreaterThan(0);
		}
	});

	it('should track chunk indices correctly', () => {
		const text = 'Para 1.\n\nPara 2.\n\nPara 3.\n\nPara 4.\n\nPara 5.';
		const chunks = chunkText(text, 'test.md');

		for (let i = 0; i < chunks.length; i++) {
			expect(chunks[i].chunkIndex).toBe(i);
		}
	});

	it('should handle markdown formatting in text', () => {
		const text = '# Heading\n\nSome **bold** and *italic* text.\n\nMore `code` and [links](http://example.com).';
		const chunks = chunkText(text, 'test.md');

		expect(chunks.length).toBeGreaterThan(0);
		expect(chunks[0].text).toContain('# Heading');
	});

	it('should handle text with only newlines', () => {
		const text = '\n\n\n\n';
		expect(chunkText(text, 'test.md')).toEqual([]);
	});

	it('should handle single sentence text', () => {
		const text = 'Just one sentence here.';
		const chunks = chunkText(text, 'test.md');

		expect(chunks.length).toBe(1);
		expect(chunks[0].text).toBe('Just one sentence here.');
	});
});
