import React, { useMemo, useState } from "react";

// 互動地圖：點擊「建築工程站」時，高亮所有藍色 1，其他隱藏
// 👉 使用方式：
// 1) 可按「選擇地圖圖片」載入你要的地圖圖檔（jpg/png）。
// 2) 點擊左側圖例「建築工程站」→ 只顯示藍色 1；
//    點「全部顯示」→ 顯示全部標記。
// 3) 你可在 markers 陣列中新增/編輯節點（x/y 為百分比座標，0~100）。

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
    case "blue":
      return "bg-blue-500 text-white";
    case "green":
      return "bg-green-500 text-white";
    case "yellow":
      return "bg-yellow-400 text-black";
    case "purple":
      return "bg-purple-500 text-white";
    case "orange":
      return "bg-orange-500 text-white";
    case "pink":
      return "bg-pink-500 text-white";
    case "red":
      return "bg-red-500 text-white";
    case "teal":
      return "bg-teal-500 text-white";
    case "indigo":
      return "bg-indigo-500 text-white";
    case "slate":
      return "bg-slate-500 text-white";
    case "cyan":
      return "bg-cyan-500 text-black";
    default:
      return "bg-gray-500 text-white";
  }
};

// 範例標記：可直接換成你自己資料（type 使用 TYPE_META 的 key）
const DEFAULT_MARKERS = [
  { id: 1, x: 18, y: 20, type: "建築工程站", number: 1 }, // 藍 1
  { id: 2, x: 30, y: 28, type: "建築工程站", number: 1 }, // 藍 1
  { id: 3, x: 40, y: 35, type: "研究工程站", number: 4 },
  { id: 4, x: 54, y: 33, type: "防禦工程站", number: 2 },
  { id: 5, x: 62, y: 46, type: "建築工程站", number: 1 }, // 藍 1
  { id: 6, x: 44, y: 62, type: "採集工程站", number: 2 },
  { id: 7, x: 72, y: 64, type: "生產工程站", number: 3 },
  { id: 8, x: 80, y: 22, type: "都政工程站", number: 1 },
  { id: 9, x: 25, y: 74, type: "訓練工程站", number: 3 },
  { id: 10, x: 12, y: 60, type: "遠征工程站", number: 1 },
];

