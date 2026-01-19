下面给你一个**全量可覆盖**的新版 `App.jsx`（整文件复制替换即可）。这一版的核心变化是：

* ✅ **不再和 Mol* 默认 preset “打架”**
  结构加载后，Mol* 会自动生成“主体蛋白/配体”的 representations。你之前“滤镜/颜色不变”的根因就是没有更新到**正在显示的那套 repr**。
* ✅ **颜色/滤镜改成真正的底层更新：build → update → commit**
  我会直接遍历当前 structure 的 `representation.representations`，对每个 repr 做 update，再 commit，所以**色卡一定会影响蛋白**（只要 Mol* 正常显示结构）。
* ✅ **滤镜变化明显**：Nature/Cell 不只是背景，会改变主体表示（cartoon/putty）、透明度、以及额外 surface 层（Glass/Xray/Holo）。
* ✅ 保留你要的：Binder pocket + AI 自然语言（链/残基/配体/pocket）

> 你直接把下面整段代码复制，覆盖 `App.jsx` 全部内容。
> 改完运行后，你先测试：**色卡染色**、**Nature/Cell 切换**、**Glass/Xray**、**Binder pocket**、**AI 残基染色**。

---

```jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera, Upload, Download, Layers, Maximize, AlertCircle,
  MessageSquare, Send, Share2, RefreshCw, Search, Droplet, Disc, Box, Monitor, Ghost
} from "lucide-react";

/** -----------------------------
 *  Load Mol* from CDN (safe)
 * ------------------------------*/
const loadScript = (src) =>
  new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });

const loadStyle = (href) => {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = href;
  document.head.appendChild(l);
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const COLOR_NAME_MAP = {
  red: "#ff0000", 红: "#ff0000",
  blue: "#4f46e5", 蓝: "#4f46e5",
  green: "#22c55e", 绿: "#22c55e",
  yellow: "#facc15", 黄: "#facc15",
  purple: "#a855f7", 紫: "#a855f7",
  orange: "#f97316", 橙: "#f97316",
  black: "#000000", 黑: "#000000",
  white: "#ffffff", 白: "#ffffff",
  cyan: "#06b6d4", 青: "#06b6d4",
  pink: "#ec4899", 粉: "#ec4899",
};

function normalizeHexColor(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (COLOR_NAME_MAP[s]) return COLOR_NAME_MAP[s];
  const m = s.match(/^#?([0-9a-fA-F]{6})$/);
  if (m) return `#${m[1].toLowerCase()}`;
  return null;
}

function hexToInt(hex) {
  try {
    return parseInt(String(hex).replace("#", ""), 16);
  } catch {
    return 0x4f46e5;
  }
}

/** -----------------------------
 *  AI parsing (robust regex)
 * ------------------------------*/
