import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Embedder, EmbeddingResult } from "../src/rag/embedder";
import {
  Indexer,
  type IndexerConfig,
  type IndexProgress,
  type IndexResult,
  type VaultAdapter,
} from "../src/rag/indexer";
import type { FilePersistence, StoredChunk } from "../src/rag/vector-store";

// Mock TFile class for tests
class MockTFile {
  readonly path: string;
  constructor(path: string) {
    this.path = path;
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
    read: vi.fn().mockResolvedValue(""),
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
      embedMany: vi.fn().mockResolvedValue({
        results: [] as Array<EmbeddingResult>,
        errors: [] as Array<{ text: string; message: string }>,
      }),
    };

    // Pass mock embedder and mock file system via dependency injection
    indexer = new Indexer(
      mockConfig,
      mockVault as unknown as VaultAdapter,
      mockEmbedder as unknown as Embedder,
      mockFileSystem,
    );

    // Initialize the indexer so reindex() has an initialized store
    await indexer.initialize();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("reindex", () => {
    it("should scan vault and process files", async () => {
      const mockFiles = [{ path: "note1.md" }, { path: "note2.md" }];
      mockVault.getMarkdownFiles.mockReturnValue(mockFiles);
      mockVault.read.mockResolvedValue("Hello world. This is a test note.");

      const embedMock = {
        embedding: Array(1024).fill(0.01),
        text: "Hello world. This is a test note.",
      };
      mockEmbedder.embedMany.mockResolvedValue({
        results: [embedMock],
        errors: [],
      });

      const progressUpdates: Array<IndexProgress> = [];
      const onProgress = (progress: IndexProgress): void => {
        progressUpdates.push({ ...progress });
      };

      const result: IndexResult = await indexer.reindex(onProgress);

      expect(result.success).toBe(true);
      expect(result.filesScanned).toBe(2); // Both files are scanned
      expect(result.chunksCreated).toBeGreaterThan(0);
      expect(result.embeddingsGenerated).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);

      // Verify vector store operations
      expect(mocks.mockVectorStore.createNew).toHaveBeenCalledTimes(1);
      expect(mocks.mockVectorStore.addChunks).toHaveBeenCalled();
    });

    it("should handle empty vault", async () => {
      mockVault.getMarkdownFiles.mockReturnValue([]);

      const progressUpdates: Array<IndexProgress> = [];
      const onProgress = (progress: IndexProgress): void => {
        progressUpdates.push({ ...progress });
      };

      const result: IndexResult = await indexer.reindex(onProgress);

      expect(result.success).toBe(true);
      expect(result.filesScanned).toBe(0);
      expect(result.chunksCreated).toBe(0);
      expect(result.embeddingsGenerated).toBe(0);
    });

    it("should skip empty files", async () => {
      mockVault.getMarkdownFiles.mockReturnValue([{ path: "empty.md" }]);
      mockVault.read.mockResolvedValue("");

      const onProgress = (_progress: IndexProgress): void => {
        // no-op
      };

      const result: IndexResult = await indexer.reindex(onProgress);

      expect(result.success).toBe(true);
      expect(result.filesScanned).toBe(1); // File is scanned even though content is empty
      expect(result.chunksCreated).toBe(0);
    });

    it("should skip whitespace-only files", async () => {
      mockVault.getMarkdownFiles.mockReturnValue([{ path: "whitespace.md" }]);
      mockVault.read.mockResolvedValue("   \n\n  ");

      const onProgress = (_progress: IndexProgress): void => {
        // no-op
      };

      const result: IndexResult = await indexer.reindex(onProgress);

      expect(result.success).toBe(true);
      expect(result.filesScanned).toBe(1); // File is scanned even though content is whitespace
    });

    it("should handle file read errors gracefully", async () => {
      mockVault.getMarkdownFiles.mockReturnValue([
        { path: "readable.md" },
        { path: "unreadable.md" },
      ]);
      mockVault.read
        .mockResolvedValueOnce("Readable content")
        .mockRejectedValueOnce(new Error("File not found"));

      mockEmbedder.embedMany.mockResolvedValue({
        results: [
          { embedding: Array(1024).fill(0.01), text: "Readable content" },
        ],
        errors: [],
      });

      const progressUpdates: Array<IndexProgress> = [];
      const onProgress = (progress: IndexProgress): void => {
        progressUpdates.push({ ...progress });
      };

      const result: IndexResult = await indexer.reindex(onProgress);

      expect(result.success).toBe(true);
      expect(result.filesScanned).toBe(1);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors[0]).toContain("unreadable.md");
    });

