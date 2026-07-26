import { OpenAIEmbeddings } from "@langchain/openai";

import type { IEmbeddings } from "../interfaces";

export class LangchainEmbeddingsAdapter implements IEmbeddings {
  readonly #embeddings: OpenAIEmbeddings;

  public constructor(options: {
    model: string;
    baseUrl: string;
    dimensions: number;
    apiKey: string;
    errorHandler: (e: unknown) => void;
  }) {
    this.#embeddings = new OpenAIEmbeddings({
      model: options.model,
      configuration: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        baseURL: options.baseUrl,
        apiKey: !options.apiKey || options.apiKey === "" ? "-" : options.apiKey,
      },
      dimensions: options.dimensions,
      maxRetries: 2,
      onFailedAttempt: (e): void => options.errorHandler(e),
    });
  }

  public embedDocuments(texts: Array<string>): Promise<Array<Array<number>>> {
    return this.#embeddings.embedDocuments(texts);
  }

  public embedQuery(text: string): Promise<Array<number>> {
    return this.#embeddings.embedQuery(text);
  }
}
