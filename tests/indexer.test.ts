import type { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Embedder, EmbeddingResult } from "../src/rag/embedder";
import {
  Indexer,
  type IndexerConfig,
  type VaultAdapter,
} from "../src/rag/indexer";
import type { FilePersistence, StoredChunk } from "../src/rag/vector-store";

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
const mocks = vi.hoisted(() => ({
  mockVectorStore: {
    createNew: vi.fn(),
    addChunks: vi.fn(),
    saveToDisk: vi.fn(),
    close: vi.fn(),
    clear: vi.fn(),
    initialize: vi.fn(function (this: { createNew: () => Promise<void> }) {
      return this.createNew();
    }),
    removeBySource: vi.fn().mockResolvedValue(0),
  },
  VectorStore: vi.fn(),
}));

// Mock the vector-store module using the hoisted mocks
vi.mock("../src/rag/vector-store", () => ({
  VectorStore: mocks.VectorStore,
}));

// In-memory file system mock for tests
function createMockFileSystem(): FilePersistence {
  return {
    write: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue("{}"),
    writeBinary: vi.fn().mockResolvedValue(undefined),
    readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    exists: vi.fn().mockResolvedValue(false),
  };
}

/**
 * Wait for the indexer's queue processor to finish all pending work.
 * Polls isProcessing() and queue length until idle.
 */
