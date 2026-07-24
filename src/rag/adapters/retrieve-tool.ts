import { z } from "zod";

import type { IVaultTool, IVectorStore } from "../interfaces";

export class RetrieveToolAdapter implements IVaultTool {
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

  public get zodSchema(): Record<string, unknown> {
    return {
      query: z.string().describe("The search query to find relevant notes"),
    };
  }

  public async execute(params: Record<string, string>): Promise<string> {
    const query = params.query;
    const retrievedDocs = await this.#vectorStore.similaritySearch(query, 5);
    const serialized = retrievedDocs
      .map(
        (doc) => `Source: ${doc.metadata.source}\nContent: ${doc.pageContent}`,
      )
      .join("\n");

    return serialized;
  }
}
