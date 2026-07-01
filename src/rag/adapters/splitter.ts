import type { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

import type { IDocumentSplitter } from "../interfaces";

export class LangchainSplitterAdapter implements IDocumentSplitter {
  readonly #splitter: RecursiveCharacterTextSplitter;

  public constructor(chunkSize: number, chunkOverlap: number) {
    this.#splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
    });
  }

  public splitDocuments(docs: Array<Document>): Promise<Array<Document>> {
    return this.#splitter.splitDocuments(docs);
  }
}
