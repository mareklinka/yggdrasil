/* eslint-disable max-len */
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import type { ClientTool, ServerTool } from "@langchain/core/tools";
import { tool } from "@langchain/core/tools";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { AgentRunStream } from "langchain";
import { createAgent } from "langchain";
import type { TFile, Vault } from "obsidian";
import { deflate, inflate } from "pako";
import * as z from "zod";

export class LangchainRag {
  readonly #agent: ReturnType<typeof createAgent>;
  readonly #splitter: RecursiveCharacterTextSplitter;
  readonly #vectorStore: MemoryVectorStore;

  public constructor(
    private readonly vault: Vault,
    private readonly config: { dbPath: string },
  ) {
    this.#splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 500,
      chunkOverlap: 100,
    });

    const embeddings = new OpenAIEmbeddings({
      model: "v5-small-retrieval-Q8_0.gguf",
      configuration: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        baseURL: "http://127.0.0.1:10001/v1",
      },
      dimensions: 1024,
      apiKey: "-",
    });

    this.#vectorStore = new MemoryVectorStore(embeddings);
    this.#loadFromDisk();

    const retrieveSchema = z.object({ query: z.string() });
    const retrieve = tool(
      async ({ query }) => {
        const retrievedDocs = await this.#vectorStore.similaritySearch(
          query,
          5,
        );
        const serialized = retrievedDocs
          .map(
            (doc) =>
              `Source: ${doc.metadata.source}\nContent: ${doc.pageContent}`,
          )
          .join("\n");
        return [serialized, retrievedDocs];
      },
      {
        name: "retrieve",
        description: "Retrieve information related to a query.",
        schema: retrieveSchema,
        responseFormat: "content_and_artifact",
      },
    );

    const model = new ChatOpenAI({
      model: "/model/Qwen3.6-mtp-35B-A3B-UD-Q4_K_XL.gguf",
      configuration: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        baseURL: "http://127.0.0.1:9001/v1",
        apiKey: "-",
      },
    });

    const systemPrompt = `You are Yggdrasil, an AI assistant specialized in D&D campaign management and world-building. You operate inside an Obsidian plugin that indexes a dungeon master's campaign notes into a vector store for semantic search and retrieval.
## Your Role
You help dungeon masters search, summarize, and reason about their campaign world by retrieving relevant notes from the vault and synthesizing accurate, well-structured answers. Your vault contains notes organized into categories such as:

- **NPCs** — Characters, their traits, motivations, relationships, and stats
- **Locations** — Geography, settlements, dungeons, landmarks, and regional lore
- **Bestiary** — Monsters, creatures, statistics, and encounter notes
- **Session History** — Recaps of past sessions, plot developments, player decisions, and consequences
- **Characters** — Player characters, backgrounds, arcs, and party dynamics
- **History/Lore** — World mythology, factions, empires, timelines, and cosmology
- **Campaign Notes** — Plot hooks, adventure outlines, and DM decisions

## How You Work
You have access to a \`retrieve\` tool that performs semantic search over the indexed vault. Use it whenever the user asks about anything in the campaign world.

1. **Retrieve first, answer second.** Always call \`retrieve\` with a clear, focused query before answering. Break complex questions into multiple targeted queries if needed (e.g., search for NPCs separately from locations).
2. **Be specific in your queries.** Use D&D-relevant terms — faction names, creature types, character names, location descriptors. Vague queries return vague results.
3. **Synthesize, don't copy-paste.** Combine information from multiple retrieved chunks into a coherent answer. Resolve contradictions by preferring the most specific or most recent source.
4. **Cite your sources.** Every answer must reference the source files it drew from. Use the format: *"[Source: path/to/note.md]"* at the end of relevant claims.
5. **Acknowledge gaps.** If the retrieved context doesn't fully answer the question, say so explicitly. Never invent facts about the campaign world. If the user asks something the vault doesn't contain, state that clearly and offer general D&D advice as a fallback.
6. **Respect campaign continuity.** Session history notes often override earlier lore. When there's a conflict, prefer later session notes and explicitly note when something has been retconned.

## Answer Style
- Be concise but thorough. DMs need quick reference answers during sessions, not essays.
- Use structured formatting: bullet points, tables for stats, and clear headings.
- When summarizing NPCs, include: name, role, key traits, motivations, and notable relationships.
- When summarizing locations, include: description, key features, inhabitants, and significant events.
- When summarizing sessions, include: key events, decisions made, consequences, and unresolved threads.
- When discussing monsters, include: CR, key abilities, tactics, and loot if available.

## Important Rules
- NEVER fabricate campaign details. If you don't know, say "I don't have information about that in the vault."
- NEVER assume player character actions that aren't documented in session notes.
- ALWAYS cite sources so the DM can verify and read more context.
- If a query is ambiguous (e.g., "tell me about the dragon"), ask for clarification before searching, or search broadly and present options.
- Keep answers session-ready: scannable, factual, and directly useful at the table.`;

    this.#agent = createAgent({
      model: model,
      tools: [retrieve],
      systemPrompt: systemPrompt,
    });
  }

  public async index(...files: Array<TFile>): Promise<void> {
    console.log("Indexing", files.length, "files...");

    const docs: Array<Document> = [];

    for (const file of files) {
      const content = await this.vault.cachedRead(file);

      console.log(
        `Loaded document: ${file.path} (${content.length} characters)`,
      );

      docs.push(
        new Document({
          pageContent: content,
          metadata: { path: file.path },
        }),
      );
    }

    const allSplits = await this.#splitter.splitDocuments(docs);
    console.log(`Split files into ${allSplits.length} sub-documents.`);

    await this.#vectorStore.addDocuments(allSplits);
    await this.#saveToDisk();
  }

  public async delete(file: TFile): Promise<void> {
    this.#vectorStore.memoryVectors = this.#vectorStore.memoryVectors.filter(
      (_) => _.metadata.path !== file.path,
    );
  }

  #stream: AgentRunStream<
    unknown,
    ReadonlyArray<ClientTool | ServerTool>,
    Record<string, unknown>
  > | null = null;

  public async query(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<string> {
    const agentInputs = {
      messages: messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
    };

    console.log("Querying agent with messages:", agentInputs.messages);

    const stream = await this.#agent.streamEvents(agentInputs, {
      version: "v3",
    });

    this.#stream = stream;

    const tokens: Array<string> = [];

    await Promise.all([
      (async (): Promise<void> => {
        for await (const message of stream.messages) {
          for await (const token of message.text) {
            tokens.push(token);
          }
        }
      })(),
      (async (): Promise<void> => {
        for await (const call of stream.toolCalls) {
          console.log("Tool call:", call.name, call.input);
        }
      })(),
    ]);

    try {
      return tokens.join("");
    } catch (error) {
      console.error(
        "Error retrieving final output from the agent stream:",
        error,
      );

      return "There was an error processing your request. Please try again.";
    } finally {
      this.#stream = null;
    }
  }

  public cancelQuery(): void {
    if (this.#stream !== null) {
      this.#stream.abort();
      this.#stream = null;
    }
  }

  async #saveToDisk(): Promise<void> {
    const json = JSON.stringify(this.#vectorStore.memoryVectors);
    const compressed = deflate(json, { level: -1 });
    await this.vault.adapter.writeBinary(
      this.config.dbPath,
      compressed.buffer as ArrayBuffer,
    );

    console.log(
      `Vector store persisted to ${this.config.dbPath}, containing ${this.#vectorStore.memoryVectors.length} chunk(s).`,
    );
  }

  async #loadFromDisk(): Promise<void> {
    if (!(await this.vault.adapter.exists(this.config.dbPath))) {
      return;
    }

    try {
      const compressed = await this.vault.adapter.readBinary(
        this.config.dbPath,
      );
      const json = inflate(new Uint8Array(compressed), { toText: true });
      const raw = JSON.parse(json);

      this.#vectorStore.memoryVectors = raw;

      console.log(
        `Vector store loaded from ${this.config.dbPath}, containing ${this.#vectorStore.memoryVectors.length} chunk(s).`,
      );
    } catch {
      throw new Error(
        `Failed to load vector store from ${this.config.dbPath}. ` +
          "The file may be missing or corrupted.",
      );
    }
  }
}
