import React, { useMemo, useState, useEffect, useRef } from "react";

/** 互動地圖（含縮放/平移 + 格線 + 吸附 + 十字準星）
 * - 預設背景：/custom_map_1200_suncity.png（public/）
 * - 預設標記：/markers_suncity.json（public/）
 * - 世界座標：左下(0,0) ~ 右上(1199,1199)
 */

const MAP_MAX = 1199;

const TYPE_META = {
  建築工程站: { code: "build", color: "blue", number: 1 },
  採集工程站: { code: "gather", color: "green", number: 2 },
  生產工程站: { code: "produce", color: "yellow", number: 3 },
  研究工程站: { code: "research", color: "purple", number: 4 },
  都政工程站: { code: "gov", color: "orange", number: 1 },
  訓練工程站: { code: "train", color: "pink", number: 3 },
  防禦工程站: { code: "defense", color: "red", number: 2 },
  遠征工程站: { code: "expedition", color: "teal", number: 1 },
  堡壘: { code: "fort", color: "indigo", number: 1 },
  要塞: { code: "citadel", color: "slate", number: 1 },
  雪原總部: { code: "hq", color: "cyan", number: 1 },
};

const colorClass = (name) => {
  switch (name) {
    case "blue": return "bg-blue-500 text-white";
    case "green": return "bg-green-500 text-white";
    case "yellow": return "bg-yellow-400 text-black";
    case "purple": return "bg-purple-500 text-white";
    case "orange": return "bg-orange-500 text-white";
    case "pink": return "bg-pink-500 text-white";
    case "red": return "bg-red-500 text-white";
    case "teal": return "bg-teal-500 text-white";
    case "indigo": return "bg-indigo-500 text-white";
    case "slate": return "bg-slate-500 text-white";
    case "cyan": return "bg-cyan-500 text-black";
    default: return "bg-gray-500 text-white";
  }
};

// 世界座標 ↔ 百分比（定位）
const worldToPct = (x, y) => ({ xPct: (x / MAP_MAX) * 100, yPct: ((MAP_MAX - y) / MAP_MAX) * 100 });
const pctToWorld = (xPct, yPctFromTop) => ({ x: Math.round(xPct * MAP_MAX), y: Math.round((1 - yPctFromTop) * MAP_MAX) });

// 夾限平移，避免露出黑底；縮到比容器小時置中
function clampPan(rect, tx, ty, scale) {
  const contentW = rect.width * scale;
  const contentH = rect.height * scale;
  if (scale <= 1) {
    return { tx: (rect.width - contentW) / 2, ty: (rect.height - contentH) / 2 };
  }
  const minTx = rect.width - contentW;
  const minTy = rect.height - contentH;
  return { tx: Math.min(0, Math.max(minTx, tx)), ty: Math.min(0, Math.max(minTy, ty)) };
}

