// src/guardrails/domain.guardrail.ts
import { Agent, run, type InputGuardrailFunctionArgs } from "@openai/agents";
import { z } from "zod";

/**
 * Domain-check agent: returns whether the query is recruitment-related.
 */
const domainCheckAgent = new Agent({
  name: "Recruitment Domain Guardrail",
  instructions: `
You check whether the user query is related strictly to recruitment.

Allowed topics:
- Login / registration
- Resume upload
- Resume analysis
- Resume advice
- Job eligibility
- Job matching
- Candidate / recruiter workflows

Reject:
- Programming questions
- General knowledge
- Math
- Jokes
- Any unrelated topic

Be strict.
`,
  outputType: z.object({
    isRecruitmentQuery: z.boolean(),
    reason: z.string().optional()
  })
});

/**
 * Utility: normalizes various input shapes into plain text.
 * Agents SDK may pass:
 * - a raw string,
 * - an array of chat/message objects,
 * - a single message object, etc.
 */
function normalizeInputToString(argsInput: unknown): string {
  // plain string
  if (typeof argsInput === "string") return argsInput;

  // array (e.g., message history)
  if (Array.isArray(argsInput)) {
    return argsInput
      .map((item) => {
        // item might be a string or an object like { role, content }
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          // content can be string or structured
          const content = (item as any).content;
          if (typeof content === "string") return content;
          // content might be input_text shape { text: string }
          if (content && typeof content === "object") {
            return content.text ?? "";
          }
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }

  // single object with content
  if (argsInput && typeof argsInput === "object") {
    const content = (argsInput as any).content;
    if (typeof content === "string") return content;
    if (content && typeof content === "object") return content.text ?? "";
    // fallback: stringify
    return JSON.stringify(argsInput);
  }

  // fallback
  return String(argsInput ?? "");
}

/**
 * The guardrail object compatible with agents' InputGuardrail type.
 * Note: `execute` accepts the SDK arg shape; we normalize and then run the domainCheckAgent.
 */
export const recruitmentInputGuardrail = {
  name: "Recruitment Scope Guardrail",
  async execute(args: InputGuardrailFunctionArgs<unknown>) {
    // Normalize to plain text before sending to the domain-check agent
    const inputText = normalizeInputToString(args.input);

    // Run the domain check agent on the normalized string
    const result = await run(domainCheckAgent, inputText);

    return {
      outputInfo: result.finalOutput?.reason,
      tripwireTriggered: !result.finalOutput?.isRecruitmentQuery
    };
  }
};