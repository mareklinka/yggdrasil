import { Document as LangchainDocument } from "@langchain/core/documents";
import { ChatOpenAI } from "@langchain/openai";
import type { TFile, Vault } from "obsidian";
import { deflate, inflate } from "pako";

import { LangchainAgentAdapter } from "./adapters/agent";
import { LangchainEmbeddingsAdapter } from "./adapters/embeddings";
import { RetrieveToolAdapter } from "./adapters/retrieve-tool";
import { LangchainSplitterAdapter } from "./adapters/splitter";
import { LangchainVectorStoreAdapter } from "./adapters/vector-store";
import type { IAgent, IDocumentSplitter, IVectorStore } from "./interfaces";
import { systemPrompt } from "./prompts";

export class LangchainRag {
  readonly #vault: Vault;
  readonly #dbPath: string;
  readonly #splitter: IDocumentSplitter;
  readonly #vectorStore: IVectorStore;
  readonly #agent: IAgent;

  public constructor(
    vault: Vault,
    config: { dbPath: string },
    splitter: IDocumentSplitter,
    vectorStore: IVectorStore,
    agent: IAgent,
  ) {
    this.#vault = vault;
    this.#dbPath = config.dbPath;
    this.#splitter = splitter;
    this.#vectorStore = vectorStore;
    this.#agent = agent;

    this.#loadFromDisk();
  }

  public async index(...files: Array<TFile>): Promise<void> {
    console.log("Indexing", files.length, "files...");

    const docs: Array<LangchainDocument> = [];

    for (const file of files) {
      const content = await this.#vault.cachedRead(file);

      console.log(
        `Loaded document: ${file.path} (${content.length} characters)`,
      );

      docs.push(
        new LangchainDocument({
          pageContent: content,
          metadata: { path: file.path },
        }),
      );
    }

    const allSplits = await this.#splitter.splitDocuments(docs);
    console.log(`Split files into ${allSplits.length} sub-documents.`);

    await this.#vectorStore.addDocuments(allSplits);
    await this.#saveToDisk();
  }

  public delete(path: string): void {
    this.#vectorStore.deleteDocumentsByPath(path);
  }

  public async query(query: string): Promise<string> {
    console.log("Querying agent with messages:", query);
    return this.#agent.invoke(query);
  }

  async #saveToDisk(): Promise<void> {
    const vectors = this.#vectorStore.getVectors();
    const json = JSON.stringify(vectors);
    const compressed = deflate(json, { level: -1 });
    await this.#vault.adapter.writeBinary(
      this.#dbPath,
      compressed.buffer as ArrayBuffer,
    );

    console.log(
      `Vector store persisted to ${this.#dbPath}, containing ${vectors.length} chunk(s).`,
    );
  }

  async #loadFromDisk(): Promise<void> {
    if (!(await this.#vault.adapter.exists(this.#dbPath))) {
      return;
    }

    try {
      const compressed = await this.#vault.adapter.readBinary(this.#dbPath);
      const json = inflate(new Uint8Array(compressed), { toText: true });
      const raw = JSON.parse(json);

      this.#vectorStore.setVectors(raw);

      console.log(
        `Vector store loaded from ${this.#dbPath}, containing ${raw.length} chunk(s).`,
      );
    } catch {
      throw new Error(
        `Failed to load vector store from ${this.#dbPath}. ` +
          "The file may be missing or corrupted.",
      );
    }
  }
}

/**
 * Creates a fully wired LangchainRag instance with default langchain adapters.
 * Use this in your composition root (e.g., Obsidian plugin's onload).
 */
export function createLangchainRag(
  vault: Vault,
  config: { dbPath: string },
): LangchainRag {
  const splitter = new LangchainSplitterAdapter(500, 100);

  const embeddings = new LangchainEmbeddingsAdapter({
    model: "v5-small-retrieval-Q8_0.gguf",
    baseUrl: "http://127.0.0.1:10001/v1",
    dimensions: 1024,
    apiKey: "-",
  });

  const vectorStore = new LangchainVectorStoreAdapter(embeddings);

  const rawChatModel = new ChatOpenAI({
    model: "/model/Qwen3.6-mtp-35B-A3B-UD-Q4_K_XL.gguf",
    configuration: {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      baseURL: "http://127.0.0.1:9001/v1",
      apiKey: "-",
    },
  });

  const retrieveTool = new RetrieveToolAdapter(vectorStore);

  const agent = new LangchainAgentAdapter({
    model: rawChatModel,
    retrieveTool,
    systemPrompt,
  });

  return new LangchainRag(vault, config, splitter, vectorStore, agent);
}
