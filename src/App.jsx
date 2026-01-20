import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Camera, Layers, Upload, Download, Droplet, Box, 
  AlertCircle, RefreshCw, Search, Cpu, Sparkles, Palette, Activity, Send, Info
} from 'lucide-react';

// --- 全局配置 ---
const GEMINI_API_TOKEN = ""; // 请在此处填写你的 Gemini API Key
const INITIAL_STRUCTURE = "4HHB"; 

// --- 动态加载 Mol* 依赖 ---
const injectMolstarResources = () => {
  return new Promise((resolve) => {
    if (window.molstar) return resolve();
    
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/molstar@latest/build/viewer/molstar.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/molstar@latest/build/viewer/molstar.js';
    script.onload = resolve;
    document.head.appendChild(script);
  });
};

const BioLensEngine = () => {
  // --- DOM & Instance Refs ---
  const viewerContainer = useRef(null);
  const molstarInstance = useRef(null);
  const chatEndMarker = useRef(null);
  
  // --- 状态管理 (已更新变量名) ---
  const [isSystemLoading, setIsSystemLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [inputSearchId, setInputSearchId] = useState("");
  const [loadedStructureTitle, setLoadedStructureTitle] = useState(INITIAL_STRUCTURE);
  const [engineStatus, setEngineStatus] = useState("Initializing...");
  
  // 视觉参数状态
  const [activeVisualLabel, setActiveVisualLabel] = useState('cartoon'); 
  const [activeColorSchema, setActiveColorSchema] = useState('chain-id'); 
  const [hexTintValue, setHexTintValue] = useState("#6366f1");
  const [isWaterVisible, setIsWaterVisible] = useState(false);
  const [isHeteroVisible, setIsHeteroVisible] = useState(true);

  // AI 对话状态
  const [userChatInput, setUserChatInput] = useState("");
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [chatLog, setChatLog] = useState([
    { role: 'system', text: 'BioLens 智能分析引擎已启动。' }
  ]);

  // --- 核心逻辑：应用视觉样式 ---
  const synchronizeVisuals = useCallback(async () => {
    const plugin = molstarInstance.current;
    if (!plugin) return;

    setEngineStatus("Rendering...");
    try {
      const structureHierarchy = plugin.managers.structure.hierarchy.current.structures;
      if (structureHierarchy.length === 0) return;

      const targetStructure = structureHierarchy[0];

      // 使用事务批量处理更新，防止界面闪烁
      await plugin.dataTransaction(async () => {
        // 1. 清理现有展示组件
        for (const component of targetStructure.components) {
          await plugin.managers.structure.hierarchy.remove([component]);
        }

        // 2. 创建聚合物组件 (蛋白质/核酸)
        const polymerData = await plugin.builders.structure.tryCreateComponentStatic(targetStructure.cell, 'polymer', 'Polymer');
        if (polymerData) {
          let reprType = 'cartoon';
          if (activeVisualLabel === 'surface') reprType = 'molecular-surface';
          if (activeVisualLabel === 'ball-stick') reprType = 'ball-and-stick';
          if (activeVisualLabel === 'spacefill') reprType = 'spacefill';
          if (activeVisualLabel === 'wireframe') reprType = 'line';

          const colorParams = activeColorSchema === 'uniform' 
            ? { name: 'uniform', params: { value: parseInt(hexTintValue.replace('#', ''), 16) } }
            : { name: activeColorSchema };

          await plugin.builders.structure.representation.addRepresentation(polymerData, { 
            type: reprType, 
            color: colorParams.name,
            colorParams: colorParams.params
          });
        }

        // 3. 创建配体/异质原子组件
        if (isHeteroVisible) {
          const heteroData = await plugin.builders.structure.tryCreateComponentStatic(targetStructure.cell, 'ligand', 'Hetero');
          if (heteroData) {
            await plugin.builders.structure.representation.addRepresentation(heteroData, { 
              type: 'ball-and-stick', 
              color: 'element-symbol' 
            });
          }
        }

        // 4. 创建水分母组件
        if (isWaterVisible) {
          const waterData = await plugin.builders.structure.tryCreateComponentStatic(targetStructure.cell, 'water', 'Water');
          if (waterData) {
            await plugin.builders.structure.representation.addRepresentation(waterData, { 
              type: 'ball-and-stick', 
              color: 'uniform',
              colorParams: { value: 0x4fc3f7 },
              typeParams: { alpha: 0.4, sizeFactor: 0.2 }
            });
          }
        }
      });
      setEngineStatus("Ready");
    } catch (err) {
      console.error("Visual Sync Error:", err);
      setEngineStatus("Render Error");
    }
  }, [activeVisualLabel, activeColorSchema, hexTintValue, isWaterVisible, isHeteroVisible]);

  // --- 生命周期：引擎初始化 ---
  useEffect(() => {
    const startup = async () => {
      try {
        await injectMolstarResources();
        
        const viewer = await window.molstar.Viewer.create(viewerContainer.current, {
          layoutIsExpanded: false,
          layoutShowControls: false,
          layoutShowRemoteState: false,
          layoutShowSequence: true,
          viewportShowExpand: false,
          viewportShowSelectionMode: false,
          viewportShowAnimation: true,
        });
        
        molstarInstance.current = viewer;
        await loadStructureFromRcsb(INITIAL_STRUCTURE);
        setIsSystemLoading(false);
      } catch (e) {
        setErrorMessage("引擎启动失败，请刷新页面。");
      }
    };
    startup();
    return () => molstarInstance.current?.dispose();
  }, []);

  // 监听交互状态变化
  useEffect(() => {
    if (!isSystemLoading) synchronizeVisuals();
  }, [activeVisualLabel, activeColorSchema, hexTintValue, isWaterVisible, isHeteroVisible, synchronizeVisuals]);

  // --- 数据加载器 ---
  const loadStructureFromRcsb = async (pdbId) => {
    const plugin = molstarInstance.current;
    if (!plugin || !pdbId) return;

    setIsSystemLoading(true);
    setEngineStatus(`Fetching ${pdbId}...`);
    try {
      await plugin.clear();
      const downloadUrl = `https://files.rcsb.org/download/${pdbId.toLowerCase()}.pdb`;
      const dataAsset = await plugin.builders.data.download({ url: downloadUrl });
      const trajData = await plugin.builders.structure.parseTrajectory(dataAsset, 'pdb');
      await plugin.builders.structure.hierarchy.applyPreset(trajData, 'default');
      
      setLoadedStructureTitle(pdbId.toUpperCase());
      setTimeout(synchronizeVisuals, 300); // 确保加载后应用当前画风
    } catch (e) {
      setErrorMessage(`无法从 RCSB 加载 ${pdbId}`);
    } finally {
      setIsSystemLoading(false);
    }
  };

  const handleLocalFileUpload = async (event) => {
    const targetFile = event.target.files[0];
    if (!targetFile || !molstarInstance.current) return;

    setIsSystemLoading(true);
    setEngineStatus("Parsing Local File...");
    try {
      await molstarInstance.current.clear();
      const fileName = targetFile.name.toLowerCase();
      const isBinary = fileName.endsWith('.bcif');
      const format = fileName.endsWith('.cif') || isBinary ? 'mmcif' : 'pdb';

      const fileReader = new FileReader();
      fileReader.onload = async (e) => {
        const rawData = e.target.result;
        const dataAsset = await molstarInstance.current.builders.data.rawData({ 
          data: rawData, 
          label: targetFile.name 
        });
        const trajData = await molstarInstance.current.builders.structure.parseTrajectory(dataAsset, format);
        await molstarInstance.current.builders.structure.hierarchy.applyPreset(trajData, 'default');
        
        setLoadedStructureTitle("Local File");
        setIsSystemLoading(false);
        setTimeout(synchronizeVisuals, 300);
      };

      if (isBinary) fileReader.readAsArrayBuffer(targetFile);
      else fileReader.readAsText(targetFile);
    } catch (err) {
      setErrorMessage("本地文件解析失败");
      setIsSystemLoading(false);
    }
  };

  // --- AI 逻辑 ---
  const invokeGeminiAi = async (prompt) => {
    if (!GEMINI_API_TOKEN) return "System: API Key missing.";
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      const result = await response.json();
      return result.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";
    } catch (e) { return "Connection Error."; }
  };

  const processAiCommand = async (e) => {
    e.preventDefault();
    if (!userChatInput.trim() || isAiThinking) return;

    const query = userChatInput;
    setUserChatInput("");
    setChatLog(prev => [...prev, { role: 'user', text: query }]);
    setIsAiThinking(true);

    const contextPrompt = `
      You are BioLens AI. Control the viewer settings based on user input.
      Available Styles: cartoon, surface, ball-stick, spacefill, wireframe.
      Current ID: ${loadedStructureTitle}.
      User: "${query}"
      If setting update requested, reply in JSON: {"updates": {"activeVisualLabel": "style_name", "isWaterVisible": true/false}, "message": "Feedback"}
      Else reply with text explanation.
    `;

    const aiResponse = await invokeGeminiAi(contextPrompt);
    try {
      const cleanJson = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      if (parsed.updates) {
        if (parsed.updates.activeVisualLabel) setActiveVisualLabel(parsed.updates.activeVisualLabel);
        if (parsed.updates.isWaterVisible !== undefined) setIsWaterVisible(parsed.updates.isWaterVisible);
      }
      setChatLog(prev => [...prev, { role: 'system', text: parsed.message }]);
    } catch {
      setChatLog(prev => [...prev, { role: 'system', text: aiResponse }]);
    }
    setIsAiThinking(false);
    chatEndMarker.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="flex flex-col h-screen w-full bg-slate-900 text-slate-100 font-sans overflow-hidden">
      
      {/* 顶部控制台 */}
      <header className="h-16 flex items-center justify-between px-6 bg-slate-950 border-b border-white/10 z-50">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-600 rounded-lg shadow-lg shadow-indigo-500/20">
            <Cpu size={20} className="text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight">BIOLENS <span className="text-indigo-400">PRO</span></span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center bg-slate-800/50 rounded-full px-3 py-1 border border-white/5">
            <Search size={14} className="text-slate-500" />
            <input 
              className="bg-transparent border-none outline-none px-2 py-1 text-xs w-28 font-mono uppercase"
              placeholder="SEARCH PDB"
              value={inputSearchId}
              onChange={e => setInputSearchId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadStructureFromRcsb(inputSearchId)}
            />
          </div>

          <label className="group flex items-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-full cursor-pointer transition-all text-xs font-bold shadow-lg shadow-indigo-600/20">
            <Upload size={14} /> 
            <span>UPLOAD CIF/PDB</span>
            <input type="file" onChange={handleLocalFileUpload} className="hidden" accept=".pdb,.cif,.bcif" />
          </label>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        
        {/* 3D 渲染主区 */}
        <main className="flex-1 relative bg-black">
          {isSystemLoading && (
            <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-md">
              <RefreshCw className="w-10 h-10 text-indigo-500 animate-spin mb-4" />
              <p className="text-indigo-300 font-mono text-sm tracking-widest uppercase">{engineStatus}</p>
            </div>
          )}

          {errorMessage && (
            <div className="absolute top-10 left-1/2 -translate-x-1/2 z-50 bg-red-500 text-white px-6 py-3 rounded-full flex items-center gap-3 shadow-2xl shadow-red-500/40">
              <AlertCircle size={18} />
              <span className="text-sm font-bold">{errorMessage}</span>
              <button onClick={() => setErrorMessage(null)} className="ml-4 hover:opacity-50">✕</button>
            </div>
          )}
          
          <div ref={viewerContainer} className="w-full h-full" />

          {/* AI 浮动窗口 */}
          <div className="absolute bottom-6 left-6 z-40 w-80">
            <div className="bg-slate-950/90 border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[380px] backdrop-blur-xl">
              <div className="p-3 border-b border-white/5 flex items-center gap-2">
                <Sparkles size={14} className="text-indigo-400" />
                <span className="text-[10px] font-black uppercase tracking-tighter text-slate-400">Biological AI Assistant</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {chatLog.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-[11px] leading-relaxed ${
                      msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-slate-800 text-slate-300 rounded-tl-none border border-white/5'
                    }`}>
                      {msg.text}
                    </div>
                  </div>
                ))}
                <div ref={chatEndMarker} />
              </div>
              <form onSubmit={processAiCommand} className="p-3 bg-white/5">
                <div className="relative flex items-center">
                  <input 
                    className="w-full bg-slate-900 border border-white/10 rounded-full py-2 px-4 pr-10 text-xs focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                    placeholder="Command or Question..."
                    value={userChatInput}
                    onChange={e => setUserChatInput(e.target.value)}
                  />
                  <button type="submit" className="absolute right-3 text-indigo-500 hover:text-indigo-400">
                    {isAiThinking ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </main>

        {/* 右侧交互面板 */}
        <aside className="w-72 bg-slate-950 border-l border-white/10 p-6 flex flex-col gap-8 shadow-2xl z-40">
          
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Layers size={14} className="text-indigo-500" />
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Geometry Style</h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {['cartoon', 'surface', 'ball-stick', 'spacefill', 'wireframe'].map(style => (
                <button 
                  key={style}
                  onClick={() => setActiveVisualLabel(style)}
                  className={`py-2 px-1 rounded-lg text-[10px] font-bold border transition-all uppercase
                  ${activeVisualLabel === style ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-600/20' : 'bg-slate-900 border-white/5 text-slate-500 hover:bg-slate-800'}`}
                >
                  {style}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-4">
              <Palette size={14} className="text-indigo-500" />
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Coloring Schema</h3>
            </div>
            <div className="space-y-2">
              <select 
                className="w-full bg-slate-900 border border-white/10 rounded-lg p-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-indigo-500"
                value={activeColorSchema}
                onChange={e => setActiveColorSchema(e.target.value)}
              >
                <option value="chain-id">Chain Index</option>
                <option value="element-symbol">Atomic Element</option>
                <option value="residue-name">Residue Identity</option>
                <option value="hydrophobicity">Hydrophobicity</option>
                <option value="uniform">Custom Uniform</option>
              </select>

              {activeColorSchema === 'uniform' && (
                <div className="mt-4 p-3 bg-slate-900 rounded-xl border border-white/5 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-500">TINT</span>
                  <input 
                    type="color" 
                    className="w-8 h-8 bg-transparent cursor-pointer"
                    value={hexTintValue}
                    onChange={e => setHexTintValue(e.target.value)}
                  />
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-4">
              <Activity size={14} className="text-indigo-500" />
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Subsystem Toggle</h3>
            </div>
            <div className="space-y-2">
              <ToggleButton label="Solvent (HOH)" active={isWaterVisible} onClick={() => setIsWaterVisible(!isWaterVisible)} color="bg-blue-500" />
              <ToggleButton label="Hetero-atoms" active={isHeteroVisible} onClick={() => setIsHeteroVisible(!isHeteroVisible)} color="bg-emerald-500" />
            </div>
          </section>

          <div className="mt-auto space-y-3">
            <div className="p-4 bg-slate-900 rounded-2xl border border-white/5">
              <div className="flex items-center gap-2 mb-1">
                <Info size={12} className="text-indigo-500" />
                <span className="text-[10px] font-bold text-slate-300 uppercase">Active Entity</span>
              </div>
              <p className="text-xs font-mono text-indigo-400 truncate">{loadedStructureTitle}</p>
            </div>
            <button 
              onClick={() => molstarInstance.current?.managers.camera.reset()}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-[10px] font-black tracking-widest transition-all border border-white/5"
            >
              RESET VIEWPORT
            </button>
          </div>

        </aside>
      </div>
    </div>
  );
};

const ToggleButton = ({ label, active, onClick, color }) => (
  <button 
    onClick={onClick}
    className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
      active ? 'bg-slate-900 border-white/10' : 'bg-slate-950 border-transparent opacity-40'
    }`}
  >
    <span className="text-[10px] font-bold uppercase text-slate-400">{label}</span>
    <div className={`w-2 h-2 rounded-full ${active ? color : 'bg-slate-700'}`} />
  </button>
);

export default BioLensEngine;
