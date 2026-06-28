import type { TFile, Vault } from "obsidian";

import { type FilePersistence } from "./vector-store";

/**
 * File persistence adapter backed by an Obsidian Vault.
 * Creates parent directories automatically when writing files.
 */
export class VaultFileSystem implements FilePersistence {
  public constructor(private readonly vault: Vault) {}

  async write(filePath: string, content: string): Promise<void> {
    await this.#ensureParentDir(filePath);
    await this.vault.adapter.write(filePath, content);
  }

  async writeBinary(filePath: string, content: ArrayBuffer): Promise<void> {
    await this.#ensureParentDir(filePath);
    await this.vault.adapter.writeBinary(filePath, content);
  }

  read(filePath: string): Promise<string> {
    return this.vault.adapter.read(filePath);
  }

  readBinary(filePath: string): Promise<ArrayBuffer> {
    return this.vault.adapter.readBinary(filePath);
  }

  exists(filePath: string): Promise<boolean> {
    return this.vault.adapter.exists(filePath);
  }

  async #ensureParentDir(filePath: string): Promise<void> {
    const parentPath = filePath.substring(0, filePath.lastIndexOf("/"));
    if (!parentPath) return;

    if (await this.vault.adapter.exists(parentPath)) return;

    const parts = parentPath.split("/");
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (await this.vault.adapter.exists(currentPath)) continue;
      await this.vault.createFolder(currentPath);
    }
  }
}
