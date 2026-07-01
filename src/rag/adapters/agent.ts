import type { ClientTool, ServerTool } from "@langchain/core/tools";
import { tool } from "@langchain/core/tools";
import type { ChatOpenAI } from "@langchain/openai";
import type { AgentRunStream } from "langchain";
import { createAgent } from "langchain";
import { z } from "zod";

import type { IAgent, IRetrieveTool } from "../interfaces";

export class LangchainAgentAdapter implements IAgent {
  readonly #agent: ReturnType<typeof createAgent>;

  public constructor(options: {
    model: ChatOpenAI;
    retrieveTool: IRetrieveTool;
    systemPrompt: string;
  }) {
    const retrieve = tool(
      async ({ query }) => {
        const result = await options.retrieveTool.execute(query);
        return result.serialized;
      },
      {
        name: options.retrieveTool.toolName,
        description: options.retrieveTool.toolDescription,
        schema: z.object({ query: z.string() }),
      },
    );

    this.#agent = createAgent({
      model: options.model,
      tools: [retrieve],
      systemPrompt: options.systemPrompt,
    });
  }

  public streamEvents(
    input: Record<string, unknown>,
  ): Promise<
    AgentRunStream<
      unknown,
      ReadonlyArray<ClientTool | ServerTool>,
      Record<string, unknown>
    >
  > {
    return this.#agent.streamEvents(input, { version: "v3" });
  }
}
