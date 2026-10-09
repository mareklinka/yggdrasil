import type { Document } from "@langchain/core/documents";
import { MarkdownTextSplitter } from "@langchain/textsplitters";

import type { IDocumentSplitter } from "../interfaces";

export class LangchainSplitterAdapter implements IDocumentSplitter {
  readonly #splitter: MarkdownTextSplitter;

  public constructor(chunkSize: number, chunkOverlap: number) {
    this.#splitter = new MarkdownTextSplitter({
      chunkSize,
      chunkOverlap,
    });
  }

  public splitDocuments(docs: Array<Document>): Promise<Array<Document>> {
    return this.#splitter.splitDocuments(docs);
  }
}
