export interface IMessageHistory {
  push(message: string): void;
  setDraft(text: string): void;
  previous(): string;
  next(): string;
  clear(): void;
  readonly size: number;
  readonly atDefaultPosition: boolean;
}

export class MessageHistory implements IMessageHistory {
  readonly #entries: Array<string>;
  readonly #maxSize: number;
  #cursor: number;
  #draft: string;

  public constructor(maxSize: number = 100) {
    this.#entries = [];
    this.#maxSize = maxSize;
    this.#cursor = -1;
    this.#draft = "";
  }

  public setDraft(text: string): void {
    this.#draft = text;
  }

  public push(message: string): void {
    this.#entries.push(message);
    if (this.#entries.length > this.#maxSize) {
      this.#entries.shift();
    }
    this.#cursor = -1;
  }

  public previous(): string {
    if (this.#entries.length === 0) {
      return "";
    }

    if (this.#cursor === -1) {
      this.#cursor = this.#entries.length - 1;
    } else if (this.#cursor === 0) {
      return this.#entries[0];
    } else {
      this.#cursor = this.#cursor - 1;
    }

    return this.#entries[this.#cursor];
  }

  public next(): string {
    if (this.#cursor === -1) {
      return this.#draft;
    }

    this.#cursor = this.#cursor + 1;

    if (this.#cursor >= this.#entries.length) {
      this.#cursor = -1;
      const draft = this.#draft;
      return draft;
    }

    return this.#entries[this.#cursor];
  }

  public clear(): void {
    this.#entries.length = 0;
    this.#cursor = -1;
    this.#draft = "";
  }

  public get size(): number {
    return this.#entries.length;
  }

  public get atDefaultPosition(): boolean {
    return this.#cursor === -1;
  }
}