export default function MapHighlighter () {
  const [bgUrl, setBgUrl] = useState("");
  const [markers, setMarkers] = useState(DEFAULT_MARKERS);
  const [filter, setFilter] = useState(null); // { type: string, number: number } | null
  const [editMode, setEditMode] = useState(false);
  const [draftType, setDraftType] = useState("建築工程站");
  const [draftNumber, setDraftNumber] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  // 變焦/平移狀態
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0); // translateX (px)
  const [ty, setTy] = useState(0); // translateY (px)
  const [panMode, setPanMode] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({x:0,y:0});
  const [originStart, setOriginStart] = useState({tx:0,ty:0});

  const filtered = useMemo(() => {
    if (!filter) return markers;
    return markers.filter((m) => m.type === filter.type && m.number === filter.number);
  }, [filter, markers]);

  // 供動態圖例使用：彙整目前資料中存在的 (type, number)
  const combos = useMemo(() => {
    const map = new Map();
    for (const m of markers) {
      if (!map.has(m.type)) map.set(m.type, new Set());
      map.get(m.type).add(m.number);
    }
    return map; // Map<type, Set<number>>
  }, [markers]);

  const onMapClick = (e) => {
    if (panMode) return; // 平移模式不新增
    if (!editMode) return;
    if (selectedId) setSelectedId(null);

    const rect = e.currentTarget.getBoundingClientRect();
    // 取得滑鼠相對容器座標（px）
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    // 反算變換前的座標
    const lx = (px - tx) / scale; // logical x in px of 原圖
    const ly = (py - ty) / scale; // logical y in px
    const xPct = (lx / rect.width) * 100;
    const yPct = (ly / rect.height) * 100;
    if (xPct < 0 || xPct > 100 || yPct < 0 || yPct > 100) return;

    setMarkers((prev) => [
      ...prev,
      { id: Date.now(), x: +xPct.toFixed(2), y: +yPct.toFixed(2), type: draftType, number: draftNumber },
    ]);
  };

  // 滾輪縮放（以滑鼠位置為焦點）
  const onWheel = (e) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const focusX = e.clientX - rect.left;
    const focusY = e.clientY - rect.top;
    const delta = -e.deltaY; // 上正下負
    const factor = Math.exp(delta * 0.0015); // 平滑縮放
    const newScale = Math.min(6, Math.max(0.5, scale * factor));
    const s = newScale / scale;
    // 調整平移，保持焦點不動
    const newTx = focusX - s * (focusX - tx);
    const newTy = focusY - s * (focusY - ty);
    setScale(newScale);
    setTx(newTx);
    setTy(newTy);
  };

  const onMouseDown = (e) => {
    if (!panMode) return;
    setDragging(true);
    setDragStart({x: e.clientX, y: e.clientY});
    setOriginStart({tx, ty});
  };
  const onMouseMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    setTx(originStart.tx + dx);
    setTy(originStart.ty + dy);
  };
  const onMouseUp = () => setDragging(false);
  const resetView = () => { setScale(1); setTx(0); setTy(0); };

  const applyToSelected = () => {
    if (!selectedId) return;
    setMarkers(prev => prev.map(m => m.id === selectedId ? { ...m, type: draftType, number: draftNumber } : m));
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setMarkers(prev => prev.filter(m => m.id !== selectedId));
    setSelectedId(null);
  };

  const exportJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(markers, null, 2));
    const a = document.createElement("a");
    a.href = dataStr;
    a.download = "markers.json";
    a.click();
  };

  const importJson = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const arr = JSON.parse(reader.result);
        if (Array.isArray(arr)) setMarkers(arr);
      } catch (e) { console.error(e); }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen w-full bg-slate-900 text-slate-100 p-6">
      <div className="mx-auto max-w-6xl grid grid-cols-12 gap-6">
        {/* 側邊圖例 */}
        <aside className="col-span-12 md:col-span-3">
          <h2 className="text-xl font-semibold mb-3">圖例（Legend）</h2>
          <div className="flex items-center gap-2 mb-4">
            <button onClick={() => setPanMode(v=>!v)} className={`rounded-xl px-3 py-1 ${panMode?"bg-amber-600":"bg-slate-700"}`}>{panMode?"平移中":"啟用平移"}</button>
            <button onClick={() => {setScale(s=>Math.min(6,s*1.2));}} className="rounded-xl px-3 py-1 bg-slate-700">放大</button>
            <button onClick={() => {setScale(s=>Math.max(0.5,s/1.2));}} className="rounded-xl px-3 py-1 bg-slate-700">縮小</button>
            <button onClick={resetView} className="rounded-xl px-3 py-1 bg-slate-700">重置</button>
          </div>
          <div className="space-y-2">
            {/* 動態圖例：依目前 markers 產生類型與數字。新節點建立後會自動出現。 */}
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
                      <button key={num} onClick={() => setFilter({ type, number: num })} className="flex items-center gap-2 rounded-2xl px-2 py-1 bg-slate-800 hover:bg-slate-700 shadow" title={`只顯示：${type}（${num}）`}>
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
                <label className="flex-1 bg-slate-700 hover:bg-slate-600 rounded-xl px-3 py-2 text-center cursor-pointer">
                  匯入JSON
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
              <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const url = URL.createObjectURL(f); setBgUrl(url); }} className="block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:bg-slate-600 file:text-white hover:file:bg-slate-500" />
              <p className="text-xs opacity-70 mt-2 leading-5">小技巧：開啟「編輯模式」後，直接在地圖上點擊即可新增一個節點（依下方選擇的類型/數字）。</p>
            </div>
          </div>
        </aside>

        {/* 地圖區 */}
        <main className="col-span-12 md:col-span-9">
          <div className="relative w-full aspect-[1.6] overflow-hidden rounded-3xl bg-slate-800 shadow-lg overscroll-contain"
            onClick={onMapClick}
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          >
            <div className="absolute inset-0" style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})`, transformOrigin: "0 0" }}>
              {bgUrl ? (
                <img src={bgUrl} alt="map" className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-slate-300">
                  請於左側上傳地圖圖片（你也可以先下載我提供的地圖並上傳）
                </div>
              )}

              {filtered.map((m) => {
                const meta = TYPE_META[m.type] || { color: "gray" };
                return (
                  <Marker
                    key={m.id}
                    x={m.x}
                    y={m.y}
                    number={m.number}
                    color={meta.color}
                    highlight={!!filter && m.type===filter.type && m.number===filter.number}
                    selected={selectedId===m.id}
                    onClickMarker={() => {
                      if (!editMode) return;
                      if (selectedId === m.id) {
                        // 再次點擊同節點 → 移除
                        setMarkers(prev => prev.filter(x => x.id !== m.id));
                        setSelectedId(null);
                        return;
                      }
                      // 第一次點擊 → 選取並將草稿同步為該節點的類型/數字，方便編輯
                      setSelectedId(m.id);
                      setDraftType(m.type);
                      setDraftNumber(m.number);
                    }}
                  />
                );
              })}
            </div>
            {filtered.map((m) => {
              const meta = TYPE_META[m.type] || { color: "gray" };
              return (
                <Marker
                  key={m.id}
                  x={m.x}
                  y={m.y}
                  number={m.number}
                  color={meta.color}
                  highlight={!!filter && m.type===filter.type && m.number===filter.number}
                  selected={selectedId===m.id}
                  onClickMarker={() => {
                    if (!editMode) return;
                    if (selectedId === m.id) {
                      // 再次點擊同節點 → 移除
                      setMarkers(prev => prev.filter(x => x.id !== m.id));
                      setSelectedId(null);
                      return;
                    }
                    // 第一次點擊 → 選取並將草稿同步為該節點的類型/數字，方便編輯
                    setSelectedId(m.id);
                    setDraftType(m.type);
                    setDraftNumber(m.number);
                  }}
                />
              );
            })}
          </div>
          <div className="mt-4 text-sm opacity-80">
            {editMode && <span className="mr-3">🛠️ 編輯模式：點地圖可新增節點。</span>}
            {filter ? (
              <span>篩選：<b>{filter.type}（{filter.number}）</b>，其餘已隱藏。</span>
            ) : (
              <span>顯示全部標記。</span>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// ========= 新增：標記元件（修正 Marker is not defined） =========
function Marker({ x, y, number, color, highlight, selected, onClickMarker }) {
  return (
    <div
      className="absolute cursor-pointer"
      onClick={(e)=>{ e.stopPropagation(); onClickMarker && onClickMarker(); }}
      style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
    >
      <div className="relative">
        {(highlight || selected) && (
          <span className={`absolute inset-0 -z-10 ${selected?"animate-none":"animate-ping"} rounded-full w-9 h-9 ${selected?"bg-white/40":"bg-blue-400/50"}`} />
        )}
        <span
          className={
            "flex items-center justify-center w-9 h-9 rounded-full text-base font-bold shadow-lg border border-white/20 " +
            colorClass(color)
          }
        >
          {number}
        </span>
      </div>
    </div>
  );
}
