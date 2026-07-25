import type { ContentBlock } from "@langchain/core/messages";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { END, START, StateGraph } from "@langchain/langgraph";
import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import type { IVaultTool } from "../interfaces";
import { evaluatorPrompt } from "../prompts";

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

  // Evaluator's routing decision
  evaluatorDecision: Annotation<"end" | "retriever" | undefined>({
    reducer: (current, update) => update ?? current,
    default: () => undefined,
  }),

  // Number of times the retriever node has been executed
  retrieverCallCount: Annotation<number>({
    reducer: (_current, update) => update ?? 0,
    default: () => 0,
  }),
});

export type AgentStateType = typeof AgentState.State;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export class LangchainAgentAdapter {
  readonly #invoker: (
    input: string,
    history: Array<ChatMessage>,
    signal?: AbortSignal,
  ) => Promise<string>;

  public constructor(options: {
    model: ChatOpenAI;
    tools: Array<IVaultTool>;
    systemPrompt: string;
  }) {
    const langchainTools = options.tools.map((vt) =>
      tool(async (params: Record<string, string>) => vt.execute(params), {
        name: vt.toolName,
        description: vt.toolDescription,
        schema: z.object(vt.zodSchema),
      }),
    );

    // Main LLM bound to tools for agent loop
    const llm = options.model.bindTools(langchainTools);

    // Separate LLM instance for evaluation (not bound to tools, so its events don't leak into the graph stream)
    const evaluationLlm = options.model.bindTools([]);
    const MAX_RETRIEVER_ITERATIONS = 3;

    const extractText = (c: string | Array<ContentBlock | string>): string => {
      if (typeof c === "string") {
        return c;
      }
      return c
        .filter(
          (block): block is ContentBlock | string =>
            typeof block === "string" || block.type === "text",
        )
        .map((block) => {
          if (typeof block === "string") {
            return block.replace(/\n+$/, "");
          }
          return (block.text as string).replace(/\n+$/, "");
        })
        .join("\n");
    };

    const extractJson = (text: string): string => {
      const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        return fenceMatch[1].trim();
      }
      const braceStart = text.indexOf("{");
      const braceEnd = text.lastIndexOf("}");
      if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
        return text.substring(braceStart, braceEnd + 1).trim();
      }
      return text.trim();
    };

    const callModel = async (
      state: typeof AgentState.State,
    ): Promise<Partial<typeof AgentState.State>> => {
      console.log(
        `Retriever turn (evaluation round ${state.retrieverCallCount + 1} of ${MAX_RETRIEVER_ITERATIONS})`,
        state,
      );

      const messages = [
        new SystemMessage(options.systemPrompt),
        ...state.messages,
      ];

      const response = await llm.invoke(messages);

      return {
        messages: [response],
      };
    };

    const toolNode = new ToolNode(langchainTools);

    const evaluateAnswer = async (
      state: typeof AgentState.State,
    ): Promise<Partial<typeof AgentState.State>> => {
      console.log("Evaluating answer quality for state:", state);

      const lastMessage = state.messages[state.messages.length - 1];
      const content =
        lastMessage instanceof AIMessage ? lastMessage.content : "";

      const answerText = extractText(content).trim();

      // Store the proposed answer
      const finalAnswer: string = answerText;

      // Force end on the final allowed iteration
      if (state.retrieverCallCount >= MAX_RETRIEVER_ITERATIONS) {
        return {
          finalAnswer,
          toolCallCount: state.toolCallCount,
          evaluatorDecision: "end",
          messages: [...state.messages],
        };
      }

      // Use LLM to evaluate answer quality
      const evaluationPrompt = [
        new SystemMessage(evaluatorPrompt),
        new HumanMessage(
          `User query: ${extractText(state.messages[0]?.content) ?? "N/A"}\n\nAI response: ${answerText}`,
        ),
      ];

      const evaluationResponse = await evaluationLlm.invoke(evaluationPrompt);
      const evaluationContent =
        evaluationResponse instanceof AIMessage
          ? evaluationResponse.content
          : "";

      // Parse the evaluation result using Zod
      const EvaluationSchema = z.object({
        quality: z.enum(["good", "poor"]),
        reason: z.string(),
      });

      let decision: "end" | "retriever" = "end";
      let nextCallCount = state.retrieverCallCount;
      const messages = [...state.messages];

      try {
        const evaluationText = extractText(evaluationContent);

        const parsed = EvaluationSchema.safeParse(
          JSON.parse(extractJson(evaluationText)),
        );
        if (parsed.success && parsed.data.quality === "poor") {
          decision = "retriever";
          nextCallCount = state.retrieverCallCount + 1;
          messages.push(
            new HumanMessage("Evaluation result: " + parsed.data.reason),
          );
        }
      } catch (e) {
        // If parsing fails, default to ending (conservative approach)
        console.warn(
          "Failed to parse evaluation response, defaulting to end",
          e,
        );
      }

      console.log(`Evaluator result:", `, decision, {
        decision: decision,
        answer: answerText,
      });

      return {
        finalAnswer,
        toolCallCount: state.toolCallCount,
        evaluatorDecision: decision,
        retrieverCallCount: nextCallCount,
        messages: messages,
      };
    };

    // Conditional edge from model: should we continue to tools or evaluator?
    const shouldContinueFromModel = (
      state: typeof AgentState.State,
    ): typeof toolsNode | typeof evaluatorNode => {
      const lastMessage = state.messages[state.messages.length - 1];

      // If the last message has tool calls, route to tools
      if (
        lastMessage instanceof AIMessage &&
        lastMessage.tool_calls &&
        lastMessage.tool_calls.length > 0
      ) {
        return toolsNode;
      }

      // Otherwise, route to evaluator for quality check
      return evaluatorNode;
    };

    // Conditional edge from evaluator: should we retry or end?
    const shouldContinueFromEvaluator = (
      state: typeof AgentState.State,
    ): typeof retrieverNode | typeof END => {
      // Use the evaluator's LLM-based decision
      if (state.evaluatorDecision === retrieverNode) {
        return retrieverNode;
      }
      return END;
    };

    const graph = new StateGraph(AgentState)
      // Add nodes
      .addNode(retrieverNode, callModel)
      .addNode(evaluatorNode, evaluateAnswer)
      .addNode(toolsNode, toolNode)

      // Add edges
      .addEdge(START, retrieverNode)
      .addConditionalEdges(retrieverNode, shouldContinueFromModel, {
        tools: toolsNode,
        [evaluatorNode]: evaluatorNode,
      })
      .addEdge(toolsNode, retrieverNode)
      .addConditionalEdges(evaluatorNode, shouldContinueFromEvaluator, {
        retriever: retrieverNode,
        [END]: END,
      });

    const compiledGraph = graph.compile();

    // Compile the graph
    this.#invoker = async (
      input: string,
      history: Array<ChatMessage>,
      signal?: AbortSignal,
    ): Promise<string> => {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const historyMessages: Array<HumanMessage | AIMessage> = history.map(
        (entry) =>
          entry.role === "user"
            ? new HumanMessage(entry.content)
            : new AIMessage(entry.content),
      );

      const stream = await compiledGraph.stream(
        { messages: [...historyMessages, new HumanMessage(input)] },
        { signal },
      );

      let finalAnswer = "";
      for await (const update of stream) {
        if (signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        const evaluatorUpdate = update.evaluator as
          typeof AgentState.State | undefined;
        if (evaluatorUpdate?.finalAnswer) {
          finalAnswer = evaluatorUpdate.finalAnswer;
        }
      }
      return finalAnswer;
    };
  }

  public invoke(
    input: string,
    history: Array<ChatMessage>,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.#invoker(input, history, signal);
  }
}
