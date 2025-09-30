import React, { useEffect, useMemo, useRef, useState } from "react";

/** Interactive Grid Map (minimal, null-safe)
 *  - World coords: (0,0) .. (1199,1199) square
 *  - Wheel zoom; optional pan (button)
 *  - Default gridStep = 1 (auto sparsify)
 */

const MAP_MAX = 1199;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 6;

const TYPE_META = {
  建築工程站: { color: "blue" },
  採集工程站: { color: "green" },
  生產工程站: { color: "yellow" },
  研究工程站: { color: "purple" },
  攻擊工程站: { color: "orange" },
  訓練工程站: { color: "pink" },
  防禦工程站: { color: "red" },
  遠征工程站: { color: "teal" },
  堡壘: { color: "indigo" },
  要塞: { color: "slate" },
  雪原總部: { color: "cyan" },
  熔爐: { color: "amber" },
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
    amber: "bg-amber-500 text-black",
  }[name] || "bg-gray-500 text-white");

// world ↔ percent
const worldToPct = (x, y) => ({ xPct: (x / MAP_MAX) * 100, yPct: ((MAP_MAX - y) / MAP_MAX) * 100 });
const pctToWorld = (xPct, yPctFromTop) => ({ x: Math.round(xPct * MAP_MAX), y: Math.round((1 - yPctFromTop) * MAP_MAX) });

function clampPan(rect, tx, ty, scale) {
  const cw = rect.width * scale, ch = rect.height * scale;
  if (scale <= 1) return { tx: (rect.width - cw) / 2, ty: (rect.height - ch) / 2 };
  const minTx = rect.width - cw, minTy = rect.height - ch;
  return { tx: Math.min(0, Math.max(minTx, tx)), ty: Math.min(0, Math.max(minTy, ty)) };
}

