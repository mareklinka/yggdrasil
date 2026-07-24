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

/** Stores and retrieves document embeddings. */
export interface IVectorStore {
  addDocuments(docs: Array<Document>): Promise<void>;
  deleteDocumentsByPath(path: string): void;
  similaritySearch(query: string, k: number): Promise<Array<Document>>;
  setVectors(vecs: Array<unknown>): void;
  getVectors(): Array<unknown>;
}

/** Runs an agent with tools and system prompt. */
export interface IAgent {
  invoke(query: string): Promise<string>;
}

/** Vault filesystem tool exposed to the agent. */
export interface IVaultTool {
  get toolName(): string;
  get toolDescription(): string;
  get zodSchema(): Record<string, unknown>;
  execute(params: Record<string, string>): Promise<string>;
}
