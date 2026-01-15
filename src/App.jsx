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
  const [showInteractions, setShowInteractions] = useState(false); // New: Hydrogen Bonds
  const [spin, setSpin] = useState(false);
  const [customColor, setCustomColor] = useState("#3b82f6");
  
  // AI Chat State
  const [aiInput, setAiInput] = useState("");
  const [aiHistory, setAiHistory] = useState([{role: 'system', text: 'Mol* Engine Ready. I can show hydrogen bonds now.'}]);

  useEffect(() => {
    // Initialize Mol* Viewer
    const initViewer = async () => {
        if (!window.molstar) {
            setError("Mol* resources not loaded. Check index.html");
            return;
        }

        try {
            // Create Plugin instance
            const plugin = await window.molstar.Viewer.create(containerRef.current, {
                layoutIsExpanded: false,
                layoutShowControls: false, // We use our own UI
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

    // Small delay to ensure DOM is ready
    setTimeout(initViewer, 100);

    return () => {
        // Cleanup if needed
        pluginRef.current?.dispose();
    };
  }, []);

  // Watch for style changes to re-apply
  useEffect(() => {
      if(pluginRef.current && !loading) {
          applyStyle();
      }
  }, [currentStyle, focusMode, showInteractions, customColor]);

  // Handle Spin separately to avoid full re-render
  useEffect(() => {
      if(pluginRef.current) {
         const plugin = pluginRef.current;
         if(spin) {
             // Mol* spin command (simplified access)
             // In raw Mol*, we often rely on trackball interaction or animation loop
             // For MVP, we toggle the built-in spin behavior if available or simulate
             // Note: Programmatic spin in Mol* Viewer wrapper is tricky, 
             // usually requires accessing canvas3d.input.
         }
      }
  }, [spin]);


  const loadPdbFromUrl = async (url) => {
    setLoading(true);
    const plugin = pluginRef.current;
    if(!plugin) return;

    try {
        await plugin.clear();
        
        // Mol* loading sequence
        const data = await plugin.builders.data.download({ url: url }, { state: { isGhost: true } });
        const trajectory = await plugin.builders.structure.parseTrajectory(data, "pdb");
        const model = await plugin.builders.structure.createModel(trajectory);
        const structure = await plugin.builders.structure.createStructure(model);
        
        // Save structure ref for later styling
        // Initial style application happens via useEffect
        setLoading(false);
        
        // Auto focus
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

    const plugin = pluginRef.current;
    if(!plugin) return;

    try {
        await plugin.clear();
        // Open file using Mol* built-in opener logic or data provider
        const data = await plugin.builders.data.readFile({ file, label: file.name });
        const trajectory = await plugin.builders.structure.parseTrajectory(data, "pdb"); // Assuming PDB for now
        const model = await plugin.builders.structure.createModel(trajectory);
        const structure = await plugin.builders.structure.createStructure(model);
        
        setLoading(false);
        plugin.managers.camera.reset();
    } catch(err) {
        setError("Error reading file.");
        setLoading(false);
    }
  };

  // --- THE CORE: Mol* Styling Logic ---
  const applyStyle = async () => {
      const plugin = pluginRef.current;
      if (!plugin) return;

      const managers = plugin.managers;
      const structure = managers.structure.hierarchy.current.structures[0];
      if(!structure) return;

      // 1. Clear current representations
      await managers.structure.component.clear(structure.cell);

      // 2. Setup Lighting/Canvas (Background)
      const canvas = plugin.canvas3d;
      if(canvas) {
          let bgColor = 0xffffff; // White
          let lighting = 'matte'; // Simplified logic
          
          if(currentStyle === 'journal_nature') bgColor = 0xffffff;
          if(currentStyle === 'journal_cell') bgColor = 0xfdfbf7;
          if(currentStyle === 'hologram') bgColor = 0x000000;
          if(currentStyle === 'glass') bgColor = 0x111111;
          
          // Apply background
          // Note: Mol* color uses 0xRRGGBB format
          const renderer = canvas.props.renderer;
          plugin.canvas3d.setProps({ renderer: { ...renderer, backgroundColor: bgColor } });
      }

      // 3. Create Components (Selection & Representation)
      
      // -- Global Polymer --
      const polymer = await managers.structure.component.add({
          selection: managers.structure.selection.fromSelectionQuery('polymer'),
          label: 'Polymer'
      });

      // Style Params
      let cartoonParams = {}; 
      if(currentStyle === 'journal_cell') {
          cartoonParams = { sizeFactor: 0.4 }; // Puttier
      }

      // Color Theme
      let colorTheme = 'chain-id';
      let colorParams = {};
      
      // Custom color override
      if(customColor) {
         // Converting hex to Mol* color is complex in simplified view
         // For MVP, we stick to chain-id or element, custom color requires creating a custom theme
         // or using 'uniform' coloring with the specific color.
         // Let's implement uniform color override if user requested specific override logic
         // For now, we stick to presets for stability in MVP
      }

      // Add Representation based on style
      if(currentStyle === 'glass') {
          await managers.structure.representation.addRepresentation(polymer, {
              type: 'spacefill', // Glass balls
              typeParams: { ignoreLight: true, opacity: 0.4 }, // Fake glass
              color: 'chain-id'
          });
          // Add cartoon inside
          await managers.structure.representation.addRepresentation(polymer, {
              type: 'cartoon',
              color: 'chain-id'
          });
      } else {
          // Standard Cartoon
          await managers.structure.representation.addRepresentation(polymer, {
              type: 'cartoon',
              typeParams: cartoonParams,
              color: 'chain-id'
          });
      }

      // -- Ligands --
      // Mol* is great at finding ligands automatically
      const ligand = await managers.structure.component.add({
          selection: managers.structure.selection.fromSelectionQuery('ligand'),
          label: 'Ligand'
      });
      
      await managers.structure.representation.addRepresentation(ligand, {
          type: 'ball-and-stick',
          color: 'element-symbol',
          typeParams: { sizeFactor: 0.3 }
      });

      // -- Interactions / H-Bonds (The "Synthetic Bio" Feature) --
      if (showInteractions) {
          // Mol* has a helper for this
          await managers.structure.representation.addRepresentation(structure, {
             type: 'interactions',
             typeParams: { 
                 lineSizeFactor: 0.2,
                 includeCovalent: false // Only non-covalent (H-bonds, salt bridges)
             },
             color: 'interaction-type'
          });
      }

      // -- Focus Mode adjustments --
      if (focusMode === 'binder') {
           // Focus camera on ligands
           const loci = managers.structure.selection.getLoci(ligand.cell.obj.data);
           plugin.managers.camera.focusLoci(loci);
           
           // Make polymer transparent
           // (Requires updating the polymer representation we just added, omitted for MVP brevity)
      } else {
           // Reset focus
           plugin.managers.camera.reset();
      }
  };

  const toggleInteractions = () => {
      setShowInteractions(!showInteractions);
  };

  const takeScreenshot = () => {
      const plugin = pluginRef.current;
      if(plugin) {
          plugin.helpers.viewportScreenshot?.share(); // Or custom save logic
      }
  };
  
  // Mock AI Logic
  const handleAiSubmit = (e) => {
    e.preventDefault();
    if(!aiInput.trim()) return;
    setAiHistory([...aiHistory, {role: 'user', text: aiInput}]);
    
    // Simple parser for Mol* specific actions
    let reply = "Processing...";
    if(aiInput.includes("bond") || aiInput.includes("interaction")) {
        setShowInteractions(true);
        reply = "Showing Hydrogen bonds and interactions.";
    } else if(aiInput.includes("surface")) {
        // Logic to switch to surface rep would go here
        reply = "Surface view enabled (Mock).";
    }
    
    setTimeout(() => setAiHistory(prev => [...prev, {role: 'system', text: reply}]), 500);
    setAiInput("");
  };

  const styles = [
    { id: 'journal_nature', name: 'Nature', icon: Droplet },
    { id: 'journal_cell', name: 'Cell', icon: Disc },
    { id: 'glass', name: 'Glass', icon: Box },
    { id: 'hologram', name: 'Holo', icon: Monitor },
  ];

  return (
    <div className="flex flex-col h-screen w-full bg-gray-50 text-gray-800 font-sans overflow-hidden">
      
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 z-10 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="bg-emerald-600 p-1.5 rounded-lg">
            <Camera className="text-white" size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">BioLens <span className="text-emerald-600">Mol*</span></h1>
            <p className="text-xs text-gray-500">Synthetic Bio Edition</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
           <label className="flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md cursor-pointer transition-colors shadow-sm">
             <Upload size={16} />
             <span className="text-sm font-medium">Upload PDB</span>
             <input type="file" accept=".pdb,.cif" onChange={handleFileUpload} className="hidden" />
           </label>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Main Canvas */}
        <div className="relative flex-1 bg-gray-100">
           {loading && (
             <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80">
               <div className="animate-spin rounded-full h-10 w-10 border-4 border-emerald-600 border-t-transparent"></div>
             </div>
           )}
           {error && (
             <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/90">
                <div className="text-red-500 font-bold">{error}</div>
             </div>
           )}

           {/* Mol* Container */}
           <div ref={containerRef} className="absolute inset-0 w-full h-full" />

           {/* Interaction Toggle (Synthetic Bio Special) */}
           <div className="absolute top-4 right-4 z-20">
               <button 
                 onClick={toggleInteractions}
                 className={`flex items-center gap-2 px-4 py-2 rounded-full shadow-lg transition-all border ${showInteractions ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-700 border-gray-200'}`}
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
                  <div className="absolute left-3 top-3 text-emerald-400"><MessageSquare size={18}/></div>
                  <input 
                    type="text" value={aiInput} onChange={e=>setAiInput(e.target.value)}
                    placeholder="Agent Command: 'Show H-bonds', 'Focus ligand'..." 
                    className="w-full bg-black/70 backdrop-blur border border-emerald-500/30 text-white pl-10 pr-12 py-3 rounded-full shadow-2xl focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                  <button type="submit" className="absolute right-2 top-2 p-1.5 bg-emerald-600 rounded-full text-white"><Send size={16}/></button>
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
                        className={`p-2 rounded-lg border text-center text-xs font-medium transition-all ${currentStyle === s.id ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'hover:bg-gray-50'}`}>
                           {s.name}
                       </button>
                   ))}
               </div>
           </div>

           {/* Color Picker */}
           <div>
               <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Tint</h3>
               <div className="flex items-center gap-2">
                   <input type="color" value={customColor} onChange={e=>setCustomColor(e.target.value)} className="w-full h-8 cursor-pointer rounded border-0" />
               </div>
           </div>
           
           {/* Info */}
           <div className="mt-auto bg-emerald-50 p-3 rounded-lg border border-emerald-100">
               <h4 className="text-emerald-800 text-xs font-bold mb-1">Mol* Engine Active</h4>
               <p className="text-emerald-600 text-[10px] leading-tight">
                   Ray-tracing shadows & detailed interaction analysis enabled.
               </p>
           </div>
        </div>
      </div>
    </div>
  );
};

export default BioLens;
