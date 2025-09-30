import React, { useEffect, useMemo, useRef, useState } from "react";

/** Interactive Map – consolidated
 *  World coords: (0,0) bottom-left .. (1199,1199) top-right (square map)
 *  Public assets: /custom_map_1200_suncity.png, /markers_suncity.json
 */

const MAP_MAX = 1199;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 6;

const TYPE_META = {
  建築工程站: { color: "blue" },
  採集工程站: { color: "green" },
  生產工程站: { color: "yellow" },
  研究工程站: { color: "purple" },
  都政工程站: { color: "orange" },
  訓練工程站: { color: "pink" },
  防禦工程站: { color: "red" },
  遠征工程站: { color: "teal" },
  堡壘: { color: "indigo" },
  要塞: { color: "slate" },
  雪原總部: { color: "cyan" },
};

const colorClass = (name) =>
  ({
    blue: "bg-blue-500 text-white",
    green: "bg-green-500 text-white",
    yellow: "bg-yellow-400 text-black",
    purple: "bg-purple-500 text-white",
    orange: "bg-orange-500 text-white",
    pink: "bg-pink-500 text-white",
    red: "bg-red-500 text-white",
    teal: "bg-teal-500 text-white",
    indigo: "bg-indigo-500 text-white",
    slate: "bg-slate-500 text-white",
    cyan: "bg-cyan-500 text-black",
  }[name] || "bg-gray-500 text-white");

// world ↔ percent (for square map)
const worldToPct = (x, y) => ({ xPct: (x / MAP_MAX) * 100, yPct: ((MAP_MAX - y) / MAP_MAX) * 100 });
const pctToWorld = (xPct, yPctFromTop) => ({ x: Math.round(xPct * MAP_MAX), y: Math.round((1 - yPctFromTop) * MAP_MAX) });

// keep content inside container (no black gaps)
function clampPan(rect, tx, ty, scale) {
  const cw = rect.width * scale;
  const ch = rect.height * scale;
  if (scale <= 1) return { tx: (rect.width - cw) / 2, ty: (rect.height - ch) / 2 };
  const minTx = rect.width - cw, minTy = rect.height - ch;
  return { tx: Math.min(0, Math.max(minTx, tx)), ty: Math.min(0, Math.max(minTy, ty)) };
}

