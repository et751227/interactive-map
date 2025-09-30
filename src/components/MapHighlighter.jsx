import React, { useEffect, useMemo, useRef, useState } from "react";

/** Interactive Grid Map with Zoom Cap (no overlap at max zoom)
 * World coords: (0,0) .. (1199,1199) square map
 */

const MAP_MAX = 1199;
const ZOOM_MIN = 0.5;
const HARD_ZOOM_MAX = 8; // 物理極限（演算法還會再動態變更上限）

// 類型與顏色（已將「都政工程站」改為「攻擊工程站」，並新增「熔爐」）
const TYPE_META = {
  建築工程站: { color: "blue" },
  採集工程站: { color: "green" },
  生產工程站: { color: "yellow" },
  研究工程站: { color: "purple" },
  攻擊工程站: { color: "orange" }, // ← rename
  訓練工程站: { color: "pink" },
  防禦工程站: { color: "red" },
  遠征工程站: { color: "teal" },
  堡壘: { color: "indigo" },
  要塞: { color: "slate" },
  雪原總部: { color: "cyan" },
  熔爐: { color: "amber" },        // ← new
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

// world ↔ percent（正方形）
const worldToPct = (x, y) => ({ xPct: (x / MAP_MAX) * 100, yPct: ((MAP_MAX - y) / MAP_MAX) * 100 });
const pctToWorld = (xPct, yPctFromTop) => ({ x: Math.round(xPct * MAP_MAX), y: Math.round((1 - yPctFromTop) * MAP_MAX) });

// 平移夾限（避免露黑邊）
function clampPan(rect, tx, ty, scale) {
  const cw = rect.width * scale, ch = rect.height * scale;
  if (scale <= 1) return { tx: (rect.width - cw) / 2, ty: (rect.height - ch) / 2 };
  const minTx = rect.width - cw, minTy = rect.height - ch;
  return { tx: Math.min(0, Math.max(minTx, tx)), ty: Math.min(0, Math.max(minTy, ty)) };
}

export default function MapHighlighter() {
  // ====== data ======
  const [markers, setMarkers] = useState([]);
  const [editMode, setEditMode] = useState(true);
  const [draftType, setDraftType] = useState("建築工程站");
  const [draftNumber, setDraftNumber] = useState(1);
  const [draftLabel, setDraftLabel] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  // ====== view ======
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [panMode, setPanMode] = useState(false);
  const drag = useRef(null);

  // 標記大小（以 scale=1 時的直徑 px 作為基準）
  const [baseMarkerPx, setBaseMarkerPx] = useState(24);
  const DIAMETER_MIN = 8;
  const DIAMETER_MAX = 48;
  const PAD_PX = 6; // 兩圓之間保留的間距

  // 格線
  const [gridStep] = useState(1);
  const [hover, setHover] = useState(null);
  const [badge, setBadge] = useState(null);

  // Jump
  const [jumpX, setJumpX] = useState("");
  const [jumpY, setJumpY] = useState("");
  const [jumpZoom, setJumpZoom] = useState("");
  const [lastJump, setLastJump] = useState(null);
  const [autoMarkOnJump, setAutoMarkOnJump] = useState(true);

  useEffect(() => {
    // 初始先放太陽城
    setMarkers([{ id: "sun", type: "雲原總部", number: 1, x: 597, y: 597, label: "太陽城" }]);
  }, []);

  // ====== helpers ======
  const rectOf = () => {
    const el = containerRef.current;
    if (!el) return { left: 0, top: 0, width: 1, height: 1 };
    return el.getBoundingClientRect();
  };

  const logicalFromEvent = (e) => {
    const rect = rectOf();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const lx = (px - tx) / scale, ly = (py - ty) / scale;
    return { rect, xPct: lx / rect.width, yPctFromTop: ly / rect.height };
  };

  const centerAt = (x, y, newScale = null) => {
    const rect = rectOf();
    const s = newScale ?? scale;
    const clampedS = Math.min(HARD_ZOOM_MAX, Math.max(ZOOM_MIN, s));
    const { xPct, yPct } = worldToPct(x, y);
    let nx = rect.width / 2 - clampedS * (xPct / 100) * rect.width;
    let ny = rect.height / 2 - clampedS * (yPct / 100) * rect.height;
    const { tx: ctx, ty: cty } = clampPan(rect, nx, ny, clampedS);
    setScale(clampedS); setTx(ctx); setTy(cty);
  };

  // 在當前縮放下，渲染用 marker 直徑
  const markerDiameterAt = (s) =>
    Math.max(DIAMETER_MIN, Math.min(DIAMETER_MAX, baseMarkerPx * s));
  const computeMarkerSize = () => Math.round(markerDiameterAt(scale));

  // ====== 動態「不重疊」最大縮放 ======
  function isScaleNonOverlapping(markersArr, rect, s) {
    if (!rect?.width || !rect?.height || markersArr.length < 2) return true;
    const need = markerDiameterAt(s) + PAD_PX; // 兩點至少要這麼遠（像素）
    for (let i = 0; i < markersArr.length; i++) {
      for (let j = i + 1; j < markersArr.length; j++) {
        const dxWorld = Math.abs(markersArr[i].x - markersArr[j].x);
        const dyWorld = Math.abs(markersArr[i].y - markersArr[j].y);
        const dWorld = Math.hypot(dxWorld, dyWorld);
        const dPx = (dWorld / MAP_MAX) * rect.width * s; // 世界距離投影成螢幕像素距離
        if (dPx < need) return false;
      }
    }
    return true;
  }
  function computeDynamicMaxScale(markersArr, rect) {
    if (!rect?.width || !rect?.height || markersArr.length < 2) return HARD_ZOOM_MAX;
    let lo = ZOOM_MIN, hi = HARD_ZOOM_MAX;
    for (let it = 0; it < 24; it++) {
      const mid = (lo + hi) / 2;
      if (isScaleNonOverlapping(markersArr, rect, mid)) lo = mid;
      else hi = mid;
    }
    return Math.max(ZOOM_MIN, Math.min(HARD_ZOOM_MAX, lo));
  }

  const rect = rectOf();
  const dynamicMaxScale = useMemo(
    () => computeDynamicMaxScale(markers, rect),
    [markers, rect.width, rect.height, baseMarkerPx]
  );

  useEffect(() => {
    if (scale > dynamicMaxScale) centerAt(MAP_MAX / 2, MAP_MAX / 2, dynamicMaxScale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dynamicMaxScale]);

  // ====== interactions ======
  const addMarkerAt = (x, y) => {
    const id = Date.now();
    setMarkers(prev => [...prev, { id, x, y, type: draftType, number: draftNumber, label: (draftLabel || "") }]);
    setBadge({ x, y });
  };

  const goToInputCoord = () => {
    const x = Math.max(0, Math.min(MAP_MAX, Number(jumpX)));
    const y = Math.max(0, Math.min(MAP_MAX, Number(jumpY)));
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    const z = jumpZoom === "" ? null : Number(jumpZoom);
    centerAt(x, y, z);
    setLastJump({ x, y });
    setBadge({ x, y });
    if (autoMarkOnJump) addMarkerAt(x, y);
  };

  const onMapClick = (e) => {
    const { xPct, yPctFromTop } = logicalFromEvent(e);
    if (Number.isNaN(xPct) || Number.isNaN(yPctFromTop)) return;
    let { x, y } = pctToWorld(xPct, yPctFromTop);
    x = Math.max(0, Math.min(MAP_MAX, x));
    y = Math.max(0, Math.min(MAP_MAX, y));
    setBadge({ x, y });
    if (!editMode) return;
    if (selectedId) setSelectedId(null);
    if (xPct < 0 || xPct > 1 || yPctFromTop < 0 || yPctFromTop > 1) return;
    addMarkerAt(x, y);
  };

  // 滾輪縮放（以滑鼠為中心），上限 = dynamicMaxScale
  const onWheel = (e) => {
    e.preventDefault();
    const { rect } = logicalFromEvent(e);
    const focusX = e.clientX - rect.left, focusY = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    let targetScale = Math.min(HARD_ZOOM_MAX, Math.max(ZOOM_MIN, scale * factor));
    targetScale = Math.min(targetScale, dynamicMaxScale); // ★ 動態上限
    const s = targetScale / scale;
    let nx = focusX - s * (focusX - tx), ny = focusY - s * (focusY - ty);
    const { tx: ctx, ty: cty } = clampPan(rect, nx, ny, targetScale);
    setScale(targetScale); setTx(ctx); setTy(cty);
  };

  // 平移（開啟平移後，按左鍵拖曳）
  const onMouseDown = (e) => {
    if (!panMode) return;
    drag.current = { sx: e.clientX, sy: e.clientY, tx0: tx, ty0: ty };
  };
  const onMouseMove = (e) => {
    if (drag.current) {
      const { rect } = logicalFromEvent(e);
      const dx = e.clientX - drag.current.sx, dy = e.clientY - drag.current.sy;
      const { tx: ctx, ty: cty } = clampPan(rect, drag.current.tx0 + dx, drag.current.ty0 + dy, scale);
      setTx(ctx); setTy(cty); return;
    }
    const { xPct, yPctFromTop } = logicalFromEvent(e);
    if (Number.isNaN(xPct)) return;
    let { x, y } = pctToWorld(xPct, yPctFromTop);
    setHover({ x, y });
  };
  const endDrag = () => (drag.current = null);

  // 刪除選取
  const deleteSelected = () => {
    if (!selectedId) return;
    setMarkers(prev => prev.filter(m => m.id !== selectedId));
    setSelectedId(null);
  };

  // 匯入/匯出
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(markers, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: "markers.json" });
    a.click(); URL.revokeObjectURL(url);
  };
  const importJson = (file) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const arr = JSON.parse(r.result);
        if (Array.isArray(arr)) setMarkers(arr.map(m => ({ label: "", ...m })));
      } catch {}
    };
    r.readAsText(file);
  };

  // ====== render ======
  return (
    <div className="min-h-screen w-full bg-slate-900 text-slate-100 p-6">
      <div className="mx-auto max-w-6xl grid grid-cols-12 gap-6">
        {/* Sidebar */}
        <aside className="col-span-12 md:col-span-3 space-y-4">
          {/* 前往座標 */}
          <div className="p-3 rounded-2xl bg-slate-800/70 space-y-2">
            <div className="text-sm font-medium">前往座標</div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <label className="block text-xs opacity-80 mb-1">X</label>
                <input type="number" min={0} max={MAP_MAX} value={jumpX} onChange={(e)=>setJumpX(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter') goToInputCoord();}} className="w-full bg-slate-700 rounded-xl px-3 py-2" placeholder="0-1199" />
              </div>
              <div>
                <label className="block text-xs opacity-80 mb-1">Y</label>
                <input type="number" min={0} max={MAP_MAX} value={jumpY} onChange={(e)=>setJumpY(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter') goToInputCoord();}} className="w-full bg-slate-700 rounded-xl px-3 py-2" placeholder="0-1199" />
              </div>
              <div>
                <label className="block text-xs opacity-80 mb-1">縮放(可空)</label>
                <input type="number" step="0.1" min={ZOOM_MIN} max={HARD_ZOOM_MAX} value={jumpZoom} onChange={(e)=>setJumpZoom(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter') goToInputCoord();}} className="w-full bg-slate-700 rounded-xl px-3 py-2" placeholder="1~8" />
              </div>
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

          {/* 編輯區 */}
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
              <button onClick={exportJson} className="flex-1 bg-slate-700 hover:bg-slate-600 rounded-xl px-3 py-2">匯出JSON</button>
              <label className="flex-1 bg-slate-700 hover:bg-slate-600 rounded-xl px-3 py-2 text-center cursor-pointer">匯入JSON
                <input type="file" accept="application/json" className="hidden" onChange={(e)=>{const f=e.target.files?.[0]; if(f) importJson(f);}}/>
              </label>
            </div>
            {selectedId && (
              <div className="pt-2 border-t border-white/10 space-y-2">
                <div className="text-xs opacity-80">正在編輯節點：{selectedId}</div>
                <div className="flex gap-2">
                  <button onClick={deleteSelected} className="flex-1 bg-red-600 hover:bg-red-500 rounded-xl px-3 py-2">刪除節點</button>
                </div>
              </div>
            )}
          </div>

          {/* 標記大小（控制最大縮放） */}
          <div className="p-3 rounded-2xl bg-slate-800/70 space-y-2">
            <div className="text-sm font-medium">標記大小（直徑）</div>
            <input type="range" min="10" max="40" step="1"
              value={baseMarkerPx}
              onChange={(e)=>setBaseMarkerPx(parseInt(e.target.value || "24"))}
              className="w-full" />
            <div className="text-xs opacity-70">scale=1 時直徑：{baseMarkerPx}px。會自動限制最大縮放以避免重疊。</div>
          </div>
        </aside>

        {/* Map */}
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
            <div className="absolute inset-0" style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})`, transformOrigin: "0 0" }}>
              {/* grid */}
              <GridSVG step={gridStep} scale={scale} />
              {/* crosshair + badge */}
              {hover && <Crosshair x={hover.x} y={hover.y} />}
              {badge && <CoordBadge x={badge.x} y={badge.y} />}

              {/* markers */}
              {markers.map(m => {
                const { xPct, yPct } = worldToPct(m.x, m.y);
                const meta = TYPE_META[m.type] || { color: "gray" };
                const size = computeMarkerSize();
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

          <div className="mt-3 text-sm opacity-80">
            {editMode ? <span className="mr-3">🛠️ 編輯模式：點地圖可新增節點</span> : <span className="mr-3">檢視模式</span>}
            {badge && <span>最近座標：<b>({badge.x}, {badge.y})</b></span>}
            <button onClick={()=>setPanMode(v=>!v)} className={`ml-4 px-3 py-1 rounded-xl ${panMode?"bg-amber-600":"bg-slate-700"}`}>{panMode?"平移中":"啟用平移"}</button>
            <span className="ml-2 text-xs opacity-70">（滾輪縮放；最大縮放已依標記大小自動限制，確保不重疊）</span>
          </div>
        </main>
      </div>
    </div>
  );
}

/* ---------- Sub components ---------- */

function Marker({ xPct, yPct, number, color, size, label, selected, onClickMarker }) {
  return (
    <div
      className="absolute cursor-pointer"
      onClick={(e) => { e.stopPropagation(); onClickMarker && onClickMarker(); }}
      style={{ left: `${xPct}%`, top: `${yPct}%`, transform: "translate(-50%, -50%)" }}
      title={label ? `${label} (${number})` : `${number}`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        {selected && (
          <span className="absolute inset-0 -z-10 rounded-full bg-white/40" style={{ width: size, height: size }} />
        )}
        <span
          className={`flex items-center justify-center rounded-full font-bold shadow-lg border border-white/20 ${colorClass(color)}`}
          style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
        >
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
      <div className="absolute h-full w-px bg-white/30" style={{ left: `${xPct}%`, top: 0 }} />
      <div className="absolute w-full h-px bg-white/30" style={{ top: `${yPct}%`, left: 0 }} />
    </>
  );
}

/** GridSVG – step=1 by default; auto sparsify for performance */
function GridSVG({ step = 1, scale }) {
  let sparsify = 1;
  if (scale < 0.9)      sparsify = 8;
  else if (scale < 1.1) sparsify = 4;
  else if (scale < 1.4) sparsify = 2;

  const inc = Math.max(1, Math.round(step * sparsify));
  const lines = [];

  for (let x = 0; x <= MAP_MAX; x += inc) {
    const { xPct } = worldToPct(x, 0);
    const major100 = x % 100 === 0, major10 = x % 10 === 0;
    const stroke = major100 ? "rgba(255,255,255,0.55)" : major10 ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.18)";
    const width  = major100 ? 2 : major10 ? 1.5 : 1;
    lines.push(<line key={`vx${x}`} x1={`${xPct}%`} y1="0%" x2={`${xPct}%`} y2="100%" stroke={stroke} strokeWidth={width} />);
  }
  for (let y = 0; y <= MAP_MAX; y += inc) {
    const { yPct } = worldToPct(0, y);
    const major100 = y % 100 === 0, major10 = y % 10 === 0;
    const stroke = major100 ? "rgba(255,255,255,0.55)" : major10 ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.18)";
    const width  = major100 ? 2 : major10 ? 1.5 : 1;
    lines.push(<line key={`hy${y}`} x1="0%" y1={`${yPct}%`} x2="100%" y2={`${yPct}%`} stroke={stroke} strokeWidth={width} />);
  }

  // 中心參考線（600）
  const { xPct: x600 } = worldToPct(600, 0);
  const { yPct: y600 } = worldToPct(0, 600);
  lines.push(<line key="vx600" x1={`${x600}%`} y1="0%" x2={`${x600}%`} y2="100%" stroke="rgba(255,255,255,0.6)" strokeWidth={2} />);
  lines.push(<line key="hy600" x1="0%" y1={`${y600}%`} x2="100%" y2={`${y600}%`} stroke="rgba(255,255,255,0.6)" strokeWidth={2} />);

  return <svg className="absolute inset-0 pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">{lines}</svg>;
}
