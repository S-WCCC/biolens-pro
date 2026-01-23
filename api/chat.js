// /pages/api/chat.js
// Next.js Pages Router API Route (Vercel Serverless / Node.js runtime)
// DeepSeek OpenAI-compatible API via fetch
// Env: DEEPSEEK_API_KEY (required), DEEPSEEK_MODEL (optional, default deepseek-chat)

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

// =========================
// 1) Prompts
// =========================
const SYSTEM_PROMPT_ANSWER = `
你是一个专业、简洁的生物结构可视化助手。用户会问问题，请直接用自然语言回答。回答要清晰、准确、不过度发散。
`.trim();

/**
 * 重要：这里的协议必须与前端 executeCommand() 的白名单一致
 * 你前端目前能识别：
 * reset_colors, color, set_representation, hide, show, set_opacity,
 * focus, reset_camera, spin, highlight, label, measure_distance,
 * batch, clarify, noop
 *
 * 同时：target 的 schema 也要与前端 buildOverlayFromTarget / focusTarget / measureDistance 一致。
 */
const SYSTEM_PROMPT_COMMAND = `
你是一个“Mol* PDB 可视化指令编译器”。你的唯一任务：把用户的自然语言指令，翻译成【前端可直接执行】的单个 JSON 对象。

############################
# 0) 最高优先级硬规则（必须遵守）
############################
- 你只能输出【纯 JSON】（只输出一个 JSON 对象），不要输出任何解释、Markdown、代码围栏、额外文字。
- JSON 必须能被 JSON.parse 直接解析：
  - 使用双引号
  - 不允许尾随逗号
  - 不允许注释
- 顶层结构固定为：
  {"action":"<string>","params":{...}}
- 顶层只允许 action 与 params 两个键；params 必须是对象（即使为空也写 {}）。

############################
# 1) Action 白名单（只能从这里选，区分大小写）
############################
你输出的 action 必须严格等于以下之一：
1. "reset_colors"
2. "color"
3. "set_representation"
4. "hide"
5. "show"
6. "set_opacity"
7. "focus"
8. "reset_camera"
9. "spin"
10. "highlight"
11. "label"
12. "measure_distance"
13. "batch"
14. "clarify"
15. "noop"

############################
# 2) target 统一规范（非常重要）
############################
所有需要“选中目标”的 action，都用 params.target 描述目标，target 只能包含这些字段：

target = {
  "type": "residue" | "range" | "chain" | "ligand" | "protein" | "polymer" | "all",
  "chain": "A",
  "resId": 100,
  "startResId": 10,
  "endResId": 50,
  "resName": "ATP"
}

约束：
- chain 优先大写字母，例如 "A"
- resId/startResId/endResId 必须是整数
- ligand 的 resName 必须是大写（如 ATP/HEM）
- 如果用户没有给出足够信息（例如说“把某个残基变红”但没给编号/链），必须输出 action="clarify"。

############################
# 3) 参数规范（按 action）
############################
A) action="color"
params = {
  "target": <target>,
  "color": "#RRGGBB"
}

B) action="set_representation"
params = {
  "rep": "cartoon"|"surface"|"sticks"|"lines"|"spheres",
  "quality": "auto"|"low"|"medium"|"high"
}

C) action="show" / action="hide"
params = { "what": "water"|"ligand" }
（注意：前端目前只支持 water/ligand）

D) action="set_opacity"
params = { "target": <target>, "opacity": 0.0~1.0 }

E) action="focus"
params = { "target": <target> }

F) action="reset_camera"
params = {}

G) action="spin"
params = { "enabled": true|false, "speed": 1.0 }

H) action="highlight"
params = { "target": <target> }

I) action="label"
params = { "target": <target>, "enabled": true|false, "text": "optional" }
（注意：前端 label 可能降级为高亮）

J) action="measure_distance"
params = {
  "a": <target>,
  "b": <target>,
  "unit": "angstrom"
}
（注意：前端当前仅支持 residue-residue（按 CA）距离）

K) action="batch"
params = { "commands": [ {"action":"...","params":{...}}, ... ] }

L) action="clarify"
params = { "question": "一句话问清缺失信息", "options": ["可选项1","可选项2"] }

M) action="noop"
params = { "reason": "简短原因" }

############################
# 4) 颜色词映射（你必须输出十六进制）
############################
红 red -> #ff0000
蓝 blue -> #0000ff
绿 green -> #00ff00
黄 yellow -> #ffff00
白 white -> #ffffff
黑 black -> #000000
灰 gray/grey -> #808080
橙 orange -> #ff7f00
紫 purple/violet -> #8000ff

############################
# 5) 现在开始处理真实用户输入
############################
`.trim();

