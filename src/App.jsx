import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, Sun, Layers, Maximize, Upload, Download, Zap, Droplet, Box, 
  AlertCircle, Play, Pause, Grid, Scissors, Eye, Disc, Activity, Monitor, Ghost,
  MessageSquare, Mic, Send, Share2
} from 'lucide-react';

const BioLens = () => {
  const containerRef = useRef(null);
  const pluginRef = useRef(null); // Stores the Mol* plugin instance
  
  // UI State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState("4hhb.pdb (Hemoglobin)");
  
  // Visualization State
  const [currentStyle, setCurrentStyle] = useState('journal_nature');
  const [focusMode, setFocusMode] = useState('global');
  const [showInteractions, setShowInteractions] = useState(false); // Hydrogen Bonds
  const [spin, setSpin] = useState(false);
  
  // 恢复之前好看的蓝色默认值 (Indigo-ish Blue)
  const [customColor, setCustomColor] = useState("#4f46e5"); 
  const [useCustomColor, setUseCustomColor] = useState(false); // 是否启用自定义颜色覆盖
  
  // AI Chat State
  const [aiInput, setAiInput] = useState("");
  const [aiHistory, setAiHistory] = useState([{role: 'system', text: 'Mol* Engine Ready. Try "Show interactions" or "Color red".'}]);

  useEffect(() => {
    // Initialize Mol* Viewer
    const initViewer = async () => {
        if (!window.molstar) {
            setError("Mol* resources not loaded. Check index.html");
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
            await loadPdbFromUrl("https://files.rcsb.org/download/4hhb.pdb");
            setLoading(false);

        } catch (e) {
            console.error(e);
            setError("Failed to initialize Mol* Viewer.");
            setLoading(false);
        }
    };

    setTimeout(initViewer, 100);

    return () => {
        pluginRef.current?.dispose();
    };
  }, []);

  // Watch for style changes
  useEffect(() => {
      if(pluginRef.current && !loading) {
          applyStyle();
      }
  }, [currentStyle, focusMode, showInteractions, customColor, useCustomColor]);

  // Handle Spin
  useEffect(() => {
      if(pluginRef.current) {
         // Note: Mol* spin toggle logic is complex via API, 
         // for MVP we rely on manual interaction or simple camera resets for now.
         // Real auto-rotation requires accessing the plugin canvas3d trackball controller.
      }
  }, [spin]);

  // Helper: Detect format more robustly
  const getFormat = (str) => {
      if (!str) return 'pdb';
      const lower = str.toLowerCase();
      if (lower.endsWith('.cif') || lower.endsWith('.mmcif')) return 'mmcif';
      if (lower.endsWith('.pdb') || lower.endsWith('.ent')) return 'pdb';
      return 'pdb'; // Default fallback
  };

  const loadPdbFromUrl = async (url) => {
    setLoading(true);
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
        console.error(e);
        setError("Failed to load PDB. Try a local file.");
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
        
        // Robust Format Detection
        const format = getFormat(file.name);
        console.log(`Loading file: ${file.name} as ${format}`);

        // Open file
        const data = await plugin.builders.data.readFile({ file, label: file.name });
        const trajectory = await plugin.builders.structure.parseTrajectory(data, format);
        const model = await plugin.builders.structure.createModel(trajectory);
        await plugin.builders.structure.createStructure(model);
        
        setLoading(false);
        plugin.managers.camera.reset();
    } catch(err) {
        console.error(err);
        // Better error message
        setError(`Error reading file. Mol* could not parse this as ${getFormat(file.name).toUpperCase()}.`);
        setLoading(false);
    }
  };

  // --- THE CORE: Mol* Styling Logic ---
  const applyStyle = async () => {
      const plugin = pluginRef.current;
      if (!plugin) return;

      const managers = plugin.managers;
      if (!managers.structure.hierarchy.current.structures[0]) return;
      const structure = managers.structure.hierarchy.current.structures[0];

      // 1. Clear current representations
      await managers.structure.component.clear(structure.cell);

      // 2. Setup Background
      const canvas = plugin.canvas3d;
      if(canvas) {
          let bgColor = 0xffffff;
          if(currentStyle === 'journal_nature') bgColor = 0xffffff;
          if(currentStyle === 'journal_cell') bgColor = 0xfdfbf7; // Warm white
          if(currentStyle === 'hologram') bgColor = 0x000000;
          if(currentStyle === 'glass') bgColor = 0x111111;
          if(currentStyle === 'xray') bgColor = 0x000000;
          
          const renderer = canvas.props.renderer;
          plugin.canvas3d.setProps({ renderer: { ...renderer, backgroundColor: bgColor } });
      }

      // 3. Create Polymer Component
      const polymer = await managers.structure.component.add({
          selection: managers.structure.selection.fromSelectionQuery('polymer'),
          label: 'Polymer'
      });

      // --- COLORING LOGIC ---
      // Convert Hex to 0xRRGGBB
      const customColorInt = parseInt(customColor.replace('#', ''), 16);
      
      // Determine Color Theme: Use 'uniform' if Tint is active, else 'chain-id'
      let colorTheme = useCustomColor ? 'uniform' : 'chain-id';
      let colorParams = useCustomColor ? { value: customColorInt } : {};

      // Style Params
      if(currentStyle === 'journal_cell') {
           await managers.structure.representation.addRepresentation(polymer, {
              type: 'cartoon',
              typeParams: { sizeFactor: 0.4 },
              color: colorTheme, colorParams
          });
          await managers.structure.representation.addRepresentation(polymer, {
              type: 'gaussian-surface',
              typeParams: { ignoreLight: false, alpha: 0.3 },
              color: colorTheme, colorParams
          });

      } else if(currentStyle === 'glass') {
          await managers.structure.representation.addRepresentation(polymer, {
              type: 'spacefill', 
              typeParams: { ignoreLight: false, alpha: 0.3, sizeFactor: 1.1 }, 
              color: colorTheme, colorParams
          });
          await managers.structure.representation.addRepresentation(polymer, {
              type: 'cartoon',
              color: colorTheme, colorParams
          });

      } else if(currentStyle === 'hologram') {
          // Hologram ignores custom tint usually, but we can allow override
          const holoColor = useCustomColor ? customColorInt : 0x00ffcc;
          await managers.structure.representation.addRepresentation(polymer, {
              type: 'cartoon',
              typeParams: { sizeFactor: 0.1 },
              color: 'uniform', colorParams: { value: holoColor }
          });
          await managers.structure.representation.addRepresentation(polymer, {
              type: 'ball-and-stick',
              typeParams: { sizeFactor: 0.1 },
              color: 'uniform', colorParams: { value: 0xffffff }
          });

      } else if(currentStyle === 'xray') {
          await managers.structure.representation.addRepresentation(polymer, {
              type: 'molecular-surface',
              typeParams: { alpha: 0.15, flatShaded: true, doubleSided: true, ignoreLight: true }, 
              color: 'uniform', colorParams: { value: 0xffffff }
          });
          await managers.structure.representation.addRepresentation(polymer, {
              type: 'cartoon',
              typeParams: { sizeFactor: 0.2 },
              color: 'uniform', colorParams: { value: 0xffffff }
          });

      } else {
          // Default: Journal Nature
          await managers.structure.representation.addRepresentation(polymer, {
              type: 'cartoon',
              color: colorTheme, colorParams
          });
      }

      // -- Ligands --
      try {
        const ligand = await managers.structure.component.add({
            selection: managers.structure.selection.fromSelectionQuery('ligand'),
            label: 'Ligand'
        });
        
        await managers.structure.representation.addRepresentation(ligand, {
            type: 'ball-and-stick',
            color: 'element-symbol',
            typeParams: { sizeFactor: 0.35 }
        });

        if (focusMode === 'binder') {
            const loci = managers.structure.selection.getLoci(ligand.cell.obj.data);
            plugin.managers.camera.focusLoci(loci);
        } else {
            plugin.managers.camera.reset();
        }
      } catch (err) {
          // No ligands found, ignore
      }

      // -- Interactions / H-Bonds --
      if (showInteractions) {
          await managers.structure.representation.addRepresentation(structure, {
             type: 'interactions',
             typeParams: { lineSizeFactor: 0.2, includeCovalent: false },
             color: 'interaction-type'
          });
      }
  };

  const toggleInteractions = () => {
      setShowInteractions(!showInteractions);
  };

  const handleColorChange = (e) => {
      setCustomColor(e.target.value);
      setUseCustomColor(true); // Enable override when user picks a color
  };

  const takeScreenshot = () => {
      const plugin = pluginRef.current;
      if(plugin) {
          plugin.helpers.viewportScreenshot?.share();
      }
  };
  
  // --- AI API INTEGRATION (核心：AI连接部分) ---
  const handleAiSubmit = async (e) => {
    e.preventDefault();
    if(!aiInput.trim()) return;
    
    // 1. 先把用户的话显示在界面上
    setAiHistory(prev => [...prev, {role: 'user', text: aiInput}]);
    const userInput = aiInput;
    setAiInput("");

    // 2. 调用后端 API (当你创建好 api/chat.js 后，取消下面代码的注释)
    /*
    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userInput })
        });
        const data = await res.json();
        
        // 假设 AI 返回的是 JSON 指令: { "action": "show_interactions" }
        const command = JSON.parse(data.result || "{}");
        
        if (command.action === 'color') {
            setCustomColor(command.params);
            setUseCustomColor(true);
        } else if (command.action === 'show_interactions') {
            setShowInteractions(true);
        } else if (command.action === 'reset') {
            setUseCustomColor(false);
            setCurrentStyle('journal_nature');
        }
        
        setAiHistory(prev => [...prev, {role: 'system', text: "Executed: " + command.action}]);
    } catch (err) {
        console.error("AI Error:", err);
        setAiHistory(prev => [...prev, {role: 'system', text: "Error connecting to AI Agent."}]);
    }
    */

    // --- 目前是 Mock (模拟) 逻辑，直到你连接 API ---
    let reply = "Processing (Mock)...";
    if(userInput.includes("bond") || userInput.includes("interaction")) {
        setShowInteractions(true);
        reply = "OK, showing Hydrogen bonds.";
    } else if(userInput.includes("red")) {
        setCustomColor("#ff0000");
        setUseCustomColor(true);
        reply = "Colored structure Red.";
    } else if(userInput.includes("blue")) {
        setCustomColor("#4f46e5");
        setUseCustomColor(true);
        reply = "Colored structure Blue.";
    } else if(userInput.includes("reset")) {
        setUseCustomColor(false);
        setShowInteractions(false);
        reply = "Reset to default view.";
    }
    
    setTimeout(() => setAiHistory(prev => [...prev, {role: 'system', text: reply}]), 500);
  };

  // Reverted to Blue/Indigo Theme as requested
  const styles = [
    { id: 'journal_nature', name: 'Nature', icon: Droplet },
    { id: 'journal_cell', name: 'Cell', icon: Disc },
    { id: 'glass', name: 'Glass', icon: Box },
    { id: 'hologram', name: 'Holo', icon: Monitor },
    { id: 'xray', name: 'X-Ray', icon: Ghost },
  ];

  return (
    <div className="flex flex-col h-screen w-full bg-gray-50 text-gray-800 font-sans overflow-hidden">
      
      {/* Header - Reverted to Indigo (Blue) */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 z-10 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 p-1.5 rounded-lg">
            <Camera className="text-white" size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">BioLens <span className="text-indigo-600">Mol*</span></h1>
            <p className="text-xs text-gray-500">Synthetic Bio Edition</p>
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
           {loading && (
             <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80">
               <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-600 border-t-transparent"></div>
             </div>
           )}
           {error && (
             <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/90">
                <div className="text-red-500 font-bold px-4 text-center">{error}</div>
             </div>
           )}

           <div ref={containerRef} className="absolute inset-0 w-full h-full" />

           {/* Interaction Toggle */}
           <div className="absolute top-4 right-4 z-20">
               <button 
                 onClick={toggleInteractions}
                 className={`flex items-center gap-2 px-4 py-2 rounded-full shadow-lg transition-all border ${showInteractions ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200'}`}
               >
                   <Share2 size={16} />
                   <span className="font-medium text-sm">H-Bonds / Interactions</span>
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
                  <input 
                    type="text" value={aiInput} onChange={e=>setAiInput(e.target.value)}
                    placeholder="AI Agent: 'Show H-bonds', 'Color blue', 'Reset'..." 
                    className="w-full bg-black/70 backdrop-blur border border-indigo-500/30 text-white pl-10 pr-12 py-3 rounded-full shadow-2xl focus:ring-2 focus:ring-indigo-500 outline-none placeholder-gray-400"
                  />
                  <button type="submit" className="absolute right-2 top-2 p-1.5 bg-indigo-600 rounded-full text-white"><Send size={16}/></button>
               </form>
           </div>
        </div>

        {/* Sidebar */}
        <div className="w-64 bg-white border-l border-gray-200 p-4 z-20 shadow-xl flex flex-col gap-6">
           {/* Styles */}
           <div>
               <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Styles</h3>
               <div className="grid grid-cols-2 gap-2">
                   {styles.map(s => (
                       <button key={s.id} onClick={() => setCurrentStyle(s.id)} 
                        className={`p-2 rounded-lg border text-center text-xs font-medium transition-all ${currentStyle === s.id ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'hover:bg-gray-50'}`}>
                           {s.name}
                       </button>
                   ))}
               </div>
           </div>

           {/* Color Picker (Fixed) */}
           <div>
               <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Tint (Override)</h3>
               <div className="flex items-center gap-2">
                   <input 
                     type="color" 
                     value={customColor} 
                     onChange={handleColorChange} 
                     className="w-full h-8 cursor-pointer rounded border border-gray-200" 
                   />
                   {useCustomColor && (
                       <button onClick={() => setUseCustomColor(false)} className="text-[10px] text-gray-500 hover:text-red-500 underline">
                           Reset
                       </button>
                   )}
               </div>
           </div>
           
           {/* Info */}
           <div className="mt-auto bg-indigo-50 p-3 rounded-lg border border-indigo-100">
               <h4 className="text-indigo-800 text-xs font-bold mb-1">Mol* Engine Active</h4>
               <p className="text-indigo-600 text-[10px] leading-tight">
                   Ray-tracing shadows & detailed interaction analysis enabled.
               </p>
           </div>
        </div>
      </div>
    </div>
  );
};

export default BioLens;
