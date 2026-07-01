import type { Document } from "@langchain/core/documents";

import type { IRetrieveTool, IVectorStore } from "../interfaces";

export class RetrieveToolAdapter implements IRetrieveTool {
  readonly #vectorStore: IVectorStore;

  public constructor(vectorStore: IVectorStore) {
    this.#vectorStore = vectorStore;
  }

  public get toolName(): string {
    return "retrieve";
  }

  public get toolDescription(): string {
    return "Retrieve information related to a query.";
  }

  public async execute(
    query: string,
  ): Promise<{ serialized: string; docs: Array<Document> }> {
    const retrievedDocs = await this.#vectorStore.similaritySearch(query, 5);
    const serialized = retrievedDocs
      .map(
        (doc) => `Source: ${doc.metadata.source}\nContent: ${doc.pageContent}`,
      )
      .join("\n");

    return { serialized, docs: retrievedDocs };
  }
}
