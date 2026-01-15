import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, Sun, Layers, Maximize, Upload, Download, Zap, Droplet, Box, 
  AlertCircle, Play, Pause, Grid, Scissors, Eye, Disc, Activity, Monitor, Ghost,
  MessageSquare, Mic, Send, Share2
} from 'lucide-react';

const BioLens = () => {
  const containerRef = useRef(null);
  const pluginRef = useRef(null);
  
  // UI State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState("4hhb.pdb (Hemoglobin)");
  
  // Visualization State
  const [currentStyle, setCurrentStyle] = useState('journal_nature');
  const [focusMode, setFocusMode] = useState('global');
  const [showInteractions, setShowInteractions] = useState(false);
  const [spin, setSpin] = useState(false);
  
  // 恢复之前好看的蓝色默认值
  const [customColor, setCustomColor] = useState("#4f46e5"); 
  const [useCustomColor, setUseCustomColor] = useState(false);
  
  // AI Chat State
  const [aiInput, setAiInput] = useState("");
  const [aiHistory, setAiHistory] = useState([{role: 'system', text: 'Mol* Engine Ready. Upload a PDB to start.'}]);

  useEffect(() => {
    const initViewer = async () => {
        // 检查 Mol* 资源是否加载
        if (!window.molstar) {
            setError("Critical Error: window.molstar is undefined. Please check if index.html includes the Mol* script.");
            return;
        }

        try {
            const plugin = await window.molstar.Viewer.create(containerRef.current, {
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
            
            pluginRef.current = plugin;
            
            // Initial Load
            loadPdbFromUrl("https://files.rcsb.org/download/4hhb.pdb");

        } catch (e) {
            console.error("Init Error:", e);
            setError(`Initialization Failed: ${e.message}`);
            setLoading(false);
        }
    };

    setTimeout(initViewer, 100);

    return () => {
        pluginRef.current?.dispose();
    };
  }, []);

  // 辅助函数：更强壮的格式检测
  const getFormat = (str) => {
      if (!str) return 'pdb';
      const lower = str.toLowerCase();
      if (lower.endsWith('.cif') || lower.endsWith('.mmcif')) return 'mmcif';
      if (lower.endsWith('.bcif')) return 'bcif';
      if (lower.endsWith('.pdb') || lower.endsWith('.ent')) return 'pdb';
      return 'pdb'; // 默认回退到 pdb
  };

  const loadPdbFromUrl = async (url) => {
    setLoading(true);
    setError(null);
    const plugin = pluginRef.current;
    if(!plugin) return;

    try {
        await plugin.clear();
        const format = getFormat(url);
        
        const data = await plugin.builders.data.download({ url: url }, { state: { isGhost: true } });
        const trajectory = await plugin.builders.structure.parseTrajectory(data, format);
        const model = await plugin.builders.structure.createModel(trajectory);
        await plugin.builders.structure.createStructure(model);
        
        setLoading(false);
        plugin.managers.camera.reset();
    } catch (e) {
        console.error("Download Error:", e);
        setError(`Load Error: ${e.message}`);
        setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setLoading(true);
    setError(null);

    const plugin = pluginRef.current;
    if(!plugin) return;

    try {
        await plugin.clear();
        
        const format = getFormat(file.name);
        const isBinary = format === 'bcif'; 
        
        console.log(`Attempting to load ${file.name} as ${format} (Binary: ${isBinary})`);

        // --- 核心修复逻辑：双重尝试加载 ---
        try {
            // 尝试 1: 标准读取
            const data = await plugin.builders.data.readFile({ file, label: file.name, isBinary });
            const trajectory = await plugin.builders.structure.parseTrajectory(data, format);
            const model = await plugin.builders.structure.createModel(trajectory);
            await plugin.builders.structure.createStructure(model);
        } catch (innerErr) {
            console.warn("Standard read failed, attempting fallback to text read...", innerErr);
            
            // 尝试 2 (Fallback): 强制作为文本读取
            // 很多时候 Mol* 对 file 对象的处理在不同浏览器有兼容性问题，
            // 这里我们手动读出文本，再喂给 Mol*
            if (!isBinary) {
                const text = await file.text();
                const data = await plugin.builders.data.rawData({ data: text, label: file.name });
                const trajectory = await plugin.builders.structure.parseTrajectory(data, format);
                const model = await plugin.builders.structure.createModel(trajectory);
                await plugin.builders.structure.createStructure(model);
            } else {
                throw innerErr; // 二进制文件没法转文本，抛出错误
            }
        }
        
        setLoading(false);
        plugin.managers.camera.reset();
        
    } catch(err) {
        console.error("Upload Error:", err);
        // 显示详细错误给用户
        setError(`Parsing Failed: ${err.message}. Detected format: ${getFormat(file.name).toUpperCase()}`);
        setLoading(false);
    }
  };

  // --- Watch for Style Changes ---
  useEffect(() => {
      if(pluginRef.current && !loading && !error) {
          applyStyle();
      }
  }, [currentStyle, focusMode, showInteractions, customColor, useCustomColor, loading]);

  const applyStyle = async () => {
      const plugin = pluginRef.current;
      if (!plugin) return;
      
      try {
          const managers = plugin.managers;
          const hierarchy = managers.structure.hierarchy.current;
          if (!hierarchy.structures[0]) return;
          const structure = hierarchy.structures[0];

          // 1. Clear old
          await managers.structure.component.clear(structure.cell);

          // 2. Background
          const canvas = plugin.canvas3d;
          if(canvas) {
              let bgColor = 0xffffff;
              if(currentStyle === 'hologram' || currentStyle === 'xray') bgColor = 0x000000;
              if(currentStyle === 'glass') bgColor = 0x111111;
              if(currentStyle === 'journal_cell') bgColor = 0xfdfbf7;
              
              const renderer = canvas.props.renderer;
              plugin.canvas3d.setProps({ renderer: { ...renderer, backgroundColor: bgColor } });
          }

          // 3. Components
          const polymer = await managers.structure.component.add({
              selection: managers.structure.selection.fromSelectionQuery('polymer'),
              label: 'Polymer'
          });

          // Coloring Logic
          const customColorInt = parseInt(customColor.replace('#', ''), 16);
          let colorTheme = useCustomColor ? 'uniform' : 'chain-id';
          let colorParams = useCustomColor ? { value: customColorInt } : {};

          // Representations
          let type = 'cartoon';
          let typeParams = {};
          
          if(currentStyle === 'journal_cell') {
              typeParams = { sizeFactor: 0.4 };
          } else if(currentStyle === 'glass') {
              type = 'spacefill';
              typeParams = { ignoreLight: false, alpha: 0.3, sizeFactor: 1.1 };
          } else if(currentStyle === 'hologram') {
              typeParams = { sizeFactor: 0.1 };
              colorTheme = 'uniform';
              colorParams = { value: 0x00ffcc };
          } else if(currentStyle === 'xray') {
              // Add transparent surface + cartoon
              await managers.structure.representation.addRepresentation(polymer, {
                  type: 'molecular-surface',
                  typeParams: { alpha: 0.15, flatShaded: true, doubleSided: true, ignoreLight: true }, 
                  color: 'uniform', colorParams: { value: 0xffffff }
              });
              type = 'cartoon';
              typeParams = { sizeFactor: 0.2 };
              colorTheme = 'uniform';
              colorParams = { value: 0xffffff };
          }

          await managers.structure.representation.addRepresentation(polymer, {
              type, typeParams, color: colorTheme, colorParams
          });

          // Ligands
          try {
            const ligand = await managers.structure.component.add({
                selection: managers.structure.selection.fromSelectionQuery('ligand'),
                label: 'Ligand'
            });
            await managers.structure.representation.addRepresentation(ligand, {
                type: 'ball-and-stick', color: 'element-symbol', typeParams: { sizeFactor: 0.35 }
            });
            if (focusMode === 'binder') {
                const loci = managers.structure.selection.getLoci(ligand.cell.obj.data);
                plugin.managers.camera.focusLoci(loci);
            }
          } catch (e) {}

          // H-Bonds
          if (showInteractions) {
              await managers.structure.representation.addRepresentation(structure, {
                 type: 'interactions',
                 typeParams: { lineSizeFactor: 0.1, includeCovalent: false },
                 color: 'interaction-type'
              });
          }
      } catch (styleErr) {
          console.error("Style Apply Error:", styleErr);
      }
  };

  const toggleInteractions = () => setShowInteractions(!showInteractions);
  const handleColorChange = (e) => { setCustomColor(e.target.value); setUseCustomColor(true); };
  const takeScreenshot = () => { pluginRef.current?.helpers.viewportScreenshot?.share(); };
  
  // --- AI Logic (Placeholder until API is connected) ---
  const handleAiSubmit = async (e) => {
    e.preventDefault();
    if(!aiInput.trim()) return;
    
    // UI Update
    setAiHistory(prev => [...prev, {role: 'user', text: aiInput}]);
    const userInput = aiInput;
    setAiInput("");
    
    // 如果你已经配置好了 api/chat.js，可以在这里取消注释
    /*
    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userInput })
        });
        const data = await res.json();
        // 处理 data.result ...
    } catch (err) { ... }
    */

    // Mock Response
    let reply = "Connect API to fully activate.";
    if(userInput.includes("red")) { setCustomColor("#ff0000"); setUseCustomColor(true); reply = "Coloring Red."; }
    else if(userInput.includes("blue")) { setCustomColor("#4f46e5"); setUseCustomColor(true); reply = "Coloring Blue."; }
    else if(userInput.includes("reset")) { setUseCustomColor(false); reply = "Resetting view."; }
    
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
    { id: 'global', name: 'Global View', icon: Maximize },
    { id: 'binder', name: 'Binder Focus', icon: Layers },
    { id: 'structure_prop', name: 'Surface Prop', icon: Sun },
  ];

  return (
    <div className="flex flex-col h-screen w-full bg-gray-50 text-gray-800 font-sans overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 z-10 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 p-1.5 rounded-lg">
            <Camera className="text-white" size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">BioLens <span className="text-indigo-600">Pro</span></h1>
            <p className="text-xs text-gray-500">Synthetic Bio Edition (Debug Mode)</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
           <label className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md cursor-pointer transition-colors shadow-sm">
             <Upload size={16} />
             <span className="text-sm font-medium">Upload File</span>
             <input type="file" accept=".pdb,.cif,.ent,.mmcif" onChange={handleFileUpload} className="hidden" />
           </label>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Main Canvas */}
        <div className="relative flex-1 bg-gray-100">
           {/* Detailed Error Box */}
           {error && (
             <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 bg-white p-6 rounded-lg shadow-2xl border-2 border-red-500 max-w-lg w-full">
                <div className="flex items-center gap-2 text-red-600 font-bold text-lg mb-2">
                    <AlertCircle /> Error
                </div>
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

           {/* Controls */}
           <div className="absolute top-4 right-4 z-20">
               <button onClick={toggleInteractions} className={`flex items-center gap-2 px-4 py-2 rounded-full shadow-lg border ${showInteractions ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700'}`}>
                   <Share2 size={16} /> <span className="text-sm">H-Bonds</span>
               </button>
           </div>
           
           {/* AI Chat Bar */}
           <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 w-full max-w-lg px-4 z-20">
               {aiHistory.length > 1 && (
                 <div className="mb-2 bg-black/60 backdrop-blur text-white text-xs p-2 rounded-lg max-h-32 overflow-y-auto">
                     {aiHistory.slice(-2).map((m,i) => <div key={i} className="mb-1"><b>{m.role}:</b> {m.text}</div>)}
                 </div>
               )}
               <form onSubmit={handleAiSubmit} className="relative">
                  <div className="absolute left-3 top-3 text-indigo-400"><MessageSquare size={18}/></div>
                  <input type="text" value={aiInput} onChange={e=>setAiInput(e.target.value)} placeholder="Type command..." className="w-full bg-black/70 backdrop-blur border border-indigo-500/30 text-white pl-10 pr-12 py-3 rounded-full outline-none" />
                  <button type="submit" className="absolute right-2 top-2 p-1.5 bg-indigo-600 rounded-full text-white"><Send size={16}/></button>
               </form>
           </div>
        </div>

        {/* Sidebar */}
        <div className="w-64 bg-white border-l border-gray-200 p-4 z-20 shadow-xl flex flex-col gap-6">
           <div>
               <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Styles</h3>
               <div className="grid grid-cols-2 gap-2">
                   {styles.map(s => (
                       <button key={s.id} onClick={() => setCurrentStyle(s.id)} className={`p-2 rounded-lg border text-xs font-medium ${currentStyle === s.id ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'hover:bg-gray-50'}`}>{s.name}</button>
                   ))}
               </div>
           </div>
           <div>
               <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Tint</h3>
               <div className="flex items-center gap-2">
                   <input type="color" value={customColor} onChange={handleColorChange} className="w-full h-8 cursor-pointer rounded border border-gray-200" />
                   {useCustomColor && <button onClick={() => setUseCustomColor(false)} className="text-[10px] text-gray-500 underline">Reset</button>}
               </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default BioLens;
