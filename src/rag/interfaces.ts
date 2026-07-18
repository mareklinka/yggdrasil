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

/** Executes semantic search queries and returns serialized results. */
export interface IRetrieveTool {
  get toolName(): string;
  get toolDescription(): string;
  execute(
    query: string,
  ): Promise<{ serialized: string; docs: Array<Document> }>;
}

/** Runs an agent with tools and system prompt. */
export interface IAgent {
  invoke(query: string): Promise<string>;
}