// =========================
// 2) Helpers: safe JSON extraction & normalization
// =========================
function jsonStringFallback(reason) {
  return JSON.stringify({ action: "noop", params: { reason: String(reason || "noop") } });
}

function isPlainObject(x) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

function normalizeChain(c) {
  if (c == null) return undefined;
  const s = String(c).trim();
  if (!s) return undefined;
  return s.length === 1 ? s.toUpperCase() : s.toUpperCase(); // 保守处理：全大写
}

const COLOR_WORD_MAP = new Map([
  ["red", "#ff0000"], ["红", "#ff0000"], ["红色", "#ff0000"],
  ["blue", "#0000ff"], ["蓝", "#0000ff"], ["蓝色", "#0000ff"],
  ["green", "#00ff00"], ["绿", "#00ff00"], ["绿色", "#00ff00"],
  ["yellow", "#ffff00"], ["黄", "#ffff00"], ["黄色", "#ffff00"],
  ["white", "#ffffff"], ["白", "#ffffff"], ["白色", "#ffffff"],
  ["black", "#000000"], ["黑", "#000000"], ["黑色", "#000000"],
  ["gray", "#808080"], ["grey", "#808080"], ["灰", "#808080"], ["灰色", "#808080"],
  ["orange", "#ff7f00"], ["橙", "#ff7f00"], ["橙色", "#ff7f00"],
  ["purple", "#8000ff"], ["violet", "#8000ff"], ["紫", "#8000ff"], ["紫色", "#8000ff"],
]);

function toHexColor(c) {
  if (typeof c !== "string") return undefined;
  const s = c.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  const key = s.toLowerCase();
  if (COLOR_WORD_MAP.has(key)) return COLOR_WORD_MAP.get(key);
  // 中文可能不走 toLowerCase
  if (COLOR_WORD_MAP.has(s)) return COLOR_WORD_MAP.get(s);
  return undefined;
}

function repNormalize(rep) {
  if (rep == null) return undefined;
  const s = String(rep).trim().toLowerCase();
  // 允许输入更自由的描述，归一到前端白名单
  if (["cartoon", "ribbon"].includes(s)) return "cartoon";
  if (["surface"].includes(s)) return "surface";
  if (["sticks", "stick", "ball-and-stick", "ball_and_stick", "bns"].includes(s)) return "sticks";
  if (["lines", "line", "wire"].includes(s)) return "lines";
  if (["spheres", "sphere", "spacefill", "vdw"].includes(s)) return "spheres";
  return undefined;
}

function whatNormalize(what) {
  if (what == null) return undefined;
  const s = String(what).trim().toLowerCase();
  if (["water", "solvent", "hoh", "wat"].includes(s) || ["水", "水分子"].includes(what)) return "water";
  if (["ligand", "drug", "het"].includes(s) || ["配体", "药", "药物"].includes(what)) return "ligand";
  return undefined;
}

/**
 * 从文本中提取“第一个完整 JSON 对象”
 * - 支持 ```json ...``` 围栏
 * - 支持前后夹杂文字
 * - 使用“括号深度 + 字符串状态机”保证不会被字符串内的 { } 干扰
 */
function extractFirstJsonObject(text = "") {
  const s = String(text);

  // 1) fenced ```json ... ```
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) return fenced[1].trim();

  // 2) scan for first balanced {...}
  let start = -1;
  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = false;
      }
      continue;
    } else {
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === "{") {
        if (start === -1) start = i;
        depth += 1;
        continue;
      }
      if (ch === "}") {
        if (start !== -1) {
          depth -= 1;
          if (depth === 0) {
            return s.slice(start, i + 1).trim();
          }
        }
      }
    }
  }

  // 3) fallback
  return s.trim();
}

function safeJsonParse(maybeJson) {
  try {
    return JSON.parse(maybeJson);
  } catch {
    return null;
  }
}

// ---------- Action whitelist strictly aligned with executeCommand ----------
const ACTION_WHITELIST = new Set([
  "reset_colors",
  "color",
  "set_representation",
  "hide",
  "show",
  "set_opacity",
  "focus",
  "reset_camera",
  "spin",
  "highlight",
  "label",
  "measure_distance",
  "batch",
  "clarify",
  "noop",
]);

