import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import type { GraphRunStream } from "@langchain/langgraph";
import { END, START, StateGraph } from "@langchain/langgraph";
import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import type { IAgent, IRetrieveTool } from "../interfaces";

const retrieverNode = "retriever";
const evaluatorNode = "evaluator";
const toolsNode = "tools";

const AgentState = Annotation.Root({
  // Messages accumulate through the conversation
  ...MessagesAnnotation.spec,

  // Track which tools have been called (for debugging)
  toolCallCount: Annotation<number>({
    reducer: (current, update) => update ?? current ?? 0,
    default: () => 0,
  }),

  // Final answer from the agent
  finalAnswer: Annotation<string>({
    reducer: (current, update) => update ?? current ?? "",
    default: () => "",
  }),
});

export type AgentStateType = typeof AgentState.State;

export class LangchainAgentAdapter implements IAgent {
  readonly #streamer: (
    input: string,
  ) => Promise<GraphRunStream<AgentStateType, Record<string, never>>>;

  public constructor(options: {
    model: ChatOpenAI;
    retrieveTool: IRetrieveTool;
    systemPrompt: string;
  }) {
    const t = tool(
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

    const llm = options.model.bindTools([t]);

    const callModel = async (
      state: typeof AgentState.State,
    ): Promise<Partial<typeof AgentState.State>> => {
      const messages = [
        new SystemMessage(options.systemPrompt),
        ...state.messages,
      ];

      const response = await llm.invoke(messages);

      return {
        messages: [response],
      };
    };

    // Node 2: Execute tools (using the prebuilt ToolNode)
    const toolNode = new ToolNode([t]);

    // Conditional edge: should we continue to tools or end?
    const shouldContinue = (
      state: typeof AgentState.State,
    ): "tools" | typeof END => {
      console.log("Checking continue", state);
      const lastMessage = state.messages[state.messages.length - 1];

      // If the last message has tool calls, route to tools
      if (
        lastMessage instanceof AIMessage &&
        lastMessage.tool_calls &&
        lastMessage.tool_calls.length > 0
      ) {
        return "tools";
      }

      // Otherwise, we're done
      return END;
    };

    const graph = new StateGraph(AgentState)
      // Add nodes
      .addNode(retrieverNode, callModel)
      .addNode(toolsNode, toolNode)

      // Add edges
      .addEdge(START, retrieverNode)
      .addConditionalEdges(retrieverNode, shouldContinue, {
        tools: toolsNode,
        [END]: END,
      })
      .addEdge(toolsNode, retrieverNode);

    const compiledGraph = graph.compile();

    // Compile the graph
    this.#streamer = (
      input: string,
    ): Promise<GraphRunStream<AgentStateType, Record<string, never>>> =>
      compiledGraph.streamEvents(
        { messages: [new HumanMessage(input)] },
        { version: "v3" },
      );
  }

  public streamEvents(
    input: string,
  ): Promise<GraphRunStream<AgentStateType, Record<string, never>>> {
    return this.#streamer(input);
  }
}
