import type { BaseMessage, ContentBlock } from "@langchain/core/messages";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { ToolCall } from "@langchain/core/messages/tool";
import { tool } from "@langchain/core/tools";
import { entrypoint, task } from "@langchain/langgraph";
import type { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import type { ChatMessage, IAgent, IVaultTool } from "../interfaces";
import { evaluatorPrompt } from "../prompts";

interface AgentInput {
  // Conversation history followed by the current user message
  messages: Array<BaseMessage>;

  // The current user query, for the evaluator (messages also contain history)
  userQuery: string;
}

const EvaluationSchema = z.object({
  quality: z.enum(["good", "poor"]),
  reason: z.string(),
});

type Evaluation = z.infer<typeof EvaluationSchema>;

export class LangchainAgentAdapter implements IAgent {
  readonly #invoker: (
    query: ChatMessage,
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
    const toolsByName = new Map(langchainTools.map((t) => [t.name, t]));

    // Main LLM bound to tools for agent loop
    const llm = options.model.bindTools(langchainTools);

    // LLM without tools, for evaluation and for forcing a text answer
    const plainLlm = options.model.bindTools([]);
    const MAX_RETRIEVER_ITERATIONS = 3;
    const MAX_EVALUATOR_CONTEXT_CHARS = 30_000;
    const MAX_TOOL_ROUNDS = 10;

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

    // History only contains human/AI messages, so all tool results belong to the current turn
    const collectToolContext = (messages: Array<BaseMessage>): string => {
      const blocks = messages
        .filter((m): m is ToolMessage => m instanceof ToolMessage)
        .map((m) => `--- ${m.name ?? "tool"} ---\n${extractText(m.content)}`);

      if (blocks.length === 0) {
        return "(none — the assistant did not call any tools)";
      }

      // Keep the newest results within the budget
      const kept: Array<string> = [];
      let used = 0;
      for (let i = blocks.length - 1; i >= 0; i--) {
        const remaining = MAX_EVALUATOR_CONTEXT_CHARS - used;
        if (remaining <= 0) {
          break;
        }
        const block =
          blocks[i].length > remaining
            ? `${blocks[i].substring(0, remaining)}\n[TRUNCATED]`
            : blocks[i];
        kept.unshift(block);
        used += block.length;
      }

      const omitted = blocks.length - kept.length;
      if (omitted > 0) {
        kept.unshift(`[${omitted} earlier tool result(s) omitted]`);
      }
      return kept.join("\n");
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

    const toolCallsOf = (message: BaseMessage): Array<ToolCall> =>
      message instanceof AIMessage ? (message.tool_calls ?? []) : [];

    // Retriever turn: tool-bound model call
    const callModel = task(
      "callModel",
      async (
        messages: Array<BaseMessage>,
        retrieverRound: number,
      ): Promise<BaseMessage> => {
        console.log(
          `Retriever turn (evaluation round ${retrieverRound + 1} of ${MAX_RETRIEVER_ITERATIONS})`,
          messages,
        );
        return llm.invoke([
          new SystemMessage(options.systemPrompt),
          ...messages,
        ]);
      },
    );

    // Tool budget exhausted: same prompt, no tools bound, so the model must answer in text
    const forceAnswer = task(
      "forceAnswer",
      async (messages: Array<BaseMessage>): Promise<BaseMessage> =>
        plainLlm.invoke([new SystemMessage(options.systemPrompt), ...messages]),
    );

    // Failures become error tool messages, like ToolNode's default error handling
    const callTool = task(
      "callTool",
      async (toolCall: ToolCall): Promise<ToolMessage> => {
        const toToolMessage = (
          content: string,
          status: "success" | "error",
        ): ToolMessage =>
          new ToolMessage({
            content,
            name: toolCall.name,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            tool_call_id: toolCall.id ?? "",
            status,
          });

        try {
          const langchainTool = toolsByName.get(toolCall.name);
          if (langchainTool === undefined) {
            throw new Error(`Tool "${toolCall.name}" not found.`);
          }
          const result: unknown = await langchainTool.invoke(toolCall);
          if (result instanceof ToolMessage) {
            return result;
          }
          return toToolMessage(
            typeof result === "string" ? result : JSON.stringify(result),
            "success",
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return toToolMessage(
            `Error: ${message}\n Please fix your mistakes.`,
            "error",
          );
        }
      },
    );

    // Returns undefined when the evaluator output cannot be parsed
    const evaluate = task(
      "evaluate",
      async (
        userQuery: string,
        messages: Array<BaseMessage>,
        answerText: string,
      ): Promise<Evaluation | undefined> => {
        console.log("Evaluating answer quality", { userQuery, answerText });

        const evaluationPrompt = [
          new SystemMessage(evaluatorPrompt),
          new HumanMessage(
            `User query: ${userQuery || "N/A"}\n\n` +
              `Retrieved context:\n${collectToolContext(messages)}\n\n` +
              `AI response: ${answerText}`,
          ),
        ];

        const evaluationResponse = await plainLlm.invoke(evaluationPrompt);
        const evaluationContent =
          evaluationResponse instanceof AIMessage
            ? evaluationResponse.content
            : "";

        try {
          const parsed = EvaluationSchema.safeParse(
            JSON.parse(extractJson(extractText(evaluationContent))),
          );
          return parsed.success ? parsed.data : undefined;
        } catch (e) {
          // If parsing fails, default to ending (conservative approach)
          console.warn(
            "Failed to parse evaluation response, defaulting to end",
            e,
          );
          return undefined;
        }
      },
    );

    const agent = entrypoint(
      { name: "agent" },
      async (input: AgentInput): Promise<string> => {
        let messages = input.messages;

        for (let retrieverRound = 0; ; retrieverRound++) {
          let response = await callModel(messages, retrieverRound);

          // Tool loop: run requested tools and call the model again, up to the round limit
          for (let toolRound = 0; ; toolRound++) {
            const toolCalls = toolCallsOf(response);
            if (toolCalls.length === 0) {
              break;
            }
            if (toolRound >= MAX_TOOL_ROUNDS) {
              console.warn(
                `Tool round limit (${MAX_TOOL_ROUNDS}) reached, forcing an answer`,
              );
              response = await forceAnswer(messages);
              break;
            }
            const results = await Promise.all(
              toolCalls.map((tc) => callTool(tc)),
            );
            messages = [...messages, response, ...results];
            response = await callModel(messages, retrieverRound);
          }
          messages = [...messages, response];

          const content = response instanceof AIMessage ? response.content : "";
          const answerText = extractText(content).trim();

          // Force end on the final allowed iteration
          if (retrieverRound >= MAX_RETRIEVER_ITERATIONS) {
            return answerText;
          }

          const evaluation = await evaluate(
            input.userQuery,
            messages,
            answerText,
          );
          const decision = evaluation?.quality === "poor" ? "retriever" : "end";
          console.log("Evaluator result:", decision, {
            decision,
            answer: answerText,
          });

          if (evaluation?.quality !== "poor") {
            return answerText;
          }
          messages = [
            ...messages,
            new HumanMessage("Evaluation result: " + evaluation.reason),
          ];
        }
      },
    );

    this.#invoker = async (
      query: ChatMessage,
      history: Array<ChatMessage>,
      signal?: AbortSignal,
    ): Promise<string> => {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const toLangchainMessage = (
        entry: ChatMessage,
      ): HumanMessage | AIMessage => {
        if (entry.role === "assistant") {
          return new AIMessage(entry.content);
        }
        if (entry.attachments !== undefined && entry.attachments.length > 0) {
          const content: Array<ContentBlock> = [
            { type: "text", text: entry.content },
            ...entry.attachments.map((a) => ({
              type: "image_url" as const,
              // eslint-disable-next-line @typescript-eslint/naming-convention
              image_url: { url: a.dataUrl },
            })),
          ];
          return new HumanMessage(content);
        }
        return new HumanMessage(entry.content);
      };

      const historyMessages: Array<HumanMessage | AIMessage> =
        history.map(toLangchainMessage);

      // The evaluator only sees text, so tell it about any attached images
      const attachmentCount = query.attachments?.length ?? 0;
      const userQuery =
        attachmentCount > 0
          ? `${query.content}\n[User attached ${attachmentCount} image(s)]`
          : query.content;

      const answer = await agent.invoke(
        {
          messages: [...historyMessages, toLangchainMessage(query)],
          userQuery,
        },
        { signal },
      );

      // Covers an abort that lands after the last task but before invoke resolves
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return answer;
    };
  }

  public invoke(
    query: ChatMessage,
    history: Array<ChatMessage>,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.#invoker(query, history, signal);
  }
}
