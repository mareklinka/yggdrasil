import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import type { Document } from "@langchain/core/documents";

import type { IEmbeddings, IVectorStore } from "../interfaces";

export class LangchainVectorStoreAdapter implements IVectorStore {
  readonly #store: MemoryVectorStore;

  public constructor(embeddings: IEmbeddings) {
    this.#store = new MemoryVectorStore(embeddings);
  }

  public addDocuments(docs: Array<Document>): Promise<void> {
    return this.#store.addDocuments(docs);
  }

  public deleteDocumentsByPath(path: string): void {
    const vectors = this.getVectors() as Array<{
      metadata: { path: string };
    }>;
    const filtered = vectors.filter((v) => v.metadata.path !== path);
    console.log('Removed', vectors.length - filtered.length, 'chunk(s)');
    this.setVectors(filtered);
  }

  public similaritySearch(query: string, k: number): Promise<Array<Document>> {
    return this.#store.similaritySearch(query, k);
  }

  public setVectors(vecs: Array<unknown>): void {
    this.#store.memoryVectors = vecs as never;
  }

  public getVectors(): Array<unknown> {
    return this.#store.memoryVectors;
  }
}