/**
 * 将 DeepSeek 的“非标准 action/params”归一化为前端可执行格式
 * 解决：color_residue / residue_number / chainId / color="red" 等各种变体
 */
function normalizeCommandObject(obj) {
  if (!isPlainObject(obj)) {
    return { action: "noop", params: { reason: "Invalid JSON object from model." } };
  }

  // 1) get action
  let action = obj.action;
  if (typeof action !== "string") {
    // 允许一些常见变体字段
    action = obj.cmd || obj.command || obj.type;
  }
  action = typeof action === "string" ? action.trim() : "";

  // 2) map common non-standard actions to standard
  const aLower = action.toLowerCase();

  const actionMap = new Map([
    ["color_residue", "color"],
    ["color_chain", "color"],
    ["set_color", "color"],
    ["setcolour", "color"],
    ["set_color_residue", "color"],
    ["set_color_chain", "color"],

    ["focus_ligand", "focus"],
    ["focus_residue", "focus"],
    ["focus_chain", "focus"],
    ["reset_view", "reset_camera"],
    ["resetcamera", "reset_camera"],

    ["show_ligand", "show"],
    ["hide_ligand", "hide"],
    ["show_water", "show"],
    ["hide_water", "hide"],

    ["opacity", "set_opacity"],
    ["set_transparency", "set_opacity"],
    ["transparency", "set_opacity"],
    ["set_opacity_residue", "set_opacity"],

    ["representation", "set_representation"],
    ["set_rep", "set_representation"],

    ["distance", "measure_distance"],
    ["measure", "measure_distance"],
    ["measure_distance_ca", "measure_distance"],

    ["highlight_residue", "highlight"],
    ["highlight_chain", "highlight"],

    ["label_residue", "label"],
    ["label_chain", "label"],

    ["reset_colors", "reset_colors"],
    ["clear_colors", "reset_colors"],
  ]);

  if (!ACTION_WHITELIST.has(action)) {
    if (actionMap.has(aLower)) action = actionMap.get(aLower);
  }

  // 3) params
  let params = obj.params;
  if (!isPlainObject(params)) params = {};

  // 某些模型会把字段直接放顶层：把它们合并进 params
  const topLevelCarry = ["chain", "chainId", "resId", "residue_number", "start", "end", "startResId", "endResId", "resName", "ligand", "color", "opacity", "enabled", "speed", "what", "rep", "quality", "a", "b", "unit", "commands"];
  for (const k of topLevelCarry) {
    if (obj[k] !== undefined && params[k] === undefined) params[k] = obj[k];
  }

  // 4) normalize by action
  switch (action) {
    case "batch": {
      const cmds = Array.isArray(params.commands) ? params.commands : Array.isArray(params.cmds) ? params.cmds : null;
      if (!cmds || !cmds.length) {
        return { action: "noop", params: { reason: "batch.commands is empty." } };
      }
      const normalized = [];
      for (const c of cmds) normalized.push(normalizeCommandObject(c));
      return { action: "batch", params: { commands: normalized } };
    }

    case "show":
    case "hide": {
      // allow derived forms: show_ligand etc.
      let what = params.what;
      if (!what) {
        if (aLower.includes("ligand")) what = "ligand";
        if (aLower.includes("water")) what = "water";
      }
      what = whatNormalize(what);
      if (!what) {
        return {
          action: "clarify",
          params: { question: `${action} 缺少 what（water/ligand）`, options: ["water", "ligand"] },
        };
      }
      return { action, params: { what } };
    }

    case "spin": {
      const enabled = params.enabled !== undefined ? !!params.enabled : (aLower.includes("on") ? true : aLower.includes("off") ? false : true);
      const speed = Number(params.speed ?? 1.0);
      return { action: "spin", params: { enabled, speed: Number.isFinite(speed) ? speed : 1.0 } };
    }

    case "reset_camera":
    case "reset_colors": {
      return { action, params: {} };
    }

    case "set_representation": {
      const rep = repNormalize(params.rep);
      const qualityRaw = params.quality ? String(params.quality).toLowerCase() : "auto";
      const quality = ["auto", "low", "medium", "high"].includes(qualityRaw) ? qualityRaw : "auto";
      if (!rep) {
        return {
          action: "clarify",
          params: { question: "set_representation 缺少或不支持 rep", options: ["cartoon", "surface", "sticks", "lines", "spheres"] },
        };
      }
      return { action: "set_representation", params: { rep, quality } };
    }

    case "set_opacity": {
      const opacity = clamp01(params.opacity);
      const target = normalizeTarget(params.target, params);
      if (!target) {
        return {
          action: "clarify",
          params: { question: "set_opacity 需要明确 target（链/残基/范围/配体/整体）", options: ["chain", "residue", "range", "ligand", "all"] },
        };
      }
      return { action: "set_opacity", params: { target, opacity } };
    }

    case "focus":
    case "highlight":
    case "label":
    case "color": {
      const target = normalizeTarget(params.target, params);

      if (!target) {
        return {
          action: "clarify",
          params: { question: `${action} 需要明确 target（链/残基/范围/配体/整体）`, options: ["chain", "residue", "range", "ligand", "all"] },
        };
      }

      if (action === "label") {
        const enabled = params.enabled !== undefined ? !!params.enabled : true;
        const text = params.text !== undefined ? String(params.text) : undefined;
        const out = { action: "label", params: { target, enabled } };
        if (text) out.params.text = text;
        return out;
      }

      if (action === "color") {
        const color = toHexColor(params.color);
        if (!color) {
          return {
            action: "clarify",
            params: { question: "color 缺少或不支持的颜色（必须是 #RRGGBB 或常见颜色词）", options: ["#ff0000", "#0000ff", "#00ff00", "#ffff00"] },
          };
        }
        return { action: "color", params: { target, color } };
      }

      // focus/highlight
      return { action, params: { target } };
    }

    case "measure_distance": {
      // 支持多种变体：a/b 可能是 {chain,resId} 或直接 a_chain/a_resId
      const a = normalizeTarget(params.a, params, "a");
      const b = normalizeTarget(params.b, params, "b");

      if (!a || !b) {
        return {
          action: "clarify",
          params: {
            question: "measure_distance 需要两个 residue 目标（a/b），例如：A链10 与 A链25",
            options: ["a: {type:'residue',chain:'A',resId:10}", "b: {type:'residue',chain:'A',resId:25}"],
          },
        };
      }

      // 前端当前只支持 residue-residue（CA）
      if (a.type !== "residue" || b.type !== "residue") {
        return { action: "noop", params: { reason: "measure_distance 目前仅支持 residue-residue（按 CA）。" } };
      }

      return { action: "measure_distance", params: { a, b, unit: "angstrom" } };
    }

    case "clarify": {
      const question = params.question ? String(params.question) : "需要更多信息。";
      const options = Array.isArray(params.options) ? params.options.map(String) : [];
      return { action: "clarify", params: { question, options } };
    }

    case "noop": {
      const reason = params.reason ? String(params.reason) : "noop";
      return { action: "noop", params: { reason } };
    }

    default: {
      // action 不在白名单 → 尝试兜底
      return { action: "noop", params: { reason: `Unsupported action from model: ${action || "(empty)"}` } };
    }
  }
}

