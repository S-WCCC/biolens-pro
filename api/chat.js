// /pages/api/chat.js
// Next.js Pages Router API Route (Vercel Serverless)
// DeepSeek OpenAI-compatible API via fetch
// Env: DEEPSEEK_API_KEY (required), DEEPSEEK_MODEL (optional, default deepseek-chat)

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

// ========== Prompts ==========
const SYSTEM_PROMPT_ANSWER = `
你是一个专业、简洁的生物结构可视化助手。用户会问问题，请直接用自然语言回答。
`.trim();

const SYSTEM_PROMPT_COMMAND = `
你是一个“Mol* PDB 可视化指令编译器”。你的唯一任务：把用户的自然语言，翻译成【前端可直接执行】的单个 JSON 对象。
你只能输出【纯 JSON】（只输出一个 JSON 对象），不要输出任何解释、Markdown、代码围栏、额外文字。
顶层结构固定为：{"action":"<string>","params":{...}}
（此处放你完整的白名单协议与示例）
`.trim();

// ========== Helpers ==========
function jsonStringFallback(reason) {
  // 给 command 模式兜底：保证前端 JSON.parse(data.result) 不崩
  return JSON.stringify({ action: "noop", params: { reason } });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      mode: "command",
      raw: "",
      result: jsonStringFallback("Method Not Allowed"),
      error: "Method Not Allowed",
    });
  }

  try {
    const { message, mode } = req.body || {};
    const userText = typeof message === "string" ? message.trim() : "";

    if (!userText) {
      return res.status(400).json({
        mode: mode || "command",
        raw: "",
        result: jsonStringFallback("Invalid request: message must be a non-empty string"),
        error: "Invalid request",
      });
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return res.status(200).json({
        mode: mode || "command",
        raw: "",
        result: jsonStringFallback("Server misconfigured: missing DEEPSEEK_API_KEY"),
        error: "Server misconfigured: missing DEEPSEEK_API_KEY",
      });
    }

    const resolvedMode = mode === "answer" ? "answer" : "command";
    const systemPrompt =
      resolvedMode === "answer" ? SYSTEM_PROMPT_ANSWER : SYSTEM_PROMPT_COMMAND;

    const response = await fetch(DEEPSEEK_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText },
        ],
        stream: false,
        temperature: resolvedMode === "answer" ? 0.7 : 0,
        top_p: 1,
        max_tokens: 1200,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return res.status(200).json({
        mode: resolvedMode,
        raw: "",
        result: jsonStringFallback(`DeepSeek API failed: HTTP ${response.status}`),
        details: errText.slice(0, 1200),
        error: `DeepSeek API failed: HTTP ${response.status}`,
      });
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? "";

    // answer：raw 直接给自然语言；result 也给同样内容，方便前端统一处理
    if (resolvedMode === "answer") {
      return res.status(200).json({
        mode: "answer",
        raw: content,
        result: content,
        model: MODEL,
      });
    }

    // command：要求 content 本身就是 JSON 字符串
    return res.status(200).json({
      mode: "command",
      raw: content,     // 可选：方便调试
      result: content,  // 前端 JSON.parse(data.result)
      model: MODEL,
    });
  } catch (err) {
    return res.status(200).json({
      mode: "command",
      raw: "",
      result: jsonStringFallback(`Internal Server Error: ${String(err?.message || err)}`),
      error: String(err?.message || err),
    });
  }
}