export default function MapHighlighter() {
  const [markers, setMarkers] = useState([]);
  const [editMode, setEditMode] = useState(true);
  const [draftType, setDraftType] = useState("建築工程站");
  const [draftNumber, setDraftNumber] = useState(1);
  const [draftLabel, setDraftLabel] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [panMode, setPanMode] = useState(false);
  const drag = useRef(null);

  const [gridStep] = useState(1);
  const [hover, setHover] = useState(null);
  const [badge, setBadge] = useState(null);

  const [jumpX, setJumpX] = useState("");
  const [jumpY, setJumpY] = useState("");
  const [jumpZoom, setJumpZoom] = useState("");
  const [lastJump, setLastJump] = useState(null);
  const [autoMarkOnJump, setAutoMarkOnJump] = useState(true);
  const [pinnedId, setPinnedId] = useState(null);

  useEffect(() => {
    setMarkers([{ id: "sun", type: "雲原總部", number: 1, x: 597, y: 597, label: "太陽城" }]);
  }, []);

  // ---------- helpers (NULL-SAFE) ----------
  const rectOf = () => {
    const el = containerRef.current;
    if (!el) return { left: 0, top: 0, width: 1, height: 1 };
    return el.getBoundingClientRect();
  };

  const logicalFromEvent = (e) => {
    const rect = rectOf();
    // 若還沒 mount（width=1）就先給安全值，避免 NaN
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const lx = (px - tx) / scale, ly = (py - ty) / scale;
    return { rect, xPct: lx / rect.width, yPctFromTop: ly / rect.height };
  };

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

  const computeMarkerSize = (x, y, list, rect) => {
    let size = Math.max(10, Math.min(40, 12 * scale));
    const { xPct, yPct } = worldToPct(x, y);
    const px = (xPct/100)*rect.width*scale, py = (yPct/100)*rect.height*scale;
    let neighbors = 0;
    for (const m of list) {
      if (m.x===x && m.y===y) continue;
      const p = worldToPct(m.x, m.y);
      const qx = (p.xPct/100)*rect.width*scale, qy = (p.yPct/100)*rect.height*scale;
      if (Math.hypot(px-qx, py-qy) < 60) neighbors++;
    }
    if (neighbors >= 3) size *= 0.7; else if (neighbors >= 1) size *= 0.85;
    return Math.round(size);
  };

  function computeOffsets(list, rect, scale, sizeFn, pinnedId = null) {
    const offsets = new Map();
    if (!list.length) return offsets;
    const items = list.map(m => {
      const { xPct, yPct } = worldToPct(m.x, m.y);
      return { id:m.id, px:(xPct/100)*rect.width*scale, py:(yPct/100)*rect.height*scale, size:sizeFn(m.x,m.y,list,rect) };
    });
    const id2 = new Map(items.map(i=>[i.id,i]));
    const left = new Set(items.map(i=>i.id));
    const near2 = (a,b) => { const thr=Math.max(a.size,b.size)*0.8; const dx=a.px-b.px, dy=a.py-b.py; return dx*dx+dy*dy<thr*thr; };
    while (left.size) {
      const rootId = left.values().next().value; left.delete(rootId);
      const q=[id2.get(rootId)]; const cluster=[];
      while(q.length){ const a=q.pop(); cluster.push(a);
        for(const id of [...left]){ const b=id2.get(id); if(near2(a,b)){ left.delete(id); q.push(b);} } }
      if(cluster.length===1 || cluster.some(c=>c.id===pinnedId)){ cluster.forEach(c=>offsets.set(c.id,{dx:0,dy:0})); continue;}
      const R=Math.max(...cluster.map(c=>c.size))*0.75;
      for(let i=0;i<cluster.length;i++){ const ang=2*Math.PI*i/cluster.length; offsets.set(cluster[i].id,{dx:R*Math.cos(ang),dy:R*Math.sin(ang)}); }
    }
    return offsets;
  }

  // ---------- events ----------
  const addMarkerAt = (x, y) => {
    const id = Date.now();
    setMarkers(prev => [...prev, { id, x, y, type: draftType, number: draftNumber, label: (draftLabel||"") }]);
    setBadge({ x, y }); setPinnedId(id);
  };

  const goToInputCoord = () => {
    const x = Math.max(0, Math.min(MAP_MAX, Number(jumpX)));
    const y = Math.max(0, Math.min(MAP_MAX, Number(jumpY)));
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    const z = jumpZoom === "" ? null : Number(jumpZoom);
    centerAt(x, y, z); setLastJump({x,y}); setBadge({x,y});
    if (autoMarkOnJump) addMarkerAt(x, y);
  };

  const onMapClick = (e) => {
    const { xPct, yPctFromTop } = logicalFromEvent(e);
    if (Number.isNaN(xPct) || Number.isNaN(yPctFromTop)) return; // 尚未 mount
    let { x, y } = pctToWorld(xPct, yPctFromTop);
    x = Math.max(0, Math.min(MAP_MAX, x)); y = Math.max(0, Math.min(MAP_MAX, y));
    setBadge({ x, y });
    if (!editMode) return;
    if (selectedId) setSelectedId(null);
    if (xPct < 0 || xPct > 1 || yPctFromTop < 0 || yPctFromTop > 1) return;
    addMarkerAt(x, y);
  };

  const onWheel = (e) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return; // 尚未 mount
    const { rect } = logicalFromEvent(e);
    const focusX = e.clientX - rect.left, focusY = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const targetScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale * factor));
    const s = targetScale / scale;
    let nx = focusX - s*(focusX - tx), ny = focusY - s*(focusY - ty);
    const { tx: ctx, ty: cty } = clampPan(rect, nx, ny, targetScale);
    setScale(targetScale); setTx(ctx); setTy(cty);
  };

  const onMouseDown = (e) => { if (!panMode) return; const el=containerRef.current; if(!el) return;
    drag.current = { sx: e.clientX, sy: e.clientY, tx0: tx, ty0: ty }; };
  const onMouseMove = (e) => {
    if (drag.current) {
      const { rect } = logicalFromEvent(e);
      const dx = e.clientX - drag.current.sx, dy = e.clientY - drag.current.sy;
      const { tx: ctx, ty: cty } = clampPan(rect, drag.current.tx0 + dx, drag.current.ty0 + dy, scale);
      setTx(ctx); setTy(cty); return;
    }
    const el = containerRef.current; if (!el) return;
    const { xPct, yPctFromTop } = logicalFromEvent(e);
    if (Number.isNaN(xPct)) return;
    let { x, y } = pctToWorld(xPct, yPctFromTop);
    setHover({ x, y });
  };
  const endDrag = () => (drag.current = null);

  const deleteSelected = () => { if (!selectedId) return; setMarkers(prev=>prev.filter(m=>m.id!==selectedId)); setSelectedId(null); setPinnedId(null); };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(markers, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = Object.assign(document.createElement("a"), { href:url, download:"markers.json" });
    a.click(); URL.revokeObjectURL(url);
  };
  const importJson = (file) => {
    const r = new FileReader();
    r.onload = () => { try { const arr = JSON.parse(r.result); if (Array.isArray(arr)) setMarkers(arr.map(m=>({ label:"", ...m }))); } catch {} };
    r.readAsText(file);
  };

  const rect = rectOf();
  const offsetsMap = useMemo(
    () => computeOffsets(markers, rect, scale, computeMarkerSize, pinnedId),
    [markers, scale, tx, ty, rect.width, rect.height, pinnedId]
  );

  return (
    <div className="min-h-screen w-full bg-slate-900 text-slate-100 p-6">
      <div className="mx-auto max-w-6xl grid grid-cols-12 gap-6">

        {/* 左側（精簡） */}
        <aside className="col-span-12 md:col-span-3 space-y-4">
          <div className="p-3 rounded-2xl bg-slate-800/70 space-y-2">
            <div className="text-sm font-medium">前往座標</div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div><label className="block text-xs opacity-80 mb-1">X</label>
                <input type="number" min={0} max={MAP_MAX} value={jumpX} onChange={(e)=>setJumpX(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter') goToInputCoord();}} className="w-full bg-slate-700 rounded-xl px-3 py-2" placeholder="0-1199" /></div>
              <div><label className="block text-xs opacity-80 mb-1">Y</label>
                <input type="number" min={0} max={MAP_MAX} value={jumpY} onChange={(e)=>setJumpY(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter') goToInputCoord();}} className="w-full bg-slate-700 rounded-xl px-3 py-2" placeholder="0-1199" /></div>
              <div><label className="block text-xs opacity-80 mb-1">縮放(可空)</label>
                <input type="number" step="0.1" min={ZOOM_MIN} max={ZOOM_MAX} value={jumpZoom} onChange={(e)=>setJumpZoom(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter') goToInputCoord();}} className="w-full bg-slate-700 rounded-xl px-3 py-2" placeholder="1~6" /></div>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={autoMarkOnJump} onChange={(e)=>setAutoMarkOnJump(e.target.checked)} />
              前往後自動新增節點
            </label>
            <div className="flex gap-2">
              <button onClick={goToInputCoord} className="flex-1 bg-slate-700 hover:bg-slate-600 rounded-xl px-3 py-2">前往</button>
              <button onClick={()=>{ if(lastJump) addMarkerAt(lastJump.x, lastJump.y); }} disabled={!lastJump}
                className={`px-3 py-2 rounded-xl ${lastJump ? "bg-emerald-600 hover:bg-emerald-500" : "bg-slate-700 opacity-50 cursor-not-allowed"}`}>
                在此標記
              </button>
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-slate-800/70 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm">編輯模式</label>
              <button onClick={()=>setEditMode(v=>!v)} className={`px-3 py-1 rounded-xl ${editMode?"bg-emerald-500":"bg-slate-600"}`}>{editMode?"開啟":"關閉"}</button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <select value={draftType} onChange={(e)=>setDraftType(e.target.value)} className="col-span-2 bg-slate-700 rounded-xl px-3 py-2">
                {Object.keys(TYPE_META).map(k => <option key={k} value={k}>{k}</option>)}
              </select>
              <label className="col-span-1 self-center">數字</label>
              <input type="number" min={0} max={9} value={draftNumber} onChange={(e)=>setDraftNumber(parseInt(e.target.value||"0"))} className="col-span-1 bg-slate-700 rounded-xl px-3 py-2" />
              <label className="col-span-1 self-center">名稱</label>
              <input type="text" value={draftLabel} onChange={(e)=>setDraftLabel(e.target.value)} className="col-span-1 bg-slate-700 rounded-xl px-3 py-2" placeholder="例如：前哨站A" />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={()=>{ const blob=new Blob([JSON.stringify(markers,null,2)],{type:"application/json"}); const url=URL.createObjectURL(blob); const a=Object.assign(document.createElement("a"),{href:url,download:"markers.json"}); a.click(); URL.revokeObjectURL(url); }} className="flex-1 bg-slate-700 hover:bg-slate-600 rounded-xl px-3 py-2">匯出JSON</button>
              <label className="flex-1 bg-slate-700 hover:bg-slate-600 rounded-xl px-3 py-2 text-center cursor-pointer">匯入JSON
                <input type="file" accept="application/json" className="hidden" onChange={(e)=>{const f=e.target.files?.[0]; if(f){ const r=new FileReader(); r.onload=()=>{ try{ const arr=JSON.parse(r.result); if(Array.isArray(arr)) setMarkers(arr.map(m=>({label:"",...m}))); }catch{} }; r.readAsText(f);} }}/>
              </label>
            </div>
            {selectedId && (
              <div className="pt-2 border-t border-white/10 space-y-2">
                <div className="text-xs opacity-80">正在編輯節點：{selectedId}</div>
                <div className="flex gap-2">
                  <button onClick={()=>{ setMarkers(prev=>prev.filter(m=>m.id!==selectedId)); setSelectedId(null); setPinnedId(null);} } className="flex-1 bg-red-600 hover:bg-red-500 rounded-xl px-3 py-2">刪除節點</button>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* 地圖 */}
        <main className="col-span-12 md:col-span-9">
          <div
            ref={containerRef}
            className="relative w-full aspect-square overflow-hidden rounded-3xl bg-slate-800 shadow-lg select-none"
            onClick={onMapClick}
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
          >
            <div className="absolute inset-0" style={{ transform:`translate(${tx}px, ${ty}px) scale(${scale})`, transformOrigin:"0 0" }}>
              <GridSVG step={gridStep} scale={scale} />
              {hover && <Crosshair x={hover.x} y={hover.y} />}
              {badge && <CoordBadge x={badge.x} y={badge.y} />}

              {markers.map((m) => {
                const { xPct, yPct } = worldToPct(m.x, m.y);
                const meta = TYPE_META[m.type] || { color: "gray" };
                const size = computeMarkerSize(m.x, m.y, markers, rect);
                const o = offsetsMap.get(m.id) || { dx: 0, dy: 0 };
                const selected = selectedId === m.id;
                return (
                  <Marker
                    key={m.id}
                    xPct={xPct}
                    yPct={yPct}
                    number={m.number}
                    color={meta.color}
                    size={size}
                    label={m.label}
                    selected={selected}
                    offsetPx={o}
                    onClickMarker={() => {
                      if (!editMode) return;
                      if (selected) { setMarkers(prev=>prev.filter(x=>x.id!==m.id)); setSelectedId(null); setPinnedId(null); return; }
                      setSelectedId(m.id); setPinnedId(m.id); setDraftType(m.type); setDraftNumber(m.number); setDraftLabel(m.label || "");
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div className="mt-3 text-sm opacity-80">
            {editMode ? <span className="mr-3">🛠️ 編輯模式：點地圖可新增節點</span> : <span className="mr-3">檢視模式</span>}
            {badge && <span>最近座標：<b>({badge.x}, {badge.y})</b></span>}
            <button onClick={()=>setPanMode(v=>!v)} className={`ml-4 px-3 py-1 rounded-xl ${panMode?"bg-amber-600":"bg-slate-700"}`}>{panMode?"平移中":"啟用平移"}</button>
            <span className="ml-2 text-xs opacity-70">（滾輪縮放）</span>
          </div>
        </main>
      </div>
    </div>
  );
}

/* -------- Sub components -------- */

function Marker({ xPct, yPct, number, color, size, label, selected, offsetPx={dx:0,dy:0}, onClickMarker }) {
  const { dx, dy } = offsetPx;
  return (
    <div
      className="absolute cursor-pointer"
      onClick={(e)=>{ e.stopPropagation(); onClickMarker && onClickMarker(); }}
      style={{ left:`${xPct}%`, top:`${yPct}%`, transform:`translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))` }}
      title={label ? `${label} (${number})` : `${number}`}
    >
      {(Math.abs(dx)>1 || Math.abs(dy)>1) && (
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-white border border-black/30 shadow" />
      )}
      <div className="relative" style={{ width:size, height:size }}>
        {selected && <span className="absolute inset-0 -z-10 rounded-full bg-white/40" style={{ width:size, height:size }} />}
        <span className={`flex items-center justify-center rounded-full font-bold shadow-lg border border-white/20 ${colorClass(color)}`}
              style={{ width:size, height:size, fontSize:Math.round(size*0.45) }}>
          {number}
        </span>
        {label && <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 px-1.5 py-0.5 text-[10px] rounded bg-black/60" style={{ whiteSpace:"nowrap" }}>{label}</span>}
      </div>
    </div>
  );
}

function CoordBadge({ x, y }) {
  const { xPct, yPct } = worldToPct(x, y);
  return (
    <div className="absolute" style={{ left:`${xPct}%`, top:`${yPct}%`, transform:"translate(-50%, -140%)" }}>
      <div className="px-2 py-1 text-xs rounded bg-black/70 text-white border border-white/10 shadow">({x}, {y})</div>
      <div className="w-2 h-2 bg-white rounded-full border border-black/30 shadow" style={{ transform:"translate(-50%, 6px)" }} />
    </div>
  );
}

function Crosshair({ x, y }) {
  const { xPct, yPct } = worldToPct(x, y);
  return (
    <>
      <div className="absolute h-full w-px bg-white/30" style={{ left:`${xPct}%`, top:0 }} />
      <div className="absolute w-full h-px bg-white/30" style={{ top:`${yPct}%`, left:0 }} />
    </>
  );
}

function GridSVG({ step=1, scale }) {
  let sparsify = 1;
  if (scale < 0.9)      sparsify = 8;
  else if (scale < 1.1) sparsify = 4;
  else if (scale < 1.4) sparsify = 2;
  const inc = Math.max(1, Math.round(step * sparsify));
  const lines = [];
  for (let x=0; x<=MAP_MAX; x+=inc) {
    const { xPct } = worldToPct(x, 0);
    const major100 = x % 100 === 0, major10 = x % 10 === 0;
    const stroke = major100 ? "rgba(255,255,255,0.55)" : major10 ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.18)";
    const width  = major100 ? 2 : major10 ? 1.5 : 1;
    lines.push(<line key={`vx${x}`} x1={`${xPct}%`} y1="0%" x2={`${xPct}%`} y2="100%" stroke={stroke} strokeWidth={width} />);
  }
  for (let y=0; y<=MAP_MAX; y+=inc) {
    const { yPct } = worldToPct(0, y);
    const major100 = y % 100 === 0, major10 = y % 10 === 0;
    const stroke = major100 ? "rgba(255,255,255,0.55)" : major10 ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.18)";
    const width  = major100 ? 2 : major10 ? 1.5 : 1;
    lines.push(<line key={`hy${y}`} x1="0%" y1={`${yPct}%`} x2="100%" y2={`${yPct}%`} stroke={stroke} strokeWidth={width} />);
  }
  const { xPct: x600 } = worldToPct(600, 0);
  const { yPct: y600 } = worldToPct(0, 600);
  lines.push(<line key="vx600" x1={`${x600}%`} y1="0%" x2={`${x600}%`} y2="100%" stroke="rgba(255,255,255,0.6)" strokeWidth={2} />);
  lines.push(<line key="hy600" x1="0%" y1={`${y600}%`} x2="100%" y2={`${y600}%`} stroke="rgba(255,255,255,0.6)" strokeWidth={2} />);
  return <svg className="absolute inset-0 pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">{lines}</svg>;
}
