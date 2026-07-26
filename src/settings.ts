export interface YggdrasilSettings {
  embeddingsModelPath: string;
  embeddingsBaseUrl: string;
  embeddingsDimensions: number;
  embeddingsApiKey: string;
  chatModelPath: string;
  chatModelBaseUrl: string;
  chatModelApiKey: string;
  chatModelHasVision: boolean;
  splitterChunkSize: number;
  splitterChunkOverlap: number;
}

export const DEFAULT_SETTINGS: YggdrasilSettings = {
  embeddingsModelPath: "",
  embeddingsBaseUrl: "",
  embeddingsDimensions: 1024,
  embeddingsApiKey: "",
  chatModelPath: "",
  chatModelBaseUrl: "",
  chatModelApiKey: "",
  chatModelHasVision: false,
  splitterChunkSize: 500,
  splitterChunkOverlap: 100,
};

export function validateBaseUrl(value: string): string | null {
  if (value === "") {
    return null;
  }
  try {
    new URL(value);
    return null;
  } catch {
    return "Must be a valid absolute URL (e.g. http://localhost:11434/v1)";
  }
}

export function validatePositiveInt(value: number): string | null {
  if (!Number.isInteger(value) || value < 0) {
    return "Must be a non-negative integer";
  }
  return null;
}

// export const DEFAULT_SETTINGS: YggdrasilSettings = {
//   embeddingsModelPath: "v5-small-retrieval-Q8_0.gguf",
//   embeddingsBaseUrl: "http://127.0.0.1:10001/v1",
//   embeddingsDimensions: 1024,
//   embeddingsApiKey: "-",
//   chatModelPath: "/model/Qwen3.6-mtp-35B-A3B-UD-Q4_K_XL.gguf",
//   chatModelBaseUrl: "http://brain.mar3ek.home:9001/v1",
//   chatModelApiKey: "-",
//   splitterChunkSize: 500,
//   splitterChunkOverlap: 100,
// };