export default function MapHighlighter() {
  // 預設背景 & 載入標記
  const [bgUrl, setBgUrl] = useState("/custom_map_1200_suncity.png");
  const [markers, setMarkers] = useState([]);
  const [filter, setFilter] = useState(null); // {type, number} | null
  const [editMode, setEditMode] = useState(false);
  const [draftType, setDraftType] = useState("建築工程站");
  const [draftNumber, setDraftNumber] = useState(1);
  const [selectedId, setSelectedId] = useState(null);

  // 縮放/平移
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [panMode, setPanMode] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [originStart, setOriginStart] = useState({ tx: 0, ty: 0 });
  const containerRef = useRef(null);

  // 格線/準星/座標
  const [showGrid, setShowGrid] = useState(true);
  const [gridStep, setGridStep] = useState(50); // 單位：世界座標
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [showCrosshair, setShowCrosshair] = useState(true);
  const [hoverCoord, setHoverCoord] = useState(null); // {x,y}
  const [clickCoord, setClickCoord] = useState(null); // {x,y}

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/markers_suncity.json");
        if (r.ok) {
          const arr = await r.json();
          if (Array.isArray(arr) && arr.length) { setMarkers(arr); return; }
        }
      } catch {}
      setMarkers([{ id: "sun_city", type: "雪原總部", number: 1, x: 597, y: 597, label: "太陽城" }]);
    })();
  }, []);

  const filtered = useMemo(() => (!filter ? markers : markers.filter(m => m.type === filter.type && m.number === filter.number)), [filter, markers]);

  const combos = useMemo(() => {
    const map = new Map();
    for (const m of markers) { if (!map.has(m.type)) map.set(m.type, new Set()); map.get(m.type).add(m.number); }
    return map;
  }, [markers]);

  // 目前滑鼠在原圖上的百分比與對應世界座標
  const getLogical = (event) => {
    const rect = containerRef.current.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const lx = (px - tx) / scale;
    const ly = (py - ty) / scale;
    return { xPct: lx / rect.width, yPctFromTop: ly / rect.height, rect };
  };

  const snap = (v) => Math.round(v / gridStep) * gridStep;

  const onMapClick = (e) => {
    const { xPct, yPctFromTop } = getLogical(e);
    let { x, y } = pctToWorld(xPct, yPctFromTop);
    if (snapToGrid) { x = Math.max(0, Math.min(MAP_MAX, snap(x))); y = Math.max(0, Math.min(MAP_MAX, snap(y))); }
    setClickCoord({ x, y });
    if (panMode || !editMode) return;
    if (selectedId) setSelectedId(null);
    if (xPct < 0 || xPct > 1 || yPctFromTop < 0 || yPctFromTop > 1) return;
    setMarkers(prev => [...prev, { id: Date.now(), x, y, type: draftType, number: draftNumber }]);
  };

  const onMouseMove = (e) => {
    if (dragging) {
      const { rect } = getLogical(e);
      let newTx = originStart.tx + (e.clientX - dragStart.x);
      let newTy = originStart.ty + (e.clientY - dragStart.y);
      const clamped = clampPan(rect, newTx, newTy, scale);
      setTx(clamped.tx); setTy(clamped.ty);
      return;
    }
    // 更新準星座標
    const { xPct, yPctFromTop } = getLogical(e);
    let { x, y } = pctToWorld(xPct, yPctFromTop);
    if (snapToGrid) { x = snap(x); y = snap(y); }
    setHoverCoord({ x, y });
  };

  const onWheel = (e) => {
    e.preventDefault();
    const { rect } = getLogical(e);
    const focusX = e.clientX - rect.left, focusY = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const targetScale = Math.min(6, Math.max(0.5, scale * factor));
    const s = targetScale / scale;
    let newTx = focusX - s * (focusX - tx), newTy = focusY - s * (focusY - ty);
    const clamped = clampPan(rect, newTx, newTy, targetScale);
    setScale(targetScale); setTx(clamped.tx); setTy(clamped.ty);
  };

  const onMouseDown = (e) => { if (!panMode) return; setDragging(true); setDragStart({ x: e.clientX, y: e.clientY }); setOriginStart({ tx, ty }); };
  const onMouseUp = () => setDragging(false);

  const resetView = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    const c = rect ? clampPan(rect, 0, 0, 1) : { tx: 0, ty: 0 };
    setScale(1); setTx(c.tx); setTy(c.ty);
  };
  const zoomBy = (mult) => {
    const rect = containerRef.current.getBoundingClientRect();
    const focusX = rect.width / 2, focusY = rect.height / 2;
    const targetScale = Math.min(6, Math.max(0.5, scale * mult));
    const s = targetScale / scale;
    let newTx = focusX - s * (focusX - tx), newTy = focusY - s * (focusY - ty);
    const clamped = clampPan(rect, newTx, newTy, targetScale);
    setScale(targetScale); setTx(clamped.tx); setTy(clamped.ty);
  };

  const applyToSelected = () => { if (!selectedId) return;
    setMarkers(prev => prev.map(m => m.id === selectedId ? ({ ...m, type: draftType, number: draftNumber }) : m));
  };
  const deleteSelected = () => { if (!selectedId) return; setMarkers(prev => prev.filter(m => m.id !== selectedId)); setSelectedId(null); };
  const exportJson = () => { const a = document.createElement("a"); a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(markers, null, 2)); a.download = "markers.json"; a.click(); };
  const importJson = (file) => { const r = new FileReader(); r.onload = () => { try { const arr = JSON.parse(r.result); if (Array.isArray(arr)) setMarkers(arr); } catch (e) {} }; r.readAsText(file); };

  // 產生格線（SVG，跟著縮放/平移）
  const Grid = () => {
    if (!showGrid) return null;
    const lines = [];
    for (let x = 0; x <= MAP_MAX; x += gridStep) {
      const { xPct } = worldToPct(x, 0);
      const major = x % 100 === 0;
      lines.push(<line key={`vx${x}`} x1={`${xPct}%`} y1="0%" x2={`${xPct}%`} y2="100%" stroke="rgba(255,255,255,0.25)" strokeWidth={major ? 1.5 : 1} />);
    }
    for (let y = 0; y <= MAP_MAX; y += gridStep) {
      const { yPct } = worldToPct(0, y);
      const major = y % 100 === 0;
      lines.push(<line key={`hy${y}`} x1="0%" y1={`${yPct}%`} x2="100%" y2={`${yPct}%`} stroke="rgba(255,255,255,0.25)" strokeWidth={major ? 1.5 : 1} />);
    }
    // 軸向 600 加強
    const { xPct: x600 } = worldToPct(600, 0);
    const { yPct: y600 } = worldToPct(0, 600);
    lines.push(<line key="vx600" x1={`${x600}%`} y1="0%" x2={`${x600}%`} y2="100%" stroke="rgba(255,255,255,0.55)" strokeWidth={2} />);
    lines.push(<line key="hy600" x1="0%" y1={`${y600}%`} x2="100%" y2={`${y600}%`} stroke="rgba(255,255,255,0.55)" strokeWidth={2} />);
    return (
      <svg className="absolute inset-0 pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
        {lines}
      </svg>
    );
  };

  // 十字準星
  const Crosshair = () => {
    if (!showCrosshair || !hoverCoord) return null;
    const { xPct, yPct } = worldToPct(hoverCoord.x, hoverCoord.y);
    return (
      <>
        <div className="absolute h-full w-px bg-white/40" style={{ left: `${xPct}%`, top: 0 }} />
        <div className="absolute w-full h-px bg-white/40" style={{ top: `${yPct}%`, left: 0 }} />
        <div className="absolute" style={{ left: `${xPct}%`, top: `${yPct}%`, transform: "translate(-50%,-140%)" }}>
          <div className="px-2 py-1 text-xs rounded bg-black/70 text-white border border-white/10 shadow">({hoverCoord.x}, {hoverCoord.y})</div>
        </div>
      </>
    );
  };

  return (
    <div className="min-h-screen w-full bg-slate-900 text-slate-100 p-6">
      <div className="mx-auto max-w-6xl grid grid-cols-12 gap-6">
        {/* 側邊工具 */}
        <aside className="col-span-12 md:col-span-3">
          <h2 className="text-xl font-semibold mb-3">圖例（Legend）</h2>

          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => setPanMode(v=>!v)} className={`rounded-xl px-3 py-1 ${panMode?"bg-amber-600":"bg-slate-700"}`}>{panMode?"平移中":"啟用平移"}</button>
            <button onClick={() => zoomBy(1.2)} className="rounded-xl px-3 py-1 bg-slate-700">放大</button>
            <button onClick={() => zoomBy(1/1.2)} className="rounded-xl px-3 py-1 bg-slate-700">縮小</button>
            <button onClick={resetView} className="rounded-xl px-3 py-1 bg-slate-700">重置</button>
          </div>

          {/* 格線/吸附/準星 */}
          <div className="flex items-center gap-2 mb-4 text-sm">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={showGrid} onChange={e=>setShowGrid(e.target.checked)} /> 顯示格線
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={snapToGrid} onChange={e=>setSnapToGrid(e.target.checked)} /> 吸附到格點
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={showCrosshair} onChange={e=>setShowCrosshair(e.target.checked)} /> 十字準星
            </label>
          </div>

          <div className="mb-4 text-sm">
            <label className="block mb-1 opacity-80">格線間距（單位）</label>
            <select value={gridStep} onChange={e=>setGridStep(parseInt(e.target.value))}
              className="bg-slate-700 rounded-xl px-3 py-2">
              {[10,20,25,50,100].map(s=> <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* 動態圖例 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm opacity-80">點圖例可過濾；按「全部顯示」清除</span>
              <button onClick={() => setFilter(null)} className="rounded-xl px-3 py-1 bg-slate-700 hover:bg-slate-600">全部顯示</button>
            </div>
            <div className="space-y-3">
              {[...combos.keys()].map((type) => {
                const color = TYPE_META[type]?.color || "gray";
                const numbers = [...combos.get(type)].sort((a,b)=>a-b);
                return (
                  <div key={type} className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm w-28 truncate" title={type}>{type}</span>
                    {numbers.map((num) => (
                      <button key={num} onClick={() => setFilter({type, number:num})}
                        className="flex items-center gap-2 rounded-2xl px-2 py-1 bg-slate-800 hover:bg-slate-700 shadow"
                        title={`只顯示：${type}（${num}）`}>
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${colorClass(color)} font-bold text-sm`}>{num}</span>
                        <span className="text-xs opacity-80">只顯示</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>

            {/* 編輯工具 */}
            <div className="mt-4 space-y-3 p-3 rounded-2xl bg-slate-800/70">
              <div className="flex items-center justify-between">
                <label className="text-sm">編輯模式</label>
                <button onClick={() => setEditMode(v=>!v)} className={`px-3 py-1 rounded-xl ${editMode?"bg-emerald-500":"bg-slate-600"}`}>{editMode?"開啟":"關閉"}</button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <select value={draftType} onChange={(e)=>setDraftType(e.target.value)} className="col-span-2 bg-slate-700 rounded-xl px-3 py-2">
                  {Object.keys(TYPE_META).map(k=> <option key={k} value={k}>{k}</option>)}
                </select>
                <label className="col-span-1 self-center">數字</label>
                <input type="number" min={0} max={9} value={draftNumber} onChange={(e)=>setDraftNumber(parseInt(e.target.value||"0"))} className="col-span-1 bg-slate-700 rounded-xl px-3 py-2"/>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={exportJson} className="flex-1 bg-slate-700 hover:bg-slate-600 rounded-xl px-3 py-2">匯出JSON</button>
                <label className="flex-1 bg-slate-700 hover:bg-slate-600 rounded-xl px-3 py-2 text-center cursor-pointer">匯入JSON
                  <input type="file" accept="application/json" className="hidden" onChange={(e)=>{const f=e.target.files?.[0]; if(f) importJson(f);}}/>
                </label>
              </div>
              {selectedId && (
                <div className="pt-2 border-t border-white/10 space-y-2">
                  <div className="text-xs opacity-80">正在編輯節點：{selectedId}</div>
                  <div className="flex gap-2">
                    <button onClick={applyToSelected} className="flex-1 bg-emerald-600 hover:bg-emerald-500 rounded-xl px-3 py-2">套用至選取節點</button>
                    <button onClick={deleteSelected} className="flex-1 bg-red-600 hover:bg-red-500 rounded-xl px-3 py-2">刪除節點</button>
                  </div>
                </div>
              )}
            </div>

            {/* 圖片上傳 */}
            <div className="mt-4">
              <label className="block text-sm opacity-80 mb-2">選擇地圖圖片</label>
              <input type="file" accept="image/*" onChange={(e) => {
                const f = e.target.files?.[0]; if (!f) return;
                const url = URL.createObjectURL(f); setBgUrl(url);
              }} className="block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:bg-slate-600 file:text-white hover:file:bg-slate-500"/>
              <p className="text-xs opacity-70 mt-2 leading-5">座標採 <b>世界座標</b> 0..1199（左下為原點）。縮放/平移/格線吸附皆已處理。</p>
            </div>
          </div>
        </aside>

        {/* 地圖區 */}
        <main className="col-span-12 md:col-span-9">
          <div
            ref={containerRef}
            className="relative w-full aspect-[1.6] overflow-hidden rounded-3xl bg-slate-800 shadow-lg"
            onClick={onMapClick}
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          >
            {/* 受縮放/平移的內容容器 */}
            <div className="absolute inset-0" style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})`, transformOrigin: "0 0" }}>
              {/* 地圖底圖 */}
              {bgUrl ? (
                <img src={bgUrl} alt="map" className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-slate-300">請上傳地圖</div>
              )}

              {/* 格線（SVG） */}
              <Grid />

              {/* 滑鼠十字準星 */}
              <Crosshair />

              {/* 點擊座標徽章 */}
              {clickCoord && <CoordBadge x={clickCoord.x} y={clickCoord.y} />}

              {/* 節點 */}
              {filtered.map((m) => {
                const { xPct, yPct } = worldToPct(m.x, m.y);
                const meta = TYPE_META[m.type] || { color: "gray" };
                const isHL = !!filter && m.type===filter.type && m.number===filter.number;
                return (
                  <Marker
                    key={m.id}
                    xPct={xPct}
                    yPct={yPct}
                    number={m.number}
                    color={meta.color}
                    highlight={isHL}
                    selected={selectedId===m.id}
                    onClickMarker={() => {
                      if (!editMode) return;
                      if (selectedId === m.id) { setMarkers(prev=>prev.filter(x=>x.id!==m.id)); setSelectedId(null); return; }
                      setSelectedId(m.id); setDraftType(m.type); setDraftNumber(m.number);
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div className="mt-4 text-sm opacity-80">
            {editMode && <span className="mr-3">🛠️ 編輯模式：點地圖可新增節點。</span>}
            {filter ? <span>篩選：<b>{filter.type}（{filter.number}）</b>，其餘已隱藏。</span> : <span>顯示全部標記。</span>}
            {clickCoord && <span className="ml-4">最近點擊座標：<b>({clickCoord.x}, {clickCoord.y})</b></span>}
          </div>
        </main>
      </div>
    </div>
  );
}

/* ====== 標記元件 ====== */
function Marker({ xPct, yPct, number, color, highlight, selected, onClickMarker }) {
  return (
    <div className="absolute cursor-pointer" onClick={(e) => { e.stopPropagation(); onClickMarker && onClickMarker(); }} style={{ left: `${xPct}%`, top: `${yPct}%`, transform: "translate(-50%, -50%)" }}>
      <div className="relative">
        {(highlight || selected) && (
          <span className={`absolute inset-0 -z-10 ${selected?"animate-none":"animate-ping"} rounded-full w-9 h-9 ${selected?"bg-white/40":"bg-blue-400/50"}`} />
        )}
        <span className={"flex items-center justify-center w-9 h-9 rounded-full text-base font-bold shadow-lg border border-white/20 " + colorClass(color)}>{number}</span>
      </div>
    </div>
  );
}

/* ====== 點擊座標徽章 ====== */
function CoordBadge({ x, y }) {
  const { xPct, yPct } = worldToPct(x, y);
  return (
    <div className="absolute" style={{ left: `${xPct}%`, top: `${yPct}%`, transform: "translate(-50%, -140%)" }}>
      <div className="px-2 py-1 text-xs rounded bg-black/70 text-white border border-white/10 shadow">({x}, {y})</div>
      <div className="w-2 h-2 bg-white rounded-full border border-black/30 shadow" style={{ transform: "translate(-50%, 6px)" }} />
    </div>
  );
}