/**
 * target 归一化：
 * - 优先使用 params.target（若存在且结构正确）
 * - 否则从 params 的常见字段拼装：chain/chainId + resId/residue_number/start/end/resName/ligand 等
 * - 支持 a/b 前缀字段：a_chain, a_resId, a_residue_number 等
 */
function normalizeTarget(targetMaybe, params, prefix = "") {
  // 1) if provided as object and looks like target
  if (isPlainObject(targetMaybe) && typeof targetMaybe.type === "string") {
    return sanitizeTarget(targetMaybe);
  }

  // 2) build from params
  const pfx = prefix ? `${prefix}_` : "";

  const chain =
    normalizeChain(params?.[`${pfx}chain`]) ||
    normalizeChain(params?.[`${pfx}chainId`]) ||
    normalizeChain(params?.chain) ||
    normalizeChain(params?.chainId);

  // residue
  const resIdRaw =
    params?.[`${pfx}resId`] ??
    params?.[`${pfx}residue_number`] ??
    params?.resId ??
    params?.residue_number;

  // range
  const startRaw =
    params?.[`${pfx}startResId`] ??
    params?.[`${pfx}start`] ??
    params?.startResId ??
    params?.start;

  const endRaw =
    params?.[`${pfx}endResId`] ??
    params?.[`${pfx}end`] ??
    params?.endResId ??
    params?.end;

  // ligand
  const resNameRaw =
    params?.[`${pfx}resName`] ??
    params?.[`${pfx}ligand`] ??
    params?.resName ??
    params?.ligand;

  // global hints
  const globalHint = params?.global || params?.all || params?.whole || params?.entire || params?.target === "all";

  // If already has explicit target type fields
  if (globalHint === true) {
    return { type: "all" };
  }

  // decide type
  // a) range
  if (startRaw !== undefined && endRaw !== undefined) {
    const a = Number(startRaw);
    const b = Number(endRaw);
    if (Number.isInteger(a) && Number.isInteger(b)) {
      return sanitizeTarget({ type: "range", chain, startResId: a, endResId: b });
    }
  }

  // b) residue
  if (resIdRaw !== undefined) {
    const r = Number(resIdRaw);
    if (Number.isInteger(r)) {
      return sanitizeTarget({ type: "residue", chain, resId: r });
    }
  }

  // c) chain
  if (chain) {
    return sanitizeTarget({ type: "chain", chain });
  }

  // d) ligand
  if (resNameRaw !== undefined) {
    const rn = String(resNameRaw).trim().toUpperCase();
    if (rn) return sanitizeTarget({ type: "ligand", resName: rn });
  }

  return null;
}