    it("should handle embedding failures gracefully", async () => {
      mockVault.getMarkdownFiles.mockReturnValue([{ path: "note.md" }]);
      mockVault.read.mockResolvedValue("Test content");

      mockEmbedder.embedMany.mockResolvedValue({
        results: [] as Array<EmbeddingResult>,
        errors: [{ text: "Test content", message: "API error" }],
      });

      const onProgress = (_progress: IndexProgress): void => {
        // no-op
      };

      const result: IndexResult = await indexer.reindex(onProgress);

      expect(result.success).toBe(true);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    });

    it("should report progress updates during indexing", async () => {
      mockVault.getMarkdownFiles.mockReturnValue([
        { path: "note1.md" },
        { path: "note2.md" },
        { path: "note3.md" },
      ]);
      mockVault.read.mockResolvedValue("Test content");

      mockEmbedder.embedMany.mockResolvedValue({
        results: [{ embedding: Array(1024).fill(0.01), text: "Test content" }],
        errors: [],
      });

      const progressUpdates: Array<IndexProgress> = [];
      const onProgress = (progress: IndexProgress): void => {
        progressUpdates.push({ ...progress });
      };

      await indexer.reindex(onProgress);

      // Should have multiple progress updates
      expect(progressUpdates.length).toBeGreaterThan(1);

      // First update should be scanning phase
      expect(progressUpdates[0].phase).toBe("scanning");

      // Should transition to indexing
      const indexingUpdates = progressUpdates.filter(
        (p) => p.phase === "indexing",
      );
      expect(indexingUpdates.length).toBeGreaterThan(0);

      // Last update should be complete
      expect(progressUpdates[progressUpdates.length - 1].phase).toBe(
        "complete",
      );
    });

    it("should report progress with correct file counts", async () => {
      mockVault.getMarkdownFiles.mockReturnValue([
        { path: "note1.md" },
        { path: "note2.md" },
      ]);
      mockVault.read.mockResolvedValue("Test content");

      mockEmbedder.embedMany.mockResolvedValue({
        results: [{ embedding: Array(1024).fill(0.01), text: "Test content" }],
        errors: [],
      });

      let maxCurrent = 0;
      const onProgress = (progress: IndexProgress): void => {
        if (progress.current > maxCurrent) {
          maxCurrent = progress.current;
        }
      };

      await indexer.reindex(onProgress);

      expect(maxCurrent).toBe(2);
    });

    it("should store chunks with correct metadata", async () => {
      mockVault.getMarkdownFiles.mockReturnValue([
        { path: "campaigns/npc.md" },
      ]);
      mockVault.read.mockResolvedValue("Grommet is a dwarf warrior.");

      const mockEmbedding = Array(1024).fill(0.01);
      mockEmbedder.embedMany.mockResolvedValue({
        results: [
          { embedding: mockEmbedding, text: "Grommet is a dwarf warrior." },
        ],
        errors: [],
      });

      await indexer.reindex(() => {
        // no-op
      });

      // Check that addChunks was called with correct metadata
      expect(mocks.mockVectorStore.addChunks).toHaveBeenCalled();
      const storedChunks: Array<StoredChunk> =
        mocks.mockVectorStore.addChunks.mock.calls[0][0];

      expect(storedChunks.length).toBeGreaterThan(0);
      expect(storedChunks[0].source).toBe("campaigns/npc.md");
      expect(storedChunks[0].text).toContain("Grommet");
    });

    it("should handle indexing errors and report failure", async () => {
      mockVault.getMarkdownFiles.mockReturnValue([{ path: "note.md" }]);
      mockVault.read.mockResolvedValue("Test content");

      // Make saveToDisk throw during the storing phase
      mocks.mockVectorStore.saveToDisk.mockRejectedValueOnce(
        new Error("Disk write failed"),
      );

      const onProgress = (_progress: IndexProgress): void => {
        // no-op
      };

      const result: IndexResult = await indexer.reindex(onProgress);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should include current file path in progress updates", async () => {
      mockVault.getMarkdownFiles.mockReturnValue([{ path: "folder/note.md" }]);
      mockVault.read.mockResolvedValue("Test content");

      mockEmbedder.embedMany.mockResolvedValue({
        results: [{ embedding: Array(1024).fill(0.01), text: "Test content" }],
        errors: [],
      });

      let currentFile = "";
      const onProgress = (progress: IndexProgress): void => {
        if (progress.currentFile) {
          currentFile = progress.currentFile;
        }
      };

      await indexer.reindex(onProgress);

      expect(currentFile).toBe("folder/note.md");
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
        mockVault,
        mockEmbedder as unknown as Embedder,
        mockFileSystem,
      );
      expect(customIndexer).toBeDefined();
    });

    it("should use default embedder config when not specified", () => {
      const minimalConfig: IndexerConfig = {
        dbPath: "/path.json",
        dimensions: 1024,
      };

      const customIndexer = new Indexer(
        minimalConfig,
        mockVault,
        mockEmbedder as unknown as Embedder,
        mockFileSystem,
      );
      expect(customIndexer).toBeDefined();
    });
  });
});
