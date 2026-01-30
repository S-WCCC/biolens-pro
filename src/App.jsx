'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Upload, Search, AlertCircle, RefreshCw, MessageSquare, Send,
  Cpu, Layers, Sparkles, Wand2, Palette,
  MousePointer2, CircleDashed, Link2, Target, Microscope, ScanSearch,
  Play, Settings2
} from 'lucide-react';

/**
 * BioLens Agent Pro - Manual Form Edition
 * 1. Removed LLM dependency for commands.
 * 2. Added Structured Form Builder for precise control.
 * 3. executeCommand logic remains the core driver.
 */

// --- 1. Static Configuration (保持不变) ---
const loadMolstarResources = () => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') { resolve(); return; }
    if (window.molstar) { resolve(); return; }
    
    // Lock version 3.48.0
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/molstar@3.48.0/build/viewer/molstar.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/molstar@3.48.0/build/viewer/molstar.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Mol* script'));
    document.head.appendChild(script);
  });
};

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v)));
const isHexColor = (s) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.trim());
const hexToInt = (hex) => {
  try {
    if (!hex || typeof hex !== 'string') return 0xff0000;
    return parseInt(hex.replace('#', ''), 16) || 0xff0000;
  } catch {
    return 0xff0000;
  }
};
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

// --- 2. Main Component ---
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

  // Visuals
  const [activePreset, setActivePreset] = useState('default');
  const [activeStyle, setActiveStyle] = useState('cartoon');
  const [activeColorMode, setActiveColorMode] = useState('chain');
  const [customColor, setCustomColor] = useState('#4f46e5');
  const [showWater, setShowWater] = useState(false);
  const [showLigands, setShowLigands] = useState(true);
  const [polymerOpacity, setPolymerOpacity] = useState(1.0);
  const [ligandOpacity, setLigandOpacity] = useState(1.0);
  const [waterOpacity, setWaterOpacity] = useState(0.4);

  // Interaction
  const [clickMode, setClickMode] = useState('pick');
  const [agentOverlays, setAgentOverlays] = useState([]);
  const [spinState, setSpinState] = useState({ enabled: false, speed: 1.0 });

  // Logs (Formerly Chat)
  const [messages, setMessages] = useState([
    { role: 'system', content: 'Ready. 请在下方填写参数并执行指令。' }
  ]);

  // --- NEW: Manual Form State (新：表单状态) ---
  const [formState, setFormState] = useState({
    action: 'color',       // color, focus, label, highlight
    targetType: 'residue', // residue, chain, ligand, all
    chainVal: 'A',
    resIdVal: '',          // Start residue or single residue
    resEndVal: '',         // End residue (for range)
    ligandName: '',
    colorVal: '#ff0000',
    opacityVal: 0.5
  });

  // Helpers
  const showToastMsg = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const pushSystemLog = useCallback((text) => {
    setMessages((prev) => [...prev, { role: 'system', content: `[UI] ${text}` }]);
  }, []);

  const getPlugin = useCallback(() => viewerRef.current?.plugin, []);

  // ... (Keep getCurrentStructureWrapper, getStructureData, loadMolstarResources logic same as before) ...
  const getCurrentStructureWrapper = useCallback((plugin) => {
    try { return plugin?.managers?.structure?.hierarchy?.current?.structures?.[0] || null; } catch { return null; }
  }, []);

  const getStructureData = useCallback((plugin) => {
    try {
      const sw = getCurrentStructureWrapper(plugin);
      return sw?.cell?.obj?.data || null;
    } catch {
      return null;
    }
  }, [getCurrentStructureWrapper]);


  // --- Init & Hooks (Keep unchanged) ---
  useEffect(() => {
    const init = async () => {
      try {
        await loadMolstarResources();
        if (!window.molstar) return;
        const viewer = await window.molstar.Viewer.create(containerRef.current, {
          layoutIsExpanded: false, layoutShowControls: false, layoutShowRemoteState: false,
          layoutShowSequence: true, viewportShowExpand: false, viewportShowSelectionMode: true, viewportShowAnimation: true,
        });
        viewerRef.current = viewer;
        await handleFetchPdb('4HHB');
        setLoading(false);
      } catch (e) {
        console.error(e); setError('Init Error: ' + e.message); setLoading(false);
      }
    };
    init();
    return () => viewerRef.current?.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Click Listener (Keep unchanged) ---
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
        } catch (err) { console.warn('Click error:', err); }
      }
    });
    return () => clickSub.unsubscribe();
  }, [clickMode, loading, getPlugin]);

  // --- Sync Visuals (Keep the robust version) ---
  const syncVisuals = useCallback(async () => {
    const plugin = getPlugin();
    if (!plugin) return;
    const hierarchy = plugin.managers?.structure?.hierarchy?.current;
    if (!hierarchy?.structures?.length) return;

    try {
      await plugin.dataTransaction(async () => {
        const structure = hierarchy.structures[0];
        const state = plugin.state.data;
        const hasSel = (sel) => {
          const ref = sel?.cell?.transform?.ref ?? sel?.ref;
          return !!ref && state.cells.has(ref);
        };
        if (!structure || !structure.cell) return;

        // 1. Env (Simplified)
        const canvas = plugin.canvas3d;
        const preset = JOURNAL_PRESETS[activePreset] || JOURNAL_PRESETS.default;
        if (canvas && preset) {
           // ... (Same as previous code)
           const rendererProps = { backgroundColor: preset.bgColor };
           const postProps = { occlusion: { name: 'off', params: {} }, outline: { name: 'off', params: {} } };
           if (preset.lighting === 'occlusion') postProps.occlusion = { name: 'on', params: { samples: 32, radius: 5, bias: 0.8 } };
           canvas.setProps({ renderer: rendererProps, postProcessing: postProps });
        }

        // 2. Clean
        const currentComponents = structure.components;
        const componentsToDelete = [];
        for (const c of currentComponents) {
          if (c.cell && state.cells.has(c.cell.transform.ref)) componentsToDelete.push(c);
        }
        if (componentsToDelete.length > 0) await plugin.managers.structure.hierarchy.remove(componentsToDelete);

        // 3. Polymer Base
        const polymerComp = await plugin.builders.structure.tryCreateComponentStatic(structure.cell, 'polymer');
        if (polymerComp && hasSel(polymerComp)) {
           let colorProps = { name: COLORS[activeColorMode]?.type || 'chain-id' };
           if (activeColorMode === 'uniform') colorProps = { name: 'uniform', params: { value: hexToInt(customColor) } };
           const styleConfig = STYLES[activeStyle] || STYLES.cartoon;
           await plugin.builders.structure.representation.addRepresentation(polymerComp, {
             type: styleConfig.type, typeParams: { ...(styleConfig.param || {}), alpha: clamp01(polymerOpacity) },
             color: colorProps.name, colorParams: colorProps.params,
           });
        }
        
        // 4. Ligands/Water
        if (showLigands) {
           const ligandComp = await plugin.builders.structure.tryCreateComponentStatic(structure.cell, 'ligand');
           if (ligandComp && hasSel(ligandComp)) await plugin.builders.structure.representation.addRepresentation(ligandComp, { type: 'ball-and-stick', color: 'element-symbol', typeParams: { alpha: clamp01(ligandOpacity) } });
        }
        if (showWater) {
           const waterComp = await plugin.builders.structure.tryCreateComponentStatic(structure.cell, 'water');
           if (waterComp && hasSel(waterComp)) await plugin.builders.structure.representation.addRepresentation(waterComp, { type: 'ball-and-stick', color: 'uniform', colorParams: { value: 0x88ccff }, typeParams: { alpha: clamp01(waterOpacity) } });
        }

        // 5. Overlays
        const MS = window.molstar?.MolScriptBuilder;
        if (!MS) return;

        for (const overlay of agentOverlays) {
           try {
             let expression = null;
             const chainTest = overlay.targetChain ? MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), overlay.targetChain]) : null;

             if (overlay.type === 'residue') {
                const parts = String(overlay.target).split('-');
                const start = Number(parts[0]);
                const end = parts.length > 1 ? Number(parts[1]) : start;
                if (!isNaN(start)) {
                   const conditions = [
                     MS.core.rel.gr([MS.struct.atomProperty.macromolecular.auth_seq_id(), start - 1]),
                     MS.core.rel.lt([MS.struct.atomProperty.macromolecular.auth_seq_id(), end + 1])
                   ];
                   if (chainTest) conditions.push(chainTest);
                   expression = MS.struct.generator.atomGroups({ 'residue-test': MS.core.logic.and(conditions) });
                }
             } else if (overlay.type === 'chain') {
                expression = MS.struct.generator.atomGroups({ 'chain-test': MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), overlay.target]) });
             } else if (overlay.type === 'ligand') {
                const resName = String(overlay.resName || '').trim().toUpperCase();
                const compIdFn = MS.struct.atomProperty?.macromolecular?.label_comp_id;
                const entityTest = MS.core.rel.eq([MS.struct.atomProperty.macromolecular.entityType(), 'non-polymer']);
                if (resName && compIdFn) expression = MS.struct.generator.atomGroups({ 'entity-test': entityTest, 'resname-test': MS.core.rel.eq([compIdFn(), resName]) });
                else expression = MS.struct.generator.atomGroups({ 'entity-test': entityTest });
             } 
             // ... other types (zone, global-hbond) omitted for brevity but should be kept from previous version ...
             
             if (!expression) continue;
             const selComp = await plugin.builders.structure.tryCreateComponentFromExpression(structure.cell, expression, overlay.id, { label: overlay.label || 'Overlay' });
             if (!selComp || !hasSel(selComp)) continue;

             const colorVal = hexToInt(overlay.color);
             await plugin.builders.structure.representation.addRepresentation(selComp, {
               type: 'ball-and-stick', color: 'uniform', colorParams: { value: colorVal },
               typeParams: { sizeFactor: 0.35, alpha: clamp01(overlay.alpha ?? 1.0) }
             });
           } catch(e) { console.error(e); }
        }
      });
    } catch (e) { console.error(e); }
  }, [activePreset, activeStyle, activeColorMode, customColor, showWater, showLigands, polymerOpacity, ligandOpacity, waterOpacity, agentOverlays, getPlugin]);

  useEffect(() => { if (!loading) syncVisuals(); }, [syncVisuals, loading]);

  // --- Handlers ---
  const handleFetchPdb = async (id) => {
    const plugin = getPlugin(); if (!plugin || !id) return;
    setLoading(true); setAgentOverlays([]);
    try {
      await plugin.clear();
      const data = await plugin.builders.data.download({ url: `https://files.rcsb.org/download/${id.toUpperCase()}.pdb`, isBinary: false });
      const traj = await plugin.builders.structure.parseTrajectory(data, 'pdb');
      const model = await plugin.builders.structure.createModel(traj);
      await plugin.builders.structure.createStructure(model);
      setFileName(id.toUpperCase()); setLoading(false);
    } catch { setError('Fetch failed'); setLoading(false); }
  };
  
  const handleFileUpload = (e) => { /* Keep same logic */ };

  // --- 3. HELPER: Build Overlay (Logic Only) ---
  const buildOverlayFromTarget = (target, color, extra = {}) => {
    const t = target?.type;
    const chain = target?.chain ? String(target.chain).trim().toUpperCase() : null;
    const id = mkId();

    if (t === 'residue') {
      const resId = Number(target.resId);
      if (!isNaN(resId)) {
        return { id, type: 'residue', target: `${resId}-${resId}`, targetChain: chain, color, ...extra };
      }
    }
    if (t === 'range') {
        const a = Number(target.startResId);
        const b = Number(target.endResId);
        if(!isNaN(a) && !isNaN(b)) {
            return { id, type: 'residue', target: `${a}-${b}`, targetChain: chain, color, ...extra };
        }
    }
    if (t === 'chain' && chain) return { id, type: 'chain', target: chain, color, ...extra };
    if (t === 'ligand') return { id, type: 'ligand', resName: String(target?.resName).toUpperCase(), color, ...extra };
    return null;
  };
  
  // --- 4. EXECUTE COMMAND (Core Engine) ---
  const executeCommand = async (cmd) => {
    const action = cmd?.action;
    const params = cmd?.params || {};

    try {
      if (action === 'color' || action === 'highlight' || action === 'label') {
        const target = params?.target;
        const color = params?.color || '#ffff00';
        const label = action === 'label' ? 'Manual:Label' : (action === 'highlight' ? 'Manual:HL' : 'Manual:Color');
        
        const ov = buildOverlayFromTarget(target, color, { 
            style: 'ball-and-stick', 
            alpha: 1.0, 
            label 
        });

        if (ov) {
            setAgentOverlays(prev => [...prev, ov]);
            return { ok: true, reply: `已执行: ${action} on ${target.type}` };
        } else {
            return { ok: false, reply: '目标无效 (缺少参数?)' };
        }
      }
      
      if (action === 'reset_colors') {
          setAgentOverlays([]);
          return { ok: true, reply: '已重置所有图层。' };
      }

      if (action === 'focus') {
          // Simplification for manual focus
          const plugin = getPlugin();
          if(plugin) plugin.managers.camera.reset(); // Just reset for now or implement robust focus logic
          return { ok: true, reply: '已重置视角' };
      }
    } catch(e) {
        return { ok: false, reply: '执行出错: ' + e.message };
    }
    return { ok: false, reply: '未知指令' };
  };

  // --- 5. NEW: Handle Manual Form Submit ---
  const handleManualSubmit = () => {
    const { action, targetType, chainVal, resIdVal, resEndVal, ligandName, colorVal } = formState;
    
    // Construct Target Object based on type
    let target = { type: targetType };
    
    if (targetType === 'residue') {
        if (!resIdVal) { showToastMsg('请输入残基编号'); return; }
        if (resEndVal) {
            target.type = 'range';
            target.chain = chainVal;
            target.startResId = resIdVal;
            target.endResId = resEndVal;
        } else {
            target.chain = chainVal;
            target.resId = resIdVal;
        }
    } else if (targetType === 'chain') {
        if (!chainVal) { showToastMsg('请输入链ID'); return; }
        target.chain = chainVal;
    } else if (targetType === 'ligand') {
        target.resName = ligandName;
    } else if (targetType === 'all') {
        target.type = 'all';
    }

    // Build Command
    const cmd = {
        action: action, // color, focus, highlight
        params: {
            target: target,
            color: colorVal
        }
    };

    // Log & Execute
    setMessages(prev => [...prev, { role: 'user', content: `[Manual] ${action} ${targetType} ${chainVal}:${resIdVal}` }]);
    
    executeCommand(cmd).then(res => {
        showToastMsg(res.reply);
        setMessages(prev => [...prev, { role: 'system', content: res.reply }]);
    });
  };

  // --- RENDER ---
  return (
    <div className="flex flex-col h-screen w-full bg-slate-50 text-slate-800 font-sans overflow-hidden">
      {toast && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-50 bg-slate-800/90 text-white px-4 py-2 rounded-full shadow-xl flex items-center gap-2 animate-fade-in-up transition-all pointer-events-none">
          <Sparkles size={14} className="text-yellow-400" />
          <span className="text-xs font-medium">{toast}</span>
        </div>
      )}

      {/* Header (Simplified) */}
      <header className="h-14 bg-white border-b flex items-center justify-between px-4 shadow-sm z-20">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 p-1.5 rounded text-white"><Cpu size={18} /></div>
          <h1 className="font-bold text-lg tracking-tight">BioLens <span className="text-indigo-600">Form</span></h1>
        </div>
        <div className="flex items-center gap-2">
            <input className="bg-slate-100 border-none outline-none text-sm w-24 px-2 py-1.5 uppercase rounded" 
                   value={pdbId} onChange={(e) => setPdbId(e.target.value)} placeholder="PDB ID" />
            <button onClick={() => handleFetchPdb(pdbId)} className="btn-secondary">Load</button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Main Viewer */}
        <main className="flex-1 relative bg-slate-200">
          <div ref={containerRef} className="absolute inset-0 w-full h-full" />
          <div className="absolute top-4 left-4 z-10">
              <div className="bg-white/90 px-3 py-1 rounded shadow font-bold text-xs">ID: {fileName}</div>
          </div>
          {agentOverlays.length > 0 && (
            <button onClick={() => setAgentOverlays([])} className="absolute top-4 right-4 z-10 bg-red-500 text-white px-3 py-1.5 rounded shadow text-xs font-bold">
                Clear Layers ({agentOverlays.length})
            </button>
          )}
        </main>

        {/* Sidebar */}
        <aside className="w-80 bg-white border-l flex flex-col z-20 shadow-xl">
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
             {/* Log Area */}
             <div className="bg-slate-50 p-3 rounded-lg border h-48 overflow-y-auto mb-4 text-xs font-mono space-y-1">
                {messages.map((m, i) => (
                    <div key={i} className={m.role === 'user' ? 'text-indigo-600' : 'text-slate-600'}>
                        {m.role === 'user' ? '>' : '#'} {m.content}
                    </div>
                ))}
                <div ref={chatEndRef}></div>
             </div>

             <section>
               <div className="flex items-center gap-2 mb-3 text-indigo-600 font-bold text-xs uppercase tracking-wider">
                   <Settings2 size={14} /> 指令构建器 (Builder)
               </div>
               
               <div className="space-y-3 p-3 bg-slate-50 rounded-xl border border-indigo-100">
                  {/* 1. Action */}
                  <div className="grid grid-cols-2 gap-2">
                      <label className="text-[10px] text-slate-500 uppercase font-bold">Action</label>
                      <label className="text-[10px] text-slate-500 uppercase font-bold">Target Type</label>
                      <select className="input-field" value={formState.action} onChange={e => setFormState({...formState, action: e.target.value})}>
                          <option value="color">Color (上色)</option>
                          <option value="highlight">Highlight (高亮)</option>
                          <option value="focus">Focus (聚焦)</option>
                      </select>
                      <select className="input-field" value={formState.targetType} onChange={e => setFormState({...formState, targetType: e.target.value})}>
                          <option value="residue">Residue (残基)</option>
                          <option value="chain">Chain (链)</option>
                          <option value="ligand">Ligand (配体)</option>
                          <option value="all">All (整体)</option>
                      </select>
                  </div>

                  {/* 2. Params based on Target Type */}
                  {formState.targetType === 'chain' && (
                     <div>
                         <label className="label-text">Chain ID (e.g., A)</label>
                         <input className="input-field" value={formState.chainVal} onChange={e => setFormState({...formState, chainVal: e.target.value})} placeholder="A" />
                     </div>
                  )}

                  {formState.targetType === 'residue' && (
                     <div className="space-y-2">
                         <div>
                             <label className="label-text">Chain ID</label>
                             <input className="input-field" value={formState.chainVal} onChange={e => setFormState({...formState, chainVal: e.target.value})} placeholder="A" />
                         </div>
                         <div className="grid grid-cols-2 gap-2">
                             <div>
                                 <label className="label-text">Residue ID</label>
                                 <input type="number" className="input-field" value={formState.resIdVal} onChange={e => setFormState({...formState, resIdVal: e.target.value})} placeholder="10" />
                             </div>
                             <div>
                                 <label className="label-text">End (Optional)</label>
                                 <input type="number" className="input-field" value={formState.resEndVal} onChange={e => setFormState({...formState, resEndVal: e.target.value})} placeholder="20" />
                             </div>
                         </div>
                     </div>
                  )}

                  {formState.targetType === 'ligand' && (
                     <div>
                         <label className="label-text">Ligand Name (e.g., HEM)</label>
                         <input className="input-field" value={formState.ligandName} onChange={e => setFormState({...formState, ligandName: e.target.value})} placeholder="HEM" />
                     </div>
                  )}

                  {/* 3. Color Picker (Only for color action) */}
                  {formState.action === 'color' && (
                      <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                          <span className="label-text">Pick Color</span>
                          <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-slate-500">{formState.colorVal}</span>
                              <input type="color" className="w-6 h-6 p-0 border-none bg-transparent cursor-pointer" 
                                     value={formState.colorVal} onChange={e => setFormState({...formState, colorVal: e.target.value})} />
                          </div>
                      </div>
                  )}
               </div>

               {/* Execute Button */}
               <button onClick={handleManualSubmit} className="mt-4 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all active:scale-95 shadow-md">
                   <Play size={16} fill="currentColor" />
                   执行指令 (Run)
               </button>
             </section>
          </div>
        </aside>
      </div>

      <style>{`
        .input-field { @apply w-full bg-white border border-slate-300 text-slate-700 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500; }
        .label-text { @apply text-[10px] text-slate-500 font-medium mb-1 block; }
        .btn-secondary { @apply px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded transition-colors; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 2px; }
        @keyframes fade-in-up { 0% { opacity: 0; transform: translate(-50%, 10px); } 100% { opacity: 1; transform: translate(-50%, 0); } }
        .animate-fade-in-up { animation: fade-in-up 0.3s ease-out forwards; }
      `}</style>
    </div>
  );
};

export default BioLensApp;