/**
 * 严格裁剪 target 字段，避免前端无法处理的奇怪结构
 */
function sanitizeTarget(t) {
  if (!isPlainObject(t) || typeof t.type !== "string") return null;

  const type = String(t.type).trim();
  if (!["residue", "range", "chain", "ligand", "protein", "polymer", "all"].includes(type)) return null;

  const out = { type };

  if (t.chain !== undefined) {
    const c = normalizeChain(t.chain);
    if (c) out.chain = c;
  }

  if (type === "residue") {
    const r = Number(t.resId);
    if (Number.isInteger(r)) out.resId = r;
    else return null;
  }

  if (type === "range") {
    const a = Number(t.startResId);
    const b = Number(t.endResId);
    if (Number.isInteger(a) && Number.isInteger(b)) {
      out.startResId = a;
      out.endResId = b;
    } else return null;
  }

  if (type === "chain") {
    if (!out.chain) return null;
  }

  if (type === "ligand") {
    const rn = String(t.resName || "").trim().toUpperCase();
    if (!rn) return null;
    out.resName = rn;
  }

  // protein/polymer/all 不强制其他字段
  return out;
}

/**
 * 将模型返回的 content 归一化为 “严格可执行 JSON 字符串”
 * - parse失败 → noop
 * - action不在白名单 → 映射/兜底
 * - params/target 字段不合规 → clarify/noop
 */
function ensureStrictCommandJson(contentText) {
  const extracted = extractFirstJsonObject(contentText);
  const parsed = safeJsonParse(extracted);

  // 如果模型没有按协议输出 JSON，这里做兜底
  if (!parsed) {
    return jsonStringFallback("Model did not return valid JSON.");
  }

  const normalized = normalizeCommandObject(parsed);

  // 顶层强约束：只保留 action/params
  const action = typeof normalized.action === "string" ? normalized.action : "noop";
  const params = isPlainObject(normalized.params) ? normalized.params : {};

  // action 最终必须在白名单，否则 noop
  if (!ACTION_WHITELIST.has(action)) {
    return jsonStringFallback(`Unsupported action after normalization: ${action}`);
  }

  return JSON.stringify({ action, params });
}

// =========================
// 3) Handler
// =========================
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

    const resolvedMode = mode === "answer" ? "answer" : "command";

    if (!userText) {
      return res.status(400).json({
        mode: resolvedMode,
        raw: "",
        result: jsonStringFallback("Invalid request: message must be a non-empty string"),
        error: "Invalid request",
      });
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return res.status(200).json({
        mode: resolvedMode,
        raw: "",
        result: jsonStringFallback("Server misconfigured: missing DEEPSEEK_API_KEY"),
        error: "Server misconfigured: missing DEEPSEEK_API_KEY",
      });
    }

    const systemPrompt = resolvedMode === "answer" ? SYSTEM_PROMPT_ANSWER : SYSTEM_PROMPT_COMMAND;

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

    const data = await response.json().catch(() => ({}));
    const content = data?.choices?.[0]?.message?.content ?? "";

    // answer：raw 直接自然语言
    if (resolvedMode === "answer") {
      const out = String(content || "").trim();
      return res.status(200).json({
        mode: "answer",
        raw: out,
        result: out,
        model: MODEL,
      });
    }

    // command：强制归一化为严格 JSON 字符串
    const strictResult = ensureStrictCommandJson(content);

    return res.status(200).json({
      mode: "command",
      raw: String(content || ""),
      result: strictResult,
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
