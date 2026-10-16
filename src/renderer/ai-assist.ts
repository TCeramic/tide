import { aiPrompt, parseAiResult, type AiInput, type AiResult } from "../core/ai-assist";
import { applyGeneratedTheme, updateCoverTheme } from "./generated-theme";

export function mountAiAssist(getInput: (task: "theme" | "segment") => AiInput, cover: () => string | undefined, apply: (result: AiResult) => void) {
  const element = document.createElement("details"); element.className = "ai-assist";
  const summary = document.createElement("summary"); summary.textContent = "主题与 AI 辅助";
  const body = document.createElement("div"); body.className = "ai-assist-body";
  const note = document.createElement("p"); note.className = "library-note"; note.textContent = "本地配色无需密钥；模型生成需要配置服务。";
  const actions = document.createElement("div"); actions.className = "ai-assist-actions";
  const input = document.createElement("textarea"); input.rows = 5; input.maxLength = 256000; input.setAttribute("aria-label", "AI 生成结果 JSON"); input.placeholder = "粘贴主题或分词 JSON";
  const local = button("生成封面配色", () => { const current = getInput("theme"); updateCoverTheme(`manual:${Date.now()}`, cover(), current.title); void window.tide.setAppearance({ background: "paper" }); note.textContent = "已生成本地配色，没有调用大模型"; });
  const copy = (task: "theme" | "segment") => async () => {
    const prompt = aiPrompt(getInput(task));
    try { await navigator.clipboard.writeText(prompt); note.textContent = "提示词已复制，模型返回 JSON 后粘贴到下方"; }
    catch { input.value = prompt; input.select(); note.textContent = "提示词已放入文本框，可手动复制"; }
  };
  let disposed = false, generation = 0;
  const commit = (result: AiResult) => {
    if (result.task === "theme") { applyGeneratedTheme(result.theme); void window.tide.setAppearance({ background: "paper" }); note.textContent = "模型配色已应用"; }
    else { apply(result); note.textContent = "分词已应用；没有原始逐词时间的行会明确标为估算"; }
  };
  const generate = (task: "theme" | "segment") => async () => {
    const token = ++generation, request = getInput(task); automaticTheme.disabled = automaticSegment.disabled = true;
    note.textContent = "正在生成…";
    try {
      const reply = await window.tide.aiGenerate(request);
      if (disposed || token !== generation) return;
      if (getInput(task).title !== request.title || JSON.stringify(getInput(task).lines) !== JSON.stringify(request.lines)) { note.textContent = "曲目已变化，旧结果未应用"; return; }
      if (reply.ok) commit(reply.result); else note.textContent = reply.message;
    } catch { note.textContent = "生成失败，请检查服务配置"; }
    finally { if (!disposed) void refreshStatus(); }
  };
  const automaticTheme = button("模型生成主题", generate("theme"));
  const automaticSegment = button("模型歌词分词", generate("segment"));
  automaticTheme.disabled = automaticSegment.disabled = true;
  const refreshStatus = async () => {
    try { const status = await window.tide.aiStatus(); if (disposed) return; automaticTheme.disabled = automaticSegment.disabled = !status.configured; element.dataset.configured = String(Boolean(status.configured)); }
    catch { /* A missing optional model service leaves manual tools usable. */ }
  };
  actions.append(local, button("复制主题提示词", copy("theme")), button("复制分词提示词", copy("segment")), automaticTheme, automaticSegment);
  const imports = document.createElement("div"); imports.className = "ai-assist-actions";
  for (const [task, label] of [["theme", "应用主题 JSON"], ["segment", "应用分词 JSON"]] as const) imports.append(button(label, () => {
    try { commit(parseAiResult(input.value, getInput(task))); } catch (error) { note.textContent = error instanceof Error ? error.message : "JSON 格式无效"; }
  }));
  body.append(note, actions, input, imports); element.append(summary, body);
  void refreshStatus();
  return { element, destroy() { disposed = true; generation++; } };
}
function button(text: string, action: () => void): HTMLButtonElement {
  const element = document.createElement("button"); element.type = "button"; element.className = "text-button"; element.textContent = text; element.addEventListener("click", action); return element;
}
