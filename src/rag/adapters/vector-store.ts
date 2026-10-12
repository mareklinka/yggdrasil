import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import { maximalMarginalRelevance } from "@langchain/core/utils/math";

import type {
  IEmbeddings,
  IVectorStore,
  MmrSearchOptions,
  ScoredDocument,
} from "../interfaces";

/**
 * MemoryVectorStore's own MMR search discards the similarity scores. This subclass
 * reuses its protected candidate query to keep them, and to filter by score before MMR.
 */
class ScoredMemoryVectorStore extends MemoryVectorStore {
  public async maxMarginalRelevanceSearchWithScore(
    query: string,
    options: MmrSearchOptions,
  ): Promise<Array<ScoredDocument>> {
    const queryEmbedding = await this.embeddings.embedQuery(query);
    const fetched = await this._queryVectors(queryEmbedding, options.fetchK);
    const candidates = fetched.filter(
      (c) => c.similarity >= options.scoreThreshold,
    );

    const dropped = fetched.filter((c) => c.similarity < options.scoreThreshold);
    if (dropped.length > 0) {
      console.log(
        `Dropped ${dropped.length} candidate(s) below score threshold ${options.scoreThreshold}:`,
        dropped.map((c) => `${c.metadata.path} (${c.similarity.toFixed(3)})`),
      );
    }

    const selected = maximalMarginalRelevance(
      queryEmbedding,
      candidates.map((c) => c.embedding),
      options.lambda,
      options.k,
    );

    return selected.map((idx) => {
      const candidate = candidates[idx];
      return {
        document: new Document({
          pageContent: candidate.content,
          metadata: candidate.metadata,
          id: candidate.id,
        }),
        score: candidate.similarity,
      };
    });
  }
}

export class LangchainVectorStoreAdapter implements IVectorStore {
  readonly #store: ScoredMemoryVectorStore;
  readonly #embeddings: IEmbeddings;

  public constructor(embeddings: IEmbeddings) {
    this.#embeddings = embeddings;
    this.#store = new ScoredMemoryVectorStore(embeddings);
  }

  public addDocuments(docs: Array<Document>): Promise<void> {
    return this.#store.addDocuments(docs);
  }

  public deleteDocumentsByPath(path: string): void {
    const vectors = this.getVectors() as Array<{
      metadata: { path: string };
    }>;
    const filtered = vectors.filter((v) => v.metadata.path !== path);
    console.log("Removed", vectors.length - filtered.length, "chunk(s)");
    this.setVectors(filtered);
  }

  public async replaceDocumentsByPath(
    oldPath: string,
    docs: Array<Document>,
  ): Promise<void> {
    // Embed first: if this throws, the existing chunks are left untouched
    const vectors = await this.#embeddings.embedDocuments(
      docs.map((d) => d.pageContent),
    );
    this.deleteDocumentsByPath(oldPath);
    await this.#store.addVectors(vectors, docs);
  }

  public maxMarginalRelevanceSearch(
    query: string,
    options: MmrSearchOptions,
  ): Promise<Array<ScoredDocument>> {
    return this.#store.maxMarginalRelevanceSearchWithScore(query, options);
  }

  public setVectors(vecs: Array<unknown>): void {
    this.#store.memoryVectors = vecs as never;
  }

  public getVectors(): Array<unknown> {
    return this.#store.memoryVectors;
  }
}
