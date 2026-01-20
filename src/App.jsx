import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Camera, Layers, Upload, Search, Cpu, Sparkles, Palette, Activity, Send, AlertCircle, RefreshCw, Trash2
} from 'lucide-react';

// --- 配置 ---
const GEMINI_API_KEY = ""; // 选填，不填不影响基础 3D 功能
const DEFAULT_PDB = "4HHB";

const BioLensV3 = () => {
  // --- Refs ---
  const containerRef = useRef(null);
  const pluginRef = useRef(null); // 存储 Mol* 实例
  
  // --- UI 状态 ---
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pdbInput, setPdbInput] = useState("");
  const [activeId, setActiveId] = useState(DEFAULT_PDB);
  
  // --- 3D 视觉参数 (这些状态改变时会触发 3D 刷新) ---
  const [style, setStyle] = useState('cartoon'); // cartoon, surface, ball-and-stick, spacefill, line
  const [colorScheme, setColorScheme] = useState('chain-id'); // chain-id, element-symbol, hydrophobicity, uniform
  const [uniformColor, setUniformColor] = useState("#4f46e5");
  const [showWater, setShowWater] = useState(false);
  const [showLigands, setShowLigands] = useState(true);

  // --- AI 状态 ---
  const [chatInput, setChatInput] = useState("");
  const [aiHistory, setAiHistory] = useState([{ role: 'system', text: 'BioLens 核心引擎就绪。您可以尝试更改样式或上传文件。' }]);
  const [isAiThinking, setIsAiThinking] = useState(false);

  // --- 核心：视觉渲染函数 (这是响应右侧点击的关键) ---
  const update3DVisuals = useCallback(async () => {
    const plugin = pluginRef.current;
    if (!plugin) return;

    // 获取当前场景中的所有结构
    const structures = plugin.managers.structure.hierarchy.current.structures;
    if (structures.length === 0) return;

    // 针对每个加载的结构应用样式 (通常只有一个)
    for (const s of structures) {
      await plugin.dataTransaction(async () => {
        // 1. 清除旧的表示组件，保持干净的画布
        for (const c of s.components) {
          await plugin.managers.structure.hierarchy.remove([c]);
        }

        // 2. 创建主聚合物 (蛋白质/核酸)
        const polymer = await plugin.builders.structure.tryCreateComponentStatic(s.cell, 'polymer');
        if (polymer) {
          const colorParams = colorScheme === 'uniform' 
            ? { name: 'uniform', params: { value: parseInt(uniformColor.replace('#', ''), 16) } }
            : { name: colorScheme };

          await plugin.builders.structure.representation.addRepresentation(polymer, { 
            type: style === 'ball-and-stick' ? 'ball-and-stick' : (style === 'surface' ? 'molecular-surface' : style), 
            color: colorParams.name,
            colorParams: colorParams.params
          });
        }

        // 3. 创建配体 (Ligands)
        if (showLigands) {
          const ligands = await plugin.builders.structure.tryCreateComponentStatic(s.cell, 'ligand');
          if (ligands) {
            await plugin.builders.structure.representation.addRepresentation(ligands, { 
              type: 'ball-and-stick', 
              color: 'element-symbol' 
            });
          }
        }

        // 4. 创建水分子
        if (showWater) {
          const water = await plugin.builders.structure.tryCreateComponentStatic(s.cell, 'water');
          if (water) {
            await plugin.builders.structure.representation.addRepresentation(water, { 
              type: 'ball-and-stick', 
              color: 'uniform',
              colorParams: { value: 0x4fc3f7 },
              typeParams: { alpha: 0.4, sizeFactor: 0.2 }
            });
          }
        }
      });
    }
  }, [style, colorScheme, uniformColor, showWater, showLigands]);

  // --- 生命周期：初始化 Mol* ---
  useEffect(() => {
    const init = async () => {
      try {
        // 动态加载资源
        if (!window.molstar) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'https://cdn.jsdelivr.net/npm/molstar@latest/build/viewer/molstar.css';
          document.head.appendChild(link);

          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/molstar@latest/build/viewer/molstar.js';
          await new Promise(r => { script.onload = r; document.head.appendChild(script); });
        }

        const viewer = await window.molstar.Viewer.create(containerRef.current, {
          layoutIsExpanded: false,
          layoutShowControls: false,
          layoutShowRemoteState: false,
          layoutShowSequence: true,
          viewportShowExpand: false,
          viewportShowSelectionMode: false,
        });

        pluginRef.current = viewer;
        await loadByPdbId(DEFAULT_PDB);
        setLoading(false);
      } catch (e) {
        setError("引擎启动失败: " + e.message);
      }
    };
    init();
    return () => pluginRef.current?.dispose();
  }, []);

  // 监听交互状态变化，实时更新 3D
  useEffect(() => {
    if (!loading) update3DVisuals();
  }, [style, colorScheme, uniformColor, showWater, showLigands, loading, update3DVisuals]);

  // --- 数据加载器 ---
  const loadByPdbId = async (id) => {
    const plugin = pluginRef.current;
    if (!plugin || !id) return;
    setLoading(true);
    try {
      await plugin.clear();
      const url = `https://files.rcsb.org/download/${id.toLowerCase()}.pdb`;
      const data = await plugin.builders.data.download({ url });
      const traj = await plugin.builders.structure.parseTrajectory(data, 'pdb');
      await plugin.builders.structure.hierarchy.applyPreset(traj, 'default');
      setActiveId(id.toUpperCase());
      setTimeout(update3DVisuals, 200); // 确保预设加载后覆盖我们自己的视觉设置
    } catch (e) {
      setError("无法获取 PDB 数据");
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !pluginRef.current) return;
    setLoading(true);
    try {
      await pluginRef.current.clear();
      const isCif = file.name.endsWith('.cif') || file.name.endsWith('.bcif');
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const data = await pluginRef.current.builders.data.rawData({ data: ev.target.result });
        const traj = await pluginRef.current.builders.structure.parseTrajectory(data, isCif ? 'mmcif' : 'pdb');
        await pluginRef.current.builders.structure.hierarchy.applyPreset(traj, 'default');
        setActiveId(file.name);
        setLoading(false);
        setTimeout(update3DVisuals, 200);
      };
      reader.readAsText(file);
    } catch (e) {
      setError("文件读取失败");
      setLoading(false);
    }
  };

  // --- AI 逻辑 ---
  const handleAiChat = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !GEMINI_API_KEY) {
        if (!GEMINI_API_KEY) setAiHistory(p => [...p, {role:'system', text:'请在代码顶部填入 API Key 即可激活 AI 对话。'}]);
        return;
    }
    const msg = chatInput;
    setChatInput("");
    setAiHistory(p => [...p, {role:'user', text: msg}]);
    setIsAiThinking(true);

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ contents: [{ parts: [{ text: `You are a bio-assistant. User asks: ${msg}. If they want to change style to surface/cartoon/etc, answer in JSON: {"style": "surface"}. Else just text.` }] }] })
        });
        const data = await res.json();
        const text = data.candidates[0].content.parts[0].text;
        try {
            const json = JSON.parse(text.replace(/```json/g, '').replace(/```/g, ''));
            if (json.style) setStyle(json.style);
            setAiHistory(p => [...p, {role:'system', text: "已为您切换样式。"}]);
        } catch {
            setAiHistory(p => [...p, {role:'system', text: text}]);
        }
    } catch (e) {
        setAiHistory(p => [...p, {role:'system', text: "AI 暂时掉线..."}]);
    } finally {
        setIsAiThinking(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-slate-900 text-white font-sans overflow-hidden">
      
      {/* 顶部导航 */}
      <header className="h-14 flex items-center justify-between px-6 bg-slate-950 border-b border-white/10 z-50">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-indigo-600 rounded">
            <Cpu size={18} />
          </div>
          <span className="font-bold tracking-tight text-sm">BIOLENS <span className="text-indigo-500">PRO</span></span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-800 rounded-md px-2 border border-white/5">
            <Search size={14} className="text-slate-500" />
            <input 
              className="bg-transparent border-none outline-none px-2 py-1 text-xs w-24 uppercase font-mono"
              placeholder="PDB ID"
              value={pdbInput}
              onChange={e => setPdbInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadByPdbId(pdbInput)}
            />
          </div>
          <button onClick={() => loadByPdbId(pdbInput)} className="bg-indigo-600 hover:bg-indigo-500 text-[10px] font-bold px-3 py-1.5 rounded transition-all">FETCH</button>
          
          <div className="h-4 w-px bg-white/10 mx-1" />
          
          <label className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-[10px] font-bold cursor-pointer transition-all border border-white/10">
            <Upload size={14} /> UPLOAD
            <input type="file" onChange={handleFileUpload} className="hidden" accept=".pdb,.cif" />
          </label>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        
        {/* 3D 视口 */}
        <main className="flex-1 relative bg-[#050505]">
          {loading && (
            <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-slate-950/60 backdrop-blur-sm">
              <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin mb-2" />
              <p className="text-[10px] font-mono text-indigo-300">ENGINE PROCESSING...</p>
            </div>
          )}

          {error && (
            <div className="absolute top-5 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-4 py-2 rounded-md text-xs flex items-center gap-2 shadow-xl">
              <AlertCircle size={14} /> {error}
              <button onClick={() => setError(null)} className="ml-2 font-bold">✕</button>
            </div>
          )}
          
          <div ref={containerRef} className="w-full h-full" />

          {/* AI 对话框 */}
          <div className="absolute bottom-6 left-6 z-40 w-72">
            <div className="bg-slate-950/90 border border-white/10 rounded-xl shadow-2xl flex flex-col max-h-[300px]">
              <div className="p-2.5 border-b border-white/5 flex items-center gap-2">
                <Sparkles size={14} className="text-indigo-400" />
                <span className="text-[10px] font-bold text-slate-400">BIOLENS AI</span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar text-[10px]">
                {aiHistory.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[90%] px-2.5 py-1.5 rounded-lg ${m.role === 'user' ? 'bg-indigo-600' : 'bg-slate-800 text-slate-300'}`}>
                      {m.text}
                    </div>
                  </div>
                ))}
              </div>
              <form onSubmit={handleAiChat} className="p-2 bg-white/5">
                <input 
                  className="w-full bg-slate-900 border border-white/10 rounded-md py-1.5 px-3 text-[10px] outline-none focus:border-indigo-500"
                  placeholder="Ask AI..."
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                />
              </form>
            </div>
          </div>
        </main>

        {/* 右侧交互面板 */}
        <aside className="w-64 bg-slate-950 border-l border-white/10 p-5 flex flex-col gap-6 z-40 shadow-2xl">
          
          <div>
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
              <Layers size={14} /> Drawing Style
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              {['cartoon', 'surface', 'ball-and-stick', 'spacefill', 'line'].map(s => (
                <button 
                  key={s}
                  onClick={() => setStyle(s)}
                  className={`py-2 rounded text-[9px] font-bold border transition-all uppercase
                  ${style === s ? 'bg-indigo-600 border-indigo-400' : 'bg-slate-900 border-white/5 text-slate-500 hover:bg-slate-800'}`}
                >
                  {s.replace('-and-', '&')}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
              <Palette size={14} /> Color Scheme
            </h3>
            <select 
              className="w-full bg-slate-900 border border-white/10 rounded-md p-2 text-[10px] text-slate-300 outline-none mb-2"
              value={colorScheme}
              onChange={e => setColorScheme(e.target.value)}
            >
              <option value="chain-id">By Chain</option>
              <option value="element-symbol">By Element</option>
              <option value="hydrophobicity">By Hydrophobicity</option>
              <option value="uniform">Uniform Color</option>
            </select>

            {colorScheme === 'uniform' && (
              <div className="flex items-center gap-2 p-2 bg-slate-900 rounded border border-white/5">
                <input type="color" value={uniformColor} onChange={e => setUniformColor(e.target.value)} className="w-6 h-6 bg-transparent" />
                <span className="text-[10px] font-mono text-slate-500">{uniformColor}</span>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
              <Activity size={14} /> Show/Hide
            </h3>
            <div className="space-y-2">
              <button onClick={() => setShowWater(!showWater)} className={`w-full flex justify-between p-2 rounded text-[10px] border transition-all ${showWater ? 'bg-blue-900/20 border-blue-500/50 text-blue-400' : 'bg-slate-900 border-transparent opacity-40'}`}>
                WATER (HOH) <span>{showWater ? 'ON' : 'OFF'}</span>
              </button>
              <button onClick={() => setShowLigands(!showLigands)} className={`w-full flex justify-between p-2 rounded text-[10px] border transition-all ${showLigands ? 'bg-emerald-900/20 border-emerald-500/50 text-emerald-400' : 'bg-slate-900 border-transparent opacity-40'}`}>
                LIGANDS <span>{showLigands ? 'ON' : 'OFF'}</span>
              </button>
            </div>
          </div>

          <div className="mt-auto space-y-2">
            <div className="p-3 bg-indigo-900/10 border border-indigo-500/20 rounded-lg">
                <p className="text-[9px] text-slate-500 uppercase font-bold mb-1">Active Model</p>
                <p className="text-[11px] font-mono text-indigo-400 truncate">{activeId}</p>
            </div>
            <button onClick={() => pluginRef.current?.managers.camera.reset()} className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 rounded text-[9px] font-bold transition-all border border-white/5 flex items-center justify-center gap-2">
              <RefreshCw size={12} /> RESET VIEWPORT
            </button>
          </div>

        </aside>
      </div>
    </div>
  );
};

export default BioLensV3;
