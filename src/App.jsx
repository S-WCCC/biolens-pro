import React, { useState, useEffect, useRef } from 'react';
import {
  Camera, Upload, Download, Layers, Maximize, AlertCircle,
  MessageSquare, Send, Share2, RefreshCw, Search, Droplet, Disc, Box, Monitor, Ghost
} from 'lucide-react';

/** -----------------------------
 *  Utilities: safe loader
 * ------------------------------*/
const loadScript = (src) => {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

const loadStyle = (href) => {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const COLOR_NAME_MAP = {
  red: '#ff0000', 红: '#ff0000',
  blue: '#4f46e5', 蓝: '#4f46e5',
  green: '#22c55e', 绿: '#22c55e',
  yellow: '#facc15', 黄: '#facc15',
  purple: '#a855f7', 紫: '#a855f7',
  orange: '#f97316', 橙: '#f97316',
  black: '#000000', 黑: '#000000',
  white: '#ffffff', 白: '#ffffff',
  cyan: '#06b6d4', 青: '#06b6d4',
  pink: '#ec4899', 粉: '#ec4899'
};

function normalizeHexColor(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (COLOR_NAME_MAP[s]) return COLOR_NAME_MAP[s];
  // #RRGGBB or RRGGBB
  const m = s.match(/^#?([0-9a-fA-F]{6})$/);
  if (m) return `#${m[1].toLowerCase()}`;
  return null;
}

function hexToInt(hex) {
  try {
    return parseInt(hex.replace('#', ''), 16);
  } catch {
    return 0x4f46e5;
  }
}

/** -----------------------------
 *  AI parsing (simple + robust)
 * ------------------------------*/
function parseAiCommand(raw) {
  const text = (raw || '').trim();
  const lower = text.toLowerCase();

  const intent = {
    raw: text,
    wantReset: false,
    wantInteractions: null, // true/false/null
    wantTint: null,         // { hex }
    wantOnlyChains: null,   // [ 'A','B' ] or null
    wantFocusChains: null,  // [ 'A','B' ] or null
    residueSelect: null,    // { chain, seq, aa } (aa optional)
    residueColor: null,     // hex
    wantFocusLigand: false,
    wantEmphasizeLigand: false,
    wantPocketRadius: null, // number
    wantPocketToggle: null  // true/false/null
  };

  // reset
  if (lower.includes('reset') || text.includes('复位') || text.includes('重置')) {
    intent.wantReset = true;
    return intent;
  }

  // interactions
  if (lower.includes('bond') || lower.includes('interaction') || text.includes('氢键') || text.includes('相互作用')) {
    intent.wantInteractions = true;
  }
  if (lower.includes('hide interactions') || text.includes('关闭相互作用') || text.includes('隐藏氢键')) {
    intent.wantInteractions = false;
  }

  // pocket radius / toggle
  // examples: "pocket 8", "口袋 6", "显示口袋 7Å", "关闭口袋"
  const pocketOff = lower.includes('pocket off') || text.includes('关闭口袋') || text.includes('隐藏口袋');
  const pocketOn = lower.includes('pocket on') || text.includes('显示口袋') || text.includes('打开口袋') || text.includes('开启口袋');
  if (pocketOff) intent.wantPocketToggle = false;
  if (pocketOn) intent.wantPocketToggle = true;

  const pr = text.match(/(?:pocket|口袋|pocket\s*radius|半径)\s*([0-9]{1,2})(?:\s*å|å|a|A)?/i)
         || text.match(/([0-9]{1,2})\s*(?:å|Å)\s*(?:pocket|口袋)/i);
  if (pr && pr[1]) {
    const r = clamp(parseInt(pr[1], 10), 2, 20);
    if (!Number.isNaN(r)) intent.wantPocketRadius = r;
  }

  // ligand focus/emphasize
  if (text.includes('配体') && (text.includes('放大') || text.includes('突出') || text.includes('强调') || lower.includes('emphasize'))) {
    intent.wantEmphasizeLigand = true;
  }
  if (text.includes('聚焦配体') || lower.includes('focus ligand') || (text.includes('配体') && text.includes('聚焦'))) {
    intent.wantFocusLigand = true;
  }

  // tint color: "染成红色/涂成#ff00ff/变成蓝"
  const colorWord = text.match(/(?:染色|涂成|变成|改成)\s*([#0-9a-fA-F]{6}|红|蓝|绿|黄|紫|橙|黑|白|青|粉|red|blue|green|yellow|purple|orange|black|white|cyan|pink)/i);
  if (colorWord && colorWord[1]) {
    const hx = normalizeHexColor(colorWord[1]);
    if (hx) intent.wantTint = { hex: hx };
  } else {
    // shorthand: "红", "blue"
    const shorthand = lower.match(/\b(red|blue|green|yellow|purple|orange|black|white|cyan|pink)\b/) || text.match(/[红蓝绿黄紫橙黑白青粉]/);
    if (shorthand) {
      const token = shorthand[1] || shorthand[0];
      const hx = normalizeHexColor(token);
      if (hx) intent.wantTint = { hex: hx };
    }
  }

  // chain intent
  // "只显示A链", "只看A链", "显示A链B链", "聚焦A链"
  const chainTokens = [];
  // matches: A链, b链, 1链
  const chainMatches = text.match(/[A-Za-z0-9]\s*链/g);
  if (chainMatches) {
    chainMatches.forEach(m => {
      const c = m.replace(/\s*链/g, '').trim().toUpperCase();
      if (c) chainTokens.push(c);
    });
  }

  if (chainTokens.length) {
    const only = text.includes('只显示') || text.includes('只看') || text.includes('仅显示') || lower.includes('only show');
    const focus = text.includes('聚焦') || lower.includes('focus');
    if (only) intent.wantOnlyChains = Array.from(new Set(chainTokens));
    else if (focus) intent.wantFocusChains = Array.from(new Set(chainTokens));
    else intent.wantFocusChains = Array.from(new Set(chainTokens)); // default: focus if chains mentioned
  }

  // residue selection:
  // examples:
  // "A链 57号残基", "A 57", "LYS57", "A:57"
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
    const aaSeq = text.match(new RegExp(`${aa}\\s*([0-9]{1,4})`, 'i'));
    if (aaSeq) seq = parseInt(aaSeq[1], 10);
  }

  // if residue mentioned but chain missing, we still accept seq-only highlight (less precise)
  if (seq && !Number.isNaN(seq)) {
    intent.residueSelect = { chain, seq, aa };
    // residue-specific color if user said "染成xx" or provided color
    if (intent.wantTint?.hex) intent.residueColor = intent.wantTint.hex;
  }

  return intent;
}

/** -----------------------------
 *  Component: BioLens
 * ------------------------------*/
const BioLens = () => {
  const containerRef = useRef(null);
  const pluginRef = useRef(null);

  // Data State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState("4hhb.pdb");
  const [pdbIdInput, setPdbIdInput] = useState("");

  // Visualization State
  const [currentStyle, setCurrentStyle] = useState('journal_nature');
  const [focusMode, setFocusMode] = useState('global');
  const [showInteractions, setShowInteractions] = useState(false);

  // Pocket (Binder upgrade)
  const [showPocket, setShowPocket] = useState(true);
  const [pocketRadius, setPocketRadius] = useState(6);

  // Ligand emphasis (AI can toggle)
  const [emphasizeLigand, setEmphasizeLigand] = useState(false);

  // Color State
  const [customColor, setCustomColor] = useState("#4f46e5");
  const [useCustomColor, setUseCustomColor] = useState(false);

  // AI Chat State
  const [aiInput, setAiInput] = useState("");
  const [aiHistory, setAiHistory] = useState([{ role: 'system', text: 'System Ready.' }]);

  useEffect(() => {
    const initViewer = async () => {
      try {
        if (!window.molstar) {
          loadStyle("https://cdn.jsdelivr.net/npm/molstar@latest/build/viewer/molstar.css");
          await loadScript("https://cdn.jsdelivr.net/npm/molstar@latest/build/viewer/molstar.js");
        }
        if (!window.molstar) throw new Error("Failed to load Mol* engine.");

        await new Promise(r => setTimeout(r, 80));

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

        pluginRef.current = viewer;
        await loadPdbFromUrl("https://files.rcsb.org/download/4hhb.pdb");
      } catch (e) {
        console.error("Init Error:", e);
        setError(`Initialization Failed: ${e.message}`);
        setLoading(false);
      }
    };

    initViewer();

    return () => {
      try {
        pluginRef.current?.dispose?.();
        pluginRef.current?.plugin?.dispose?.();
      } catch { }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getPluginContext = () => {
    const viewer = pluginRef.current;
    if (!viewer) return null;
    return viewer.plugin || viewer;
  };

  const getFormat = (str) => {
    if (!str) return 'pdb';
    const lower = str.toLowerCase();
    if (lower.endsWith('.cif') || lower.endsWith('.mmcif')) return 'mmcif';
    if (lower.endsWith('.bcif')) return 'bcif';
    return 'pdb';
  };

  const handlePdbFetch = async (e) => {
    e.preventDefault();
    if (!pdbIdInput || pdbIdInput.length < 4) {
      alert("请输入有效的 4 位 PDB ID (例如 1CRN)");
      return;
    }
    const id = pdbIdInput.toLowerCase();
    setFileName(id.toUpperCase());
    await loadPdbFromUrl(`https://files.rcsb.org/download/${id}.pdb`);
    setPdbIdInput("");
  };

  const loadPdbFromUrl = async (url) => {
    setLoading(true);
    setError(null);
    const ctx = getPluginContext();
    if (!ctx) return;

    try {
      await ctx.clear();

      const format = getFormat(url);

      const data = await ctx.builders.data.download({ url: url }, { state: { isGhost: true } });
      const trajectory = await ctx.builders.structure.parseTrajectory(data, format);
      const model = await ctx.builders.structure.createModel(trajectory);
      await ctx.builders.structure.createStructure(model);

      await applyStyle();

      ctx.managers.camera.reset();
      setLoading(false);
    } catch (e) {
      console.error("Download Error:", e);
      setError(`加载失败: ${e.message}。请检查网络或 PDB ID。`);
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setLoading(true);
    setError(null);

    const ctx = getPluginContext();
    if (!ctx) return;

    try {
      await ctx.clear();
      const format = getFormat(file.name);
      const isBinary = format === 'bcif';

      let data;
      if (isBinary) {
        const buffer = await file.arrayBuffer();
        data = await ctx.builders.data.rawData({ data: new Uint8Array(buffer), label: file.name });
      } else {
        const text = await file.text();
        data = await ctx.builders.data.rawData({ data: text, label: file.name });
      }

      const trajectory = await ctx.builders.structure.parseTrajectory(data, format);
      const model = await ctx.builders.structure.createModel(trajectory);
      await ctx.builders.structure.createStructure(model);

      await applyStyle();

      ctx.managers.camera.reset();
      setLoading(false);
    } catch (err) {
      console.error("Upload Error:", err);
      setError(`解析失败: ${err.message}`);
      setLoading(false);
    }
  };

  // 监听状态变化自动重绘（不在 loading/error 时触发）
  useEffect(() => {
    if (pluginRef.current && !loading && !error) {
      applyStyle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentStyle, focusMode, showInteractions,
    customColor, useCustomColor,
    showPocket, pocketRadius,
    emphasizeLigand
  ]);

  /** ------------------------------------------
   *  Internal cleanup: remove all old stuff
   * -------------------------------------------*/
  const removeOldAiAndPocketComponents = async (ctx, structureWrapper) => {
    try {
      const comps = structureWrapper?.components || [];
      const toRemove = comps.filter(c => {
        const label = c?.cell?.obj?.label || '';
        return (
          label.startsWith('AI:') ||
          label.startsWith('Pocket') ||
          label.startsWith('Ligand') ||
          label.startsWith('Binder') ||
          label.startsWith('Custom') ||
          label.startsWith('Selection')
        );
      });
      if (toRemove.length) {
        await ctx.managers.structure.hierarchy.remove(toRemove);
      }
    } catch { /* ignore */ }
  };

  /** ------------------------------------------
   *  Style applying: clean-slate + robust
   * -------------------------------------------*/
  const applyStyle = async (structureInput) => {
    const ctx = getPluginContext();
    if (!ctx) return;

    const hierarchy = ctx.managers.structure.hierarchy.current;

    let structure = structureInput;
    if (structureInput && !structureInput.components) {
      structure = hierarchy.structures.find(s => s.cell.obj?.id === structureInput.cell?.obj?.id) || hierarchy.structures[0];
    }
    if (!structure) structure = hierarchy.structures[0];
    if (!structure) return;

    try {
      // A. Canvas (safe + minimal fields used in your version)
      const canvas = ctx.canvas3d;
      if (canvas) {
        const props = {
          renderer: { backgroundColor: 0xffffff },
          postProcessing: {
            occlusion: { name: 'off', params: {} },
            outline: { name: 'off', params: {} },
          }
        };

        if (currentStyle === 'journal_nature') {
          props.renderer.backgroundColor = 0xffffff;
          props.postProcessing.occlusion = {
            name: 'on',
            params: { samples: 48, radius: 5, bias: 0.8, blurKernelSize: 15, resolutionScale: 1 }
          };
        } else if (currentStyle === 'journal_cell') {
          props.renderer.backgroundColor = 0xfdfbf7;
          props.postProcessing.outline = {
            name: 'on',
            params: { scale: 1.25, threshold: 0.33, color: 0x000000, includeTransparent: true }
          };
          props.postProcessing.occlusion = {
            name: 'on',
            params: { samples: 48, radius: 4, bias: 1.0, blurKernelSize: 11, resolutionScale: 1 }
          };
        } else if (currentStyle === 'glass') {
          props.renderer.backgroundColor = 0x000000;
          props.postProcessing.occlusion = {
            name: 'on',
            params: { samples: 32, radius: 6, bias: 0.7, blurKernelSize: 9, resolutionScale: 1 }
          };
          props.postProcessing.outline = {
            name: 'on',
            params: { scale: 1.0, threshold: 0.4, color: 0xffffff, includeTransparent: true }
          };
        } else if (currentStyle === 'hologram') {
          props.renderer.backgroundColor = 0x000000;
          props.postProcessing.outline = {
            name: 'on',
            params: { scale: 1.4, threshold: 0.25, color: 0x00ffcc, includeTransparent: true }
          };
        } else if (currentStyle === 'xray') {
          props.renderer.backgroundColor = 0x111111;
          props.postProcessing.outline = {
            name: 'on',
            params: { scale: 1.1, threshold: 0.35, color: 0xffffff, includeTransparent: true }
          };
        }

        try {
          canvas.setProps(props);
        } catch (e) {
          // keep running even if Mol* version changes something
          console.warn("canvas3d.setProps failed (non-fatal):", e);
        }
      }

      // B. Color setup
      const customColorInt = hexToInt(customColor);
      const colorTheme = useCustomColor ? 'uniform' : 'chain-id';
      const colorParams = useCustomColor ? { value: customColorInt } : {};

      // C. FULL clean slate:
      //    1) remove old components
      //    2) remove any representations on root
      //    3) remove AI/Pocket selection components
      try {
        const components = structure.components || [];
        if (components.length) {
          await ctx.managers.structure.hierarchy.remove(components);
        }
      } catch { /* ignore */ }

      try {
        const reps = structure.representations || [];
        if (reps.length) {
          await ctx.managers.structure.hierarchy.remove(reps);
        }
      } catch { /* ignore */ }

      await removeOldAiAndPocketComponents(ctx, structure);

      // D. Rebuild components & representations
      const MS = window.molstar?.MolScriptBuilder;

      // 1) Polymer component
      let polymerComp = null;
      try {
        const polymerQuery = ctx.managers.structure.selection.fromSelectionQuery('polymer');
        if (polymerQuery?.expression) {
          polymerComp = await ctx.builders.structure.tryCreateComponentFromExpression(
            structure.cell,
            polymerQuery.expression,
            'polymer',
            { label: 'Polymer', key: 'polymer' }
          );
        }
      } catch (e) {
        console.warn("Polymer component creation failed:", e);
      }

      // 2) Ligand component
      let ligandComp = null;
      let ligandQuery = null;
      try {
        ligandQuery = ctx.managers.structure.selection.fromSelectionQuery('ligand');
        if (ligandQuery?.expression) {
          ligandComp = await ctx.builders.structure.tryCreateComponentFromExpression(
            structure.cell,
            ligandQuery.expression,
            'ligand',
            { label: 'Ligand' }
          );
        }
      } catch (e) {
        console.warn("Ligand creation failed:", e);
      }

      // 3) Draw polymer (or fallback)
      if (polymerComp) {
        if (currentStyle === 'journal_cell') {
          await ctx.builders.structure.representation.addRepresentation(polymerComp, {
            type: 'putty',
            color: colorTheme,
            colorParams
          });
        } else if (currentStyle === 'glass') {
          // stronger "glass" feel: surface + spacefill + cartoon
          await ctx.builders.structure.representation.addRepresentation(polymerComp, {
            type: 'molecular-surface',
            typeParams: { alpha: 0.10, flatShaded: true, doubleSided: true, ignoreLight: false },
            color: 'uniform',
            colorParams: { value: 0xffffff }
          });
          await ctx.builders.structure.representation.addRepresentation(polymerComp, {
            type: 'spacefill',
            typeParams: { alpha: 0.30, ignoreLight: false },
            color: colorTheme,
            colorParams
          });
          await ctx.builders.structure.representation.addRepresentation(polymerComp, {
            type: 'cartoon',
            typeParams: { sizeFactor: 0.95 },
            color: colorTheme,
            colorParams
          });
        } else if (currentStyle === 'hologram') {
          const neonColor = useCustomColor ? customColorInt : 0x00ffcc;
          await ctx.builders.structure.representation.addRepresentation(polymerComp, {
            type: 'cartoon',
            typeParams: { sizeFactor: 0.08 },
            color: 'uniform',
            colorParams: { value: neonColor }
          });
          await ctx.builders.structure.representation.addRepresentation(polymerComp, {
            type: 'ball-and-stick',
            typeParams: { sizeFactor: 0.08 },
            color: 'uniform',
            colorParams: { value: 0xffffff }
          });
        } else if (currentStyle === 'xray') {
          await ctx.builders.structure.representation.addRepresentation(polymerComp, {
            type: 'molecular-surface',
            typeParams: { alpha: 0.12, flatShaded: true, doubleSided: true, ignoreLight: true },
            color: 'uniform',
            colorParams: { value: 0xffffff }
          });
          // FIX: polymerComp (not polymerComponent)
          await ctx.builders.structure.representation.addRepresentation(polymerComp, {
            type: 'cartoon',
            typeParams: { sizeFactor: 0.9 },
            color: 'uniform',
            colorParams: { value: 0xffffff }
          });
        } else {
          await ctx.builders.structure.representation.addRepresentation(polymerComp, {
            type: 'cartoon',
            typeParams: { sizeFactor: 1.0 },
            color: colorTheme,
            colorParams
          });
        }
      } else {
        // fallback draw everything
        await ctx.builders.structure.representation.addRepresentation(structure.cell, {
          type: 'ball-and-stick',
          color: colorTheme,
          colorParams
        });
      }

      // 4) Draw ligand (always element colored, but can be emphasized)
      if (ligandComp) {
        await ctx.builders.structure.representation.addRepresentation(ligandComp, {
          type: 'ball-and-stick',
          typeParams: { sizeFactor: emphasizeLigand ? 0.75 : 0.45 },
          color: 'element-symbol'
        });

        // optional: emphasize ligand with subtle surface "halo"
        if (emphasizeLigand) {
          await ctx.builders.structure.representation.addRepresentation(ligandComp, {
            type: 'molecular-surface',
            typeParams: { alpha: 0.25, flatShaded: true, doubleSided: true, ignoreLight: false },
            color: 'uniform',
            colorParams: { value: 0xffffff }
          });
        }

        if (focusMode === 'binder') {
          try {
            const loci = ctx.managers.structure.selection.getLoci(ligandComp.obj.data);
            ctx.managers.camera.focusLoci(loci);
          } catch { /* ignore */ }
        }
      }

      // 5) Binder pocket highlight (near ligand)
      if (focusMode === 'binder' && showPocket && ligandComp && MS) {
        try {
          const includeSurroundings = MS?.struct?.modifier?.includeSurroundings;
          if (typeof includeSurroundings === 'function' && ligandQuery?.expression) {
            const pocketExp = includeSurroundings({
              0: ligandQuery.expression,
              radius: clamp(parseFloat(pocketRadius), 2, 20),
              'as-whole-residues': true
            });

            const pocketComp = await ctx.builders.structure.tryCreateComponentFromExpression(
              structure.cell,
              pocketExp,
              'pocket',
              { label: `Pocket ${clamp(parseFloat(pocketRadius), 2, 20)}Å` }
            );

            if (pocketComp) {
              await ctx.builders.structure.representation.addRepresentation(pocketComp, {
                type: 'ball-and-stick',
                typeParams: { sizeFactor: 0.23 },
                color: 'uniform',
                colorParams: { value: 0xffd400 }
              });
              await ctx.builders.structure.representation.addRepresentation(pocketComp, {
                type: 'molecular-surface',
                typeParams: { alpha: 0.12, flatShaded: true, doubleSided: true, ignoreLight: false },
                color: 'uniform',
                colorParams: { value: 0xffd400 }
              });
            }
          } else {
            // Mol* API mismatch: fallback silently (no crash)
            // still binder focus works
          }
        } catch (e) {
          console.warn("Pocket creation failed (non-fatal):", e);
        }
      }

      // 6) Interactions
      if (showInteractions) {
        try {
          await ctx.builders.structure.representation.addRepresentation(structure.cell, {
            type: 'interactions',
            typeParams: { lineSizeFactor: 0.05, includeCovalent: false },
            color: 'interaction-type'
          });
        } catch (e) {
          console.warn("Interactions add failed (non-fatal):", e);
        }
      }

    } catch (styleErr) {
      console.error("Style Apply Error:", styleErr);
    }
  };

  const toggleInteractions = () => setShowInteractions(v => !v);

  const handleColorChange = (e) => {
    setCustomColor(e.target.value);
    setUseCustomColor(true);
  };

  const resetView = async () => {
    setUseCustomColor(false);
    setCustomColor("#4f46e5");
    setShowInteractions(false);
    setEmphasizeLigand(false);
    setCurrentStyle('journal_nature');
    setFocusMode('global');
    setShowPocket(true);
    setPocketRadius(6);
    const ctx = getPluginContext();
    if (ctx) ctx.managers.camera.reset();
  };

  const takeScreenshot = () => {
    const ctx = getPluginContext();
    if (ctx?.helpers?.viewportScreenshot?.share) {
      ctx.helpers.viewportScreenshot.share();
    } else {
      try {
        const canvas = containerRef.current?.querySelector('canvas');
        if (canvas) {
          const image = canvas.toDataURL("image/png");
          const link = document.createElement('a');
          link.href = image;
          link.download = `BioLens-${Date.now()}.png`;
          link.click();
        }
      } catch { }
    }
  };

  /** ------------------------------------------
   *  AI actions executor (safe)
   * -------------------------------------------*/
  const ensureStructure = (ctx) => {
    const s = ctx?.managers?.structure?.hierarchy?.current?.structures?.[0];
    return s || null;
  };

  const clearAiSelectionsOnly = async (ctx, structureWrapper) => {
    try {
      const comps = structureWrapper?.components || [];
      const toRemove = comps.filter(c => {
        const label = c?.cell?.obj?.label || '';
        return label.startsWith('AI:');
      });
      if (toRemove.length) await ctx.managers.structure.hierarchy.remove(toRemove);
    } catch { /* ignore */ }
  };

  const addAiResidueHighlight = async (ctx, structureWrapper, residue, colorHex) => {
    const MS = window.molstar?.MolScriptBuilder;
    if (!MS) return { ok: false, reason: "MolScriptBuilder missing" };

    const seq = residue?.seq;
    if (!seq || Number.isNaN(seq)) return { ok: false, reason: "Residue seq missing" };
    const chain = residue?.chain ? String(residue.chain).toUpperCase() : null;

    const colorInt = hexToInt(colorHex || '#ff0000');

    // Build expression:
    // - if chain exists: chain-test + residue-test
    // - else: residue-test only (less precise but useful)
    let exp;
    if (chain) {
      exp = MS.struct.generator.atomGroups({
        'chain-test': MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), chain]),
        'residue-test': MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_seq_id(), seq]),
      });
    } else {
      exp = MS.struct.generator.atomGroups({
        'residue-test': MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_seq_id(), seq]),
      });
    }

    const label = chain ? `AI:${chain}:${seq}` : `AI:res:${seq}`;

    const comp = await ctx.builders.structure.tryCreateComponentFromExpression(
      structureWrapper.cell,
      exp,
      'ai-residue',
      { label }
    );

    if (!comp) return { ok: false, reason: "Component create failed" };

    await ctx.builders.structure.representation.addRepresentation(comp, {
      type: 'ball-and-stick',
      typeParams: { sizeFactor: 0.38 },
      color: 'uniform',
      colorParams: { value: colorInt }
    });

    // soft surface halo
    await ctx.builders.structure.representation.addRepresentation(comp, {
      type: 'molecular-surface',
      typeParams: { alpha: 0.15, flatShaded: true, doubleSided: true, ignoreLight: false },
      color: 'uniform',
      colorParams: { value: colorInt }
    });

    try {
      const loci = ctx.managers.structure.selection.getLoci(comp.obj.data);
      ctx.managers.camera.focusLoci(loci);
    } catch { /* ignore */ }

    return { ok: true };
  };

  const showOnlyChains = async (ctx, chains) => {
    const MS = window.molstar?.MolScriptBuilder;
    const structureWrapper = ensureStructure(ctx);
    if (!MS || !structureWrapper) return { ok: false };

    const unique = Array.from(new Set((chains || []).map(c => String(c).toUpperCase()).filter(Boolean)));
    if (!unique.length) return { ok: false };

    // Clear everything then create selection component and draw it.
    // We do NOT permanently change core logic; we rely on applyStyle by switching polymer rendering via custom selection.
    // Implementation: create AI component that contains only selected chains, render it, and hide others by not rendering them.
    // To ensure not fighting with applyStyle, we set style to nature (or keep current) and then wipe and draw only AI component.
    // Easiest + robust: clear structure components and rebuild only selection.
    try {
      // remove all components & reps first
      const comps = structureWrapper.components || [];
      if (comps.length) await ctx.managers.structure.hierarchy.remove(comps);
      const reps = structureWrapper.representations || [];
      if (reps.length) await ctx.managers.structure.hierarchy.remove(reps);
    } catch { /* ignore */ }

    const chainExp = MS.struct.generator.atomGroups({
      'chain-test': MS.core.logic.or(
        unique.map(c => MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), c]))
      )
    });

    const comp = await ctx.builders.structure.tryCreateComponentFromExpression(
      structureWrapper.cell,
      chainExp,
      'ai-only-chains',
      { label: `AI:Only ${unique.join('+')}` }
    );

    if (!comp) return { ok: false };

    // draw with current style logic (simpler: cartoon)
    const customColorInt = hexToInt(customColor);
    const colorTheme = useCustomColor ? 'uniform' : 'chain-id';
    const colorParams = useCustomColor ? { value: customColorInt } : {};

    await ctx.builders.structure.representation.addRepresentation(comp, {
      type: 'cartoon',
      typeParams: { sizeFactor: 1.0 },
      color: colorTheme,
      colorParams
    });

    try {
      const loci = ctx.managers.structure.selection.getLoci(comp.obj.data);
      ctx.managers.camera.focusLoci(loci);
    } catch { /* ignore */ }

    return { ok: true };
  };

  const focusChains = async (ctx, chains) => {
    const MS = window.molstar?.MolScriptBuilder;
    const structureWrapper = ensureStructure(ctx);
    if (!MS || !structureWrapper) return { ok: false };

    const unique = Array.from(new Set((chains || []).map(c => String(c).toUpperCase()).filter(Boolean)));
    if (!unique.length) return { ok: false };

    const chainExp = MS.struct.generator.atomGroups({
      'chain-test': MS.core.logic.or(
        unique.map(c => MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), c]))
      )
    });

    await clearAiSelectionsOnly(ctx, structureWrapper);

    const comp = await ctx.builders.structure.tryCreateComponentFromExpression(
      structureWrapper.cell,
      chainExp,
      'ai-focus-chains',
      { label: `AI:Focus ${unique.join('+')}` }
    );

    if (!comp) return { ok: false };

    await ctx.builders.structure.representation.addRepresentation(comp, {
      type: 'ball-and-stick',
      typeParams: { sizeFactor: 0.16 },
      color: 'chain-id'
    });

    try {
      const loci = ctx.managers.structure.selection.getLoci(comp.obj.data);
      ctx.managers.camera.focusLoci(loci);
    } catch { /* ignore */ }

    return { ok: true };
  };

  const focusLigandIfAny = async (ctx) => {
    const structureWrapper = ensureStructure(ctx);
    if (!structureWrapper) return { ok: false };

    // We can reuse your ligand query
    try {
      const ligandQuery = ctx.managers.structure.selection.fromSelectionQuery('ligand');
      if (!ligandQuery?.expression) return { ok: false };

      const ligandComp = await ctx.builders.structure.tryCreateComponentFromExpression(
        structureWrapper.cell,
        ligandQuery.expression,
        'ai-ligand',
        { label: 'AI:Ligand' }
      );

      if (!ligandComp) return { ok: false };

      await ctx.builders.structure.representation.addRepresentation(ligandComp, {
        type: 'ball-and-stick',
        typeParams: { sizeFactor: 0.75 },
        color: 'element-symbol'
      });

      const loci = ctx.managers.structure.selection.getLoci(ligandComp.obj.data);
      ctx.managers.camera.focusLoci(loci);
      return { ok: true };
    } catch (e) {
      console.warn("focusLigand failed:", e);
      return { ok: false };
    }
  };

  const handleAiSubmit = async (e) => {
    e.preventDefault();
    if (!aiInput.trim()) return;

    const userText = aiInput;
    setAiHistory(prev => [...prev, { role: 'user', text: userText }]);
    setAiInput("");

    let reply = "指令已接收。";
    const ctx = getPluginContext();

    try {
      const intent = parseAiCommand(userText);

      if (intent.wantReset) {
        await resetView();
        reply = "视图已重置。";
        setAiHistory(prev => [...prev, { role: 'system', text: reply }]);
        return;
      }

      // interactions toggle
      if (intent.wantInteractions === true) {
        setShowInteractions(true);
      } else if (intent.wantInteractions === false) {
        setShowInteractions(false);
      }

      // pocket toggle/radius
      if (typeof intent.wantPocketToggle === 'boolean') setShowPocket(intent.wantPocketToggle);
      if (typeof intent.wantPocketRadius === 'number') setPocketRadius(intent.wantPocketRadius);

      // tint (global) only if NOT residue-specific request
      // If residueSelect present and residueColor present -> residue highlight takes priority.
      if (intent.wantTint?.hex && !intent.residueSelect) {
        setCustomColor(intent.wantTint.hex);
        setUseCustomColor(true);
      }

      // emphasize ligand
      if (intent.wantEmphasizeLigand) setEmphasizeLigand(true);

      // chain actions
      if (ctx && intent.wantOnlyChains?.length) {
        const r = await showOnlyChains(ctx, intent.wantOnlyChains);
        reply = r.ok ? `已仅显示 ${intent.wantOnlyChains.join(' ')} 链。` : "只显示链失败（可能未加载结构）。";
        setAiHistory(prev => [...prev, { role: 'system', text: reply }]);
        return; // prevent applyStyle conflict
      }

      if (ctx && intent.wantFocusChains?.length) {
        const r = await focusChains(ctx, intent.wantFocusChains);
        reply = r.ok ? `已聚焦 ${intent.wantFocusChains.join(' ')} 链。` : "聚焦链失败（可能未加载结构）。";
        setAiHistory(prev => [...prev, { role: 'system', text: reply }]);
        return;
      }

      // residue highlight
      if (ctx && intent.residueSelect && intent.residueColor) {
        const structureWrapper = ensureStructure(ctx);
        if (structureWrapper) {
          await clearAiSelectionsOnly(ctx, structureWrapper);
          const r = await addAiResidueHighlight(ctx, structureWrapper, intent.residueSelect, intent.residueColor);
          reply = r.ok
            ? `已高亮 ${intent.residueSelect.chain ? intent.residueSelect.chain + '链 ' : ''}${intent.residueSelect.seq} 号残基并染色。`
            : "残基选择失败（可能残基编号/链不存在）。";
          setAiHistory(prev => [...prev, { role: 'system', text: reply }]);
          return;
        }
      }

      // focus ligand
      if (ctx && (intent.wantFocusLigand || intent.wantEmphasizeLigand)) {
        const r = await focusLigandIfAny(ctx);
        reply = r.ok ? "已聚焦并突出显示配体。" : "未检测到配体（或聚焦失败）。";
        setAiHistory(prev => [...prev, { role: 'system', text: reply }]);
        return;
      }

      // fallback replies for simple commands (old behavior preserved)
      const lower = userText.toLowerCase();
      if (lower.includes("red") || userText.includes("红")) {
        setCustomColor("#ff0000");
        setUseCustomColor(true);
        reply = "已染色为红色。";
      } else if (lower.includes("blue") || userText.includes("蓝")) {
        setCustomColor("#4f46e5");
        setUseCustomColor(true);
        reply = "已染色为蓝色。";
      } else if (lower.includes("bond") || lower.includes("interaction") || userText.includes("氢键")) {
        setShowInteractions(true);
        reply = "已显示相互作用。";
      } else if (intent.wantPocketRadius) {
        reply = `Pocket 半径已设置为 ${intent.wantPocketRadius}Å。`;
      } else if (typeof intent.wantPocketToggle === 'boolean') {
        reply = intent.wantPocketToggle ? "已开启 Pocket 高亮。" : "已关闭 Pocket 高亮。";
      } else if (intent.wantTint?.hex) {
        reply = `已设置染色为 ${intent.wantTint.hex}。`;
      } else {
        reply = "我理解了你的指令，但未匹配到可执行动作。试试：只显示A链 / A链57号染红 / 显示口袋8Å / 聚焦配体。";
      }

    } catch (err) {
      console.error(err);
      reply = "指令解析失败。";
    }

    setAiHistory(prev => [...prev, { role: 'system', text: reply }]);
  };

  const styles = [
    { id: 'journal_nature', name: 'Nature', icon: Droplet },
    { id: 'journal_cell', name: 'Cell', icon: Disc },
    { id: 'glass', name: 'Glass', icon: Box },
    { id: 'hologram', name: 'Holo', icon: Monitor },
    { id: 'xray', name: 'X-Ray', icon: Ghost },
  ];

  const modes = [
    { id: 'global', name: 'Global', icon: Maximize },
    { id: 'binder', name: 'Binder', icon: Layers },
  ];

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

        {/* Fetch & Upload Bar */}
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
              className={`flex items-center gap-2 px-4 py-2 rounded-full shadow-lg border ${showInteractions ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700'}`}
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
                  className={`p-2 rounded-lg border text-xs font-medium transition-colors ${currentStyle === s.id ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'hover:bg-gray-50'}`}
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
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-medium ${focusMode === m.id ? 'bg-gray-800 text-white' : 'hover:bg-gray-50'}`}
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
                className={`px-2 py-1 rounded text-[11px] border ${showPocket ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'hover:bg-gray-50 text-gray-600'}`}
              >
                {showPocket ? 'ON' : 'OFF'}
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
          </div>

          <div className="text-[11px] text-gray-500">
            <div className="font-medium text-gray-600 mb-1">Loaded:</div>
            <div className="break-words">{fileName}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BioLens;
