import { aiPrompt, parseAiResult, readAiInput, type AiReply, type AiStatus } from "../core/ai-assist";

export function createAiAssistant(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch) {
  const provider = env.TIDE_AI_PROVIDER === "gemini" ? "gemini" : "openai-compatible";
  const model = (env.TIDE_AI_MODEL ?? "").trim();
  const key = env.TIDE_AI_KEY ?? "";
  let endpoint: URL | null = null;
  try {
    const parsed = new URL(env.TIDE_AI_ENDPOINT ?? (provider === "gemini" ? "https://generativelanguage.googleapis.com/v1beta" : ""));
    if (!parsed.username && !parsed.password && !parsed.search && !parsed.hash && (parsed.protocol === "https:" || parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))) endpoint = parsed;
  } catch { /* Empty configuration is the normal first launch. */ }
  const local = endpoint && ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname);
  const status: AiStatus = { configured: Boolean(endpoint && model && (key || local)), provider, model };
  let busy = false;
  return {
    status: () => ({ ...status }),
    async generate(value: unknown): Promise<AiReply> {
      if (!status.configured || !endpoint) return { ok: false, message: "模型尚未配置，可先使用本地配色或复制提示词" };
      if (busy) return { ok: false, message: "已有生成任务，请稍后" };
      busy = true;
      try {
        const input = readAiInput(value), prompt = aiPrompt(input);
        const url = new URL(endpoint);
        url.pathname = provider === "gemini" ? `${url.pathname.replace(/\/$/, "")}/models/${encodeURIComponent(model)}:generateContent` : /\/chat\/completions\/?$/.test(url.pathname) ? url.pathname : `${url.pathname.replace(/\/$/, "")}/chat/completions`;
        const response = await fetcher(url, {
          method: "POST", signal: AbortSignal.timeout(45000), headers: { "Content-Type": "application/json", ...(key ? provider === "gemini" ? { "x-goog-api-key": key } : { Authorization: `Bearer ${key}` } : {}) },
          body: JSON.stringify(provider === "gemini" ? { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } } : { model, messages: [{ role: "user", content: prompt }], temperature: 0.5, max_tokens: 4096, response_format: { type: "json_object" } }),
        });
        if (!response.ok) return { ok: false, message: `模型服务返回 HTTP ${response.status}` };
        const reader = response.body?.getReader(); if (!reader) throw new Error("模型服务没有响应正文");
        const parts: Uint8Array[] = []; let bytes = 0;
        for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 256000) { await reader.cancel(); throw new Error("模型响应过长"); } parts.push(part.value); }
        const data = JSON.parse(Buffer.concat(parts).toString("utf8"));
        const content = provider === "gemini" ? data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("") : data.choices?.[0]?.message?.content;
        if (typeof content !== "string") throw new Error("模型返回格式无效");
        return { ok: true, result: parseAiResult(content, input) };
      } catch {
        // Never expose provider URLs, response bodies, request headers or keys.
        return { ok: false, message: "生成失败、超时或结果格式无效，请检查模型配置" };
      } finally { busy = false; }
    },
  };
}
