'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Upload, Search, AlertCircle, RefreshCw, MessageSquare, 
  Cpu, Layers, Sparkles, Wand2, Palette,
  MousePointer2, CircleDashed, Link2, Target, Microscope, ScanSearch,
  Play, Settings2, FileText, Trash2
} from 'lucide-react';

/**
 * BioLens Pro - Direct Execution Edition
 * 1. Bypasses React 'useEffect' sync loops for coloring.
 * 2. Directly calls Mol* builders when "Run" is clicked.
 * 3. Includes "Structure Inspector" to debug PDB data.
 */

// --- 1. Static Configuration ---
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

const hexToInt = (hex) => {
  try {
    if (!hex || typeof hex !== 'string') return 0xff0000;
    return parseInt(hex.replace('#', ''), 16) || 0xff0000;
  } catch { return 0xff0000; }
};

const mkId = () => `layer_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

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

  // Logs
  const [messages, setMessages] = useState([
    { role: 'system', content: 'Ready. 直接模式：指令将立即发送给 Mol* 内核。' }
  ]);
  
  // Track created layers (just for UI list, not for driving render)
  const [layers, setLayers] = useState([]);

  // Form State
  const [formState, setFormState] = useState({
    action: 'color',       
    targetType: 'residue', 
    chainVal: 'A',
    resIdVal: '',          
    resEndVal: '',         
    colorVal: '#ff0000',
  });

  // Helpers
  const showToastMsg = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };
  
  const getPlugin = useCallback(() => viewerRef.current?.plugin, []);

  // --- Init ---
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

  // --- Core: Load PDB ---
  const handleFetchPdb = async (id) => {
    const plugin = getPlugin(); if (!plugin || !id) return;
    setLoading(true); setLayers([]); // Clear UI layers list
    try {
      await plugin.clear();
      const data = await plugin.builders.data.download({ url: `https://files.rcsb.org/download/${id.toUpperCase()}.pdb`, isBinary: false });
      const traj = await plugin.builders.structure.parseTrajectory(data, 'pdb');
      const model = await plugin.builders.structure.createModel(traj);
      const structure = await plugin.builders.structure.createStructure(model);
      
      // Create default Cartoon representation
      const polymer = await plugin.builders.structure.tryCreateComponentStatic(structure, 'polymer');
      if (polymer) await plugin.builders.structure.representation.addRepresentation(polymer, { type: 'cartoon', color: 'chain-id' });
      
      const ligand = await plugin.builders.structure.tryCreateComponentStatic(structure, 'ligand');
      if (ligand) await plugin.builders.structure.representation.addRepresentation(ligand, { type: 'ball-and-stick', color: 'element-symbol' });

      setFileName(id.toUpperCase()); 
      setLoading(false);
      showToastMsg(`Loaded ${id}`);
    } catch { setError('Fetch failed'); setLoading(false); }
  };

  // --- DEBUG: Inspect Structure ---
  const inspectStructure = () => {
    const plugin = getPlugin();
    if (!plugin) return;
    const structure = plugin.managers.structure.hierarchy.current.structures[0]?.cell?.obj?.data;
    if (!structure) {
        showToastMsg("没有加载结构");
        return;
    }

    console.group("🧪 Structure Inspection");
    const { units } = structure;
    const stats = {};
    
    units.forEach(u => {
        const chainId = u.unitVariant ? u.unitVariant : u.model.atomicHierarchy.chains.auth_asym_id.value(u.chainIndex);
        if (!stats[chainId]) stats[chainId] = { min: 99999, max: -99999, count: 0 };
        
        const residueIndex = u.model.atomicHierarchy.residueAtomSegments.index(u.elements[0]);
        const resId = u.model.atomicHierarchy.residues.auth_seq_id.value(residueIndex);
        
        // This is a rough check, iterating atoms is expensive, just checking first/last of units
        stats[chainId].count++; 
    });
    
    // Better way: use Model Server query or just simple prompt
    const info = `结构已加载。请在 Console 查看详细信息 (F12)。\n简单检查: 尝试操作 'polymer' 或 'ligand'。`;
    console.log("Structure Object:", structure);
    console.log("Tip: Check `structure.model.atomicHierarchy` for exact auth_seq_ids.");
    console.groupEnd();
    
    setMessages(prev => [...prev, { role: 'system', content: "已在控制台打印结构信息。请检查链名称是否为 A, B 等。" }]);
  };

  // --- DIRECT ACTION: Apply Color Immediately ---
  const applyColorDirectly = async () => {
    const plugin = getPlugin();
    if (!plugin) return;

    const { action, targetType, chainVal, resIdVal, resEndVal, colorVal } = formState;
    const MS = window.molstar.MolScriptBuilder;
    
    // 1. Get Root Structure
    const rootStruct = plugin.managers.structure.hierarchy.current.structures[0];
    if (!rootStruct) { showToastMsg("未加载结构"); return; }

    // 2. Build Expression (The "Query")
    let expression = null;
    const chain = chainVal ? chainVal.trim() : ""; 
    const chainTest = chain ? MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), chain]) : null;

    console.log(`[Direct] Building Query: Type=${targetType}, Chain=${chain}, Res=${resIdVal}`);

    if (targetType === 'residue') {
        const start = parseInt(resIdVal);
        const end = resEndVal ? parseInt(resEndVal) : start;
        
        if (isNaN(start)) { showToastMsg("请输入有效的残基编号 (数字)"); return; }

        const conditions = [
            MS.core.rel.gr([MS.struct.atomProperty.macromolecular.auth_seq_id(), start - 1]),
            MS.core.rel.lt([MS.struct.atomProperty.macromolecular.auth_seq_id(), end + 1])
        ];
        if (chainTest) conditions.push(chainTest);
        
        expression = MS.struct.generator.atomGroups({
            'residue-test': MS.core.logic.and(conditions)
        });
    } else if (targetType === 'chain') {
        if (!chain) { showToastMsg("请输入链ID"); return; }
        expression = MS.struct.generator.atomGroups({
            'chain-test': chainTest
        });
    } else if (targetType === 'ligand') {
        expression = MS.struct.generator.atomGroups({
            'entity-test': MS.core.rel.eq([MS.struct.atomProperty.macromolecular.entityType(), 'non-polymer'])
        });
    } else if (targetType === 'all') {
        expression = MS.struct.generator.all();
    }

    if (!expression) { showToastMsg("查询构建失败"); return; }

    try {
        // 3. Create Component (Selection) -> This creates a "Sub-structure"
        // Using a random tag to ensure it's a new unique layer
        const layerId = mkId();
        const label = `${action} ${targetType} ${chain}:${resIdVal}`;

        const component = await plugin.builders.structure.tryCreateComponentFromExpression(
            rootStruct.cell, 
            expression, 
            layerId, 
            { label: label }
        );

        // CHECK: Did we select anything?
        if (!component) {
            showToastMsg("⚠️ 未选中任何原子 (检查链/残基号)");
            setMessages(prev => [...prev, { role: 'system', content: `❌ 未找到: ${chain}链 ${resIdVal}号。请检查 PDB 数据。` }]);
            return;
        }

        // 4. Add Representation (The Look)
        const colorInt = hexToInt(colorVal);
        
        await plugin.builders.structure.representation.addRepresentation(component, {
            type: 'ball-and-stick', // Always use B&S for manual highlights as it's visible over cartoon
            color: 'uniform',
            colorParams: { value: colorInt },
            typeParams: { sizeFactor: 0.4 } // Make it thick
        });

        // 5. Update UI
        setLayers(prev => [...prev, { id: layerId, label }]);
        setMessages(prev => [...prev, { role: 'user', content: `[Direct] Applied ${label}` }]);
        showToastMsg("✅ 已应用更改");

    } catch (err) {
        console.error("Direct apply failed:", err);
        showToastMsg("执行错误: " + err.message);
    }
  };

  // --- Clear All Custom Layers ---
  const clearLayers = async () => {
    const plugin = getPlugin();
    if (!plugin) return;
    
    // We remove components by the tags we created
    // But easier method: Remove everything that is not "polymer" or "ligand" (base)
    // For this simple version, let's just reload the PDB structure components or remove specifically.
    
    // Simplest approach: Remove the components we tracked
    const hierarchy = plugin.managers.structure.hierarchy.current;
    const toRemove = [];
    
    hierarchy.structures.forEach(s => {
        s.components.forEach(c => {
             // If the key starts with 'layer_', it's ours
             if (c.key && c.key.startsWith('layer_')) {
                 toRemove.push(c);
             }
        });
    });

    if (toRemove.length > 0) {
        await plugin.managers.structure.hierarchy.remove(toRemove);
        setLayers([]);
        showToastMsg("已清理所有图层");
    } else {
        showToastMsg("没有可清理的图层");
    }
  };

  // --- RENDER ---
  return (
    <div className="flex flex-col h-screen w-full bg-slate-50 text-slate-800 font-sans overflow-hidden">
      {/* Toast */}
      {toast && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-50 bg-slate-800/90 text-white px-4 py-2 rounded-full shadow-xl flex items-center gap-2 animate-fade-in-up transition-all pointer-events-none">
          <Sparkles size={14} className="text-yellow-400" />
          <span className="text-xs font-medium">{toast}</span>
        </div>
      )}

      {/* Header */}
      <header className="h-14 bg-white border-b flex items-center justify-between px-4 shadow-sm z-20">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 p-1.5 rounded text-white"><Cpu size={18} /></div>
          <h1 className="font-bold text-lg tracking-tight">BioLens <span className="text-indigo-600">Direct</span></h1>
        </div>
        <div className="flex items-center gap-2">
            <input className="bg-slate-100 border-none outline-none text-sm w-24 px-2 py-1.5 uppercase rounded" 
                   value={pdbId} onChange={(e) => setPdbId(e.target.value)} placeholder="PDB ID" />
            <button onClick={() => handleFetchPdb(pdbId)} className="btn-secondary px-3 py-1.5 bg-slate-200 rounded text-xs font-bold">Load</button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Main Viewer */}
        <main className="flex-1 relative bg-slate-200">
          <div ref={containerRef} className="absolute inset-0 w-full h-full" />
          <div className="absolute top-4 left-4 z-10">
              <div className="bg-white/90 px-3 py-1 rounded shadow font-bold text-xs">ID: {fileName}</div>
          </div>
          <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
            {layers.length > 0 && (
                <button onClick={clearLayers} className="bg-red-500 text-white px-3 py-1.5 rounded shadow text-xs font-bold flex items-center gap-1">
                    <Trash2 size={12} /> Clear ({layers.length})
                </button>
            )}
             <button onClick={inspectStructure} className="bg-slate-700 text-white px-3 py-1.5 rounded shadow text-xs font-bold flex items-center gap-1">
                <FileText size={12} /> Check Struct
            </button>
          </div>
        </main>

        {/* Sidebar */}
        <aside className="w-80 bg-white border-l flex flex-col z-20 shadow-xl">
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
             {/* Log Area */}
             <div className="bg-slate-50 p-3 rounded-lg border h-32 overflow-y-auto mb-4 text-xs font-mono space-y-1">
                {messages.map((m, i) => (
                    <div key={i} className={m.role === 'user' ? 'text-indigo-600' : 'text-slate-600'}>
                        {m.role === 'user' ? '>' : '#'} {m.content}
                    </div>
                ))}
                <div ref={chatEndRef}></div>
             </div>

             <section>
               <div className="flex items-center gap-2 mb-3 text-indigo-600 font-bold text-xs uppercase tracking-wider">
                   <Settings2 size={14} /> 直接控制 (Direct Control)
               </div>
               
               <div className="space-y-3 p-3 bg-slate-50 rounded-xl border border-indigo-100">
                  {/* Action Row */}
                  <div className="grid grid-cols-2 gap-2">
                      <label className="text-[10px] text-slate-500 uppercase font-bold">Mode</label>
                      <label className="text-[10px] text-slate-500 uppercase font-bold">Target</label>
                      <select className="input-field" disabled value="color">
                          <option value="color">Add Color</option>
                      </select>
                      <select className="input-field" value={formState.targetType} onChange={e => setFormState({...formState, targetType: e.target.value})}>
                          <option value="residue">Residue (残基)</option>
                          <option value="chain">Chain (链)</option>
                          <option value="ligand">Ligand (配体)</option>
                          <option value="all">All (整体)</option>
                      </select>
                  </div>

                  {/* Dynamic Inputs */}
                  {formState.targetType === 'chain' && (
                     <div>
                         <label className="label-text">Chain ID</label>
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
                                 <label className="label-text">Residue Start</label>
                                 <input type="number" className="input-field" value={formState.resIdVal} onChange={e => setFormState({...formState, resIdVal: e.target.value})} placeholder="10" />
                             </div>
                             <div>
                                 <label className="label-text">End (Optional)</label>
                                 <input type="number" className="input-field" value={formState.resEndVal} onChange={e => setFormState({...formState, resEndVal: e.target.value})} placeholder="20" />
                             </div>
                         </div>
                     </div>
                  )}

                  {/* Color Picker */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-200 mt-2">
                      <span className="label-text">Pick Color</span>
                      <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-slate-500">{formState.colorVal}</span>
                          <input type="color" className="w-6 h-6 p-0 border-none bg-transparent cursor-pointer" 
                                 value={formState.colorVal} onChange={e => setFormState({...formState, colorVal: e.target.value})} />
                      </div>
                  </div>
               </div>

               {/* Execute Button */}
               <button onClick={applyColorDirectly} className="mt-4 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all active:scale-95 shadow-md">
                   <Play size={16} fill="currentColor" />
                   执行 (Execute)
               </button>
             </section>
          </div>
        </aside>
      </div>

      <style>{`
        .input-field { @apply w-full bg-white border border-slate-300 text-slate-700 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500; }
        .label-text { @apply text-[10px] text-slate-500 font-medium mb-1 block; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 2px; }
        @keyframes fade-in-up { 0% { opacity: 0; transform: translate(-50%, 10px); } 100% { opacity: 1; transform: translate(-50%, 0); } }
        .animate-fade-in-up { animation: fade-in-up 0.3s ease-out forwards; }
      `}</style>
    </div>
  );
};

export default BioLensApp;