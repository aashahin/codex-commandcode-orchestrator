import { efforts } from "./config";
export interface CatalogEntry {
  id: string;
  name: string;
  context?: string;
  efforts: string[];
  minPlan?: string;
  vision: boolean;
  bestFor?: string;
}
const entry = (
  id: string,
  name: string,
  efforts: string[],
  minPlan: string,
  vision: boolean,
  context?: string,
  bestFor?: string,
): CatalogEntry => ({ id, name, efforts, minPlan, vision, context, bestFor });
export const catalog: CatalogEntry[] = [
  entry("deepseek/deepseek-v4-pro", "DeepSeek V4 Pro", ["high", "max"], "Go", false, "1M", "hybrid-attention long-context reasoning"),
  entry("deepseek/deepseek-v4-flash", "DeepSeek V4 Flash", ["high", "max"], "Go", false, "1M", "fast hybrid-attention reasoning"),
  entry("deepseek/deepseek-v4-flash-vision-exp", "DeepSeek V4 Flash Vision", ["high", "max"], "Go", true, "1M", "fast reasoning with vision"),
  entry("deepseek/deepseek-v4-flash-fast", "DeepSeek V4 Flash Fast", ["low", "high", "max"], "Go", false, "1M", "low-latency V4 Flash"),
  entry("deepseek/deepseek-v4.1-flash", "DeepSeek V4.1 Flash", ["low", "high", "max"], "Go", true, "1M", "V4.1 reasoning with vision"),
  entry("moonshotai/Kimi-K3", "Kimi K3", ["low", "high", "max"], "Go", false, "1M", "long-horizon coding and knowledge work"),
  entry("moonshotai/Kimi-K2.7-Code", "Kimi K2.7 Code", [], "Go", true, "256K", "long-horizon coding with vision"),
  entry("moonshotai/Kimi-K2.7-Code-Highspeed", "Kimi K2.7 Code HighSpeed", [], "Go", true, "262K", "high-speed long-horizon coding"),
  entry("moonshotai/Kimi-K2.6", "Kimi K2.6", [], "Go", true, "256K", "long-horizon coding with vision"),
  entry("moonshotai/Kimi-K2.5", "Kimi K2.5", [], "Go", true, "256K", "multimodal frontend coding"),
  entry("z-ai/glm-5.3-flash", "GLM-5.3 Flash", ["low", "high", "max"], "Go", false, "1.05M", "fast affordable GLM coding"),
  entry("z-ai/glm-5.3-flashx", "GLM-5.3 FlashX", ["low", "high", "max"], "Go", false, "1M", "high-speed GLM-5.3 Flash"),
  entry("zai-org/GLM-5.3", "GLM-5.3", ["low", "high", "max"], "Go", false, "1M", "frontier coding"),
  entry("zai-org/GLM-5.2", "GLM-5.2", ["high", "max"], "Go", false, "1M", "powerful coding at 1M context"),
  entry("zai-org/GLM-5.2-Fast", "GLM-5.2 Fast", [], "Go", false, "1M", "high-throughput GLM-5.2"),
  entry("zai-org/GLM-5.1", "GLM-5.1", [], "Go", false, undefined, "long-horizon autonomous coding"),
  entry("zai-org/GLM-5", "GLM-5", [], "Go", false, "200K", "multi-mode thinking and planning"),
  entry("MiniMaxAI/MiniMax-M3", "MiniMax M3", ["low", "medium", "high"], "Go", false, "1M", "frontier coding, agents, multimodality"),
  entry("MiniMaxAI/MiniMax-M2.7", "MiniMax M2.7", [], "Go", false, undefined, "end-to-end software engineering agent"),
  entry("MiniMaxAI/MiniMax-M2.5", "MiniMax M2.5", [], "Go", false, "200K", "cross-platform full-stack agentic dev"),
  entry("xiaomi/mimo-v2.5-pro", "MiMo V2.5 Pro", [], "Go", false, "1M", "high-capability long-context agentic coding"),
  entry("xiaomi/mimo-v2.5", "MiMo V2.5", [], "Go", false, "1M", "efficient long-context agentic coding"),
  entry("Qwen/Qwen3.8-Omni-Flash", "Qwen 3.8 Omni Flash", ["low", "medium", "xhigh"], "Go", true, "1M", "omni-modal understanding"),
  entry("Qwen/Qwen3.8-Max-0902", "Qwen 3.8 Max 0902", ["low", "medium", "xhigh"], "Go", false, "1M", "stronger coding and agentic tool use"),
  entry("Qwen/Qwen3.8-Max", "Qwen 3.8 Max", ["low", "medium", "xhigh"], "Go", false, "1M", "autonomous long-horizon coding"),
  entry("Qwen/Qwen3.8-27B", "Qwen 3.8 27B", ["low", "medium", "xhigh"], "Go", true, "262K", "compact vision-language coding"),
  entry("Qwen/Qwen3.8-Flash", "Qwen 3.8 Flash", ["low", "medium", "xhigh"], "Go", false, "1M", "fast low-cost agentic coding"),
  entry("Qwen/Qwen3.7-Max", "Qwen 3.7 Max", [], "Go", false, "1M", "frontier coding and agent execution"),
  entry("Qwen/Qwen3.7-Plus", "Qwen 3.7 Plus", [], "Go", false, "1M", "agentic coding at lower cost"),
  entry("Qwen/Qwen3.7-Flash", "Qwen 3.7 Flash", [], "Go", false, "1M", "fast low-cost agentic coding"),
  entry("Qwen/Qwen3.6-Max-Preview", "Qwen 3.6 Max Preview", [], "Go", false, undefined, "vibe coding and agent execution"),
  entry("Qwen/Qwen3.6-Plus", "Qwen 3.6 Plus", [], "Go", false, undefined, "agentic coding and reasoning"),
  entry("meituan/LongCat-2.0", "LongCat 2.0", [], "Go", false, "1.05M", "trillion-parameter agentic coding"),
  entry("stepfun/Step-3.7-Flash", "Step 3.7 Flash", [], "Go", true, "256K", "multimodal sparse-MoE reasoning"),
  entry("stepfun/Step-3.5-Flash", "Step 3.5 Flash", [], "Go", false, "1M", "fast sparse-MoE agentic reasoning"),
  entry("tencent/hy3-paid", "Tencent Hy3", [], "Go", false, "262K", "sparse-MoE reasoning and tool use"),
  entry("tencent/hy4-preview", "Tencent Hy4 Preview", ["low", "medium", "high"], "Go", false, "1.05M", "sustained multi-step tool use"),
  entry("nvidia/nemotron-3-ultra-550b-a55b", "Nemotron 3 Ultra", [], "Go", false, "1M", "long-horizon autonomous agents"),
  entry("thinkingmachines/inkling", "Inkling", [], "Go", true, "256K", "multimodal MoE reasoning"),
  entry("thinkingmachines/inkling-small", "Inkling Small", [], "Go", false, "1M", "lightweight MoE reasoning"),
  entry("poolside/laguna-s-2.1-free", "Laguna S 2.1", [], "Go", false, "256K", "open-weight agentic coding"),
  entry("inclusionai/ling-3.0-flash-sante:free", "Ling 3.0 Flash Sante", [], "Go", false, "262K", "health and medicine tuned, strong on code"),
  entry("claude-sonnet-5", "Claude Sonnet 5", ["low", "medium", "high", "xhigh", "max"], "Pro", false, "1M", "best combo of speed and intelligence"),
  entry("claude-sonnet-4-6", "Claude Sonnet 4.6", ["low", "medium", "high", "xhigh", "max"], "Pro", false, "1M", "fast and capable Sonnet"),
  entry("claude-fable-5-1", "Claude Fable 5.1", ["low", "medium", "high", "xhigh", "max"], "Max", false, "1M", "most capable for long-horizon agents"),
  entry("claude-fable-5", "Claude Fable 5", ["low", "medium", "high", "xhigh", "max"], "Max", false, "1M", "deep reasoning and agents"),
  entry("claude-opus-5", "Claude Opus 5", ["low", "medium", "high", "xhigh", "max"], "Max", false, "1M", "most intelligent Opus for agents"),
  entry("claude-opus-4-8", "Claude Opus 4.8", ["low", "medium", "high", "xhigh", "max"], "Max", false, "1M", "strong Opus for agents and coding"),
  entry("claude-opus-4-7", "Claude Opus 4.7", ["low", "medium", "high", "xhigh", "max"], "Max", false, "1M", "older Opus for agents and coding"),
  entry("claude-haiku-4-5-20251001", "Claude Haiku 4.5", [], "Pro", false, "200K", "fastest and most compact"),
  entry("gpt-6-astra", "GPT-6 Astra", ["low", "medium", "high", "xhigh", "max"], "Max", false, "1.05M", "most capable OpenAI model for agents"),
  entry("gpt-5.6-sol", "GPT-5.6 Sol", ["low", "medium", "high", "xhigh", "max"], "GOAT", false, "1.05M", "frontier model for complex work"),
  entry("gpt-5.6-terra", "GPT-5.6 Terra", ["low", "medium", "high", "xhigh", "max"], "Pro", false, "1.05M", "balances intelligence and cost"),
  entry("gpt-5.6-luna", "GPT-5.6 Luna", ["low", "medium", "high", "xhigh", "max"], "Go", false, "1.05M", "cost-sensitive workloads"),
  entry("gpt-5.5", "GPT-5.5", ["low", "medium", "high", "xhigh"], "Pro", false, "400K", "frontier model for general complex work"),
  entry("gpt-5.4", "GPT-5.4", ["low", "medium", "high", "xhigh"], "Pro", false, "400K", "frontier model for general complex work"),
  entry("gpt-5.3-codex", "GPT-5.3 Codex", ["low", "medium", "high", "xhigh"], "Pro", false, "400K", "frontier coding model"),
  entry("gpt-5.4-mini", "GPT-5.4 Mini", ["low", "medium", "high"], "Pro", false, "400K", "fast, cost-effective everyday tasks"),
  entry("google/gemini-3.8-flash", "Gemini 3.8 Flash", ["low", "medium", "high"], "GOAT", false, "1M", "improved core reasoning"),
  entry("google/gemini-3.7-flash", "Gemini 3.7 Flash", ["low", "medium", "high"], "GOAT", false, "1.05M", "higher-quality coding and agentic work"),
  entry("google/gemini-3.6-flash", "Gemini 3.6 Flash", ["low", "medium", "high"], "Pro", false, "1M", "fast and capable Flash"),
  entry("google/gemini-3.5-flash", "Gemini 3.5 Flash", ["low", "medium", "high"], "Pro", false, "1M", "Pro-level coding proficiency"),
  entry("google/gemini-3.5-flash-lite", "Gemini 3.5 Flash Lite", ["low", "medium", "high"], "Pro", false, "1M", "ideal for subagents"),
  entry("google/gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite", ["low", "medium", "high"], "Pro", false, "1M", "high-volume workhorse"),
  entry("sakana/fugu-ultra", "Fugu Ultra", ["high", "xhigh"], "Max", false, "1M", "multi-agent orchestration"),
  entry("meta/muse-spark-1.1", "Muse Spark 1.1", ["low", "medium", "high", "xhigh"], "Pro", false, "1.05M", "agentic performance and tool use"),
  entry("meta/muse-spark-1.2", "Muse Spark 1.2", ["low", "medium", "high", "xhigh"], "GOAT", false, "1.05M", "coding-optimized for large codebases"),
  entry("meta/muse-spark-1.2-contributor", "Muse Spark 1.2 Contributor", ["low", "medium", "high", "xhigh"], "Go", false, "1.05M", "Muse Spark 1.2 at about 95% off"),
  entry("meta/muse-spark-1.3", "Muse Spark 1.3", ["low", "medium", "high", "xhigh", "max"], "GOAT", false, "1.05M", "multimodal long-horizon agentic work"),
  entry("meta/muse-spark-1.3-contributor", "Muse Spark 1.3 Contributor", ["low", "medium", "high", "xhigh"], "Go", false, "1.05M", "Muse Spark 1.3 at up to 95% off"),
  entry("xai/grok-4.5", "Grok 4.5", ["low", "medium", "high"], "Go", false, "500K", "coding, agentic tasks, knowledge work"),
  entry("xai/grok-4.6", "Grok 4.6", ["low", "medium", "high", "xhigh"], "GOAT", false, "500K", "frontier coding and STEM"),
];
export function catalogEntry(id: string) {
  return catalog.find((e) => e.id === id);
}
export function parseModel(value: string) {
  const index = value.lastIndexOf(":");
  if (index > 0) {
    const suffix = value.slice(index + 1);
    if ((efforts as readonly string[]).includes(suffix))
      return { id: value.slice(0, index), effort: suffix };
  }
  return { id: value, effort: undefined as string | undefined };
}
export function validate(model: string, effort?: string) {
  if (!/^[A-Za-z0-9._:@/-]+$/.test(model))
    throw Error("Invalid model id");
  const parsed = parseModel(model);
  const selected = effort ?? parsed.effort;
  if (selected && parsed.effort && selected !== parsed.effort)
    throw Error(
      `Conflicting effort: model requests ${parsed.effort} but effort is ${selected}`,
    );
  const known = catalogEntry(parsed.id);
  if (!known)
    return { id: parsed.id, effort: selected, known: false as const };
  if (selected && !known.efforts.includes(selected))
    throw Error(
      `Model ${parsed.id} does not advertise effort ${selected}. Advertised: ${known.efforts.length ? known.efforts.join(", ") : "none"}`,
    );
  return { id: parsed.id, effort: selected, known: true as const };
}
