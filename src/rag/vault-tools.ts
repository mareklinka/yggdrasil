import type { Vault } from "obsidian";
import { normalizePath, TFile, TFolder } from "obsidian";
import { z } from "zod";

import type { IVaultTool } from "./interfaces";

const MaxReadFileSize = 100 * 1024;

export class ListFolderTool implements IVaultTool {
  readonly #vault: Vault;

  public constructor(vault: Vault) {
    this.#vault = vault;
  }

  public get toolName(): string {
    return "list-folder";
  }

  public get toolDescription(): string {
    return "List all files and folders in a vault-relative path. Returns entries with type and path.";
  }

  public get zodSchema(): Record<string, unknown> {
    return {
      path: z
        .string()
        .describe(
          "Vault-relative folder path to list (e.g. 'NPCs' or 'Locations/Dungeons')",
        ),
    };
  }

  public async execute(params: Record<string, string>): Promise<string> {
    const path = normalizePath(params.path);
    const abstractFile = this.#vault.getAbstractFileByPath(path);
    if (abstractFile === null) {
      throw new Error(`Path does not exist in vault: "${path}".`);
    }
    if (abstractFile instanceof TFile) {
      throw new Error(`Path is a file, not a folder: "${path}".`);
    }
    if (!(abstractFile instanceof TFolder)) {
      throw new Error(`Path is not a folder: "${path}".`);
    }

    const result: Array<{ type: "file" | "folder"; path: string }> =
      abstractFile.children
        .filter((c) => c instanceof TFile || c instanceof TFolder)
        .map((c) => ({
          type: c instanceof TFile ? "file" : "folder",
          path: c.path,
        }));

    return JSON.stringify(result, null, 2);
  }
}

export class ReadFileTool implements IVaultTool {
  readonly #vault: Vault;

  public constructor(vault: Vault) {
    this.#vault = vault;
  }

  public get toolName(): string {
    return "read-file";
  }

  public get toolDescription(): string {
    return "Read content of a vault-relative file. Optionally read a line range.";
  }

  public get zodSchema(): Record<string, unknown> {
    return {
      path: z
        .string()
        .describe("Vault-relative file path to read (e.g. 'NPCs/Dragon.md')"),
      fromLine: z
        .string()
        .optional()
        .describe("0-based start line (inclusive). Default: 0"),
      toLine: z
        .string()
        .optional()
        .describe("0-based end line (exclusive). Default: end of file"),
    };
  }

  public async execute(params: Record<string, string>): Promise<string> {
    const path = normalizePath(params.path);
    const abstractFile = this.#vault.getAbstractFileByPath(path);
    if (abstractFile === null) {
      throw new Error(`Path does not exist in vault: "${path}".`);
    }
    if (abstractFile instanceof TFolder) {
      throw new Error(`Path is a folder, not a file: "${path}".`);
    }
    if (!(abstractFile instanceof TFile)) {
      throw new Error(`Path is not a file: "${path}".`);
    }

    let fromLine = 0;
    let toLine: number | undefined;

    if (params.fromLine !== undefined) {
      fromLine = parseInt(params.fromLine, 10);
      if (isNaN(fromLine) || fromLine < 0) {
        throw new Error(
          `Invalid fromLine: "${params.fromLine}". Must be a non-negative integer.`,
        );
      }
    }

    if (params.toLine !== undefined) {
      toLine = parseInt(params.toLine, 10);
      if (isNaN(toLine) || toLine < 0) {
        throw new Error(
          `Invalid toLine: "${params.toLine}". Must be a non-negative integer.`,
        );
      }
    }

    const content = await this.#vault.cachedRead(abstractFile);
    const lines = content.split("\n");

    if (toLine !== undefined) {
      if (fromLine >= toLine) {
        throw new Error(
          `Invalid range: fromLine (${fromLine}) must be less than toLine (${toLine}).`,
        );
      }
      toLine = Math.min(toLine, lines.length);
    } else {
      toLine = lines.length;
    }

    const sliced = lines.slice(fromLine, toLine).join("\n");

    if (sliced.length > MaxReadFileSize) {
      return (
        sliced.substring(0, MaxReadFileSize) +
        `\n\n[TRUNCATED: Range is ${sliced.length} characters. Only first ${MaxReadFileSize} characters shown.]`
      );
    }

    return sliced;
  }
}
