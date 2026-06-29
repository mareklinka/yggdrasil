import type { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EmbeddingError,
  EmbeddingResult,
  getEmbedder,
} from "../src/rag/embedder";
import { type getIndexer, type IVaultAdapter } from "../src/rag/indexer";
// Note: initIndexer is idempotent and automatically resets the singleton,
// so no separate reset function is needed in tests.
import type { getVectorStore, StoredChunk } from "../src/rag/vector-store";

// Helper: create a MockTFile cast to TFile for enqueue calls
function mkFile(path: string): TFile {
  const f = new MockTFile(path);
  return f as unknown as TFile;
}

// Mock TFile class that satisfies the Obsidian TFile interface
class MockTFile {
  readonly path: string;
  readonly name: string;
  readonly parent: TFile["parent"] = null as unknown as TFile["parent"];
  readonly stat = {} as TFile["stat"];
  readonly basename: string;
  readonly extension: string;
  constructor(path: string) {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
    this.basename = this.name;
    this.extension = path.split(".").pop() ?? "md";
  }
}

// Use vi.hoisted() to define mocks before vi.mock() hoisting
const mocks = vi.hoisted(() => {
  const addChunksMock = vi.fn();
  const saveToDiskMock = vi.fn();
  const clearMock = vi.fn();
  const removeBySourceMock = vi.fn().mockResolvedValue(0);
  const countChunksMock = vi.fn().mockResolvedValue(0);
  const searchMock = vi.fn().mockResolvedValue([]);
  const oramaMock = vi.fn();
  const loadFromDiskMock = vi.fn();

  return {
    mockVectorStore: {
      addChunks: addChunksMock,
      saveToDisk: saveToDiskMock,
      clear: clearMock,
      removeBySource: removeBySourceMock,
      countChunks: countChunksMock,
      search: searchMock,
      orama: oramaMock,
      loadFromDisk: loadFromDiskMock,
    } as unknown as ReturnType<typeof getVectorStore>,
    addChunksMock,
    removeBySourceMock,
  };
});

// Outer-scope mock references for use in tests
let getMarkdownFilesMock: ReturnType<typeof vi.fn>;
let readMock: ReturnType<typeof vi.fn>;
let embedManyMock: ReturnType<typeof vi.fn>;
let embedSingleMock: ReturnType<typeof vi.fn>;
let getConfigMock: ReturnType<typeof vi.fn>;

/**
 * Wait for the indexer's queue processor to finish all pending work.
 * Polls isProcessing() and queue length until idle.
 */
async function waitForProcessing(
  indexer: ReturnType<typeof getIndexer>,
): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (!indexer.isProcessing() && indexer.getQueueLength() === 0) {
      // Give a tiny tick for any final microtasks
      await new Promise((r) => setTimeout(r, 10));
      return;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("Indexer processing did not complete in time");
}

