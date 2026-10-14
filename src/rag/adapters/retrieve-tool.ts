import { z } from "zod";

import type { IVaultTool, IVectorStore } from "../interfaces";

const RESULT_COUNT = 5;
// Candidate pool MMR picks the results from
const CANDIDATE_COUNT = 20;
// Leans towards relevance; lower values favour diversity
const MMR_LAMBDA = 0.7;

export const NO_RESULTS_MESSAGE = "No relevant notes found for this query.";

export class RetrieveTool implements IVaultTool {
  readonly #vectorStore: IVectorStore;
  readonly #scoreThreshold: number;

  public constructor(vectorStore: IVectorStore, scoreThreshold: number) {
    this.#vectorStore = vectorStore;
    this.#scoreThreshold = scoreThreshold;
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
    const results = await this.#vectorStore.maxMarginalRelevanceSearch(query, {
      k: RESULT_COUNT,
      fetchK: CANDIDATE_COUNT,
      lambda: MMR_LAMBDA,
      scoreThreshold: this.#scoreThreshold,
    });
    console.log(
      `Retrieved ${results.length} chunk(s) for "${query}":`,
      results.map((r) => `${r.document.metadata.path} (${r.score.toFixed(3)})`),
    );

    if (results.length === 0) {
      return NO_RESULTS_MESSAGE;
    }

    // Scores are left out on purpose: the model judges relevance better from the content
    return results
      .map(({ document }) => `Source: ${document.metadata.path}\nContent: ${document.pageContent}`)
      .join("\n");
  }
}
