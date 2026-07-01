import { OpenAIEmbeddings } from "@langchain/openai";

import type { IEmbeddings } from "../interfaces";

export class LangchainEmbeddingsAdapter implements IEmbeddings {
  readonly #embeddings: OpenAIEmbeddings;

  public constructor(options: {
    model: string;
    baseUrl: string;
    dimensions: number;
    apiKey: string;
  }) {
    this.#embeddings = new OpenAIEmbeddings({
      model: options.model,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      configuration: { baseURL: options.baseUrl, apiKey: options.apiKey },
      dimensions: options.dimensions,
    });
  }

  public embedDocuments(texts: Array<string>): Promise<Array<Array<number>>> {
    return this.#embeddings.embedDocuments(texts);
  }

  public embedQuery(text: string): Promise<Array<number>> {
    return this.#embeddings.embedQuery(text);
  }
}