describe("Indexer", () => {
  let indexer: ReturnType<typeof getIndexer>;
  let mockEmbedder: ReturnType<typeof getEmbedder>;
  let mockVault: IVaultAdapter;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const { initIndexer, getIndexer } = await import("../src/rag/indexer");

    // initIndexer is idempotent and automatically resets the singleton
    getMarkdownFilesMock = vi.fn().mockReturnValue([] as Array<MockTFile>);
    readMock = vi.fn().mockResolvedValue("");

    mockVault = {
      getMarkdownFiles: getMarkdownFilesMock,
      read: readMock,
    } as unknown as IVaultAdapter;

    embedManyMock = vi
      .fn()
      .mockImplementation(async (texts: Array<string>) => ({
        results: texts.map(
          (text) =>
            ({
              embedding: Array(1024).fill(0.01),
              text,
            }) satisfies EmbeddingResult,
        ),
        errors: [] as Array<EmbeddingError>,
      }));
    embedSingleMock = vi.fn().mockResolvedValue(Array(1024).fill(0.01));
    getConfigMock = vi.fn().mockReturnValue({
      endpoint: "http://localhost:8000",
      model: "text-embedding-3-small",
      dimensions: 1024,
    });

    mockEmbedder = {
      embedMany: embedManyMock,
      embedSingle: embedSingleMock,
      getConfig: getConfigMock,
    } as unknown as ReturnType<typeof getEmbedder>;

    // Initialize the singleton indexer with mock dependencies
    initIndexer(mockVault, mockEmbedder, mocks.mockVectorStore);
    indexer = getIndexer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("enqueueEdit (full reindex)", () => {
    it("should enqueue files, process them, and store embeddings", async () => {
      const mockFiles = [new MockTFile("note1.md"), new MockTFile("note2.md")];
      getMarkdownFilesMock.mockReturnValue(mockFiles);
      readMock.mockResolvedValue("Hello world. This is a test note.");

      // Enqueue each file for reindexing
      for (const file of mockFiles) {
        indexer.enqueueEdit(mkFile(file.path));
      }

      // Wait for all queue items to finish processing
      await waitForProcessing(indexer);

      // Both files were read and embedded
      expect(readMock).toHaveBeenCalledTimes(2);
      expect(embedManyMock).toHaveBeenCalledTimes(2);

      // Verify vector store operations
      expect(mocks.addChunksMock).toHaveBeenCalledTimes(2);
    });

    it("should handle empty vault (no files to enqueue)", async () => {
      getMarkdownFilesMock.mockReturnValue([]);

      // No enqueue calls — nothing to process
      await waitForProcessing(indexer);

      expect(mocks.addChunksMock).not.toHaveBeenCalled();
    });

    it("should skip empty files", async () => {
      getMarkdownFilesMock.mockReturnValue([mkFile("empty.md")]);
      readMock.mockResolvedValue("");

      indexer.enqueueEdit(mkFile("empty.md"));
      await waitForProcessing(indexer);

      // File was read but content is empty, so no chunking/embedding
      expect(readMock).toHaveBeenCalledTimes(1);
      expect(embedManyMock).not.toHaveBeenCalled();
    });

    it("should skip whitespace-only files", async () => {
      getMarkdownFilesMock.mockReturnValue([mkFile("whitespace.md")]);
      readMock.mockResolvedValue("   \n\n  ");

      indexer.enqueueEdit(mkFile("whitespace.md"));
      await waitForProcessing(indexer);

      // File was read but content is whitespace-only, so no chunking/embedding
      expect(readMock).toHaveBeenCalledTimes(1);
      expect(embedManyMock).not.toHaveBeenCalled();
    });

    it("should handle file read errors gracefully", async () => {
      getMarkdownFilesMock.mockReturnValue([
        mkFile("readable.md"),
        mkFile("unreadable.md"),
      ]);
      readMock
        .mockImplementationOnce(() => Promise.resolve("Readable content"))
        .mockImplementationOnce(() =>
          Promise.reject(new Error("File not found")),
        );

      indexer.enqueueEdit(mkFile("readable.md"));
      indexer.enqueueEdit(mkFile("unreadable.md"));
      await waitForProcessing(indexer);

      // Readable file was processed, unreadable was skipped
      expect(readMock).toHaveBeenCalledTimes(2);
      expect(embedManyMock).toHaveBeenCalledTimes(1);
    });

    it("should handle embedding failures gracefully", async () => {
      getMarkdownFilesMock.mockReturnValue([mkFile("note.md")]);
      readMock.mockResolvedValue("Test content");

      embedManyMock.mockResolvedValue({
        results: [] as Array<EmbeddingResult>,
        errors: [{ text: "Test content", message: "API error" }],
      });

      indexer.enqueueEdit(mkFile("note.md"));
      await waitForProcessing(indexer);

      // File was read and embedding was attempted; indexer continues despite failure
      expect(readMock).toHaveBeenCalledTimes(1);
      expect(embedManyMock).toHaveBeenCalledTimes(1);
    });

    it("should store chunks with correct metadata", async () => {
      getMarkdownFilesMock.mockReturnValue([mkFile("campaigns/npc.md")]);
      readMock.mockResolvedValue("Grommet is a dwarf warrior.");

      indexer.enqueueEdit(mkFile("campaigns/npc.md"));
      await waitForProcessing(indexer);

      // Check that addChunks was called with correct metadata
      expect(mocks.addChunksMock).toHaveBeenCalled();
      const storedChunks: Array<StoredChunk> = (
        mocks.addChunksMock as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];

      expect(storedChunks.length).toBeGreaterThan(0);
      expect(storedChunks[0].source).toBe("campaigns/npc.md");
      expect(storedChunks[0].text).toContain("Grommet");
    });

    it("should include file path in chunk IDs", async () => {
      getMarkdownFilesMock.mockReturnValue([mkFile("folder/note.md")]);
      const longContent =
        "Test content with enough words to produce multiple chunks " +
        "for testing the chunking logic that splits text into smaller pieces.";
      readMock.mockResolvedValue(longContent);

      indexer.enqueueEdit(mkFile("folder/note.md"));
      await waitForProcessing(indexer);

      expect(mocks.addChunksMock).toHaveBeenCalled();
      const storedChunks: Array<StoredChunk> = (
        mocks.addChunksMock as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];

      // Chunk IDs should include the file path
      for (const chunk of storedChunks) {
        expect(chunk.id).toContain("folder/note.md");
        expect(chunk.source).toBe("folder/note.md");
      }
    });
  });

  describe("enqueueDelete", () => {
    it("should remove chunks by source path", async () => {
      indexer.enqueueDelete(mkFile("campaigns/npc.md"));
      await waitForProcessing(indexer);

      expect(mocks.removeBySourceMock).toHaveBeenCalledWith("campaigns/npc.md");
    });
  });

  describe("enqueueRename", () => {
    it("should remove old chunks and re-index at new path", async () => {
      const oldPath = "old/npc.md";

      indexer.enqueueRename(
        oldPath,
        mkFile("new/npc.md"),
        "Grommet is a dwarf warrior.",
      );
      await waitForProcessing(indexer);

      // Should remove old chunks
      expect(mocks.removeBySourceMock).toHaveBeenCalledWith("old/npc.md");
      // Should re-index at new path
      expect(mocks.addChunksMock).toHaveBeenCalled();
      const storedChunks: Array<StoredChunk> = (
        mocks.addChunksMock as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(storedChunks[0].source).toBe("new/npc.md");
    });
  });

  describe("cancelPending", () => {
    it("should clear the queue and reset processing state", async () => {
      readMock.mockResolvedValue("content");

      indexer.enqueueEdit(mkFile("note1.md"));
      indexer.enqueueEdit(mkFile("note2.md"));

      // Wait for first item to start processing (processor runs synchronously for first item)
      await new Promise((r) => setTimeout(r, 10));

      // Cancel remaining queue items
      indexer.cancelPending();

      expect(indexer.getQueueLength()).toBe(0);
      expect(indexer.isProcessing()).toBe(false);
    });

    it("should stop processing if cancelled mid-flight", async () => {
      // Set up a slow read so processing takes time
      readMock.mockImplementation(
        () => new Promise((r) => setTimeout(() => r("content"), 100)),
      );

      indexer.enqueueEdit(mkFile("note1.md"));
      indexer.enqueueEdit(mkFile("note2.md"));
      indexer.enqueueEdit(mkFile("note3.md"));

      // Wait a bit for processing to start
      await new Promise((r) => setTimeout(r, 20));
      expect(indexer.isProcessing()).toBe(true);

      // Cancel mid-processing
      indexer.cancelPending();

      // Give more time — processing should have stopped
      await new Promise((r) => setTimeout(r, 50));
      expect(indexer.isProcessing()).toBe(false);
      expect(indexer.getQueueLength()).toBe(0);
    });
  });

  describe("queue management", () => {
    it("should track queue length and drain after processing", async () => {
      expect(indexer.getQueueLength()).toBe(0);

      indexer.enqueueEdit(mkFile("note1.md"));
      // Queue processes on next tick — wait a microtick then check
      await new Promise((r) => setTimeout(r, 0));
      expect(indexer.getQueueLength()).toBe(0); // Already drained

      indexer.enqueueEdit(mkFile("note2.md"));
      await waitForProcessing(indexer);
      expect(indexer.getQueueLength()).toBe(0);
    });

    it("should deduplicate modify operations for the same file", async () => {
      indexer.enqueueEdit(mkFile("note.md"));
      indexer.enqueueEdit(mkFile("note.md"));
      indexer.enqueueEdit(mkFile("note.md"));

      // Only one item should be in the queue
      expect(indexer.getQueueLength()).toBe(1);
      await waitForProcessing(indexer);
    });

    it("should process items sequentially", async () => {
      readMock.mockResolvedValue("Test content");

      indexer.enqueueEdit(mkFile("note1.md"));
      indexer.enqueueEdit(mkFile("note2.md"));

      await waitForProcessing(indexer);

      // Both files should be read (2 calls for 2 files)
      expect(readMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("initialization", () => {
    it("should initialize and retrieve the singleton indexer", async () => {
      const testVault: IVaultAdapter = {
        getMarkdownFiles: vi.fn().mockReturnValue([] as Array<MockTFile>),
        read: vi.fn().mockResolvedValue(""),
      };

      const testEmbedder = {
        embedMany: vi.fn().mockResolvedValue({
          results: [] as Array<EmbeddingResult>,
          errors: [],
        }),
        embedSingle: vi.fn().mockResolvedValue([]),
        getConfig: vi.fn(),
      } as unknown as ReturnType<typeof getEmbedder>;

      vi.resetModules();
      const { initIndexer, getIndexer } = await import("../src/rag/indexer");

      const testIndexer = initIndexer(
        testVault,
        testEmbedder,
        mocks.mockVectorStore,
      );
      const retrievedIndexer = getIndexer();

      expect(testIndexer).toBe(retrievedIndexer);
      expect(retrievedIndexer).toBeDefined();
    });
  });

  describe("constructor", () => {
    it("should create indexer with custom config", async () => {
      const testVault: IVaultAdapter = {
        getMarkdownFiles: vi.fn().mockReturnValue([] as Array<MockTFile>),
        read: vi.fn().mockResolvedValue(""),
      };

      const testEmbedder = {
        embedMany: vi.fn().mockResolvedValue({
          results: [] as Array<EmbeddingResult>,
          errors: [],
        }),
        embedSingle: vi.fn().mockResolvedValue([]),
        getConfig: vi.fn(),
      } as unknown as ReturnType<typeof getEmbedder>;

      vi.resetModules();
      const { initIndexer } = await import("../src/rag/indexer");

      const customIndexer = initIndexer(
        testVault,
        testEmbedder,
        mocks.mockVectorStore,
      );
      expect(customIndexer).toBeDefined();
      expect(customIndexer.getQueueLength()).toBe(0);
      expect(customIndexer.isProcessing()).toBe(false);
    });
  });
});
