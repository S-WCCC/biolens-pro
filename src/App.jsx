import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, Sun, Layers, Maximize, Upload, Download, Zap, Droplet, Box, 
  AlertCircle, Play, Pause, Grid, Scissors, Eye, Disc, Activity, Monitor, Ghost,
  MessageSquare, Mic, Send, Share2, RefreshCw, Search
} from 'lucide-react';

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
  
  // Color State
  const [customColor, setCustomColor] = useState("#4f46e5"); 
  const [useCustomColor, setUseCustomColor] = useState(false);
  
  // AI Chat State
  const [aiInput, setAiInput] = useState("");
  const [aiHistory, setAiHistory] = useState([{role: 'system', text: 'System Ready.'}]);

  useEffect(() => {
    const initViewer = async () => {
        try {
            // 1. 加载资源
            if (!window.molstar) {
                console.log("Loading Mol* from CDN...");
                loadStyle("https://cdn.jsdelivr.net/npm/molstar@latest/build/viewer/molstar.css");
                await loadScript("https://cdn.jsdelivr.net/npm/molstar@latest/build/viewer/molstar.js");
            }
            if (!window.molstar) throw new Error("Failed to load Mol* engine.");

            await new Promise(r => setTimeout(r, 100));

            // 2. 初始化 Viewer
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
            
            // 3. 初始加载
            loadPdbFromUrl("https://files.rcsb.org/download/4hhb.pdb");

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
        } catch(e) {}
    };
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

  // --- 1. 修复 Fetch 功能 ---
  const handlePdbFetch = async (e) => {
      e.preventDefault();
      if (!pdbIdInput || pdbIdInput.length < 4) {
          alert("请输入有效的 4 位 PDB ID (例如 1CRN)");
          return;
      }
      const id = pdbIdInput.toLowerCase();
      setFileName(id.toUpperCase());
      // 优先尝试 .bcif (更小更快)，如果失败 Mol* 可能会报错，这里用 pdb 兼容性好点
      await loadPdbFromUrl(`https://files.rcsb.org/download/${id}.pdb`);
      setPdbIdInput("");
  };

  const loadPdbFromUrl = async (url) => {
    setLoading(true);
    setError(null);
    const ctx = getPluginContext();
    if(!ctx) return;

    try {
        await ctx.clear(); // 清空整个场景
        
        const format = getFormat(url);
        console.log(`Downloading ${url}...`);
        
        const data = await ctx.builders.data.download({ url: url }, { state: { isGhost: true } });
        const trajectory = await ctx.builders.structure.parseTrajectory(data, format);
        const model = await ctx.builders.structure.createModel(trajectory);
        await ctx.builders.structure.createStructure(model); // 创建基础结构
        
        // 关键：结构加载后，立即调用 applyStyle 生成视觉效果
        // 不传递参数，让 applyStyle 自动获取 hierarchy 中的结构 wrapper (解决 .components undefined 问题)
        await applyStyle(); 
        
        ctx.managers.camera.reset();
        setLoading(false);
    } catch (e) {
        console.error("Download Error:", e);
        setError(`加载失败: ${e.message}。请检查网络或 PDB ID。`);
        setLoading(false);
    }
  };

  // --- 2. 修复上传无反应 (绕过 Asset 系统) ---
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setLoading(true);
    setError(null);

    const ctx = getPluginContext();
    if(!ctx) return;

    try {
        await ctx.clear(); 
        const format = getFormat(file.name);
        const isBinary = format === 'bcif'; 
        
        console.log(`Reading local file: ${file.name} (${format})`);

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
        
        await applyStyle(); // 立即上色，不传参数，自动查找
        
        ctx.managers.camera.reset();
        setLoading(false);
    } catch(err) {
        console.error("Upload Error:", err);
        setError(`解析失败: ${err.message}`);
        setLoading(false);
    }
  };

  // 监听状态变化自动重绘
  useEffect(() => {
      // 只有当不是正在加载时才重绘，避免冲突
      if(pluginRef.current && !loading && !error) {
          applyStyle();
      }
  }, [currentStyle, focusMode, showInteractions, customColor, useCustomColor]);

  // --- 3 & 4. 修复画风重置 & 染色 (Clean Slate Strategy) ---
  const applyStyle = async (structureInput) => {
      const ctx = getPluginContext();
      if (!ctx) return;
      
      const hierarchy = ctx.managers.structure.hierarchy.current;
      
      // 核心修复：正确解析 structure 对象
      let structure = structureInput;
      if (structureInput && !structureInput.components) {
          structure = hierarchy.structures.find(s => s.cell.obj?.id === structureInput.cell?.obj?.id) || hierarchy.structures[0];
      }
      
      if (!structure) {
          structure = hierarchy.structures[0];
      }
      
      if (!structure) return;

      try {
          // A. 画布/光照设置 (Post-Processing)
          const canvas = ctx.canvas3d;
          if(canvas) {
              let props = {
                  renderer: { backgroundColor: 0xffffff }, // Default white
                  postProcessing: {
                      occlusion: { name: 'off', params: {} },
                      outline: { name: 'off', params: {} },
                  }
              };

              if(currentStyle === 'journal_nature') {
                  props.renderer.backgroundColor = 0xffffff;
                  props.postProcessing.occlusion = { 
                      name: 'on', 
                      params: { samples: 32, radius: 5, bias: 0.8, blurKernelSize: 15, resolutionScale: 1 } 
                  };
              } 
              else if(currentStyle === 'journal_cell') {
                  props.renderer.backgroundColor = 0xfdfbf7; // Warm white
                  props.postProcessing.outline = { 
                      name: 'on', 
                      params: { scale: 1, threshold: 0.33, color: 0x000000, includeTransparent: true } 
                  };
                  props.postProcessing.occlusion = { 
                      name: 'on', 
                      params: { samples: 32, radius: 4, bias: 1.0 } 
                  };
              }
              else if(currentStyle === 'glass') {
                  props.renderer.backgroundColor = 0x000000;
              }
              else if(currentStyle === 'hologram') {
                  props.renderer.backgroundColor = 0x000000;
              }
              else if(currentStyle === 'xray') {
                  props.renderer.backgroundColor = 0x111111;
              }

              ctx.canvas3d.setProps(props);
          }

          // B. 准备颜色
          const customColorInt = parseInt(customColor.replace('#', ''), 16);
          let colorTheme = useCustomColor ? 'uniform' : 'chain-id';
          let colorParams = useCustomColor ? { value: customColorInt } : {};

          // C. 移除所有现有的子组件
          const components = structure.components;
          if (components && components.length > 0) {
              await ctx.managers.structure.hierarchy.remove(components);
          }

          // D. 重新创建组件和视觉效果
          
          // --- 1. Polymer (骨架) ---
          let polymerComp;
          try {
              const polymerQuery = ctx.managers.structure.selection.fromSelectionQuery('polymer');
              // 关键修复：增加空值检查，防止 reading 'expression' of undefined
              if (polymerQuery) {
                  polymerComp = await ctx.builders.structure.tryCreateComponentFromExpression(
                      structure.cell, polymerQuery.expression, 'polymer', { label: 'Polymer', key: 'polymer' }
                  );
              }
          } catch(e) {
              console.warn("Polymer component creation failed:", e);
          }

          if (polymerComp) {
              if(currentStyle === 'journal_cell') {
                  // Cell Style: Putty Cartoon
                  await ctx.builders.structure.representation.addRepresentation(polymerComp, {
                      type: 'putty', 
                      color: colorTheme, colorParams
                  });
              } else if(currentStyle === 'glass') {
                  // Glass Style: Spacefill (Transparent) + Cartoon (Solid)
                  await ctx.builders.structure.representation.addRepresentation(polymerComp, {
                      type: 'spacefill', 
                      typeParams: { alpha: 0.3, ignoreLight: false }, 
                      color: colorTheme, colorParams
                  });
                  await ctx.builders.structure.representation.addRepresentation(polymerComp, {
                      type: 'cartoon', color: colorTheme, colorParams
                  });
              } else if(currentStyle === 'hologram') {
                  // Hologram: Neon wireframe
                  const neonColor = useCustomColor ? customColorInt : 0x00ffcc;
                  await ctx.builders.structure.representation.addRepresentation(polymerComp, {
                      type: 'cartoon', typeParams: { sizeFactor: 0.1 }, color: 'uniform', colorParams: { value: neonColor }
                  });
                  await ctx.builders.structure.representation.addRepresentation(polymerComp, {
                      type: 'ball-and-stick', typeParams: { sizeFactor: 0.1 }, color: 'uniform', colorParams: { value: 0xffffff }
                  });
              } else if(currentStyle === 'xray') {
                  await ctx.builders.structure.representation.addRepresentation(polymerComp, {
                      type: 'molecular-surface', 
                      typeParams: { alpha: 0.2, flatShaded: true, doubleSided: true, ignoreLight: true }, 
                      color: 'uniform', colorParams: { value: 0xffffff }
                  });
                  await ctx.builders.structure.representation.addRepresentation(polymerComponent, {
                      type: 'cartoon', color: 'uniform', colorParams: { value: 0xffffff }
                  });
              } else {
                  // Nature (Default): High quality cartoon
                  await ctx.builders.structure.representation.addRepresentation(polymerComp, {
                      type: 'cartoon', 
                      color: colorTheme, colorParams
                  });
              }
          } else {
              // 兜底：如果没有 Polymer (比如 DNA 或小分子复合物)，就画全部
              await ctx.builders.structure.representation.addRepresentation(structure.cell, { 
                  type: 'ball-and-stick', color: colorTheme, colorParams 
              });
          }

          // --- 2. Ligand (配体) ---
          try {
              const ligandQuery = ctx.managers.structure.selection.fromSelectionQuery('ligand');
              // 关键修复：增加空值检查
              if (ligandQuery) {
                  const ligandComp = await ctx.builders.structure.tryCreateComponentFromExpression(
                      structure.cell, ligandQuery.expression, 'ligand', { label: 'Ligand' }
                  );
                  
                  if (ligandComp) {
                      await ctx.builders.structure.representation.addRepresentation(ligandComp, {
                          type: 'ball-and-stick', 
                          typeParams: { sizeFactor: 0.4 },
                          color: 'element-symbol' 
                      });
                      
                      if (focusMode === 'binder') {
                          const loci = ctx.managers.structure.selection.getLoci(ligandComp.obj.data);
                          ctx.managers.camera.focusLoci(loci);
                      }
                  }
              }
          } catch(e) {
              console.warn("Ligand creation failed:", e);
          }

          // --- 3. Interactions ---
          if (showInteractions) {
              // 在根结构上添加相互作用
              await ctx.builders.structure.representation.addRepresentation(structure.cell, {
                 type: 'interactions',
                 typeParams: { lineSizeFactor: 0.05, includeCovalent: false },
                 color: 'interaction-type'
              });
          }

      } catch (styleErr) {
          console.error("Style Apply Error:", styleErr);
      }
  };

  const toggleInteractions = () => setShowInteractions(!showInteractions);
  
  const handleColorChange = (e) => { 
      setCustomColor(e.target.value); 
      setUseCustomColor(true); 
  };

  const resetView = async () => {
      setUseCustomColor(false);
      setShowInteractions(false);
      setCurrentStyle('journal_nature');
      setFocusMode('global');
      const ctx = getPluginContext();
      if(ctx) ctx.managers.camera.reset();
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
          } catch(e){}
      }
  };
  
  const handleAiSubmit = async (e) => {
    e.preventDefault();
    if(!aiInput.trim()) return;
    
    setAiHistory(prev => [...prev, {role: 'user', text: aiInput}]);
    const cmd = aiInput.toLowerCase();
    setAiInput("");
    
    let reply = "指令已接收。";
    const ctx = getPluginContext();
    const MS = window.molstar?.MolScriptBuilder;

    try {
        if(cmd.includes("red") || cmd.includes("红")) { 
            setCustomColor("#ff0000"); setUseCustomColor(true); reply = "已染色为红色。"; 
        }
        else if(cmd.includes("blue") || cmd.includes("蓝")) { 
            setCustomColor("#4f46e5"); setUseCustomColor(true); reply = "已染色为蓝色。"; 
        }
        else if(cmd.includes("reset") || cmd.includes("复位")) { 
            resetView(); reply = "视图已重置。"; 
        }
        else if(cmd.includes("bond") || cmd.includes("interaction") || cmd.includes("氢键")) { 
            setShowInteractions(true); reply = "已显示相互作用。"; 
        }
        else if (MS && ctx) {
            const structure = ctx.managers.structure.hierarchy.current.structures[0];
            const chainMatches = cmd.match(/[a-z0-9]链/g);
            if (chainMatches && chainMatches.length >= 1) {
                const chains = chainMatches.map(s => s.replace('链', '').toUpperCase());
                const chainExp = MS.struct.generator.atomGroups({
                    'chain-test': MS.core.logic.or(
                        chains.map(c => MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), c]))
                    )
                });
                const comp = await ctx.builders.structure.tryCreateComponentFromExpression(
                    structure.cell, chainExp, 'custom-selection', { label: `Chain ${chains.join('+')}` }
                );
                await ctx.builders.structure.representation.addRepresentation(comp, { type: 'ball-and-stick', color: 'chain-id' });
                const loci = ctx.managers.structure.selection.getLoci(comp.obj.data);
                ctx.managers.camera.focusLoci(loci);
                reply = `已聚焦 ${chains.join(' ')} 链。`;
            }
        }
    } catch (err) {
        console.error(err);
        reply = "指令解析失败。";
    }
    setTimeout(() => setAiHistory(prev => [...prev, {role: 'system', text: reply}]), 500);
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
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 z-10 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 p-1.5 rounded-lg">
            <Camera className="text-white" size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">BioLens <span className="text-indigo-600">Pro</span></h1>
            <p className="text-xs text-gray-500">Synthetic Bio Edition</p>
          </div>
        </div>
        
        {/* Fetch & Upload Bar */}
        <div className="flex items-center gap-2">
            <form onSubmit={handlePdbFetch} className="flex items-center border border-gray-300 rounded-md overflow-hidden bg-gray-50">
                <div className="px-3 text-gray-400"><Search size={14}/></div>
                <input 
                    type="text" 
                    value={pdbIdInput}
                    onChange={(e) => setPdbIdInput(e.target.value.toUpperCase())}
                    placeholder="PDB ID (e.g. 1CRN)" 
                    className="w-32 py-1.5 bg-transparent text-sm focus:outline-none"
                    maxLength={4}
                />
                <button type="submit" className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-xs font-medium transition-colors">Fetch</button>
            </form>
            
            <div className="h-6 w-px bg-gray-300 mx-2"></div>

            <label className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md cursor-pointer transition-colors shadow-sm">
                <Upload size={16} />
                <span className="text-sm font-medium">Upload</span>
                <input type="file" accept=".pdb,.cif,.ent,.mmcif" onChange={handleFileUpload} className="hidden" />
            </label>
            <button onClick={takeScreenshot} className="p-2 border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-md" title="Screenshot">
                <Download size={16} />
            </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="relative flex-1 bg-gray-100">
           {error && (
             <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 bg-white p-6 rounded-lg shadow-2xl border-2 border-red-500 max-w-lg w-full">
                <div className="flex items-center gap-2 text-red-600 font-bold text-lg mb-2"><AlertCircle /> Error</div>
                <div className="bg-gray-100 p-3 rounded text-sm font-mono text-gray-700 break-words mb-4 max-h-40 overflow-auto">{error}</div>
                <button onClick={() => setError(null)} className="w-full py-2 bg-gray-200 hover:bg-gray-300 rounded font-medium">Close</button>
             </div>
           )}
           {loading && (
             <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/80">
               <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-600 border-t-transparent"></div>
             </div>
           )}
           <div ref={containerRef} className="absolute inset-0 w-full h-full" />
           
           <div className="absolute top-4 right-4 z-20 flex gap-2">
               <button onClick={resetView} className="flex items-center gap-2 px-4 py-2 rounded-full shadow-lg border bg-white text-gray-700 hover:bg-gray-50">
                   <RefreshCw size={16} /> <span className="text-sm">Reset</span>
               </button>
               <button onClick={toggleInteractions} className={`flex items-center gap-2 px-4 py-2 rounded-full shadow-lg border ${showInteractions ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700'}`}>
                   <Share2 size={16} /> <span className="text-sm">H-Bonds</span>
               </button>
           </div>

           <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 w-full max-w-lg px-4 z-20">
               {aiHistory.length > 1 && (
                 <div className="mb-2 bg-black/60 backdrop-blur text-white text-xs p-2 rounded-lg max-h-32 overflow-y-auto">
                     {aiHistory.slice(-2).map((m,i) => <div key={i} className="mb-1"><b>{m.role}:</b> {m.text}</div>)}
                 </div>
               )}
               <form onSubmit={handleAiSubmit} className="relative">
                  <div className="absolute left-3 top-3 text-indigo-400"><MessageSquare size={18}/></div>
                  <input type="text" value={aiInput} onChange={e=>setAiInput(e.target.value)} placeholder="AI指令..." className="w-full bg-black/70 backdrop-blur border border-indigo-500/30 text-white pl-10 pr-12 py-3 rounded-full outline-none" />
                  <button type="submit" className="absolute right-2 top-2 p-1.5 bg-indigo-600 rounded-full text-white"><Send size={16}/></button>
               </form>
           </div>
        </div>

        <div className="w-64 bg-white border-l border-gray-200 p-4 z-20 shadow-xl flex flex-col gap-6">
           <div>
               <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Styles (滤镜)</h3>
               <div className="grid grid-cols-2 gap-2">
                   {styles.map(s => (
                       <button key={s.id} onClick={() => setCurrentStyle(s.id)} className={`p-2 rounded-lg border text-xs font-medium transition-colors ${currentStyle === s.id ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'hover:bg-gray-50'}`}>{s.name}</button>
                   ))}
               </div>
           </div>
           
           <div>
               <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Scene Focus (场景)</h3>
               <div className="grid grid-cols-1 gap-2">
                   {modes.map(m => (
                       <button key={m.id} onClick={() => setFocusMode(m.id)} className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-medium ${focusMode === m.id ? 'bg-gray-800 text-white' : 'hover:bg-gray-50'}`}>
                           <span className="flex items-center gap-2"><m.icon size={14} /> {m.name}</span>
                       </button>
                   ))}
               </div>
           </div>

           <div>
               <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Tint (染色)</h3>
               <div className="flex items-center gap-2">
                   <input type="color" value={customColor} onChange={handleColorChange} className="w-full h-8 cursor-pointer rounded border border-gray-200" />
                   {useCustomColor && <button onClick={() => { setUseCustomColor(false); setCustomColor("#4f46e5"); }} className="text-[10px] text-gray-500 underline">Reset</button>}
               </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default BioLens;