async function waitForProcessing(indexer: Indexer): Promise<void> {
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
  let indexer: Indexer;
  let mockEmbedder: { embedMany: ReturnType<typeof vi.fn> };
  let mockFileSystem: FilePersistence;

  const mockConfig: IndexerConfig = {
    dbPath: "/test/vectors.json",
    dimensions: 1024,
  };

  const mockVault = {
    getMarkdownFiles: vi.fn().mockReturnValue([] as Array<MockTFile>),
    read: vi.fn<(...args: Array<[TFile]>) => Promise<string>>().mockResolvedValue(""),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFileSystem = createMockFileSystem();

    // Set up VectorStore mock to return our shared mock instance
    // Must use a regular function (not arrow) because `new` requires a constructable function
    mocks.VectorStore.mockImplementation(function () {
      return mocks.mockVectorStore;
    });

    mockEmbedder = {
      embedMany: vi.fn().mockImplementation(async (texts: Array<string>) => ({
        results: texts.map(
          (text) =>
            ({
              embedding: Array(1024).fill(0.01),
              text,
            }) satisfies EmbeddingResult,
        ),
        errors: [] as Array<{ text: string; message: string }>,
      })),
    };

    // Pass mock embedder and mock file system via dependency injection
    indexer = new Indexer(
      mockConfig,
      mockVault as unknown as VaultAdapter,
      mockEmbedder as unknown as Embedder,
      mockFileSystem,
    );

    // Initialize the indexer so it has an initialized store
    await indexer.initialize();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("enqueueEdit (full reindex)", () => {
    it("should enqueue files, process them, and store embeddings", async () => {
      const mockFiles = [
        new MockTFile("note1.md"),
        new MockTFile("note2.md"),
      ];
      mockVault.getMarkdownFiles.mockReturnValue(mockFiles);
      mockVault.read.mockResolvedValue("Hello world. This is a test note.");

      // Enqueue each file for reindexing
      for (const file of mockFiles) {
        indexer.enqueueEdit(mkFile(file.path));
      }

      // Wait for all queue items to finish processing
      await waitForProcessing(indexer);

      // Both files were read and embedded
      expect(mockVault.read).toHaveBeenCalledTimes(2);
      expect(mockEmbedder.embedMany).toHaveBeenCalledTimes(2);

      // Verify vector store operations
      expect(mocks.mockVectorStore.createNew).toHaveBeenCalledTimes(1);
      expect(mocks.mockVectorStore.addChunks).toHaveBeenCalledTimes(2);
    });

    it("should handle empty vault (no files to enqueue)", async () => {
      mockVault.getMarkdownFiles.mockReturnValue([]);

      // No enqueue calls — nothing to process
      await waitForProcessing(indexer);

      expect(mocks.mockVectorStore.createNew).toHaveBeenCalledTimes(1);
      expect(mocks.mockVectorStore.addChunks).not.toHaveBeenCalled();
    });

    it("should skip empty files", async () => {
      mockVault.getMarkdownFiles.mockReturnValue([mkFile("empty.md")]);
      mockVault.read.mockResolvedValue("");

      indexer.enqueueEdit(mkFile("empty.md"));
      await waitForProcessing(indexer);

      // File was read but content is empty, so no chunking/embedding
      expect(mockVault.read).toHaveBeenCalledTimes(1);
      expect(mockEmbedder.embedMany).not.toHaveBeenCalled();
    });

    it("should skip whitespace-only files", async () => {
      mockVault.getMarkdownFiles.mockReturnValue([mkFile("whitespace.md")]);
      mockVault.read.mockResolvedValue("   \n\n  ");

      indexer.enqueueEdit(mkFile("whitespace.md"));
      await waitForProcessing(indexer);

      // File was read but content is whitespace-only, so no chunking/embedding
      expect(mockVault.read).toHaveBeenCalledTimes(1);
      expect(mockEmbedder.embedMany).not.toHaveBeenCalled();
    });

    it("should handle file read errors gracefully", async () => {
      mockVault.getMarkdownFiles.mockReturnValue([
        mkFile("readable.md"),
        mkFile("unreadable.md"),
      ]);
      mockVault.read
        .mockResolvedValueOnce("Readable content")
        .mockRejectedValueOnce(new Error("File not found"));

      indexer.enqueueEdit(mkFile("readable.md"));
      indexer.enqueueEdit(mkFile("unreadable.md"));
      await waitForProcessing(indexer);

      // Readable file was processed, unreadable was skipped
      expect(mockVault.read).toHaveBeenCalledTimes(2);
      expect(mockEmbedder.embedMany).toHaveBeenCalledTimes(1);
    });

    it("should handle embedding failures gracefully", async () => {
      mockVault.getMarkdownFiles.mockReturnValue([mkFile("note.md")]);
      mockVault.read.mockResolvedValue("Test content");

      mockEmbedder.embedMany.mockResolvedValue({
        results: [] as Array<EmbeddingResult>,
        errors: [{ text: "Test content", message: "API error" }],
      });

      indexer.enqueueEdit(mkFile("note.md"));
      await waitForProcessing(indexer);

      // File was read and embedding was attempted; indexer continues
      expect(mockVault.read).toHaveBeenCalledTimes(1);
      expect(mockEmbedder.embedMany).toHaveBeenCalledTimes(1);
    });

    it("should store chunks with correct metadata", async () => {
      mockVault.getMarkdownFiles.mockReturnValue([mkFile("campaigns/npc.md")]);
      mockVault.read.mockResolvedValue("Grommet is a dwarf warrior.");

      indexer.enqueueEdit(mkFile("campaigns/npc.md"));
      await waitForProcessing(indexer);

      // Check that addChunks was called with correct metadata
      expect(mocks.mockVectorStore.addChunks).toHaveBeenCalled();
      const storedChunks: Array<StoredChunk> =
        mocks.mockVectorStore.addChunks.mock.calls[0][0];

      expect(storedChunks.length).toBeGreaterThan(0);
      expect(storedChunks[0].source).toBe("campaigns/npc.md");
      expect(storedChunks[0].text).toContain("Grommet");
    });

    it("should include file path in chunk IDs", async () => {
      mockVault.getMarkdownFiles.mockReturnValue([mkFile("folder/note.md")]);
      const longContent =
        "Test content with enough words to produce multiple chunks " +
        "for testing the chunking logic that splits text into smaller pieces.";
      mockVault.read.mockResolvedValue(longContent);

      indexer.enqueueEdit(mkFile("folder/note.md"));
      await waitForProcessing(indexer);

      expect(mocks.mockVectorStore.addChunks).toHaveBeenCalled();
      const storedChunks: Array<StoredChunk> =
        mocks.mockVectorStore.addChunks.mock.calls[0][0];

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

      expect(mocks.mockVectorStore.removeBySource).toHaveBeenCalledWith(
        "campaigns/npc.md",
      );
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
      expect(mocks.mockVectorStore.removeBySource).toHaveBeenCalledWith(
        "old/npc.md",
      );
      // Should re-index at new path
      expect(mocks.mockVectorStore.addChunks).toHaveBeenCalled();
      const storedChunks: Array<StoredChunk> =
        mocks.mockVectorStore.addChunks.mock.calls[0][0];
      expect(storedChunks[0].source).toBe("new/npc.md");
    });
  });

  describe("cancelPending", () => {
    it("should clear the queue and reset processing state", async () => {
      mockVault.read.mockResolvedValue("content");

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
      mockVault.read.mockImplementation(
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
      mockVault.read.mockResolvedValue("Test content");

      indexer.enqueueEdit(mkFile("note1.md"));
      indexer.enqueueEdit(mkFile("note2.md"));

      await waitForProcessing(indexer);

      // Both files should be read (2 calls for 2 files)
      expect(mockVault.read).toHaveBeenCalledTimes(2);
    });
  });

  describe("initialization", () => {
    it("should create vector store with correct config", async () => {
      expect(mocks.VectorStore).toHaveBeenCalledWith(
        { dbPath: "/test/vectors.json", dimensions: 1024 },
        mockFileSystem,
      );
    });
  });

  describe("constructor", () => {
    it("should create indexer with custom config", () => {
      const customConfig: IndexerConfig = {
        dbPath: "/custom/path.json",
        dimensions: 512,
      };

      const customIndexer = new Indexer(
        customConfig,
        mockVault as unknown as VaultAdapter,
        mockEmbedder as unknown as Embedder,
        mockFileSystem,
      );
      expect(customIndexer).toBeDefined();
    });
  });
});
