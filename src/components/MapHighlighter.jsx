import React, { useMemo, useState, useEffect } from "react";

/**
 * 互動地圖（GitHub + Vercel 友善版）
 * - 預設背景：/custom_map_1200_suncity.png（放 public/ 目錄）
 * - 預設標記：/markers_suncity.json（放 public/ 目錄）
 * - 座標系統：世界座標（左下為原點），範圍 0..1199
 * - 編輯模式：
 *    - 點地圖新增節點（使用「類型+數字」草稿）
 *    - 點一下節點＝選取；再次點同節點＝刪除
 *    - 可修改選取節點的類型/數字並套用
 * - 左上為動態圖例（依目前資料自動產生 (type, number)）
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
    case "blue":   return "bg-blue-500 text-white";
    case "green":  return "bg-green-500 text-white";
    case "yellow": return "bg-yellow-400 text-black";
    case "purple": return "bg-purple-500 text-white";
    case "orange": return "bg-orange-500 text-white";
    case "pink":   return "bg-pink-500 text-white";
    case "red":    return "bg-red-500 text-white";
    case "teal":   return "bg-teal-500 text-white";
    case "indigo": return "bg-indigo-500 text-white";
    case "slate":  return "bg-slate-500 text-white";
    case "cyan":   return "bg-cyan-500 text-black";
    default:       return "bg-gray-500 text-white";
  }
};

// 世界座標 轉 畫面百分比（定位用，因為 <img> 用的是左上原點）
const worldToPct = (x, y) => ({
  xPct: (x / MAP_MAX) * 100,
  yPct: ((MAP_MAX - y) / MAP_MAX) * 100, // 反轉 Y
});

// 畫面百分比 轉 世界座標
const pctToWorld = (xPct, yPctFromTop) => ({
  x: Math.round(xPct * MAP_MAX),
  y: Math.round((1 - yPctFromTop) * MAP_MAX),
});

export default function MapHighlighter() {
  // 預設直接載入 public/ 的地圖
  const [bgUrl, setBgUrl] = useState("/custom_map_1200_suncity.png");
  const [markers, setMarkers] = useState([]); // 會在 useEffect 載入 JSON
  const [filter, setFilter] = useState(null); // { type, number } | null
  const [editMode, setEditMode] = useState(false);
  const [draftType, setDraftType] = useState("建築工程站");
  const [draftNumber, setDraftNumber] = useState(1);
  const [selectedId, setSelectedId] = useState(null);

  // 啟動時嘗試載入 public/markers_suncity.json
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/markers_suncity.json");
        if (res.ok) {
          const arr = await res.json();
          if (Array.isArray(arr) && arr.length) {
            setMarkers(arr);
            return;
          }
        }
      } catch {}
      // 若沒有 JSON，就至少放上太陽城
      setMarkers([{ id: "sun_city", type: "雪原總部", number: 1, x: 597, y: 597, label: "太陽城" }]);
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!filter) return markers;
    return markers.filter((m) => m.type === filter.type && m.number === filter.number);
  }, [filter, markers]);

  // 動態圖例需要：type -> Set(numbers)
  const combos = useMemo(() => {
    const map = new Map();
    for (const m of markers) {
      if (!map.has(m.type)) map.set(m.type, new Set());
      map.get(m.type).add(m.number);
    }
    return map;
  }, [markers]);

  const onMapClick = (e) => {
    if (!editMode) return;
    if (selectedId) setSelectedId(null);

    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = (e.clientX - rect.left) / rect.width;
    const yPctFromTop = (e.clientY - rect.top) / rect.height;

    const { x, y } = pctToWorld(xPct, yPctFromTop);
    setMarkers((prev) => [
      ...prev,
      { id: Date.now(), x, y, type: draftType, number: draftNumber },
    ]);
  };

  const applyToSelected = () => {
    if (!selectedId) return;
    setMarkers((prev) =>
      prev.map((m) =>
        m.id === selectedId ? { ...m, type: draftType, number: draftNumber } : m
      )
    );
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setMarkers((prev) => prev.filter((m) => m.id !== selectedId));
    setSelectedId(null);
  };

  const exportJson = () => {
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(markers, null, 2));
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
      } catch (e) {
        console.error(e);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen w-full bg-slate-900 text-slate-100 p-6">
      <div className="mx-auto max-w-6xl grid grid-cols-12 gap-6">
        {/* 側邊圖例 */}
        <aside className="col-span-12 md:col-span-3">
          <h2 className="text-xl font-semibold mb-3">圖例（Legend）</h2>

          <div className="space-y-2">
            {/* 動態圖例（依目前資料自動產生） */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm opacity-80">點圖例可過濾；按「全部顯示」清除</span>
              <button
                onClick={() => setFilter(null)}
                className="rounded-xl px-3 py-1 bg-slate-700 hover:bg-slate-600"
              >
                全部顯示
              </button>
            </div>

            <div className="space-y-3">
              {[...combos.keys()].map((type) => {
                const color = TYPE_META[type]?.color || "gray";
                const numbers = [...combos.get(type)].sort((a, b) => a - b);
                return (
                  <div key={type} className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm w-28 truncate" title={type}>
                      {type}
                    </span>
                    {numbers.map((num) => (
                      <button
                        key={num}
                        onClick={() => setFilter({ type, number: num })}
                        className="flex items-center gap-2 rounded-2xl px-2 py-1 bg-slate-800 hover:bg-slate-700 shadow"
                        title={`只顯示：${type}（${num}）`}
                      >
                        <span
                          className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${colorClass(
                            color
                          )} font-bold text-sm`}
                        >
                          {num}
                        </span>
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
                <button
                  onClick={() => setEditMode((v) => !v)}
                  className={`px-3 py-1 rounded-xl ${
                    editMode ? "bg-emerald-500" : "bg-slate-600"
                  }`}
                >
                  {editMode ? "開啟" : "關閉"}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <select
                  value={draftType}
                  onChange={(e) => setDraftType(e.target.value)}
                  className="col-span-2 bg-slate-700 rounded-xl px-3 py-2"
                >
                  {Object.keys(TYPE_META).map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <label className="col-span-1 self-center">數字</label>
                <input
                  type="number"
                  min={0}
                  max={9}
                  value={draftNumber}
                  onChange={(e) =>
                    setDraftNumber(parseInt(e.target.value || "0"))
                  }
                  className="col-span-1 bg-slate-700 rounded-xl px-3 py-2"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={exportJson}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 rounded-xl px-3 py-2"
                >
                  匯出JSON
                </button>
                <label className="flex-1 bg-slate-700 hover:bg-slate-600 rounded-xl px-3 py-2 text-center cursor-pointer">
                  匯入JSON
                  <input
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) importJson(f);
                    }}
                  />
                </label>
              </div>

              {selectedId && (
                <div className="pt-2 border-t border-white/10 space-y-2">
                  <div className="text-xs opacity-80">正在編輯節點：{selectedId}</div>
                  <div className="flex gap-2">
                    <button
                      onClick={applyToSelected}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 rounded-xl px-3 py-2"
                    >
                      套用至選取節點
                    </button>
                    <button
                      onClick={deleteSelected}
                      className="flex-1 bg-red-600 hover:bg-red-500 rounded-xl px-3 py-2"
                    >
                      刪除節點
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 圖片上傳（可覆蓋預設背景） */}
            <div className="mt-4">
              <label className="block text-sm opacity-80 mb-2">選擇地圖圖片</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const url = URL.createObjectURL(f);
                  setBgUrl(url);
                }}
                className="block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:bg-slate-600 file:text-white hover:file:bg-slate-500"
              />
              <p className="text-xs opacity-70 mt-2 leading-5">
                座標採 <b>世界座標</b> 0..1199（左下為原點）。編輯模式下點地圖會自動換算。
              </p>
            </div>
          </div>
        </aside>

        {/* 地圖區 */}
        <main className="col-span-12 md:col-span-9">
          <div
            className="relative w-full aspect-[1.0] md:aspect-[1.2] lg:aspect-[1.4] xl:aspect-[1.6] overflow-hidden rounded-3xl bg-slate-800 shadow-lg"
            onClick={onMapClick}
          >
            {bgUrl ? (
              <img
                src={bgUrl}
                alt="map"
                className="absolute inset-0 w-full h-full object-contain bg-slate-900"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-slate-300">
                請於左側上傳地圖圖片（或使用預設 public/custom_map_1200_suncity.png）
              </div>
            )}

            {filtered.map((m) => {
              const { xPct, yPct } = worldToPct(m.x, m.y);
              const meta = TYPE_META[m.type] || { color: "gray" };
              const isHL =
                !!filter &&
                m.type === filter.type &&
                m.number === filter.number;

              return (
                <Marker
                  key={m.id}
                  x={xPct}
                  y={yPct}
                  number={m.number}
                  color={meta.color}
                  highlight={isHL}
                  selected={selectedId === m.id}
                  onClickMarker={() => {
                    if (!editMode) return;
                    if (selectedId === m.id) {
                      // 再點同節點 → 刪除
                      setMarkers((prev) => prev.filter((x) => x.id !== m.id));
                      setSelectedId(null);
                      return;
                    }
                    // 第一次點 → 選取並帶入草稿
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
              <span>
                篩選：<b>{filter.type}（{filter.number}）</b>，其餘已隱藏。
              </span>
            ) : (
              <span>顯示全部標記。</span>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/* ====== 標記元件 ====== */
function Marker({ x, y, number, color, highlight, selected, onClickMarker }) {
  return (
    <div
      className="absolute cursor-pointer"
      onClick={(e) => { e.stopPropagation(); onClickMarker && onClickMarker(); }}
      style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
    >
      <div className="relative">
        {(highlight || selected) && (
          <span
            className={`absolute inset-0 -z-10 ${
              selected ? "animate-none" : "animate-ping"
            } rounded-full w-9 h-9 ${
              selected ? "bg-white/40" : "bg-blue-400/50"
            }`}
          />
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
