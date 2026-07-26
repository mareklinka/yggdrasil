import { Document as LangchainDocument } from "@langchain/core/documents";
import { ChatOpenAI } from "@langchain/openai";
import type { TFile, Vault } from "obsidian";
import { deflate, inflate } from "pako";

import type { YggdrasilSettings } from "../settings";
import { LangchainAgentAdapter } from "./adapters/agent";
import { LangchainEmbeddingsAdapter } from "./adapters/embeddings";
import { RetrieveToolAdapter } from "./adapters/retrieve-tool";
import { LangchainSplitterAdapter } from "./adapters/splitter";
import { LangchainVectorStoreAdapter } from "./adapters/vector-store";
import type { ChatAttachment, ChatMessage } from "./interfaces";
import type { IAgent, IDocumentSplitter, IVectorStore } from "./interfaces";
import { systemPrompt } from "./prompts";
import { ListFolderTool, ReadFileTool } from "./vault-tools";

export interface DocumentMetadata {
  path: string;
}

export class LangchainRag {
  readonly #vault: Vault;
  readonly #dbPath: string;
  readonly #splitter: IDocumentSplitter;
  readonly #vectorStore: IVectorStore;
  readonly #agent: IAgent;

  public constructor(
    vault: Vault,
    dbPath: string,
    splitter: IDocumentSplitter,
    vectorStore: IVectorStore,
    agent: IAgent,
  ) {
    this.#vault = vault;
    this.#dbPath = dbPath;
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
        new LangchainDocument<DocumentMetadata>({
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

  public async clear(): Promise<void> {
    this.#vectorStore.setVectors([]);
    if (await this.#vault.adapter.exists(this.#dbPath)) {
      await this.#vault.adapter.remove(this.#dbPath);
    }
  }

  public async query(
    query: string,
    attachments: Array<ChatAttachment> | undefined,
    history: Array<ChatMessage>,
    signal?: AbortSignal,
  ): Promise<string> {
    console.log("Querying agent with messages:", query);
    const chatMessage: ChatMessage = {
      role: "user",
      content: query,
      attachments:
        attachments && attachments.length > 0 ? attachments : undefined,
    };
    return this.#agent.invoke(chatMessage, history, signal);
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
  settings: YggdrasilSettings,
  dbPath: string,
  embeddingErrorHandler: (e: unknown) => void,
): LangchainRag {
  const splitter = new LangchainSplitterAdapter(
    settings.splitterChunkSize,
    settings.splitterChunkOverlap,
  );

  const embeddings = new LangchainEmbeddingsAdapter({
    model: settings.embeddingsModelPath,
    baseUrl: settings.embeddingsBaseUrl,
    dimensions: settings.embeddingsDimensions,
    apiKey: settings.embeddingsApiKey,
    errorHandler: embeddingErrorHandler,
  });

  const vectorStore = new LangchainVectorStoreAdapter(embeddings);

  const rawChatModel = new ChatOpenAI({
    model: settings.chatModelPath,
    onFailedAttempt: (e): never => {
      throw e;
    },
    configuration: {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      baseURL: settings.chatModelBaseUrl,
      apiKey:
        !settings.chatModelApiKey || settings.chatModelApiKey === ""
          ? "-"
          : settings.chatModelApiKey,
    },
  });

  const retrieveTool = new RetrieveToolAdapter(vectorStore);
  const listFolderTool = new ListFolderTool(vault);
  const readFileTool = new ReadFileTool(vault);

  const agent = new LangchainAgentAdapter({
    model: rawChatModel,
    tools: [retrieveTool, listFolderTool, readFileTool],
    systemPrompt,
  });

  return new LangchainRag(vault, dbPath, splitter, vectorStore, agent);
}
