import type { Document } from "@langchain/core/documents";

/** Splits document content into chunks for vectorization. */
export interface IDocumentSplitter {
  splitDocuments(docs: Array<Document>): Promise<Array<Document>>;
}

/** Converts text to embedding vectors. */
export interface IEmbeddings {
  embedDocuments(texts: Array<string>): Promise<Array<Array<number>>>;
  embedQuery(text: string): Promise<Array<number>>;
}

/** Options for a maximal marginal relevance (MMR) search. */
export interface MmrSearchOptions {
  /** Number of documents to return. */
  k: number;
  /** Number of nearest candidates to pick the k documents from. */
  fetchK: number;
  /** 1 = pure relevance, 0 = maximum diversity. */
  lambda: number;
  /** Candidates with a query similarity below this value are dropped before MMR. */
  scoreThreshold: number;
}

/** A retrieved document with its cosine similarity to the query. */
export interface ScoredDocument {
  document: Document;
  score: number;
}

/** Stores and retrieves document embeddings. */
export interface IVectorStore {
  addDocuments(docs: Array<Document>): Promise<void>;
  deleteDocumentsByPath(path: string): void;
  /** Embeds docs, then atomically swaps out all chunks stored under oldPath. */
  replaceDocumentsByPath(oldPath: string, docs: Array<Document>): Promise<void>;
  /** Drops candidates below the score threshold, then diversifies the rest with MMR. */
  maxMarginalRelevanceSearch(query: string, options: MmrSearchOptions): Promise<Array<ScoredDocument>>;
  setVectors(vecs: Array<unknown>): void;
  getVectors(): Array<unknown>;
}

/** An image attachment encoded as a base64 data URL. */
export interface ChatAttachment {
  dataUrl: string;
  mimeType: string;
}

/** A chat message that may include image attachments. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: Array<ChatAttachment>;
}

/** Runs an agent with tools and system prompt. */
export interface IAgent {
  invoke(
    query: ChatMessage,
    history: Array<ChatMessage>,
    signal?: AbortSignal,
  ): Promise<string>;
}

/** Vault filesystem tool exposed to the agent. */
export interface IVaultTool {
  get toolName(): string;
  get toolDescription(): string;
  get zodSchema(): Record<string, unknown>;
  execute(params: Record<string, string>): Promise<string>;
}