export default function MapHighlighter() {
  // data
  const [bgUrl, setBgUrl] = useState("/custom_map_1200_suncity.png");
  const [markers, setMarkers] = useState([]);
  const [filter, setFilter] = useState(null); // {type, number}
  const [editMode, setEditMode] = useState(false);
  const [draftType, setDraftType] = useState("建築工程站");
  const [draftNumber, setDraftNumber] = useState(1);
  const [draftLabel, setDraftLabel] = useState(""); // 名稱
  const [selectedId, setSelectedId] = useState(null);

  // view (square stage + transforms)
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [panMode, setPanMode] = useState(false);
  const drag = useRef(null); // {sx,sy,tx0,ty0}

  // grid / UX
  const [showGrid, setShowGrid] = useState(true);
  const [gridStep, setGridStep] = useState(50); // 支援 1
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [showCrosshair, setShowCrosshair] = useState(true);
  const [hover, setHover] = useState(null);
  const [badge, setBadge] = useState(null);

  // quick jump
  const [jumpX, setJumpX] = useState("");
  const [jumpY, setJumpY] = useState("");
  const [jumpZoom, setJumpZoom] = useState("");
  const [lastJump, setLastJump] = useState(null); // {x,y}
  const [autoMarkOnJump, setAutoMarkOnJump] = useState(false);

  // init markers
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/markers_suncity.json");
        if (r.ok) {
          const arr = await r.json();
          if (Array.isArray(arr) && arr.length) { setMarkers(arr.map(m => ({ label: "", ...m }))); return; }
        }
      } catch {}
      setMarkers([{ id: "sun_city", type: "雪原總部", number: 1, x: 597, y: 597, label: "太陽城" }]);
    })();
  }, []);

  // derived
  const filtered = useMemo(
    () => (!filter ? markers : markers.filter(m => m.type === filter.type && m.number === filter.number)),
    [filter, markers]
  );
  const combos = useMemo(() => {
    const map = new Map();
    for (const m of markers) { if (!map.has(m.type)) map.set(m.type, new Set()); map.get(m.type).add(m.number); }
    return map;
  }, [markers]);

  // helpers
  const rectOf = () => containerRef.current.getBoundingClientRect();
  const logicalFromEvent = (e) => {
    const rect = rectOf();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const lx = (px - tx) / scale,     ly = (py - ty) / scale;
    return { rect, xPct: lx / rect.width, yPctFromTop: ly / rect.height };
  };
  const snap = (v) => Math.round(v / gridStep) * gridStep;

  const centerAt = (x, y, newScale = null) => {
    const rect = rectOf();
    const s = newScale ?? scale;
    const clampedS = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));
    const { xPct, yPct } = worldToPct(x, y);
    let nx = rect.width / 2 - clampedS * (xPct / 100) * rect.width;
    let ny = rect.height / 2 - clampedS * (yPct / 100) * rect.height;
    const { tx: ctx, ty: cty } = clampPan(rect, nx, ny, clampedS);
    setScale(clampedS); setTx(ctx); setTy(cty);
  };

  const addMarkerAt = (x, y) => {
    let nx = x, ny = y;
    if (snapToGrid) { nx = Math.max(0, Math.min(MAP_MAX, snap(nx))); ny = Math.max(0, Math.min(MAP_MAX, snap(ny))); }
    setMarkers(prev => [...prev, { id: Date.now(), x: nx, y: ny, type: draftType, number: draftNumber, label: (draftLabel || "") }]);
    setBadge({ x: nx, y: ny });
  };

  const goToInputCoord = () => {
    const x = Math.max(0, Math.min(MAP_MAX, Number(jumpX)));
    const y = Math.max(0, Math.min(MAP_MAX, Number(jumpY)));
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    const z = jumpZoom === "" ? null : Number(jumpZoom);
    centerAt(x, y, z);
    setLastJump({ x, y }); setBadge({ x, y });
    if (autoMarkOnJump) addMarkerAt(x, y);
  };

  // interactions
  const onMapClick = (e) => {
    const { xPct, yPctFromTop } = logicalFromEvent(e);
    let { x, y } = pctToWorld(xPct, yPctFromTop);
    if (snapToGrid) { x = Math.max(0, Math.min(MAP_MAX, snap(x))); y = Math.max(0, Math.min(MAP_MAX, snap(y))); }
    setBadge({ x, y });
    if (panMode || !editMode) return;
    if (selectedId) setSelectedId(null);
    if (xPct < 0 || xPct > 1 || yPctFromTop < 0 || yPctFromTop > 1) return;
    addMarkerAt(x, y);
  };

  const onWheel = (e) => {
    e.preventDefault();
    const { rect } = logicalFromEvent(e);
    const focusX = e.clientX - rect.left, focusY = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const targetScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale * factor));
    const s = targetScale / scale;
    let nx = focusX - s * (focusX - tx), ny = focusY - s * (focusY - ty);
    const { tx: ctx, ty: cty } = clampPan(rect, nx, ny, targetScale);
    setScale(targetScale); setTx(ctx); setTy(cty);
  };

  const onMouseDown = (e) => { if (!panMode) return; drag.current = { sx: e.clientX, sy: e.clientY, tx0: tx, ty0: ty }; };
  const onMouseMove = (e) => {
    if (drag.current) {
      const { rect } = logicalFromEvent(e);
      const dx = e.clientX - drag.current.sx, dy = e.clientY - drag.current.sy;
      const { tx: ctx, ty: cty } = clampPan(rect, drag.current.tx0 + dx, drag.current.ty0 + dy, scale);
      setTx(ctx); setTy(cty); return;
    }
    const { xPct, yPctFromTop } = logicalFromEvent(e);
    let { x, y } = pctToWorld(xPct, yPctFromTop);
    if (snapToGrid) { x = snap(x); y = snap(y); }
    setHover({ x, y });
  };
  const endDrag = () => (drag.current = null);

  // edit ops
  const applyToSelected = () => {
    if (!selectedId) return;
    setMarkers(prev => prev.map(m => (m.id === selectedId ? { ...m, type: draftType, number: draftNumber, label: draftLabel } : m)));
  };
  const deleteSelected = () => { if (!selectedId) return; setMarkers(prev => prev.filter(m => m.id !== selectedId)); setSelectedId(null); };

  // IO
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(markers, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: "markers.json" });
    a.click(); URL.revokeObjectURL(url);
  };
  const importJson = (file) => {
    const r = new FileReader();
    r.onload = () => { try { const arr = JSON.parse(r.result); if (Array.isArray(arr)) setMarkers(arr.map(m => ({ label: "", ...m }))); } catch {} };
    r.readAsText(file);
  };

  // marker size (zoom-aware + density-aware)
  const computeMarkerSize = (x, y, list, rect) => {
    let size = Math.max(10, Math.min(40, 12 * scale)); // base by zoom
    const { xPct, yPct } = worldToPct(x, y);
    const px = (xPct / 100) * rect.width * scale;
    const py = (yPct / 100) * rect.height * scale;
    let neighbors = 0;
    for (const m of list) {
      if (m.x === x && m.y === y) continue;
      const p = worldToPct(m.x, m.y);
      const qx = (p.xPct / 100) * rect.width * scale;
      const qy = (p.yPct / 100) * rect.height * scale;
      if (Math.hypot(px - qx, py - qy) < 60) neighbors++;
    }
    if (neighbors >= 3) size *= 0.7; else if (neighbors >= 1) size *= 0.85;
    return Math.round(size);
  };

  return (
    <div className="min-h-screen w-full bg-slate-900 text-slate-100 p-6">
      <div className="mx-auto max-w-6xl grid grid-cols-12 gap-6">

        {/* Sidebar */}
        <aside className="col-span-12 md:col-span-3">
          <h2 className="text-xl font-semibold mb-3">圖例（Legend）</h2>

          {/* View controls */}
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => setPanMode(v=>!v)} className={`rounded-xl px-3 py-1 ${panMode?"bg-amber-600":"bg-slate-700"}`}>{panMode?"平移中":"啟用平移"}</button>
            <button onClick={() => centerAt(MAP_MAX/2, MAP_MAX/2, Math.min(ZOOM_MAX, scale*1.2))} className="rounded-xl px-3 py-1 bg-slate-700">放大</button>
            <button onClick={() => centerAt(MAP_MAX/2, MAP_MAX/2, Math.max(ZOOM_MIN, scale/1.2))} className="rounded-xl px-3 py-1 bg-slate-700">縮小</button>
            <button onClick={() => { const r=rectOf(); const c=clampPan(r,0,0,1); setScale(1); setTx(c.tx); setTy(c.ty); }} className="rounded-xl px-3 py-1 bg-slate-700">重置</button>
          </div>

          {/* Grid / Crosshair */}
          <div className="flex items-center gap-3 mb-3 text-sm">
            <label className="flex items-center gap-1"><input type="checkbox" checked={showGrid} onChange={e=>setShowGrid(e.target.checked)}/> 顯示格線</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={snapToGrid} onChange={e=>setSnapToGrid(e.target.checked)}/> 吸附</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={showCrosshair} onChange={e=>setShowCrosshair(e.target.checked)}/> 十字準星</label>
          </div>
          <div className="mb-4 text-sm">
            <label className="block mb-1 opacity-80">格線間距（單位）</label>
            <select value={gridStep} onChange={(e)=>setGridStep(Math.max(1, parseInt(e.target.value||"1")))} className="bg-slate-700 rounded-xl px-3 py-2">
              {[1,5,10,20,25,50,100].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Quick jump */}
          <div className="mb-4 p-3 rounded-2xl bg-slate-800/70 space-y-2">
            <div className="text-sm font-medium">前往座標</div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div><label className="block text-xs opacity-80 mb-1">X</label>
                <input type="number" min={0} max={MAP_MAX} value={jumpX} onChange={e=>setJumpX(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') goToInputCoord();}} className="w-full bg-slate-700 rounded-xl px-3 py-2" placeholder="0-1199"/></div>
              <div><label className="block text-xs opacity-80 mb-1">Y</label>
                <input type="number" min={0} max={MAP_MAX} value={jumpY} onChange={e=>setJumpY(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') goToInputCoord();}} className="w-full bg-slate-700 rounded-xl px-3 py-2" placeholder="0-1199"/></div>
              <div><label className="block text-xs opacity-80 mb-1">縮放(可空)</label>
                <input type="number" step="0.1" min={ZOOM_MIN} max={ZOOM_MAX} value={jumpZoom} onChange={e=>setJumpZoom(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') goToInputCoord();}} className="w-full bg-slate-700 rounded-xl px-3 py-2" placeholder="1~6"/></div>
            </div>

            <div className="flex items-center gap-3 mb-1 text-xs">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={autoMarkOnJump} onChange={e=>setAutoMarkOnJump(e.target.checked)} />
                前往後自動新增節點
              </label>
            </div>

            <div className="flex gap-2">
              <button onClick={goToInputCoord} className="flex-1 bg-slate-700 hover:bg-slate-600 rounded-xl px-3 py-2">前往</button>
              <button onClick={()=>{ if(lastJump) addMarkerAt(lastJump.x, lastJump.y); }} disabled={!lastJump}
                className={`px-3 py-2 rounded-xl ${lastJump ? "bg-emerald-600 hover:bg-emerald-500" : "bg-slate-700 opacity-50 cursor-not-allowed"}`}>
                在此標記
              </button>
              <button onClick={()=>{ setJumpX(""); setJumpY(""); setJumpZoom(""); setLastJump(null); }}
                className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600">清空</button>
            </div>
            <p className="text-xs opacity-70">輸入世界座標（左下為原點 0~1199）。</p>
          </div>

          {/* Dynamic legend */}
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm opacity-80">點圖例過濾；「全部顯示」清除</span>
              <button onClick={() => setFilter(null)} className="rounded-xl px-3 py-1 bg-slate-700 hover:bg-slate-600">全部顯示</button>
            </div>
            <div className="space-y-3">
              {[...combos.keys()].map((type) => {
                const color = TYPE_META[type]?.color || "gray";
                const nums = [...combos.get(type)].sort((a,b)=>a-b);
                return (
                  <div key={type} className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm w-28 truncate" title={type}>{type}</span>
                    {nums.map(n => (
                      <button key={n} onClick={()=>setFilter({type, number:n})}
                        className="flex items-center gap-2 rounded-2xl px-2 py-1 bg-slate-800 hover:bg-slate-700 shadow" title={`只顯示：${type}（${n}）`}>
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${colorClass(color)} font-bold text-sm`}>{n}</span>
                        <span className="text-xs opacity-80">只顯示</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>

            {/* Editor */}
            <div className="mt-4 space-y-3 p-3 rounded-2xl bg-slate-800/70">
              <div className="flex items-center justify-between">
                <label className="text-sm">編輯模式</label>
                <button onClick={()=>setEditMode(v=>!v)} className={`px-3 py-1 rounded-xl ${editMode?"bg-emerald-500":"bg-slate-600"}`}>{editMode?"開啟":"關閉"}</button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <select value={draftType} onChange={(e)=>setDraftType(e.target.value)} className="col-span-2 bg-slate-700 rounded-xl px-3 py-2">
                  {Object.keys(TYPE_META).map(k => <option key={k} value={k}>{k}</option>)}
                </select>
                <label className="col-span-1 self-center">數字</label>
                <input type="number" min={0} max={9} value={draftNumber} onChange={(e)=>setDraftNumber(parseInt(e.target.value||"0"))} className="col-span-1 bg-slate-700 rounded-xl px-3 py-2"/>
                <label className="col-span-1 self-center">名稱</label>
                <input type="text" value={draftLabel} onChange={(e)=>setDraftLabel(e.target.value)} className="col-span-1 bg-slate-700 rounded-xl px-3 py-2" placeholder="例如：前哨站A"/>
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

            {/* Background image */}
            <div className="mt-4">
              <label className="block text-sm opacity-80 mb-2">選擇地圖圖片</label>
              <input type="file" accept="image/*" onChange={(e)=>{const f=e.target.files?.[0]; if(!f) return; setBgUrl(URL.createObjectURL(f));}}
                className="block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:bg-slate-600 file:text-white hover:file:bg-slate-500"/>
              <p className="text-xs opacity-70 mt-2 leading-5">地圖為正方形，世界座標 0..1199（左下為原點）。</p>
            </div>
          </div>
        </aside>

        {/* Map stage – square so coords == image plane */}
        <main className="col-span-12 md:col-span-9">
          <div
            ref={containerRef}
            className="relative w-full aspect-square overflow-hidden rounded-3xl bg-slate-800 shadow-lg"
            onClick={onMapClick}
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
          >
            {/* transformed stage */}
            <div className="absolute inset-0" style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})`, transformOrigin: "0 0" }}>
              {bgUrl ? (
                <img src={bgUrl} alt="map" className="absolute inset-0 w-full h-full object-contain" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-slate-300">請上傳地圖</div>
              )}

              {/* grid (supports step=1, auto sparsify by zoom) */}
              {showGrid && <GridSVG step={gridStep} scale={scale} />}

              {/* crosshair & badge */}
              {showCrosshair && hover && <Crosshair x={hover.x} y={hover.y} />}
              {badge && <CoordBadge x={badge.x} y={badge.y} />}

              {/* markers */}
              {filtered.map((m) => {
                const { xPct, yPct } = worldToPct(m.x, m.y);
                const meta = TYPE_META[m.type] || { color: "gray" };
                const rect = rectOf();
                const pxSize = computeMarkerSize(m.x, m.y, filtered, rect);
                const selected = selectedId === m.id;
                const hl = !!filter && m.type === filter.type && m.number === filter.number;

                return (
                  <Marker
                    key={m.id}
                    xPct={xPct}
                    yPct={yPct}
                    number={m.number}
                    color={meta.color}
                    size={pxSize}
                    highlight={hl}
                    selected={selected}
                    label={m.label}
                    onClickMarker={() => {
                      if (!editMode) return;
                      if (selected) { setMarkers(prev => prev.filter(x => x.id !== m.id)); setSelectedId(null); return; }
                      setSelectedId(m.id); setDraftType(m.type); setDraftNumber(m.number); setDraftLabel(m.label || "");
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div className="mt-4 text-sm opacity-80">
            {editMode && <span className="mr-3">🛠️ 編輯模式：點地圖可新增節點。</span>}
            {filter ? <span>篩選：<b>{filter.type}（{filter.number}）</b>，其餘已隱藏。</span> : <span>顯示全部標記。</span>}
            {badge && <span className="ml-4">最近點擊座標：<b>({badge.x}, {badge.y})</b></span>}
          </div>
        </main>
      </div>
    </div>
  );
}

/* ======================= Sub Components ======================= */

function Marker({ xPct, yPct, number, color, size, highlight, selected, label, onClickMarker }) {
  return (
    <div
      className="absolute cursor-pointer"
      onClick={(e) => { e.stopPropagation(); onClickMarker && onClickMarker(); }}
      style={{ left: `${xPct}%`, top: `${yPct}%`, transform: "translate(-50%, -50%)" }}
      title={label ? `${label} (${number})` : `${number}`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        {(highlight || selected) && (
          <span className={`absolute inset-0 -z-10 ${selected ? "animate-none" : "animate-ping"} rounded-full ${selected ? "bg-white/40" : "bg-blue-400/50"}`} style={{ width: size, height: size }} />
        )}
        <span className={`flex items-center justify-center rounded-full font-bold shadow-lg border border-white/20 ${colorClass(color)}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}>
          {number}
        </span>
        {label && (
          <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 px-1.5 py-0.5 text-[10px] rounded bg-black/60" style={{ whiteSpace: "nowrap" }}>
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

function CoordBadge({ x, y }) {
  const { xPct, yPct } = worldToPct(x, y);
  return (
    <div className="absolute" style={{ left: `${xPct}%`, top: `${yPct}%`, transform: "translate(-50%, -140%)" }}>
      <div className="px-2 py-1 text-xs rounded bg-black/70 text-white border border-white/10 shadow">({x}, {y})</div>
      <div className="w-2 h-2 bg-white rounded-full border border-black/30 shadow" style={{ transform: "translate(-50%, 6px)" }} />
    </div>
  );
}

function Crosshair({ x, y }) {
  const { xPct, yPct } = worldToPct(x, y);
  return (
    <>
      <div className="absolute h-full w-px bg-white/40" style={{ left: `${xPct}%`, top: 0 }} />
      <div className="absolute w-full h-px bg-white/40" style={{ top: `${yPct}%`, left: 0 }} />
      <div className="absolute" style={{ left: `${xPct}%`, top: `${yPct}%`, transform: "translate(-50%,-140%)" }}>
        <div className="px-2 py-1 text-xs rounded bg-black/70 text-white border border-white/10 shadow">({x}, {y})</div>
      </div>
    </>
  );
}

/** GridSVG – supports step=1; auto sparsify based on zoom for performance/visibility */
function GridSVG({ step, scale }) {
  let sparsify = 1;
  if (scale < 0.9) sparsify = 8;
  else if (scale < 1.1) sparsify = 4;
  else if (scale < 1.4) sparsify = 2;

  const inc = Math.max(1, Math.round(step * sparsify));
  const lines = [];

  for (let x = 0; x <= MAP_MAX; x += inc) {
    const { xPct } = worldToPct(x, 0);
    const major100 = x % 100 === 0, major10 = x % 10 === 0;
    const stroke = major100 ? "rgba(255,255,255,0.55)" : major10 ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.18)";
    const width = major100 ? 2 : major10 ? 1.5 : 1;
    lines.push(<line key={`vx${x}`} x1={`${xPct}%`} y1="0%" x2={`${xPct}%`} y2="100%" stroke={stroke} strokeWidth={width} />);
  }
  for (let y = 0; y <= MAP_MAX; y += inc) {
    const { yPct } = worldToPct(0, y);
    const major100 = y % 100 === 0, major10 = y % 10 === 0;
    const stroke = major100 ? "rgba(255,255,255,0.55)" : major10 ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.18)";
    const width = major100 ? 2 : major10 ? 1.5 : 1;
    lines.push(<line key={`hy${y}`} x1="0%" y1={`${yPct}%`} x2="100%" y2={`${yPct}%`} stroke={stroke} strokeWidth={width} />);
  }

  return <svg className="absolute inset-0 pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">{lines}</svg>;
}
