'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Upload, Search, AlertCircle, RefreshCw, MessageSquare, Send,
  Cpu, Layers, Sparkles, Wand2, Palette,
  MousePointer2, CircleDashed, Link2, Target, Microscope, ScanSearch
} from 'lucide-react';

/**
 * BioLens Agent Pro - DeepSeek Edition (Fixed)
 * - Improved JSON parsing logic for residue IDs
 * - Enhanced Mol* visualization sync with debug logs
 */

// -----------------------------------------------------------------------------
// 1. Static Configuration
// -----------------------------------------------------------------------------
const loadMolstarResources = () => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') { resolve(); return; }
    if (window.molstar) { resolve(); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/molstar@latest/build/viewer/molstar.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/molstar@latest/build/viewer/molstar.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Mol* script'));
    document.head.appendChild(script);
  });
};

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v)));
const isHexColor = (s) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.trim());
const hexToInt = (hex) => parseInt(String(hex).replace('#', ''), 16);
const mkId = () => `ov_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const STYLES = {
  cartoon: { label: 'Cartoon', type: 'cartoon', param: { alpha: 1 } },
  surface: { label: 'Surface', type: 'molecular-surface', param: { alpha: 0.9, quality: 'auto' } },
  bns: { label: 'Ball & Stick', type: 'ball-and-stick', param: { sizeFactor: 0.2 } },
  spacefill: { label: 'Spacefill', type: 'spacefill', param: {} },
};

const JOURNAL_PRESETS = {
  default: { label: 'Standard', bgColor: 0xf8f9fa, style: 'cartoon', color: 'chain', lighting: 'flat' },
  nature: { label: 'Nature (Paper)', bgColor: 0xffffff, style: 'cartoon', color: 'chain', lighting: 'occlusion', param: { alpha: 1.0 } },
  dark: { label: 'Dark (Pymol)', bgColor: 0x000000, style: 'cartoon', color: 'element', lighting: 'plastic' },
  hologram: { label: 'Hologram (Cyber)', bgColor: 0x000000, style: 'bns', color: 'uniform', customColor: 0x00ffcc, lighting: 'flat' }
};

const COLORS = {
  chain: { label: 'By Chain', type: 'chain-id' },
  element: { label: 'By Element', type: 'element-symbol' },
  hydro: { label: 'Hydrophobicity', type: 'hydrophobicity' },
  rainbow: { label: 'Rainbow', type: 'sequence-id' },
  uniform: { label: 'Uniform', type: 'uniform' }
};

// -----------------------------------------------------------------------------
// 2. Main Component
// -----------------------------------------------------------------------------
const BioLensApp = () => {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const chatEndRef = useRef(null);

  // --- State ---
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [pdbId, setPdbId] = useState('4HHB');
  const [fileName, setFileName] = useState('4HHB');
  const [toast, setToast] = useState(null);

  // Visual
  const [activePreset, setActivePreset] = useState('default');
  const [activeStyle, setActiveStyle] = useState('cartoon');
  const [activeColorMode, setActiveColorMode] = useState('chain');
  const [customColor, setCustomColor] = useState('#4f46e5');

  const [showWater, setShowWater] = useState(false);
  const [showLigands, setShowLigands] = useState(true);

  // Opacity
  const [polymerOpacity, setPolymerOpacity] = useState(1.0);
  const [ligandOpacity, setLigandOpacity] = useState(1.0);
  const [waterOpacity, setWaterOpacity] = useState(0.4);

  // Interaction
  const [clickMode, setClickMode] = useState('pick');
  const [agentOverlays, setAgentOverlays] = useState([]);

  // Chat
  const [messages, setMessages] = useState([
    { role: 'system', content: 'Agent Ready. 选择“操作/问答”，然后输入：例如 “把A链100号残基变红”。' }
  ]);
  const [inputMsg, setInputMsg] = useState('');
  const [agentBusy, setAgentBusy] = useState(false);
  const [chatMode, setChatMode] = useState('command');

  // Spin
  const [spinState, setSpinState] = useState({ enabled: false, speed: 1.0 });

  // Helpers
  const showToastMsg = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const pushSystemLog = useCallback((text) => {
    setMessages((prev) => [...prev, { role: 'system', content: `[UI] ${text}` }]);
  }, []);

  const getPlugin = useCallback(() => viewerRef.current?.plugin, []);

  const getCurrentStructureWrapper = useCallback((plugin) => {
    try {
      return plugin?.managers?.structure?.hierarchy?.current?.structures?.[0] || null;
    } catch {
      return null;
    }
  }, []);

  const getStructureData = useCallback((plugin) => {
    try {
      const sw = getCurrentStructureWrapper(plugin);
      return sw?.cell?.obj?.data || null;
    } catch {
      return null;
    }
  }, [getCurrentStructureWrapper]);

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const init = async () => {
      try {
        await loadMolstarResources();
        if (!window.molstar) return;

        const viewer = await window.molstar.Viewer.create(containerRef.current, {
          layoutIsExpanded: false,
          layoutShowControls: false,
          layoutShowRemoteState: false,
          layoutShowSequence: true,
          viewportShowExpand: false,
          viewportShowSelectionMode: true,
          viewportShowAnimation: true,
        });

        viewerRef.current = viewer;
        await handleFetchPdb('4HHB');
        setLoading(false);
      } catch (e) {
        console.error(e);
        setError('Init Error: ' + e.message);
        setLoading(false);
      }
    };

    init();
    return () => viewerRef.current?.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Click Listener
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (loading) return;
    const plugin = getPlugin();
    if (!plugin) return;

    const clickSub = plugin.behaviors.interaction.click.subscribe(async (e) => {
      if (clickMode === 'pick') return;

      const currentLoci = e.current.loci;
      const MS = window.molstar?.MolScriptBuilder;

      if (MS && currentLoci.kind === 'element-loci' && currentLoci.elements.length > 0) {
        try {
          const structure = currentLoci.structure;
          const unit = currentLoci.elements[0].unit;
          const index = currentLoci.elements[0].indices[0];

          const SP = window.molstar.StructureProperties;
          const SE = window.molstar.StructureElement;

          if (SP && SE) {
            const loc = SE.Location.create(structure, unit, index);
            const seqId = SP.residue.auth_seq_id(loc);
            const chainId = SP.chain.auth_asym_id(loc);
            const resName = SP.residue.label_comp_id(loc);

            let newOverlay = null;
            let feedbackMsg = '';
            const id = mkId();

            if (clickMode === 'zone5') {
              newOverlay = { id, type: 'zone', target: `${seqId}`, targetChain: chainId, radius: 5, color: '#ff0055', rawSeqId: seqId };
              feedbackMsg = `Zone 5Å: Residue ${resName} ${seqId} (Chain ${chainId})`;
            } else if (clickMode === 'hbond') {
              newOverlay = { id, type: 'residue', target: `${seqId}-${seqId}`, targetChain: chainId, interaction: true, color: '#ffff00', style: 'ball-and-stick' };
              feedbackMsg = `H-Bonds: Residue ${resName} ${seqId} (Chain ${chainId})`;
            }

            if (newOverlay) {
              setAgentOverlays((prev) => [...prev, newOverlay]);
              showToastMsg(feedbackMsg);
              setMessages((prev) => [...prev, { role: 'system', content: `[Click] ${feedbackMsg}` }]);
            }
          }
        } catch (err) {
          console.warn('Click error:', err);
        }
      }
    });

    return () => clickSub.unsubscribe();
  }, [clickMode, loading, getPlugin]);

  // ---------------------------------------------------------------------------
  // Spin loop
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (loading) return;
    if (!spinState.enabled) return;

    const plugin = getPlugin();
    const camera = plugin?.canvas3d?.camera;
    const requestDraw = plugin?.canvas3d?.requestDraw?.bind(plugin.canvas3d);

    let raf = 0;
    let last = performance.now();

    const step = (t) => {
      const dt = Math.max(0, t - last);
      last = t;
      const delta = (dt / 16.6667) * 0.01 * (Number(spinState.speed) || 1);
      try {
        if (camera?.rotate) {
          camera.rotate(delta, 0);
          requestDraw && requestDraw();
        }
      } catch {}
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [spinState.enabled, spinState.speed, loading, getPlugin]);

  // ---------------------------------------------------------------------------
  // Core: Visual Sync (FIXED)
  // ---------------------------------------------------------------------------
  const syncVisuals = useCallback(async () => {
    const plugin = getPlugin();
    if (!plugin) {
      console.warn('[Sync] Plugin not found');
      return;
    }
    
    // Check if hierarchy exists
    if (!plugin.managers?.structure?.hierarchy?.current?.structures) {
        return;
    }
    
    const hierarchy = plugin.managers.structure.hierarchy.current;
    if (!hierarchy.structures.length) {
      // No structure loaded yet, silent return
      return;
    }

    console.log('[Sync] Starting visual sync with overlays:', agentOverlays);

    try {
      await plugin.dataTransaction(async () => {
        const structure = hierarchy.structures[0];
        const state = plugin.state.data;
        const hasSel = (sel) => {
          const ref = sel?.cell?.transform?.ref ?? sel?.ref;
          return !!ref && state.cells.has(ref);
        };

        if (!structure || !structure.cell) return;

        // 1) Environment
        const canvas = plugin.canvas3d;
        const preset = JOURNAL_PRESETS[activePreset] || JOURNAL_PRESETS.default;
        if (canvas && preset) {
          const rendererProps = { backgroundColor: preset.bgColor };
          const postProps = { occlusion: { name: 'off', params: {} }, outline: { name: 'off', params: {} } };
          if (preset.lighting === 'occlusion') postProps.occlusion = { name: 'on', params: { samples: 32, radius: 5, bias: 0.8 } };
          else if (preset.lighting === 'plastic') rendererProps.style = { name: 'matte' };
          canvas.setProps({ renderer: rendererProps, postProcessing: postProps });
        }

        // 2) Clean components
        const currentComponents = structure.components;
        const componentsToDelete = [];
        for (const c of currentComponents) {
          if (c.cell && state.cells.has(c.cell.transform.ref)) componentsToDelete.push(c);
        }
        if (componentsToDelete.length > 0) await plugin.managers.structure.hierarchy.remove(componentsToDelete);

        // 3) Render polymer base
        const polymerComp = await plugin.builders.structure.tryCreateComponentStatic(structure.cell, 'polymer');
        if (polymerComp && hasSel(polymerComp)) {
          let colorProps = { name: COLORS[activeColorMode]?.type || 'chain-id' };
          if (activeColorMode === 'uniform') colorProps = { name: 'uniform', params: { value: hexToInt(customColor) } };
          if (activePreset === 'hologram') colorProps = { name: 'uniform', params: { value: JOURNAL_PRESETS.hologram.customColor } };

          const styleConfig = STYLES[activeStyle] || STYLES.cartoon;
          const typeParams = { ...(styleConfig.param || {}), alpha: clamp01(polymerOpacity) };

          await plugin.builders.structure.representation.addRepresentation(polymerComp, {
            type: styleConfig.type,
            typeParams,
            color: colorProps.name,
            colorParams: colorProps.params,
          });
        }

        // 4) Ligands / Water
        if (showLigands) {
          const ligandComp = await plugin.builders.structure.tryCreateComponentStatic(structure.cell, 'ligand');
          if (ligandComp && hasSel(ligandComp)) {
            await plugin.builders.structure.representation.addRepresentation(ligandComp, {
              type: 'ball-and-stick',
              color: 'element-symbol',
              typeParams: { alpha: clamp01(ligandOpacity) }
            });
          }
        }

        if (showWater) {
          const waterComp = await plugin.builders.structure.tryCreateComponentStatic(structure.cell, 'water');
          if (waterComp && hasSel(waterComp)) {
            await plugin.builders.structure.representation.addRepresentation(waterComp, {
              type: 'ball-and-stick',
              color: 'uniform',
              colorParams: { value: 0x88ccff },
              typeParams: { alpha: clamp01(waterOpacity) }
            });
          }
        }

        // 5) AGENT OVERLAYS (Visual Logic)
        const MS = window.molstar?.MolScriptBuilder;
        if (!MS) {
            console.error('[Sync] MolScriptBuilder missing');
            return;
        }

        for (const overlay of agentOverlays) {
          console.log('[Sync] Processing overlay:', overlay);
          let expression = null;
          
          // Helper: Chain test (insensitive or trim?) - kept simple
          const chainTest = overlay.targetChain
            ? MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), overlay.targetChain])
            : null;

          // Global H-bonds
          if (overlay.type === 'global-hbond') {
            const allPolymers = MS.struct.generator.atomGroups({
              'entity-test': MS.core.rel.eq([MS.struct.atomProperty.macromolecular.entityType(), 'polymer'])
            });
            const selComp = await plugin.builders.structure.tryCreateComponentFromExpression(
              structure.cell, allPolymers, overlay.id, { label: 'Global H-Bonds' }
            );
            if (selComp && hasSel(selComp)) {
              await plugin.builders.structure.representation.addRepresentation(selComp, {
                type: 'interactions',
                typeParams: { includeCovalent: false, interactionTypes: ['hydrogen-bond', 'weak-hydrogen-bond', 'ionic', 'pi-pi'], sizeFactor: 0.2 }
              });
            }
            continue;
          }

          if (overlay.type === 'chain') {
            expression = MS.struct.generator.atomGroups({
              'chain-test': MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), overlay.target])
            });
          } 
          else if (overlay.type === 'residue') {
            // "start-end" or "val"
            const parts = String(overlay.target).split('-');
            const start = Number(parts[0]);
            const end = parts.length > 1 ? Number(parts[1]) : start;
            
            if (!isNaN(start)) {
                const resTest = MS.core.logic.and([
                  MS.core.rel.gr([MS.struct.atomProperty.macromolecular.auth_seq_id(), start - 1]),
                  MS.core.rel.lt([MS.struct.atomProperty.macromolecular.auth_seq_id(), end + 1])
                ]);
                expression = MS.struct.generator.atomGroups({
                  'residue-test': resTest,
                  ...(chainTest ? { 'chain-test': chainTest } : {})
                });
            }
          } 
          else if (overlay.type === 'zone') {
            const centerExp = MS.struct.generator.atomGroups({
              'residue-test': MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_seq_id(), Number(overlay.rawSeqId)]),
              ...(chainTest ? { 'chain-test': chainTest } : {})
            });
            expression = MS.struct.modifier.includeSurroundings({
              0: centerExp,
              radius: overlay.radius || 5,
              'as-whole-residues': true
            });
          } 
          else if (overlay.type === 'ligand-surround') {
            const ligExp = MS.struct.generator.atomGroups({
              'entity-test': MS.core.rel.eq([MS.struct.atomProperty.macromolecular.entityType(), 'non-polymer'])
            });
            expression = MS.struct.modifier.includeSurroundings({
              0: ligExp,
              radius: 5,
              'as-whole-residues': true
            });
          } 
          else if (overlay.type === 'ligand') {
             const entityTest = MS.core.rel.eq([MS.struct.atomProperty.macromolecular.entityType(), 'non-polymer']);
             const resName = String(overlay.resName || '').trim().toUpperCase();
             const compIdFn = MS.struct.atomProperty?.macromolecular?.label_comp_id;
             if (resName && typeof compIdFn === 'function') {
               expression = MS.struct.generator.atomGroups({
                 'entity-test': entityTest,
                 'resname-test': MS.core.rel.eq([compIdFn(), resName])
               });
             } else {
               expression = MS.struct.generator.atomGroups({ 'entity-test': entityTest });
             }
          }

          if (!expression) continue;

          // Create Selection Component
          const selComp = await plugin.builders.structure.tryCreateComponentFromExpression(
            structure.cell,
            expression,
            overlay.id,
            { label: overlay.label || 'Overlay' }
          );

          if (!selComp || !hasSel(selComp)) {
              console.warn('[Sync] Empty selection created for:', overlay);
              continue;
          }

          // Add Representation
          if (overlay.interaction) {
            await plugin.builders.structure.representation.addRepresentation(selComp, {
              type: 'interactions', typeParams: { includeCovalent: false }
            });
            await plugin.builders.structure.representation.addRepresentation(selComp, {
              type: 'ball-and-stick', color: 'element-symbol', typeParams: { sizeFactor: 0.15 }
            });
          } else {
            const colorVal = hexToInt(overlay.color || '#ff0000');
            const ovStyle = overlay.type === 'chain'
              ? 'ball-and-stick'
              : (overlay.style || 'ball-and-stick');

            await plugin.builders.structure.representation.addRepresentation(selComp, {
              type: ovStyle,
              color: 'uniform',
              colorParams: { value: colorVal },
              typeParams: { sizeFactor: 0.35, alpha: clamp01(overlay.alpha ?? 1.0) }
            });
          }
        }
      });
    } catch (err) {
      console.error('Render Error:', err);
    }
  }, [
    activePreset, activeStyle, activeColorMode, customColor,
    showWater, showLigands,
    polymerOpacity, ligandOpacity, waterOpacity,
    agentOverlays, getPlugin
  ]);

  useEffect(() => { if (!loading) syncVisuals(); }, [syncVisuals, loading]);

  // ---------------------------------------------------------------------------
  // Load structure
  // ---------------------------------------------------------------------------
  const handleFetchPdb = async (id) => {
    const plugin = getPlugin(); if (!plugin || !id) return;
    setLoading(true); setAgentOverlays([]);

    try {
      await plugin.clear();
      const data = await plugin.builders.data.download({
        url: `https://files.rcsb.org/download/${id.toUpperCase()}.pdb`,
        isBinary: false
      });
      const traj = await plugin.builders.structure.parseTrajectory(data, 'pdb');
      const model = await plugin.builders.structure.createModel(traj);
      await plugin.builders.structure.createStructure(model);
      setFileName(id.toUpperCase());
      setLoading(false);
      showToastMsg(`已加载结构: ${id.toUpperCase()}`);
    } catch (err) {
      console.error(err);
      setError('Fetch failed');
      setLoading(false);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    const plugin = getPlugin();
    if (!file || !plugin) return;

    setLoading(true); setAgentOverlays([]);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        await plugin.clear();
        const isBinary = file.name.endsWith('.bcif');
        const data = await plugin.builders.data.rawData({
          data: isBinary ? new Uint8Array(evt.target.result) : evt.target.result,
          label: file.name
        });

        const format = file.name.includes('cif')
          ? (isBinary ? 'bcif' : 'mmcif')
          : 'pdb';

        const traj = await plugin.builders.structure.parseTrajectory(data, format);
        const model = await plugin.builders.structure.createModel(traj);
        await plugin.builders.structure.createStructure(model);

        setFileName(file.name);
        setLoading(false);
        showToastMsg(`已加载文件: ${file.name}`);
      } catch (err) {
        console.error(err);
        setError('Parse failed');
        setLoading(false);
      } finally {
        try { e.target.value = ''; } catch { /* ignore */ }
      }
    };

    if (file.name.endsWith('.bcif')) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  };

  // ---------------------------------------------------------------------------
  // DeepSeek API
  // ---------------------------------------------------------------------------
  const callChatApi = async (message, mode) => {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, mode })
    });
    const data = await resp.json().catch(() => ({}));
    return data;
  };

  // ---------------------------------------------------------------------------
  // Command execution helpers (FIXED)
  // ---------------------------------------------------------------------------
  const buildOverlayFromTarget = (target, color, extra = {}) => {
    // Debug Log
    console.log('[Command] buildOverlayFromTarget input:', { target, color });

    const t = target?.type;
    const chain = target?.chain ? String(target.chain).trim() : null;
    const id = mkId();

    if (t === 'chain' && chain) {
      return { id, type: 'chain', target: chain, color, ...extra };
    }
    
    // FIX: Use !isNaN instead of Number.isInteger for robustness
    if (t === 'residue' && target?.resId !== undefined && !isNaN(Number(target.resId))) {
      const resId = Number(target.resId);
      // Ensure target is string "start-end"
      return { id, type: 'residue', target: `${resId}-${resId}`, targetChain: chain, color, ...extra };
    }
    
    if (t === 'range' && !isNaN(Number(target?.startResId)) && !isNaN(Number(target?.endResId))) {
      const a = Number(target.startResId);
      const b = Number(target.endResId);
      return { id, type: 'residue', target: `${a}-${b}`, targetChain: chain, color, ...extra };
    }
    
    if (t === 'ligand') {
      const resName = String(target?.resName || '').trim().toUpperCase();
      return { id, type: 'ligand', resName, color, ...extra };
    }
    
    console.warn('[Command] buildOverlay failed for target:', target);
    return null;
  };

  const focusTarget = async (plugin, target) => {
    const sw = getCurrentStructureWrapper(plugin);
    if (!sw?.cell) return { ok: false, reason: 'No structure loaded.' };

    const MS = window.molstar?.MolScriptBuilder;
    if (!MS) return { ok: false, reason: 'MolScriptBuilder not available.' };

    const t = target?.type;
    const chain = target?.chain ? String(target.chain).toUpperCase() : null;

    if (t === 'all' || t === 'protein' || t === 'polymer') {
      plugin?.managers?.camera?.reset?.();
      return { ok: true };
    }

    let exp = null;

    if (t === 'chain' && chain) {
      exp = MS.struct.generator.atomGroups({
        'chain-test': MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), chain])
      });
    } else if (t === 'residue' && !isNaN(Number(target?.resId))) {
      exp = MS.struct.generator.atomGroups({
        'residue-test': MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_seq_id(), Number(target.resId)]),
        ...(chain ? { 'chain-test': MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), chain]) } : {})
      });
    } else if (t === 'range' && !isNaN(Number(target?.startResId)) && !isNaN(Number(target?.endResId))) {
      const a = Number(target.startResId);
      const b = Number(target.endResId);
      const resTest = MS.core.logic.and([
        MS.core.rel.gr([MS.struct.atomProperty.macromolecular.auth_seq_id(), (a - 1)]),
        MS.core.rel.lt([MS.struct.atomProperty.macromolecular.auth_seq_id(), (b + 1)])
      ]);
      exp = MS.struct.generator.atomGroups({
        'residue-test': resTest,
        ...(chain ? { 'chain-test': MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), chain]) } : {})
      });
    } else if (t === 'ligand') {
      const entityTest = MS.core.rel.eq([MS.struct.atomProperty.macromolecular.entityType(), 'non-polymer']);
      const resName = String(target?.resName || '').trim().toUpperCase();
      const compIdFn = MS.struct.atomProperty?.macromolecular?.label_comp_id;
      if (resName && typeof compIdFn === 'function') {
        exp = MS.struct.generator.atomGroups({
          'entity-test': entityTest,
          'resname-test': MS.core.rel.eq([compIdFn(), resName])
        });
      } else {
        exp = MS.struct.generator.atomGroups({ 'entity-test': entityTest });
      }
    } else {
      return { ok: false, reason: 'Unsupported target for focus.' };
    }

    const key = `ai_focus_${Date.now()}`;
    const comp = await plugin.builders.structure.tryCreateComponentFromExpression(sw.cell, exp, key, { label: 'AI:Focus' });
    if (!comp?.obj?.data) return { ok: false, reason: 'Failed to create focus component.' };

    try {
      const loci = plugin.managers.structure.selection.getLoci(comp.obj.data);
      plugin.managers.camera.focusLoci(loci);
      return { ok: true };
    } catch {
      return { ok: false, reason: 'Focus failed.' };
    }
  };

  const findResidueCA = (structure, chain, resId) => {
    const SP = window.molstar?.StructureProperties;
    const SE = window.molstar?.StructureElement;
    const Vec3 = window.molstar?.LinearAlgebra?.Vec3;
    if (!SP || !SE || !Vec3) return null;

    const out = Vec3();

    for (const unit of structure.units) {
      const elements = unit.elements;
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        const loc = SE.Location.create(structure, unit, el);

        const c = SP.chain.auth_asym_id(loc);
        const r = SP.residue.auth_seq_id(loc);
        const atomName = SP.atom.label_atom_id(loc);

        if (chain && String(c).toUpperCase() !== String(chain).toUpperCase()) continue;
        if (Number(r) !== Number(resId)) continue;
        if (String(atomName).trim().toUpperCase() !== 'CA') continue;

        try {
          unit.conformation.position(el, out);
          return { x: out[0], y: out[1], z: out[2] };
        } catch {
          return null;
        }
      }
    }
    return null;
  };

  const measureDistance = async (plugin, params) => {
    const a = params?.a;
    const b = params?.b;
    if (!a || !b) return { ok: false, msg: 'measure_distance 缺少 a/b。' };

    if (a.type !== 'residue' || b.type !== 'residue') {
      return { ok: false, msg: '当前仅支持 residue-residue 距离（按 CA 原子）。' };
    }

    const structure = getStructureData(plugin);
    if (!structure) return { ok: false, msg: '未加载结构。' };

    const ca1 = findResidueCA(structure, a.chain, a.resId);
    const ca2 = findResidueCA(structure, b.chain, b.resId);
    if (!ca1 || !ca2) return { ok: false, msg: '未找到残基 CA 原子（检查链名/编号）。' };

    const dx = ca1.x - ca2.x;
    const dy = ca1.y - ca2.y;
    const dz = ca1.z - ca2.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return { ok: true, msg: `距离 (CA-CA): ${d.toFixed(2)} Å` };
  };

  // ---------------------------------------------------------------------------
  // Execute structured command from DeepSeek
  // ---------------------------------------------------------------------------
  const executeCommand = async (cmd) => {
    const plugin = getPlugin();
    const action = cmd?.action;
    const params = cmd?.params || {};

    if (!action || typeof action !== 'string') {
      return { ok: false, reply: 'Agent 输出缺少 action。' };
    }

    if (action === 'batch') {
      const commands = Array.isArray(params?.commands) ? params.commands : [];
      if (!commands.length) return { ok: false, reply: 'batch.commands 为空。' };
      let lastReply = '已执行批量指令。';
      for (const sub of commands) {
        // eslint-disable-next-line no-await-in-loop
        const r = await executeCommand(sub);
        lastReply = r.reply || lastReply;
      }
      return { ok: true, reply: lastReply };
    }

    if (action === 'clarify') {
      const q = params?.question || '需要更多信息以执行指令。';
      const opts = Array.isArray(params?.options) ? params.options : [];
      const hint = opts.length ? ` 选项：${opts.join(' / ')}` : '';
      return { ok: true, reply: `澄清：${q}${hint}` };
    }

    if (action === 'noop') {
      return { ok: true, reply: `无法执行：${params?.reason || '未提供原因。'}` };
    }

    try {
      switch (action) {
        case 'reset_colors': {
          setActiveColorMode('chain');
          setCustomColor('#4f46e5');
          setActivePreset('custom');
          setAgentOverlays((prev) => prev.filter(o => o.type === 'global-hbond' || o.type === 'ligand-surround'));
          return { ok: true, reply: '已恢复默认配色（按链）。' };
        }

        case 'color': {
          const target = params?.target;
          const color = params?.color;

          if (!target || typeof target !== 'object') return { ok: false, reply: 'color 缺少 target。' };
          if (!isHexColor(color)) return { ok: false, reply: 'color.color 必须是 #RRGGBB。' };

          if (['all', 'protein', 'polymer'].includes(target.type)) {
            setCustomColor(color);
            setActiveColorMode('uniform');
            setActivePreset('custom');
            return { ok: true, reply: `已对整体应用颜色 ${color}。` };
          }

          const ov = buildOverlayFromTarget(target, color, { style: 'ball-and-stick', alpha: 1.0, label: 'AI:Color' });
          if (!ov) return { ok: false, reply: '当前 color target 不支持或信息不足（例如缺链/残基号）。' };

          setAgentOverlays((prev) => [...prev, ov]);
          return { ok: true, reply: `已对目标上色 ${color}。` };
        }

        case 'set_representation': {
          const rep = params?.rep;
          const target = params?.target;

          if (!rep) return { ok: false, reply: 'set_representation 缺少 rep。' };

          const repMap = {
            cartoon: 'cartoon',
            surface: 'surface',
            sticks: 'bns',
            lines: 'bns',
            spheres: 'spacefill'
          };

          const styleKey = repMap[rep];
          if (!styleKey) return { ok: false, reply: `不支持的 rep: ${rep}` };

          if (target?.type === 'ligand') {
            setShowLigands(true);
            return { ok: true, reply: '已显示配体（配体表示当前固定为 ball-and-stick）。' };
          }

          setActiveStyle(styleKey);
          setActivePreset('custom');
          return { ok: true, reply: `已设置表示方式为 ${rep}。` };
        }

        case 'hide': {
          const what = params?.what;
          if (what === 'water') { setShowWater(false); return { ok: true, reply: '已隐藏水分子。' }; }
          if (what === 'ligand') { setShowLigands(false); return { ok: true, reply: '已隐藏配体。' }; }
          return { ok: false, reply: 'hide.what 必须是 water/ligand。' };
        }

        case 'show': {
          const what = params?.what;
          if (what === 'water') { setShowWater(true); return { ok: true, reply: '已显示水分子。' }; }
          if (what === 'ligand') { setShowLigands(true); return { ok: true, reply: '已显示配体。' }; }
          return { ok: false, reply: 'show.what 必须是 water/ligand。' };
        }

        case 'set_opacity': {
          const target = params?.target;
          const opacity = clamp01(params?.opacity);

          if (!target || typeof target !== 'object') return { ok: false, reply: 'set_opacity 缺少 target。' };

          if (['all', 'protein', 'polymer'].includes(target.type)) {
            setPolymerOpacity(opacity);
            setActivePreset('custom');
            return { ok: true, reply: `已设置蛋白透明度为 ${opacity.toFixed(2)}。` };
          }
          if (target.type === 'ligand') {
            setLigandOpacity(opacity);
            return { ok: true, reply: `已设置配体透明度为 ${opacity.toFixed(2)}。` };
          }
          if (target.type === 'water') {
            setWaterOpacity(opacity);
            return { ok: true, reply: `已设置水透明度为 ${opacity.toFixed(2)}。` };
          }

          if (['selection', 'chain', 'residue', 'range'].includes(target.type)) {
            const ov = buildOverlayFromTarget(target, '#ffff00', { alpha: opacity, style: 'ball-and-stick', label: 'AI:Opacity' });
            if (!ov) return { ok: false, reply: 'set_opacity target 信息不足。' };
            setAgentOverlays((prev) => [...prev, ov]);
            return { ok: true, reply: `已对目标添加透明高亮（alpha=${opacity.toFixed(2)}）。` };
          }

          return { ok: false, reply: 'set_opacity target.type 不支持。' };
        }

        case 'focus': {
          if (!plugin) return { ok: false, reply: 'Mol* 未初始化。' };
          const target = params?.target;
          if (!target) return { ok: false, reply: 'focus 缺少 target。' };

          const r = await focusTarget(plugin, target);
          return r.ok ? { ok: true, reply: '已聚焦目标。' } : { ok: false, reply: `聚焦失败：${r.reason || ''}` };
        }

        case 'reset_camera': {
          plugin?.managers?.camera?.reset?.();
          return { ok: true, reply: '已重置相机。' };
        }

        case 'spin': {
          const enabled = !!params?.enabled;
          const speed = Number(params?.speed ?? 1.0);
          setSpinState({ enabled, speed: Number.isFinite(speed) ? speed : 1.0 });
          return { ok: true, reply: enabled ? `已开启旋转（speed=${Number.isFinite(speed) ? speed : 1.0}）。` : '已关闭旋转。' };
        }

        case 'highlight': {
          const target = params?.target;
          if (!target) return { ok: false, reply: 'highlight 缺少 target。' };

          const ov = buildOverlayFromTarget(target, '#ffff00', { style: 'ball-and-stick', alpha: 1.0, label: 'AI:Highlight' });
          if (!ov) return { ok: false, reply: 'highlight target 信息不足或不支持。' };

          setAgentOverlays((prev) => [...prev, ov]);
          return { ok: true, reply: '已高亮目标。' };
        }

        case 'label': {
          const target = params?.target;
          const enabled = !!params?.enabled;
          if (!enabled) {
            setAgentOverlays((prev) => prev.filter(o => o.label !== 'AI:Label'));
            return { ok: true, reply: '已取消标注（通过清理 label overlay 实现）。' };
          }

          const ov = buildOverlayFromTarget(target, '#ffcc00', { style: 'ball-and-stick', alpha: 1.0, label: 'AI:Label' });
          if (!ov) return { ok: false, reply: 'label target 信息不足或不支持。' };

          setAgentOverlays((prev) => [...prev, ov]);
          return { ok: true, reply: '已标注目标（降级为高亮）。' };
        }

        case 'measure_distance': {
          if (!plugin) return { ok: false, reply: 'Mol* 未初始化。' };
          const r = await measureDistance(plugin, params);
          return r.ok ? { ok: true, reply: r.msg } : { ok: false, reply: r.msg };
        }

        default:
          return { ok: false, reply: `未知 action: ${action}` };
      }
    } catch (e) {
      console.error('executeCommand error:', e);
      return { ok: false, reply: '执行失败（前端异常）。' };
    }
  };

  // ---------------------------------------------------------------------------
  // Unified runner
  // ---------------------------------------------------------------------------
  const runAssistant = async (userText, modeOverride = null, recordUserMsg = true) => {
    const mode = modeOverride || chatMode;

    if (recordUserMsg) {
      setMessages((prev) => [...prev, { role: 'user', content: userText }]);
    }

    setAgentBusy(true);
    try {
      const data = await callChatApi(userText, mode);

      if (data?.error) {
        const msg = `服务端错误：${String(data.error)}`;
        setMessages((prev) => [...prev, { role: 'system', content: msg }]);
        showToastMsg(msg);
        return;
      }

      if (mode === 'answer') {
        const raw = String(data?.raw ?? data?.result ?? '').trim();
        const answer = raw || '（空响应）';
        setMessages((prev) => [...prev, { role: 'system', content: answer }]);
        showToastMsg(answer.slice(0, 40));
        return;
      }

      const resultStr = String(data?.result ?? '').trim();
      let cmd = null;
      try {
        cmd = JSON.parse(resultStr);
      } catch {
        cmd = { action: 'noop', params: { reason: 'Invalid JSON in result.' } };
      }

      const r = await executeCommand(cmd);
      const reply = r.reply || '已处理指令。';

      setMessages((prev) => [
        ...prev,
        { role: 'system', content: reply },
        { role: 'system', content: `JSON: ${JSON.stringify(cmd)}`, kind: 'json' }
      ]);

      showToastMsg(reply);
    } catch (e) {
      console.error(e);
      const msg = '调用 /api/chat 失败。';
      setMessages((prev) => [...prev, { role: 'system', content: msg }]);
      showToastMsg(msg);
    } finally {
      setAgentBusy(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Chat submit
  // ---------------------------------------------------------------------------
  const handleChatSubmit = async (e) => {
    e.preventDefault();
    const text = inputMsg.trim();
    if (!text) return;
    setInputMsg('');
    await runAssistant(text, null, true);
  };

  useEffect(() => {
    try { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); } catch { /* ignore */ }
  }, [messages]);

  // ---------------------------------------------------------------------------
  // Preset & Actions
  // ---------------------------------------------------------------------------
  const applyPreset = (key) => {
    const p = JOURNAL_PRESETS[key] || JOURNAL_PRESETS.default;
    setActivePreset(key);
    setActiveStyle(p.style);
    setActiveColorMode(p.color);
    if (p.customColor) setCustomColor('#' + p.customColor.toString(16).padStart(6, '0'));
  };

  const isLigandPocketActive = agentOverlays.some((o) => o.type === 'ligand-surround');
  const isGlobalHbondActive = agentOverlays.some((o) => o.type === 'global-hbond');

  const handleFocusLigandUI = async () => {
    const plugin = getPlugin();
    if (!plugin) {
      const msg = 'Mol* 未初始化。';
      showToastMsg(msg);
      pushSystemLog(msg);
      return;
    }
    setShowLigands(true);
    const r = await focusTarget(plugin, { type: 'ligand' });
    const msg = r.ok ? '已聚焦配体。' : `聚焦失败：${r.reason || '未知原因'}`;
    showToastMsg(msg);
    pushSystemLog(msg);
  };

  const handleTogglePocketUI = () => {
    const willEnable = !isLigandPocketActive;
    setAgentOverlays((prev) => {
      if (willEnable) return [...prev, { id: mkId(), type: 'ligand-surround', color: '#ff9900', label: 'UI:Pocket' }];
      return prev.filter((o) => o.type !== 'ligand-surround');
    });
    const msg = willEnable ? '已显示配体结合口袋。' : '已关闭配体结合口袋。';
    showToastMsg(msg);
    pushSystemLog(msg);
  };

  const handleToggleGlobalHbondUI = () => {
    const willEnable = !isGlobalHbondActive;
    setAgentOverlays((prev) => {
      if (willEnable) return [...prev, { id: mkId(), type: 'global-hbond', label: 'UI:GlobalHBonds' }];
      return prev.filter((o) => o.type !== 'global-hbond');
    });
    const msg = willEnable ? '已显示全局氢键网络。' : '已关闭全局氢键网络。';
    showToastMsg(msg);
    pushSystemLog(msg);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-screen w-full bg-slate-50 text-slate-800 font-sans overflow-hidden">
      {toast && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-50 bg-slate-800/90 text-white px-4 py-2 rounded-full shadow-xl flex items-center gap-2 animate-fade-in-up transition-all pointer-events-none">
          <Sparkles size={14} className="text-yellow-400" />
          <span className="text-xs font-medium">{toast}</span>
        </div>
      )}

      <header className="h-14 bg-white border-b flex items-center justify-between px-4 shadow-sm z-20">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 p-1.5 rounded text-white"><Cpu size={18} /></div>
          <h1 className="font-bold text-lg tracking-tight">BioLens <span className="text-indigo-600">Pro</span></h1>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 rounded-md overflow-hidden border border-transparent focus-within:border-indigo-500">
            <div className="pl-2 text-slate-400"><Search size={14} /></div>
            <input
              className="bg-transparent border-none outline-none text-sm w-24 px-2 py-1.5 uppercase"
              placeholder="PDB ID"
              value={pdbId}
              onChange={(e) => setPdbId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleFetchPdb(pdbId)}
            />
          </div>
          <button type="button" onClick={() => handleFetchPdb(pdbId)} className="btn-secondary">Load</button>
          <label className="btn-primary cursor-pointer flex items-center gap-2">
            <Upload size={14} /> Open
            <input type="file" className="hidden" onChange={handleFileUpload} />
          </label>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        <main className="flex-1 relative bg-slate-200">
          {loading && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80">
              <div className="animate-spin text-indigo-600"><RefreshCw /></div>
            </div>
          )}
          {error && (
            <div className="absolute top-10 left-1/2 -translate-x-1/2 z-50 bg-red-100 text-red-700 px-4 py-2 rounded flex gap-2">
              <AlertCircle size={18} />
              {error}
              <button type="button" onClick={() => setError(null)}>x</button>
            </div>
          )}
          <div ref={containerRef} className="absolute inset-0 w-full h-full" />
          <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
            <div className="bg-white/90 backdrop-blur px-3 py-1.5 rounded shadow text-xs font-bold text-slate-600 border">ID: {fileName}</div>
            {agentOverlays.length > 0 && (
              <button
                type="button"
                onClick={() => setAgentOverlays([])}
                className="bg-red-500/90 text-white px-3 py-1.5 rounded shadow text-xs font-bold hover:bg-red-600 flex items-center gap-1 transition-all"
              >
                <Wand2 size={12} /> Clear Layers ({agentOverlays.length})
              </button>
            )}
          </div>
        </main>

        <aside className="w-80 bg-white border-l flex flex-col z-20 shadow-xl">
          <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">

            <section>
              <SectionHeader icon={<Target size={14} className="text-pink-500" />} title="Smart Targets (靶点)" />
              <div className="grid grid-cols-1 gap-2 mt-2">
                <button
                  type="button"
                  onClick={handleFocusLigandUI}
                  className="flex items-center gap-2 p-2.5 rounded-lg border bg-white hover:bg-pink-50 transition-colors text-left group active:scale-95 disabled:opacity-60"
                  disabled={loading}
                >
                  <div className="p-1.5 bg-pink-100 text-pink-600 rounded-md group-hover:scale-110 transition-transform"><ScanSearch size={16} /></div>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-slate-700">Focus Ligand</span>
                    <span className="text-[10px] text-slate-400">聚焦配体/药物分子</span>
                  </div>
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleTogglePocketUI}
                    className={`relative flex flex-col items-center justify-center p-2 rounded-lg border transition-all gap-1 disabled:opacity-60 ${isLigandPocketActive ? 'bg-amber-100 border-amber-300 text-amber-800 shadow-inner scale-95' : 'bg-white hover:bg-amber-50 text-slate-600'}`}
                    disabled={loading}
                  >
                    <Microscope size={16} className={isLigandPocketActive ? 'text-amber-700' : 'text-amber-500'} />
                    <span className="text-[10px] font-medium">Binding Pocket</span>
                    {isLigandPocketActive && <div className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleGlobalHbondUI}
                    className={`relative flex flex-col items-center justify-center p-2 rounded-lg border transition-all gap-1 disabled:opacity-60 ${isGlobalHbondActive ? 'bg-indigo-100 border-indigo-300 text-indigo-800 shadow-inner scale-95' : 'bg-white hover:bg-indigo-50 text-slate-600'}`}
                    disabled={loading}
                  >
                    <Link2 size={16} className={isGlobalHbondActive ? 'text-indigo-700' : 'text-indigo-500'} />
                    <span className="text-[10px] font-medium">Global H-Bonds</span>
                    {isGlobalHbondActive && <div className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
                  </button>
                </div>
              </div>
            </section>

            <section>
              <SectionHeader icon={<MousePointer2 size={14} className="text-indigo-500" />} title="Click Action (点击交互)" />
              <div className="grid grid-cols-3 gap-2 mt-2">
                <button type="button" onClick={() => setClickMode('pick')} className={`text-[10px] p-2 rounded border flex flex-col items-center gap-1 transition-all ${clickMode === 'pick' ? 'bg-indigo-600 text-white shadow-md transform scale-105' : 'bg-white hover:bg-slate-50'}`}>
                  <MousePointer2 size={14} /> Focus
                </button>
                <button type="button" onClick={() => setClickMode('zone5')} className={`text-[10px] p-2 rounded border flex flex-col items-center gap-1 transition-all ${clickMode === 'zone5' ? 'bg-red-600 text-white shadow-md transform scale-105' : 'bg-white hover:bg-red-50'}`}>
                  <CircleDashed size={14} /> Zone 5Å
                </button>
                <button type="button" onClick={() => setClickMode('hbond')} className={`text-[10px] p-2 rounded border flex flex-col items-center gap-1 transition-all ${clickMode === 'hbond' ? 'bg-amber-500 text-white shadow-md transform scale-105' : 'bg-white hover:bg-amber-50'}`}>
                  <Link2 size={14} /> H-Bond
                </button>
              </div>
              <div className="mt-2 text-[10px] text-center text-slate-400 bg-slate-50 py-1 rounded">
                {clickMode === 'pick' && '模式：点击原子以聚焦视角'}
                {clickMode === 'zone5' && '模式：点击原子显示周围 5Å 残基'}
                {clickMode === 'hbond' && '模式：点击原子分析氢键相互作用'}
              </div>
            </section>

            <section>
              <SectionHeader icon={<Sparkles size={14} className="text-amber-500" />} title="Journal Styles" />
              <div className="grid grid-cols-2 gap-2 mt-2">
                {Object.entries(JOURNAL_PRESETS).map(([key, cfg]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyPreset(key)}
                    className={`text-xs py-2.5 px-3 rounded-xl border font-bold text-left flex items-center justify-between group ${activePreset === key ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300'}`}
                  >
                    {cfg.label}
                    {activePreset === key && <div className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_5px_rgba(74,222,128,0.8)]" />}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <SectionHeader icon={<Layers size={14} />} title="Manual Control" />
              <div className="grid grid-cols-2 gap-2 mt-2">
                {Object.entries(STYLES).map(([key, cfg]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setActiveStyle(key); setActivePreset('custom'); }}
                    className={`text-xs py-1.5 px-2 rounded border transition-colors ${activeStyle === key ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'bg-slate-50'}`}
                  >
                    {cfg.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-1.5 mt-3">
                {Object.entries(COLORS).map(([key, cfg]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setActiveColorMode(key); setActivePreset('custom'); }}
                    className={`text-[10px] px-2 py-1 rounded border ${activeColorMode === key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white'}`}
                  >
                    {cfg.label}
                  </button>
                ))}
              </div>

              <div className="mt-3 flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-100">
                <div className="flex items-center gap-2">
                  <Palette size={14} className="text-slate-400" />
                  <span className="text-xs text-slate-600 font-medium">Tint Color</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-400">{customColor}</span>
                  <input
                    type="color"
                    value={customColor}
                    onChange={(e) => {
                      setCustomColor(e.target.value);
                      setActiveColorMode('uniform');
                      setActivePreset('custom');
                    }}
                    className="w-6 h-6 rounded cursor-pointer border-none bg-transparent p-0"
                  />
                </div>
              </div>
            </section>
          </div>

          {/* Chat Panel (resizable) */}
          <div
            className="border-t bg-slate-50 flex flex-col resize-y overflow-hidden"
            style={{ height: 320, minHeight: 220, maxHeight: 640 }}
          >
            <div className="px-3 py-2 border-b bg-white flex items-center gap-2 text-indigo-600 shadow-sm">
              <MessageSquare size={14} />
              <span className="text-xs font-bold uppercase tracking-wider">Bio-Agent</span>
              {agentBusy && <span className="text-[10px] text-slate-400">（处理中…）</span>}
              <div className="ml-auto flex items-center bg-slate-100 rounded-lg p-1 border border-slate-200">
                <button
                  type="button"
                  onClick={() => setChatMode('command')}
                  className={`px-2 py-1 text-[10px] font-bold rounded-md ${chatMode === 'command' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-white'}`}
                  disabled={loading}
                >
                  操作
                </button>
                <button
                  type="button"
                  onClick={() => setChatMode('answer')}
                  className={`px-2 py-1 text-[10px] font-bold rounded-md ${chatMode === 'answer' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-white'}`}
                  disabled={loading}
                >
                  问答
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50/50">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={[
                      'max-w-[90%] px-3 py-2 rounded-xl text-xs leading-relaxed shadow-sm whitespace-pre-wrap break-words',
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-tr-none'
                        : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none',
                      msg.kind === 'json' ? 'font-mono text-[10px] bg-slate-900 text-slate-100 border-slate-900' : ''
                    ].join(' ')}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={handleChatSubmit} className="p-2 bg-white border-t flex gap-2">
              <input
                className="flex-1 bg-slate-100 border-none rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 outline-none disabled:opacity-60"
                placeholder={chatMode === 'answer' ? '提问…（返回 raw answer）' : '指令…（返回结构化 JSON 并执行）'}
                value={inputMsg}
                onChange={(e) => setInputMsg(e.target.value)}
                disabled={loading}
              />
              <button
                type="submit"
                className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60"
                disabled={agentBusy}
              >
                <Send size={14} />
              </button>
            </form>
          </div>
        </aside>
      </div>

      <style>{`
        .btn-primary { @apply px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded transition-colors shadow-sm; }
        .btn-secondary { @apply px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded transition-colors; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 2px; }
        @keyframes fade-in-up { 0% { opacity: 0; transform: translate(-50%, 10px); } 100% { opacity: 1; transform: translate(-50%, 0); } }
        .animate-fade-in-up { animation: fade-in-up 0.3s ease-out forwards; }
      `}</style>
    </div>
  );
};

const SectionHeader = ({ icon, title }) => (
  <div className="flex items-center gap-2 mb-2 text-slate-400">
    {icon} <span className="text-[10px] font-bold uppercase tracking-widest">{title}</span>
  </div>
);

export default BioLensApp;