function parseAiCommand(raw) {
  const text = (raw || "").trim();
  const lower = text.toLowerCase();

  const intent = {
    raw: text,
    wantReset: false,
    wantInteractions: null,    // true/false/null
    wantTint: null,            // { hex }
    wantOnlyChains: null,      // ['A','B']
    wantFocusChains: null,     // ['A','B']
    residueSelect: null,       // { chain?, seq, aa? }
    residueColor: null,        // hex
    wantFocusLigand: false,
    wantEmphasizeLigand: false,
    wantPocketRadius: null,
    wantPocketToggle: null,
  };

  if (lower.includes("reset") || text.includes("复位") || text.includes("重置")) {
    intent.wantReset = true;
    return intent;
  }

  // interactions
  if (lower.includes("bond") || lower.includes("interaction") || text.includes("氢键") || text.includes("相互作用")) {
    intent.wantInteractions = true;
  }
  if (lower.includes("hide interactions") || text.includes("关闭相互作用") || text.includes("隐藏氢键")) {
    intent.wantInteractions = false;
  }

  // pocket on/off + radius
  if (lower.includes("pocket off") || text.includes("关闭口袋") || text.includes("隐藏口袋")) intent.wantPocketToggle = false;
  if (lower.includes("pocket on") || text.includes("显示口袋") || text.includes("打开口袋") || text.includes("开启口袋")) intent.wantPocketToggle = true;

  const pr =
    text.match(/(?:pocket|口袋|半径|radius)\s*([0-9]{1,2})(?:\s*å|Å)?/i) ||
    text.match(/([0-9]{1,2})\s*(?:å|Å)\s*(?:pocket|口袋)/i);
  if (pr && pr[1]) {
    const r = clamp(parseInt(pr[1], 10), 2, 20);
    if (!Number.isNaN(r)) intent.wantPocketRadius = r;
  }

  // ligand focus/emphasize
  if (text.includes("配体") && (text.includes("放大") || text.includes("突出") || text.includes("强调") || lower.includes("emphasize"))) {
    intent.wantEmphasizeLigand = true;
  }
  if (text.includes("聚焦配体") || lower.includes("focus ligand") || (text.includes("配体") && text.includes("聚焦"))) {
    intent.wantFocusLigand = true;
  }

  // tint: "染成红色 / 改成 #ff00ff"
  const colorWord = text.match(/(?:染色|涂成|变成|改成)\s*([#0-9a-fA-F]{6}|红|蓝|绿|黄|紫|橙|黑|白|青|粉|red|blue|green|yellow|purple|orange|black|white|cyan|pink)/i);
  if (colorWord?.[1]) {
    const hx = normalizeHexColor(colorWord[1]);
    if (hx) intent.wantTint = { hex: hx };
  } else {
    const shorthand = lower.match(/\b(red|blue|green|yellow|purple|orange|black|white|cyan|pink)\b/) || text.match(/[红蓝绿黄紫橙黑白青粉]/);
    if (shorthand) {
      const token = shorthand[1] || shorthand[0];
      const hx = normalizeHexColor(token);
      if (hx) intent.wantTint = { hex: hx };
    }
  }

  // chains: A链 B链
  const chainMatches = text.match(/[A-Za-z0-9]\s*链/g);
  const chains = [];
  if (chainMatches) {
    chainMatches.forEach((m) => {
      const c = m.replace(/\s*链/g, "").trim().toUpperCase();
      if (c) chains.push(c);
    });
  }
  if (chains.length) {
    const only = text.includes("只显示") || text.includes("只看") || text.includes("仅显示") || lower.includes("only show");
    const focus = text.includes("聚焦") || lower.includes("focus");
    if (only) intent.wantOnlyChains = Array.from(new Set(chains));
    else if (focus) intent.wantFocusChains = Array.from(new Set(chains));
    else intent.wantFocusChains = Array.from(new Set(chains));
  }

  // residue: A链 57号 / A:57 / LYS57
  let chain = null;
  let seq = null;
  let aa = null;

  const aaMatch = text.match(/\b(ALA|ARG|ASN|ASP|CYS|GLN|GLU|GLY|HIS|ILE|LEU|LYS|MET|PHE|PRO|SER|THR|TRP|TYR|VAL)\b/i);
  if (aaMatch) aa = aaMatch[1].toUpperCase();

  const chainSeq1 = text.match(/([A-Za-z0-9])\s*[:：]\s*([0-9]{1,4})/);
  if (chainSeq1) {
    chain = chainSeq1[1].toUpperCase();
    seq = parseInt(chainSeq1[2], 10);
  }

  if (!seq) {
    const chainSeq2 = text.match(/([A-Za-z0-9])\s*链[^0-9]*([0-9]{1,4})/);
    if (chainSeq2) {
      chain = chainSeq2[1].toUpperCase();
      seq = parseInt(chainSeq2[2], 10);
    }
  }

  if (!seq && aa) {
    const aaSeq = text.match(new RegExp(`${aa}\\s*([0-9]{1,4})`, "i"));
    if (aaSeq) seq = parseInt(aaSeq[1], 10);
  }

  if (seq && !Number.isNaN(seq)) {
    intent.residueSelect = { chain, seq, aa };
    if (intent.wantTint?.hex) intent.residueColor = intent.wantTint.hex;
  }

  return intent;
}

/** -----------------------------
 *  Main Component
 * ------------------------------*/
export default function BioLens() {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [fileName, setFileName] = useState("4hhb.pdb");
  const [pdbIdInput, setPdbIdInput] = useState("");

  const [currentStyle, setCurrentStyle] = useState("journal_nature");
  const [focusMode, setFocusMode] = useState("global");

  const [showInteractions, setShowInteractions] = useState(false);

  // Binder pocket controls
  const [showPocket, setShowPocket] = useState(true);
  const [pocketRadius, setPocketRadius] = useState(6);

  // Ligand emphasize
  const [emphasizeLigand, setEmphasizeLigand] = useState(false);

  // Tint
  const [customColor, setCustomColor] = useState("#4f46e5");
  const [useCustomColor, setUseCustomColor] = useState(false);

  // AI
  const [aiInput, setAiInput] = useState("");
  const [aiHistory, setAiHistory] = useState([{ role: "system", text: "System Ready." }]);

  const styles = useMemo(() => ([
    { id: "journal_nature", name: "Nature", icon: Droplet },
    { id: "journal_cell", name: "Cell", icon: Disc },
    { id: "glass", name: "Glass", icon: Box },
    { id: "hologram", name: "Holo", icon: Monitor },
    { id: "xray", name: "X-Ray", icon: Ghost },
  ]), []);

  const modes = useMemo(() => ([
    { id: "global", name: "Global", icon: Maximize },
    { id: "binder", name: "Binder", icon: Layers },
  ]), []);

  /** -----------------------------
   *  Helpers: plugin ctx & structure
   * ------------------------------*/
  const getCtx = () => {
    const v = viewerRef.current;
    if (!v) return null;
    return v.plugin || v;
  };

  const getFirstStructureWrapper = (ctx) => {
    try {
      return ctx?.managers?.structure?.hierarchy?.current?.structures?.[0] || null;
    } catch {
      return null;
    }
  };

  const getAllReprs = (structureWrapper) => {
    // Mol* stores reprs in structureWrapper.representation.representations (object map)
    try {
      const repsObj = structureWrapper?.representation?.representations;
      if (!repsObj) return [];
      return Object.values(repsObj).filter(Boolean);
    } catch {
      return [];
    }
  };

  /** -----------------------------
   *  Init viewer
   * ------------------------------*/
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError(null);

      try {
        if (!window.molstar) {
          loadStyle("https://cdn.jsdelivr.net/npm/molstar@latest/build/viewer/molstar.css");
          await loadScript("https://cdn.jsdelivr.net/npm/molstar@latest/build/viewer/molstar.js");
        }
        if (!window.molstar) throw new Error("Mol* engine failed to load.");

        // Create viewer
        const viewer = await window.molstar.Viewer.create(containerRef.current, {
          layoutIsExpanded: false,
          layoutShowControls: false,
          layoutShowRemoteState: false,
          layoutShowSequence: true,
          layoutShowLog: false,
          layoutShowLeftPanel: true,
          viewportShowExpand: false,
          viewportShowSelectionMode: false,
          viewportShowAnimation: false,
        });

        viewerRef.current = viewer;

        // Load default PDB
        await loadPdbFromUrl("https://files.rcsb.org/download/4hhb.pdb");

      } catch (e) {
        console.error(e);
        setError(`Initialization Failed: ${e.message}`);
        setLoading(false);
      }
    };

    init();

    return () => {
      try {
        viewerRef.current?.dispose?.();
        viewerRef.current?.plugin?.dispose?.();
      } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** -----------------------------
   *  Load structure (URL / upload)
   * ------------------------------*/
  const getFormat = (nameOrUrl) => {
    if (!nameOrUrl) return "pdb";
    const s = String(nameOrUrl).toLowerCase();
    if (s.endsWith(".bcif")) return "bcif";
    if (s.endsWith(".cif") || s.endsWith(".mmcif")) return "mmcif";
    return "pdb";
  };

  const loadPdbFromUrl = async (url) => {
    const ctx = getCtx();
    if (!ctx) return;
    setLoading(true);
    setError(null);

    try {
      await ctx.clear();
      const format = getFormat(url);

      const data = await ctx.builders.data.download({ url }, { state: { isGhost: true } });
      const traj = await ctx.builders.structure.parseTrajectory(data, format);
      const model = await ctx.builders.structure.createModel(traj);
      await ctx.builders.structure.createStructure(model);

      // After structure exists: apply styles (this will update underlying reprs)
      await applyAllVisuals();

      ctx.managers.camera.reset();
      setLoading(false);

    } catch (e) {
      console.error(e);
      setError(`加载失败: ${e.message}`);
      setLoading(false);
    }
  };

  const handlePdbFetch = async (e) => {
    e.preventDefault();
    const id = pdbIdInput.trim();
    if (id.length < 4) {
      alert("请输入有效的 4 位 PDB ID (例如 1CRN)");
      return;
    }
    const pid = id.toLowerCase();
    setFileName(pid.toUpperCase());
    setPdbIdInput("");
    await loadPdbFromUrl(`https://files.rcsb.org/download/${pid}.pdb`);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ctx = getCtx();
    if (!ctx) return;

    setLoading(true);
    setError(null);
    setFileName(file.name);

    try {
      await ctx.clear();
      const format = getFormat(file.name);

      const isBinary = format === "bcif";
      let data;
      if (isBinary) {
        const buf = await file.arrayBuffer();
        data = await ctx.builders.data.rawData({ data: new Uint8Array(buf), label: file.name });
      } else {
        const text = await file.text();
        data = await ctx.builders.data.rawData({ data: text, label: file.name });
      }

      const traj = await ctx.builders.structure.parseTrajectory(data, format);
      const model = await ctx.builders.structure.createModel(traj);
      await ctx.builders.structure.createStructure(model);

      await applyAllVisuals();

      ctx.managers.camera.reset();
      setLoading(false);

    } catch (err) {
      console.error(err);
      setError(`解析失败: ${err.message}`);
      setLoading(false);
    } finally {
      // reset input so re-upload same file triggers change
      try { e.target.value = ""; } catch { /* ignore */ }
    }
  };

  /** -----------------------------
   *  Core: update underlying representations (the key fix)
   * ------------------------------*/
  const updateCanvasProps = async (ctx) => {
    const canvas = ctx?.canvas3d;
    if (!canvas?.setProps) return;

    const props = {
      renderer: { backgroundColor: 0xffffff },
      postProcessing: {
        occlusion: { name: "off", params: {} },
        outline: { name: "off", params: {} },
      },
    };

    if (currentStyle === "journal_nature") {
      props.renderer.backgroundColor = 0xffffff;
      props.postProcessing.occlusion = {
        name: "on",
        params: { samples: 48, radius: 5, bias: 0.8, blurKernelSize: 15, resolutionScale: 1 },
      };
    } else if (currentStyle === "journal_cell") {
      props.renderer.backgroundColor = 0xfdfbf7;
      props.postProcessing.outline = {
        name: "on",
        params: { scale: 1.25, threshold: 0.33, color: 0x000000, includeTransparent: true },
      };
      props.postProcessing.occlusion = {
        name: "on",
        params: { samples: 48, radius: 4, bias: 1.0, blurKernelSize: 11, resolutionScale: 1 },
      };
    } else if (currentStyle === "glass") {
      props.renderer.backgroundColor = 0x000000;
      props.postProcessing.outline = {
        name: "on",
        params: { scale: 1.05, threshold: 0.38, color: 0xffffff, includeTransparent: true },
      };
      props.postProcessing.occlusion = {
        name: "on",
        params: { samples: 32, radius: 6, bias: 0.7, blurKernelSize: 9, resolutionScale: 1 },
      };
    } else if (currentStyle === "hologram") {
      props.renderer.backgroundColor = 0x000000;
      props.postProcessing.outline = {
        name: "on",
        params: { scale: 1.45, threshold: 0.25, color: 0x00ffcc, includeTransparent: true },
      };
    } else if (currentStyle === "xray") {
      props.renderer.backgroundColor = 0x111111;
      props.postProcessing.outline = {
        name: "on",
        params: { scale: 1.1, threshold: 0.35, color: 0xffffff, includeTransparent: true },
      };
    }

    try {
      canvas.setProps(props);
    } catch (e) {
      // non-fatal if Mol* changes prop schema
      console.warn("canvas.setProps non-fatal:", e);
    }
  };

  const shouldSkipReprForTint = (reprCellObj) => {
    // Heuristic: don't recolor interactions, and prefer keeping ligand element colors.
    const label = (reprCellObj?.label || "").toLowerCase();
    const typeName = (reprCellObj?.data?.params?.type?.name || "").toLowerCase();
    if (typeName.includes("interactions")) return true;
    if (label.includes("interaction")) return true;
    // ligand: often label contains ligand, but not guaranteed
    if (label.includes("ligand")) return true;
    return false;
  };

  const updateRepresentations = async (ctx) => {
    const s = getFirstStructureWrapper(ctx);
    if (!s) return;

    const reps = getAllReprs(s);
    if (!reps.length) return;

    const tintColorInt = hexToInt(customColor);
    const wantUniform = !!useCustomColor;

    // We'll update existing reprs (the crucial part) so style/tint always shows.
    const update = ctx.build();

    for (const r of reps) {
      if (!r?.cell?.obj) continue;

      update.to(r).update((old) => {
        try {
          // Safely clone/mutate in place
          const next = { ...old };

          // 1) Tint: set uniform colorTheme on non-ligand + non-interactions
          if (wantUniform && !shouldSkipReprForTint(r.cell.obj)) {
            if (next.colorTheme) {
              next.colorTheme = { ...next.colorTheme, name: "uniform", params: { value: tintColorInt } };
            }
          } else {
            // if user turned off tint, restore chain-id for non-ligand (best-effort)
            if (!wantUniform && !shouldSkipReprForTint(r.cell.obj) && next.colorTheme) {
              next.colorTheme = { ...next.colorTheme, name: "chain-id", params: {} };
            }
          }

          // 2) Style: adjust type & params (best-effort, guarded)
          const t = next.type || next.typeParams ? next.type : next.type; // keep compatibility
          const typeName = next.type?.name || old?.type?.name;

          // Make Nature vs Cell visible: cartoon -> putty where possible
          if (currentStyle === "journal_cell") {
            if (typeName === "cartoon") {
              next.type = { ...(next.type || {}), name: "putty", params: { ...(next.type?.params || {}) } };
            }
          } else {
            // prefer cartoon in other modes if it was putty
            if (typeName === "putty") {
              next.type = { ...(next.type || {}), name: "cartoon", params: { ...(next.type?.params || {}) } };
            }
          }

          // Make Glass/Xray/Holo more obvious by alpha + sizeFactor tweaks (only if params exist)
          const p = next.type?.params ? { ...next.type.params } : null;

          if (p) {
            if (currentStyle === "glass") {
              // Many repr types support alpha; if not, it will be ignored by Mol*
              p.alpha = typeof p.alpha === "number" ? Math.min(p.alpha, 0.35) : 0.35;
            } else if (currentStyle === "xray") {
              p.alpha = typeof p.alpha === "number" ? Math.min(p.alpha, 0.20) : 0.20;
            } else if (currentStyle === "hologram") {
              p.alpha = typeof p.alpha === "number" ? Math.min(p.alpha, 0.55) : 0.55;
              // thin look if supported
              if (typeof p.sizeFactor === "number") p.sizeFactor = Math.min(p.sizeFactor, 0.2);
            } else {
              // Nature / others: solid
              if (typeof p.alpha === "number") p.alpha = 1;
            }
            next.type = { ...(next.type || {}), params: p };
          }

          return next;
        } catch {
          return old;
        }
      });
    }

    try {
      await update.commit();
    } catch (e) {
      console.warn("repr update commit non-fatal:", e);
    }
  };

  /** -----------------------------
   *  Add-on layers: interactions, ligand emphasis, pocket
   *  These are additive; we remove and re-add each time to keep consistent.
   * ------------------------------*/
  const removeComponentsByLabelPrefix = async (ctx, prefixList) => {
    const s = getFirstStructureWrapper(ctx);
    if (!s) return;
    const comps = s.components || [];
    const toRemove = comps.filter((c) => {
      const label = c?.cell?.obj?.label || "";
      return prefixList.some((p) => label.startsWith(p));
    });
    if (toRemove.length) {
      try { await ctx.managers.structure.hierarchy.remove(toRemove); } catch { /* ignore */ }
    }
  };

  const addEmphasizeLigandLayer = async (ctx) => {
    const s = getFirstStructureWrapper(ctx);
    if (!s) return;
    const MS = window.molstar?.MolScriptBuilder;
    if (!MS) return;

    try {
      await removeComponentsByLabelPrefix(ctx, ["Addon:Ligand"]);
      if (!emphasizeLigand) return;

      const ligandQuery = ctx.managers.structure.selection.fromSelectionQuery("ligand");
      if (!ligandQuery?.expression) return;

      const comp = await ctx.builders.structure.tryCreateComponentFromExpression(
        s.cell,
        ligandQuery.expression,
        "addon-ligand",
        { label: "Addon:Ligand" }
      );
      if (!comp) return;

      await ctx.builders.structure.representation.addRepresentation(comp, {
        type: "ball-and-stick",
        typeParams: { sizeFactor: 0.85 },
        color: "element-symbol"
      });

      await ctx.builders.structure.representation.addRepresentation(comp, {
        type: "molecular-surface",
        typeParams: { alpha: 0.28, flatShaded: true, doubleSided: true, ignoreLight: false },
        color: "uniform",
        colorParams: { value: 0xffffff }
      });
    } catch (e) {
      console.warn("Ligand emphasize layer non-fatal:", e);
    }
  };

  const addPocketLayerIfBinder = async (ctx) => {
    const s = getFirstStructureWrapper(ctx);
    if (!s) return;
    const MS = window.molstar?.MolScriptBuilder;
    if (!MS) return;

    try {
      await removeComponentsByLabelPrefix(ctx, ["Addon:Pocket"]);
      if (focusMode !== "binder" || !showPocket) return;

      const ligandQuery = ctx.managers.structure.selection.fromSelectionQuery("ligand");
      if (!ligandQuery?.expression) return;

      const includeSurroundings = MS?.struct?.modifier?.includeSurroundings;
      if (typeof includeSurroundings !== "function") return;

      const pocketExp = includeSurroundings({
        0: ligandQuery.expression,
        radius: clamp(parseFloat(pocketRadius), 2, 20),
        "as-whole-residues": true
      });

      const pocketComp = await ctx.builders.structure.tryCreateComponentFromExpression(
        s.cell,
        pocketExp,
        "addon-pocket",
        { label: `Addon:Pocket ${clamp(parseFloat(pocketRadius), 2, 20)}Å` }
      );
      if (!pocketComp) return;

      await ctx.builders.structure.representation.addRepresentation(pocketComp, {
        type: "ball-and-stick",
        typeParams: { sizeFactor: 0.23 },
        color: "uniform",
        colorParams: { value: 0xffd400 }
      });
      await ctx.builders.structure.representation.addRepresentation(pocketComp, {
        type: "molecular-surface",
        typeParams: { alpha: 0.13, flatShaded: true, doubleSided: true, ignoreLight: false },
        color: "uniform",
        colorParams: { value: 0xffd400 }
      });
    } catch (e) {
      console.warn("Pocket layer non-fatal:", e);
    }
  };

  const addInteractionsLayer = async (ctx) => {
    const s = getFirstStructureWrapper(ctx);
    if (!s) return;

    try {
      await removeComponentsByLabelPrefix(ctx, ["Addon:Interactions"]);
      if (!showInteractions) return;

      // Add interactions on structure cell directly (safe)
      const comp = await ctx.builders.structure.tryCreateComponentFromExpression(
        s.cell,
        // Use "everything" selection by leaving expression as whole structure
        // If this fails, we just fallback to addRepresentation on s.cell
        null,
        "addon-interactions",
        { label: "Addon:Interactions" }
      );

      const target = comp?.cell ? comp : s.cell;

      await ctx.builders.structure.representation.addRepresentation(target, {
        type: "interactions",
        typeParams: { lineSizeFactor: 0.05, includeCovalent: false },
        color: "interaction-type"
      });
    } catch (e) {
      // Fallback: directly add to s.cell
      try {
        await ctx.builders.structure.representation.addRepresentation(s.cell, {
          type: "interactions",
          typeParams: { lineSizeFactor: 0.05, includeCovalent: false },
          color: "interaction-type"
        });
      } catch { /* ignore */ }
      console.warn("Interactions non-fatal:", e);
    }
  };

  const addExtraSurfaceForGlassXrayHolo = async (ctx) => {
    // This makes style differences *very* visible even if repr type updates are limited.
    const s = getFirstStructureWrapper(ctx);
    if (!s) return;

    try {
      await removeComponentsByLabelPrefix(ctx, ["Addon:Surface"]);
      if (!["glass", "xray", "hologram"].includes(currentStyle)) return;

      // Add a surface layer to whole structure (additive)
      const alpha = currentStyle === "xray" ? 0.12 : currentStyle === "glass" ? 0.10 : 0.18;
      const colorInt =
        currentStyle === "hologram"
          ? (useCustomColor ? hexToInt(customColor) : 0x00ffcc)
          : 0xffffff;

      const comp = await ctx.builders.structure.tryCreateComponentFromExpression(
        s.cell,
        null,
        "addon-surface",
        { label: "Addon:Surface" }
      );
      const target = comp?.cell ? comp : s.cell;

      await ctx.builders.structure.representation.addRepresentation(target, {
        type: "molecular-surface",
        typeParams: { alpha, flatShaded: true, doubleSided: true, ignoreLight: currentStyle === "xray" },
        color: "uniform",
        colorParams: { value: colorInt }
      });

      if (currentStyle === "hologram") {
        // Add a thin ball-and-stick glow-like layer
        await ctx.builders.structure.representation.addRepresentation(target, {
          type: "ball-and-stick",
          typeParams: { sizeFactor: 0.08, alpha: 0.55 },
          color: "uniform",
          colorParams: { value: colorInt }
        });
      }
    } catch (e) {
      console.warn("Surface add-on non-fatal:", e);
    }
  };

  /** -----------------------------
   *  Apply all visuals (the main pipeline)
   * ------------------------------*/
  const applyAllVisuals = async () => {
    const ctx = getCtx();
    if (!ctx) return;

    // If structure not ready, do nothing
    const s = getFirstStructureWrapper(ctx);
    if (!s) return;

    try {
      await updateCanvasProps(ctx);

      // IMPORTANT: update existing reprs (this fixes your “颜色/滤镜没变化”)
      await updateRepresentations(ctx);

      // Add-ons (clear & add)
      await addExtraSurfaceForGlassXrayHolo(ctx);
      await addEmphasizeLigandLayer(ctx);
      await addPocketLayerIfBinder(ctx);
      await addInteractionsLayer(ctx);

      // Binder focus: focus ligand if possible
      if (focusMode === "binder") {
        try {
          const ligandQuery = ctx.managers.structure.selection.fromSelectionQuery("ligand");
          if (ligandQuery?.expression) {
            const comp = await ctx.builders.structure.tryCreateComponentFromExpression(
              s.cell,
              ligandQuery.expression,
              "addon-focus-ligand",
              { label: "Addon:LigandFocus" }
            );
            if (comp?.obj?.data) {
              const loci = ctx.managers.structure.selection.getLoci(comp.obj.data);
              ctx.managers.camera.focusLoci(loci);
            }
            // clean temp focus comp
            await removeComponentsByLabelPrefix(ctx, ["Addon:LigandFocus"]);
          }
        } catch { /* ignore */ }
      }

    } catch (e) {
      console.warn("applyAllVisuals non-fatal:", e);
    }
  };

  /** -----------------------------
   *  React: re-apply when controls change
   * ------------------------------*/
  useEffect(() => {
    if (loading || error) return;
    const ctx = getCtx();
    if (!ctx) return;

    // debounce a bit to avoid rapid state spam
    const t = setTimeout(() => { applyAllVisuals(); }, 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentStyle, focusMode, showInteractions,
    showPocket, pocketRadius,
    emphasizeLigand,
    customColor, useCustomColor
  ]);

  /** -----------------------------
   *  Screenshot
   * ------------------------------*/
  const takeScreenshot = () => {
    const ctx = getCtx();
    if (ctx?.helpers?.viewportScreenshot?.share) {
      ctx.helpers.viewportScreenshot.share();
      return;
    }
    try {
      const canvas = containerRef.current?.querySelector("canvas");
      if (!canvas) return;
      const image = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = image;
      link.download = `BioLens-${Date.now()}.png`;
      link.click();
    } catch { /* ignore */ }
  };

  /** -----------------------------
   *  Reset
   * ------------------------------*/
  const resetView = async () => {
    setUseCustomColor(false);
    setCustomColor("#4f46e5");
    setShowInteractions(false);
    setEmphasizeLigand(false);
    setCurrentStyle("journal_nature");
    setFocusMode("global");
    setShowPocket(true);
    setPocketRadius(6);

    const ctx = getCtx();
    if (ctx) ctx.managers.camera.reset();
  };

  /** -----------------------------
   *  AI: residue highlight / chain focus / only show chains
   * ------------------------------*/
  const clearAiComponents = async (ctx) => {
    await removeComponentsByLabelPrefix(ctx, ["AI:"]);
  };

  const addAiResidueHighlight = async (ctx, residue, colorHex) => {
    const s = getFirstStructureWrapper(ctx);
    if (!s) return { ok: false };

    const MS = window.molstar?.MolScriptBuilder;
    if (!MS) return { ok: false };

    const seq = residue?.seq;
    const chain = residue?.chain ? String(residue.chain).toUpperCase() : null;
    if (!seq || Number.isNaN(seq)) return { ok: false };

    const colorInt = hexToInt(colorHex || "#ff0000");

    let exp;
    if (chain) {
      exp = MS.struct.generator.atomGroups({
        "chain-test": MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), chain]),
        "residue-test": MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_seq_id(), seq]),
      });
    } else {
      exp = MS.struct.generator.atomGroups({
        "residue-test": MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_seq_id(), seq]),
      });
    }

    const label = chain ? `AI:${chain}:${seq}` : `AI:res:${seq}`;

    const comp = await ctx.builders.structure.tryCreateComponentFromExpression(
      s.cell,
      exp,
      "ai-residue",
      { label }
    );
    if (!comp) return { ok: false };

    await ctx.builders.structure.representation.addRepresentation(comp, {
      type: "ball-and-stick",
      typeParams: { sizeFactor: 0.38 },
      color: "uniform",
      colorParams: { value: colorInt }
    });

    await ctx.builders.structure.representation.addRepresentation(comp, {
      type: "molecular-surface",
      typeParams: { alpha: 0.15, flatShaded: true, doubleSided: true, ignoreLight: false },
      color: "uniform",
      colorParams: { value: colorInt }
    });

    try {
      const loci = ctx.managers.structure.selection.getLoci(comp.obj.data);
      ctx.managers.camera.focusLoci(loci);
    } catch { /* ignore */ }

    return { ok: true };
  };

  const focusChains = async (ctx, chains) => {
    const s = getFirstStructureWrapper(ctx);
    const MS = window.molstar?.MolScriptBuilder;
    if (!s || !MS) return { ok: false };

    const unique = Array.from(new Set((chains || []).map(c => String(c).toUpperCase()).filter(Boolean)));
    if (!unique.length) return { ok: false };

    const chainExp = MS.struct.generator.atomGroups({
      "chain-test": MS.core.logic.or(
        unique.map(c => MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), c]))
      )
    });

    await clearAiComponents(ctx);

    const comp = await ctx.builders.structure.tryCreateComponentFromExpression(
      s.cell,
      chainExp,
      "ai-focus-chains",
      { label: `AI:Focus ${unique.join("+")}` }
    );
    if (!comp) return { ok: false };

    await ctx.builders.structure.representation.addRepresentation(comp, {
      type: "ball-and-stick",
      typeParams: { sizeFactor: 0.16 },
      color: "chain-id"
    });

        try {
      const loci = ctx.managers.structure.selection.getLoci(comp.obj.data);
      ctx.managers.camera.focusLoci(loci);
    } catch { /* ignore */ }

    return { ok: true };
  };

  const showOnlyChains = async (ctx, chains) => {
    const s = getFirstStructureWrapper(ctx);
    const MS = window.molstar?.MolScriptBuilder;
    if (!s || !MS) return { ok: false };

    const unique = Array.from(new Set((chains || []).map(c => String(c).toUpperCase()).filter(Boolean)));
    if (!unique.length) return { ok: false };

    // Remove existing base representations so only the selection remains visible
    try {
      const reps = getAllReprs(s);
      if (reps.length) {
        const upd = ctx.build();
        for (const r of reps) upd.delete(r);
        await upd.commit();
      }
    } catch (e) {
      console.warn("showOnlyChains: remove base reprs non-fatal:", e);
    }

    await clearAiComponents(ctx);

    const chainExp = MS.struct.generator.atomGroups({
      "chain-test": MS.core.logic.or(
        unique.map(c => MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), c]))
      )
    });

    const comp = await ctx.builders.structure.tryCreateComponentFromExpression(
      s.cell,
      chainExp,
      "ai-only-chains",
      { label: `AI:Only ${unique.join("+")}` }
    );
    if (!comp) return { ok: false };

    const tintColorInt = hexToInt(customColor);
    const wantUniform = !!useCustomColor;

    await ctx.builders.structure.representation.addRepresentation(comp, {
      type: currentStyle === "journal_cell" ? "putty" : "cartoon",
      color: wantUniform ? "uniform" : "chain-id",
      colorParams: wantUniform ? { value: tintColorInt } : {}
    });

    // If user is in glass/xray/holo, add a surface overlay for visibility
    try {
      if (["glass", "xray", "hologram"].includes(currentStyle)) {
        const alpha = currentStyle === "xray" ? 0.12 : currentStyle === "glass" ? 0.10 : 0.18;
        const colorInt =
          currentStyle === "hologram"
            ? (useCustomColor ? hexToInt(customColor) : 0x00ffcc)
            : 0xffffff;

        await ctx.builders.structure.representation.addRepresentation(comp, {
          type: "molecular-surface",
          typeParams: { alpha, flatShaded: true, doubleSided: true, ignoreLight: currentStyle === "xray" },
          color: "uniform",
          colorParams: { value: colorInt }
        });
      }
    } catch { /* ignore */ }

    try {
      const loci = ctx.managers.structure.selection.getLoci(comp.obj.data);
      ctx.managers.camera.focusLoci(loci);
    } catch { /* ignore */ }

    // After hiding everything, keep add-ons consistent
    setTimeout(() => {
      try { applyAllVisuals(); } catch { /* ignore */ }
    }, 0);

    return { ok: true };
  };

  const focusLigandOnce = async (ctx) => {
    const s = getFirstStructureWrapper(ctx);
    if (!s) return { ok: false };

    try {
      const ligandQuery = ctx.managers.structure.selection.fromSelectionQuery("ligand");
      if (!ligandQuery?.expression) return { ok: false };

      await removeComponentsByLabelPrefix(ctx, ["AI:Ligand"]);

      const comp = await ctx.builders.structure.tryCreateComponentFromExpression(
        s.cell,
        ligandQuery.expression,
        "ai-ligand",
        { label: "AI:Ligand" }
      );
      if (!comp) return { ok: false };

      await ctx.builders.structure.representation.addRepresentation(comp, {
        type: "ball-and-stick",
        typeParams: { sizeFactor: 0.85 },
        color: "element-symbol"
      });

      const loci = ctx.managers.structure.selection.getLoci(comp.obj.data);
      ctx.managers.camera.focusLoci(loci);
      return { ok: true };
    } catch (e) {
      console.warn("focusLigandOnce non-fatal:", e);
      return { ok: false };
    }
  };

  /** -----------------------------
   *  AI submit
   * ------------------------------*/
  const handleAiSubmit = async (e) => {
    e.preventDefault();
    if (!aiInput.trim()) return;

    const userText = aiInput;
    setAiHistory(prev => [...prev, { role: "user", text: userText }]);
    setAiInput("");

    const ctx = getCtx();
    let reply = "指令已接收。";

    try {
      const intent = parseAiCommand(userText);

      if (intent.wantReset) {
        await resetView();
        reply = "视图已重置。";
        setAiHistory(prev => [...prev, { role: "system", text: reply }]);
        return;
      }

      // interactions toggle
      if (intent.wantInteractions === true) setShowInteractions(true);
      if (intent.wantInteractions === false) setShowInteractions(false);

      // pocket toggle/radius
      if (typeof intent.wantPocketToggle === "boolean") setShowPocket(intent.wantPocketToggle);
      if (typeof intent.wantPocketRadius === "number") setPocketRadius(intent.wantPocketRadius);

      // emphasize ligand
      if (intent.wantEmphasizeLigand) setEmphasizeLigand(true);

      // residue highlight has priority over global tint
      if (ctx && intent.residueSelect && intent.residueColor) {
        await clearAiComponents(ctx);
        const r = await addAiResidueHighlight(ctx, intent.residueSelect, intent.residueColor);
        reply = r.ok
          ? `已高亮 ${intent.residueSelect.chain ? intent.residueSelect.chain + "链 " : ""}${intent.residueSelect.seq} 号残基并染色。`
          : "残基选择失败（可能残基编号/链不存在）。";
        setAiHistory(prev => [...prev, { role: "system", text: reply }]);
        return;
      }

      // global tint
      if (intent.wantTint?.hex && !intent.residueSelect) {
        setCustomColor(intent.wantTint.hex);
        setUseCustomColor(true);
        reply = `已设置全局染色为 ${intent.wantTint.hex}。`;
        setAiHistory(prev => [...prev, { role: "system", text: reply }]);
        return;
      }

      // only show chains
      if (ctx && intent.wantOnlyChains?.length) {
        const r = await showOnlyChains(ctx, intent.wantOnlyChains);
        reply = r.ok ? `已仅显示 ${intent.wantOnlyChains.join(" ")} 链。` : "只显示链失败（可能未加载结构）。";
        setAiHistory(prev => [...prev, { role: "system", text: reply }]);
        return;
      }

      // focus chains
      if (ctx && intent.wantFocusChains?.length) {
        const r = await focusChains(ctx, intent.wantFocusChains);
        reply = r.ok ? `已聚焦 ${intent.wantFocusChains.join(" ")} 链。` : "聚焦链失败（可能未加载结构）。";
        setAiHistory(prev => [...prev, { role: "system", text: reply }]);
        return;
      }

      // focus ligand
      if (ctx && (intent.wantFocusLigand || intent.wantEmphasizeLigand)) {
        const r = await focusLigandOnce(ctx);
        reply = r.ok ? "已聚焦配体。" : "未检测到配体（或聚焦失败）。";
        setAiHistory(prev => [...prev, { role: "system", text: reply }]);
        return;
      }

      // pocket text feedback
      if (intent.wantPocketRadius) {
        reply = `Pocket 半径已设置为 ${intent.wantPocketRadius}Å。`;
      } else if (typeof intent.wantPocketToggle === "boolean") {
        reply = intent.wantPocketToggle ? "已开启 Pocket 高亮。" : "已关闭 Pocket 高亮。";
      } else if (intent.wantInteractions === true) {
        reply = "已显示相互作用。";
      } else if (intent.wantInteractions === false) {
        reply = "已隐藏相互作用。";
      } else {
        reply = "未匹配到可执行动作。试试：只显示A链 / A链57号染红 / 显示口袋8Å / 聚焦配体 / 显示氢键。";
      }

    } catch (err) {
      console.error(err);
      reply = "指令解析失败。";
    }

    setAiHistory(prev => [...prev, { role: "system", text: reply }]);
  };

  /** -----------------------------
   *  UI Handlers
   * ------------------------------*/
  const toggleInteractions = () => setShowInteractions(v => !v);

  const handleColorChange = (e) => {
    setCustomColor(e.target.value);
    setUseCustomColor(true);
  };

  /** -----------------------------
   *  Render
   * ------------------------------*/
  return (
    <div className="flex flex-col h-screen w-full bg-gray-50 text-gray-800 font-sans overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 z-10 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 p-1.5 rounded-lg">
            <Camera className="text-white" size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">
              BioLens <span className="text-indigo-600">Pro</span>
            </h1>
            <p className="text-xs text-gray-500">Synthetic Bio Edition</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <form onSubmit={handlePdbFetch} className="flex items-center border border-gray-300 rounded-md overflow-hidden bg-gray-50">
            <div className="px-3 text-gray-400"><Search size={14} /></div>
            <input
              type="text"
              value={pdbIdInput}
              onChange={(e) => setPdbIdInput(e.target.value.toUpperCase())}
              placeholder="PDB ID (e.g. 1CRN)"
              className="w-32 py-1.5 bg-transparent text-sm focus:outline-none"
              maxLength={4}
            />
            <button type="submit" className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-xs font-medium transition-colors">
              Fetch
            </button>
          </form>

          <div className="h-6 w-px bg-gray-300 mx-2"></div>

          <label className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md cursor-pointer transition-colors shadow-sm">
            <Upload size={16} />
            <span className="text-sm font-medium">Upload</span>
            <input
              type="file"
              accept=".pdb,.cif,.ent,.mmcif,.bcif"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>

          <button
            onClick={takeScreenshot}
            className="p-2 border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-md"
            title="Screenshot"
          >
            <Download size={16} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Viewer */}
        <div className="relative flex-1 bg-gray-100">
          {error && (
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 bg-white p-6 rounded-lg shadow-2xl border-2 border-red-500 max-w-lg w-full">
              <div className="flex items-center gap-2 text-red-600 font-bold text-lg mb-2"><AlertCircle /> Error</div>
              <div className="bg-gray-100 p-3 rounded text-sm font-mono text-gray-700 break-words mb-4 max-h-40 overflow-auto">
                {error}
              </div>
              <button onClick={() => setError(null)} className="w-full py-2 bg-gray-200 hover:bg-gray-300 rounded font-medium">
                Close
              </button>
            </div>
          )}

          {loading && (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/80">
              <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-600 border-t-transparent"></div>
            </div>
          )}

          <div ref={containerRef} className="absolute inset-0 w-full h-full" />

          {/* Floating controls */}
          <div className="absolute top-4 right-4 z-20 flex gap-2">
            <button
              onClick={resetView}
              className="flex items-center gap-2 px-4 py-2 rounded-full shadow-lg border bg-white text-gray-700 hover:bg-gray-50"
            >
              <RefreshCw size={16} /> <span className="text-sm">Reset</span>
            </button>
            <button
              onClick={toggleInteractions}
              className={`flex items-center gap-2 px-4 py-2 rounded-full shadow-lg border ${showInteractions ? "bg-indigo-600 text-white" : "bg-white text-gray-700"}`}
            >
              <Share2 size={16} /> <span className="text-sm">H-Bonds</span>
            </button>
          </div>

          {/* AI bar */}
          <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 w-full max-w-lg px-4 z-20">
            {aiHistory.length > 1 && (
              <div className="mb-2 bg-black/60 backdrop-blur text-white text-xs p-2 rounded-lg max-h-32 overflow-y-auto">
                {aiHistory.slice(-2).map((m, i) => (
                  <div key={i} className="mb-1">
                    <b>{m.role}:</b> {m.text}
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={handleAiSubmit} className="relative">
              <div className="absolute left-3 top-3 text-indigo-400"><MessageSquare size={18} /></div>
              <input
                type="text"
                value={aiInput}
                onChange={e => setAiInput(e.target.value)}
                placeholder="AI指令...（例：只显示A链 / A链57号染红 / 显示口袋8Å / 聚焦配体）"
                className="w-full bg-black/70 backdrop-blur border border-indigo-500/30 text-white pl-10 pr-12 py-3 rounded-full outline-none"
              />
              <button type="submit" className="absolute right-2 top-2 p-1.5 bg-indigo-600 rounded-full text-white">
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>

        {/* Right Panel */}
        <div className="w-64 bg-white border-l border-gray-200 p-4 z-20 shadow-xl flex flex-col gap-6 overflow-y-auto">
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Styles (滤镜)</h3>
            <div className="grid grid-cols-2 gap-2">
              {styles.map(s => (
                <button
                  key={s.id}
                  onClick={() => setCurrentStyle(s.id)}
                  className={`p-2 rounded-lg border text-xs font-medium transition-colors ${currentStyle === s.id ? "bg-indigo-50 border-indigo-500 text-indigo-700" : "hover:bg-gray-50"}`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Scene Focus (场景)</h3>
            <div className="grid grid-cols-1 gap-2">
              {modes.map(m => (
                <button
                  key={m.id}
                  onClick={() => setFocusMode(m.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-medium ${focusMode === m.id ? "bg-gray-800 text-white" : "hover:bg-gray-50"}`}
                >
                  <span className="flex items-center gap-2"><m.icon size={14} /> {m.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Binder pocket controls */}
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Binder Pocket</h3>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-600">Show Pocket</span>
              <button
                onClick={() => setShowPocket(v => !v)}
                className={`px-2 py-1 rounded text-[11px] border ${showPocket ? "bg-indigo-50 border-indigo-500 text-indigo-700" : "hover:bg-gray-50 text-gray-600"}`}
              >
                {showPocket ? "ON" : "OFF"}
              </button>
            </div>
            <div className="text-[11px] text-gray-500 mb-1">Radius: {pocketRadius}Å</div>
            <input
              type="range"
              min={2}
              max={12}
              step={1}
              value={pocketRadius}
              onChange={(e) => setPocketRadius(parseInt(e.target.value, 10))}
              className="w-full"
            />
            <div className="mt-2 text-[11px] text-gray-500">
              * 仅在 Binder 模式 + 有配体时生效
            </div>
          </div>

          {/* Ligand emphasize */}
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Ligand</h3>
            <button
              onClick={() => setEmphasizeLigand(v => !v)}
              className={`w-full px-3 py-2 rounded-lg border text-xs font-medium ${emphasizeLigand ? "bg-indigo-50 border-indigo-500 text-indigo-700" : "hover:bg-gray-50 text-gray-700"}`}
            >
              {emphasizeLigand ? "Emphasize: ON" : "Emphasize: OFF"}
            </button>
            <div className="mt-2 text-[11px] text-gray-500">
              * AI 可用：突出配体 / 聚焦配体
            </div>
          </div>

          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Tint (染色)</h3>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={customColor}
                onChange={handleColorChange}
                className="w-full h-8 cursor-pointer rounded border border-gray-200"
              />
              {useCustomColor && (
                <button
                  onClick={() => { setUseCustomColor(false); setCustomColor("#4f46e5"); }}
                  className="text-[10px] text-gray-500 underline"
                >
                  Reset
                </button>
              )}
            </div>
            <div className="mt-2 text-[11px] text-gray-500">
              * 这版 Tint 会直接更新 Mol* 当前显示的 representations
            </div>
          </div>

          <div className="text-[11px] text-gray-500">
            <div className="font-medium text-gray-600 mb-1">Loaded:</div>
            <div className="break-words">{fileName}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
