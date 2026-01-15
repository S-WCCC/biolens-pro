import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, Sun, Layers, Maximize, Upload, Download, Zap, Droplet, Box, 
  AlertCircle, Play, Pause, Grid, Scissors, Eye, Disc, Activity, Monitor, Ghost 
} from 'lucide-react';

const BioLens = () => {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const structureRef = useRef(null);
  
  // UI State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState("4hhb.pdb (Hemoglobin)");
  
  // Visualization State
  const [currentStyle, setCurrentStyle] = useState('journal_nature');
  const [focusMode, setFocusMode] = useState('global');
  const [bgColor, setBgColor] = useState('white'); 
  const [spin, setSpin] = useState(false);
  const [clipping, setClipping] = useState(100); // 0-100% visibility
  const [ligandInfo, setLigandInfo] = useState(null); // Track if ligand exists
  
  // Animation State
  const [isAnimating, setIsAnimating] = useState(false);
  const animationIntervalRef = useRef(null);

  useEffect(() => {
    // 这里的 loadScript 已经被移除，直接初始化
    // 稍微延迟一下确保 window.NGL 已就绪
    const timer = setTimeout(() => {
        if (window.NGL) {
            initStage();
        } else {
            setError("3D Engine failed to load. Please refresh.");
            setLoading(false);
        }
    }, 100);
    return () => {
        clearTimeout(timer);
        stopAnimation();
    }
  }, []);

  const initStage = () => {
    if (!containerRef.current || !window.NGL) return;
    containerRef.current.innerHTML = '';
    const stage = new window.NGL.Stage(containerRef.current, {
      backgroundColor: 'white',
      tooltip: false,
    });
    stageRef.current = stage;
    window.addEventListener('resize', () => stage.handleResize());
    
    // Fallback load
    loadPdbFromUrl("[https://files.rcsb.org/download/4hhb.pdb](https://files.rcsb.org/download/4hhb.pdb)");
  };

  const loadPdbFromUrl = (url) => {
    setLoading(true);
    setError(null);
    if (stageRef.current) stageRef.current.removeAllComponents();
    
    stageRef.current.loadFile(url).then(o => {
      structureRef.current = o;
      checkLigands(o);
      applyStyle(currentStyle, focusMode);
      o.autoView();
      setLoading(false);
    }).catch(e => {
        setLoading(false);
        setError("Network error. Please upload a local PDB file.");
    });
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setLoading(true);
    setError(null);
    stopAnimation();

    const reader = new FileReader();
    reader.onload = function(evt) {
       stageRef.current.removeAllComponents();
       const blob = new Blob([evt.target.result], { type: 'text/plain'});
       stageRef.current.loadFile(blob, { ext: 'pdb', defaultRepresentation: false }).then(o => {
         structureRef.current = o;
         checkLigands(o);
         applyStyle(currentStyle, focusMode);
         o.autoView();
         setLoading(false);
       }).catch(err => {
         setError("Failed to parse file.");
         setLoading(false);
       });
    };
    reader.readAsText(file);
  };

  const checkLigands = (component) => {
      const selectionString = "( not polymer and not water and not ion ) or ligand";
      const atomSet = component.structure.getAtomSet(selectionString);
      if (atomSet.getSize() > 0) {
          setLigandInfo(selectionString);
      } else {
          setLigandInfo(null);
      }
  };

  const toggleAssemblyAnimation = () => {
    if (isAnimating) {
      stopAnimation();
      return;
    }
    if (!structureRef.current) return;
    setIsAnimating(true);
    const structure = structureRef.current.structure;
    const chainStore = [];
    structure.eachChain(c => chainStore.push(c.chainname));
    let step = 0;
    structureRef.current.setSelection('not *');

    animationIntervalRef.current = setInterval(() => {
      if (step >= chainStore.length) {
         step = 0;
         structureRef.current.setSelection('not *'); 
      }
      const selectionString = chainStore.slice(0, step + 1).map(c => ":" + c).join(" or ");
      structureRef.current.setSelection(selectionString);
      step++;
    }, 1200); 
  };

  const stopAnimation = () => {
    if (animationIntervalRef.current) clearInterval(animationIntervalRef.current);
    setIsAnimating(false);
    if (structureRef.current) structureRef.current.setSelection('*');
  };

  const handleClippingChange = (e) => {
      const val = parseInt(e.target.value);
      setClipping(val);
      if(stageRef.current) {
          stageRef.current.setParameters({
              clipNear: 50 - (val / 2),
              clipFar: 50 + (val / 2) 
          });
      }
  };

  const applyStyle = (styleName, mode) => {
    if (!structureRef.current || !stageRef.current) return;
    const o = structureRef.current;
    const stage = stageRef.current;
    
    o.removeAllRepresentations();

    let bg = 'white';
    stage.setParameters({ cameraType: 'perspective', fogNear: 50, fogFar: 100 });

    if (styleName === 'journal_nature') {
      bg = 'white';
      stage.setParameters({ backgroundColor: bg, lightIntensity: 1, ambientIntensity: 0.4, cameraType: 'orthographic' });
    } else if (styleName === 'journal_cell') {
      bg = '#fdfbf7';
      stage.setParameters({ backgroundColor: bg, lightIntensity: 0.8, ambientIntensity: 0.8 });
    } else if (styleName === 'hologram') {
      bg = 'black';
      stage.setParameters({ backgroundColor: bg, lightIntensity: 0.5, ambientIntensity: 0.2 });
    } else if (styleName === 'glass') {
      bg = '#111';
      stage.setParameters({ backgroundColor: bg, lightIntensity: 1.5, ambientIntensity: 0.2 });
    } else if (styleName === 'xray') {
      bg = '#000';
      stage.setParameters({ backgroundColor: bg, lightIntensity: 1.2, ambientIntensity: 0.5 });
    }

    setBgColor(bg);

    const ligandSel = ligandInfo || "ligand";

    if (mode === 'global') {
        if (styleName === 'journal_nature') {
            o.addRepresentation('cartoon', { color: 'chainid', quality: 'high', roughness: 0.2 });
            o.addRepresentation('ball+stick', { sele: ligandSel, color: 'element', scale: 2.0 });
        } else if (styleName === 'journal_cell') {
            o.addRepresentation('cartoon', { color: 'chainid', quality: 'high', radiusScale: 1.2, colorScheme: 'pastel' });
            o.addRepresentation('surface', { sele: 'polymer', opacity: 0.15, color: 'white', side: 'front' });
        } else if (styleName === 'hologram') {
            o.addRepresentation('line', { color: '#00ffcc', linewidth: 2 });
            o.addRepresentation('point', { sele: 'polymer', color: '#00ffcc', sizeAttenuation: true, pointSize: 2, opacity: 0.5 });
            o.addRepresentation('ball+stick', { sele: ligandSel, color: '#ff0055', radiusScale: 0.5 });
        } else if (styleName === 'glass') {
            o.addRepresentation('surface', { sele: 'polymer', opacity: 0.3, color: '#aaccff', side: 'front', wireframe: false, roughness: 0.0, metalness: 0.5 });
            o.addRepresentation('cartoon', { color: 'spectrum', quality: 'high' });
        } else if (styleName === 'xray') {
            o.addRepresentation('surface', { sele: 'polymer', opacity: 0.2, color: 'white', wireframe: true });
            o.addRepresentation('cartoon', { color: 'white', opacity: 0.5 });
            o.addRepresentation('ball+stick', { sele: ligandSel, color: 'hotpink' });
        }
    } else if (mode === 'binder') {
        const polyColor = styleName === 'hologram' ? '#003300' : (styleName === 'glass' ? '#333' : 'lightgray');
        const polyOpac = styleName === 'hologram' ? 0.2 : 0.4;
        
        o.addRepresentation('cartoon', { sele: 'polymer', color: polyColor, opacity: polyOpac });

        if (ligandInfo) {
            o.addRepresentation('ball+stick', { 
                sele: ligandSel, 
                color: styleName === 'hologram' ? '#ff0055' : 'element', 
                radiusScale: 0.8 
            });

            const pocketSel = `(polymer) and (${ligandSel} around 6)`;
            o.addRepresentation('surface', { 
                sele: pocketSel, 
                opacity: 0.3, 
                color: styleName === 'hologram' ? '#ffff00' : 'skyblue', 
                wireframe: true,
                side: 'front'
            });

            o.addRepresentation('contact', { 
                sele: ligandSel, 
                filterSele: pocketSel, 
                maxDistance: 3.5, 
                color: styleName === 'hologram' ? '#00ff00' : 'orange',
                labelVisible: true 
            });
            
            o.autoView(ligandSel, 2000);
        } else {
             o.addRepresentation('ball+stick', { sele: 'lys or arg', color: 'blue' });
             o.autoView();
        }
    } else if (mode === 'structure_prop') {
        o.addRepresentation('surface', { sele: 'polymer', colorScheme: 'electrostatic', surfaceType: 'av' });
    }

    setCurrentStyle(styleName);
    setFocusMode(mode);
  };

  const toggleSpin = () => {
    if (!stageRef.current) return;
    if (spin) {
        stageRef.current.setSpin(false);
        stageRef.current.setRock(false);
    } else {
        stageRef.current.setRock(true, 1, 0.005); 
    }
    setSpin(!spin);
  };

  const takeScreenshot = () => {
      if(!stageRef.current) return;
      stageRef.current.makeImage({ factor: 2, antialias: true, trim: false, transparent: false }).then((blob) => {
          const element = document.createElement("a");
          element.href = window.URL.createObjectURL(blob);
          element.download = `BioLens_${currentStyle}.png`;
          document.body.appendChild(element);
          element.click();
          document.body.removeChild(element);
      });
  };

  const styles = [
    { id: 'journal_nature', name: 'Nature Clean', icon: Droplet, desc: 'Publication ready. White BG.' },
    { id: 'journal_cell', name: 'Cell Soft', icon: Disc, desc: 'Pastel colors. Soft lighting.' },
    { id: 'hologram', name: 'Hologram', icon: Monitor, desc: 'Sci-fi, data viz, dark mode.' },
    { id: 'glass', name: 'Crystal', icon: Box, desc: 'Shiny, transparent, artistic.' },
    { id: 'xray', name: 'X-Ray', icon: Ghost, desc: 'High contrast, medical scan.' },
  ];

  const modes = [
    { id: 'global', name: 'Global View', icon: Maximize },
    { id: 'binder', name: 'Binder Focus', icon: Layers },
    { id: 'structure_prop', name: 'Surface Prop', icon: Sun },
  ];

  return (
    <div className="flex flex-col h-screen w-full bg-gray-50 text-gray-800 font-sans overflow-hidden">
      
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shadow-sm z-10">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 p-1.5 rounded-lg">
            <Camera className="text-white" size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">BioLens <span className="text-indigo-600">Ultra</span></h1>
            <p className="text-xs text-gray-500">Cinematic Molecular Renderer</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
           <span className="hidden md:block text-sm font-medium text-gray-500 bg-gray-100 px-3 py-1 rounded-full truncate max-w-[200px]">
             {fileName}
           </span>
           <label className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md cursor-pointer transition-colors shadow-sm">
             <Upload size={16} />
             <span className="text-sm font-medium">Upload PDB</span>
             <input type="file" accept=".pdb,.cif" onChange={handleFileUpload} className="hidden" />
           </label>
           <button onClick={takeScreenshot} className="flex items-center gap-2 px-3 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-md">
             <Download size={16} />
             <span className="text-sm">Export PNG</span>
           </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <div className="relative flex-1 bg-gray-900">
           {loading && (
             <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm text-white">
               <div className="flex flex-col items-center gap-3">
                 <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-500 border-t-transparent"></div>
                 <span className="text-sm font-medium tracking-wider">RENDERING...</span>
               </div>
             </div>
           )}
           {error && !loading && (
             <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80">
               <div className="bg-white p-6 rounded-lg shadow-xl max-w-md text-center">
                 <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
                 <p className="text-gray-800 mb-4">{error}</p>
                 <label className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg cursor-pointer">
                   <Upload size={16} />
                   <span>Try Local File</span>
                   <input type="file" accept=".pdb,.cif" onChange={handleFileUpload} className="hidden" />
                 </label>
               </div>
             </div>
           )}
           
           <div ref={containerRef} className="w-full h-full cursor-move" style={{ backgroundColor: bgColor }} />

           {/* On-Canvas Tools */}
           <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex items-center gap-2 bg-white/10 backdrop-blur-md border border-white/20 px-4 py-2 rounded-full shadow-2xl">
               <button onClick={toggleSpin} className={`p-2 rounded-full hover:bg-white/20 transition-all ${spin ? 'text-indigo-400' : 'text-white'}`} title="Auto-Rock">
                 <Activity size={18} className={spin ? "animate-pulse" : ""} />
               </button>
               <div className="w-px h-6 bg-white/20 mx-1"></div>
               <button 
                  onClick={toggleAssemblyAnimation} 
                  className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium transition-colors ${isAnimating ? 'bg-amber-500/20 text-amber-300' : 'hover:bg-white/20 text-white'}`}
                  title="Play Assembly"
                >
                 {isAnimating ? <Pause size={16} fill="currentColor"/> : <Play size={16} fill="currentColor"/>}
                 <span>{isAnimating ? 'Assembling...' : 'Assemble'}</span>
               </button>
               <div className="w-px h-6 bg-white/20 mx-1"></div>
               <div className="flex items-center gap-2 px-2 text-white">
                  <Scissors size={16} className="text-white/70"/>
                  <input 
                    type="range" min="1" max="100" 
                    value={clipping} onChange={handleClippingChange}
                    className="w-24 h-1 bg-white/30 rounded-lg appearance-none cursor-pointer hover:bg-white/50"
                    title="Slice Structure"
                  />
               </div>
           </div>
           
           {/* Ligand Status Indicator */}
           {focusMode === 'binder' && (
               <div className="absolute top-6 left-6 bg-black/60 backdrop-blur text-white px-4 py-2 rounded-lg border border-white/10 text-xs">
                   {ligandInfo ? (
                       <span className="flex items-center gap-2 text-green-400"><Zap size={12}/> Binder Detected</span>
                   ) : (
                       <span className="flex items-center gap-2 text-yellow-400"><AlertCircle size={12}/> No distinct binder found</span>
                   )}
               </div>
           )}
        </div>

        {/* Sidebar */}
        <div className="w-72 bg-white border-l border-gray-200 flex flex-col shadow-2xl z-20">
          <div className="p-5 border-b border-gray-100">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Cinema Filters</h3>
              <div className="space-y-2">
                {styles.map((s) => (
                    <button key={s.id} onClick={() => applyStyle(s.id, focusMode)} 
                        className={`w-full flex items-center gap-3 p-2.5 rounded-xl border transition-all text-left group ${currentStyle === s.id ? 'bg-indigo-50 border-indigo-500 ring-1 ring-indigo-500' : 'border-gray-200 hover:bg-gray-50'}`}>
                        <div className={`p-2 rounded-lg ${currentStyle === s.id ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-100 text-gray-500 group-hover:bg-white'}`}>
                            {/* Fixed: Render component instance */}
                            <s.icon size={18} />
                        </div>
                        <div>
                            <div className={`font-semibold text-sm ${currentStyle === s.id ? 'text-indigo-900' : 'text-gray-900'}`}>{s.name}</div>
                            <div className="text-[10px] text-gray-500 leading-tight">{s.desc}</div>
                        </div>
                    </button>
                ))}
              </div>
          </div>

          <div className="p-5 flex-1 overflow-y-auto">
             <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Action Mode</h3>
             <div className="grid grid-cols-1 gap-2">
               {modes.map((m) => (
                 <button key={m.id} onClick={() => applyStyle(currentStyle, m.id)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg text-sm font-medium transition-all ${focusMode === m.id ? 'bg-gray-900 text-white shadow-lg scale-[1.02]' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    {/* Fixed: Render component instance */}
                    <span className="flex items-center gap-2"><m.icon size={16} /> {m.name}</span>
                    {focusMode === m.id && <div className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)]"></div>}
                 </button>
               ))}
             </div>
             
             <div className="mt-6 p-4 bg-gray-900 rounded-xl text-white shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10"><Zap size={48}/></div>
                <div className="relative z-10">
                    <h4 className="font-bold text-xs text-indigo-300 mb-1 uppercase">Visual FX</h4>
                    <p className="text-gray-400 text-xs leading-relaxed">
                        Try <strong>Hologram</strong> + <strong>Binder Focus</strong>. It creates a <span className="text-yellow-300">mesh forcefield</span> around the active site.
                    </p>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BioLens;
