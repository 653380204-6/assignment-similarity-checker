"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { useRouter } from "next/navigation";
import {
  Loader2,
  AlertCircle,
  Maximize2,
  X,
  Undo2,
  RefreshCw,
} from "lucide-react";
import { useAuthGuard } from "@/lib/useAuthGuard";
import ClusterDendrogram from "@/components/ClusterDendrogram";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  LineChart,
  Line,
} from "recharts";

type CompareItem = {
  doc_1: string;
  doc_2: string;
  combined_score?: number;
  final_score?: number;
};

type SuggestedThresholds = {
  p_loose: number;
  p_mid: number;
  p_strict: number;
  loose: number;
  mid: number;
  strict: number;
};

type DocItem = {
  doc_id: string;
  file_name?: string;
};

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function getScore(p: { combined_score?: number; final_score?: number }) {
  const v = p.final_score ?? p.combined_score ?? 0;
  return clamp01(Number(v) || 0);
}

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;

  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function buildSuggestedThresholds(
  scores: number[],
): SuggestedThresholds | null {
  const clean = [...scores]
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);

  if (!clean.length) return null;

  const p_loose = 0.8;
  const p_mid = 0.9;
  const p_strict = 0.95;

  return {
    p_loose,
    p_mid,
    p_strict,
    loose: Number(clamp01(quantile(clean, p_loose)).toFixed(2)),
    mid: Number(clamp01(quantile(clean, p_mid)).toFixed(2)),
    strict: Number(clamp01(quantile(clean, p_strict)).toFixed(2)),
  };
}

type SweepPoint = {
  threshold: number;
  passedPairs: number;
  groupCount: number;
  clusteredDocCount: number;
  singletonCount: number;
};

function getAllDocIds(documents: DocItem[], pairs: CompareItem[]) {
  if (documents.length > 0) {
    return documents.map((d) => d.doc_id);
  }

  const set = new Set<string>();
  for (const p of pairs) {
    set.add(p.doc_1);
    set.add(p.doc_2);
  }
  return Array.from(set);
}

function buildSingleLinkageStats(
  documents: DocItem[],
  pairs: CompareItem[],
  threshold: number,
): SweepPoint {
  const docIds = getAllDocIds(documents, pairs);

  const adj = new Map<string, Set<string>>();
  for (const id of docIds) {
    adj.set(id, new Set<string>());
  }

  let passedPairs = 0;

  for (const p of pairs) {
    const s = getScore(p);
    if (s >= threshold) {
      passedPairs += 1;

      if (!adj.has(p.doc_1)) adj.set(p.doc_1, new Set<string>());
      if (!adj.has(p.doc_2)) adj.set(p.doc_2, new Set<string>());

      adj.get(p.doc_1)!.add(p.doc_2);
      adj.get(p.doc_2)!.add(p.doc_1);
    }
  }

  const visited = new Set<string>();
  const groupSizes: number[] = [];

  for (const id of adj.keys()) {
    if (visited.has(id)) continue;

    const stack = [id];
    visited.add(id);

    let size = 0;

    while (stack.length > 0) {
      const cur = stack.pop()!;
      size += 1;

      for (const next of adj.get(cur) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }

    groupSizes.push(size);
  }

  const realGroups = groupSizes.filter((x) => x >= 2);
  const singletonCount = groupSizes.filter((x) => x === 1).length;
  const clusteredDocCount = realGroups.reduce((sum, size) => sum + size, 0);

  return {
    threshold: Number(threshold.toFixed(2)),
    passedPairs,
    groupCount: realGroups.length,
    clusteredDocCount,
    singletonCount,
  };
}

export default function AnalysisPage() {
  const authReady = useAuthGuard("/login");

  const [batchId, setBatchId] = useState<string | null>(null);

  const [pairs, setPairs] = useState<CompareItem[]>([]);
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [dendro, setDendro] = useState<any | null>(null);

  const [threshold, setThreshold] = useState<number>(0.8);
  const [thresholdInput, setThresholdInput] = useState<string>("0.80");
  const [loadingPairs, setLoadingPairs] = useState(false);
  const [loadingDendro, setLoadingDendro] = useState(false);

  const [isDendroModalOpen, setIsDendroModalOpen] = useState(false);

  const [selectedPreset, setSelectedPreset] = useState<
    "loose" | "mid" | "strict" | null
  >(null);

  const [didInitThreshold, setDidInitThreshold] = useState(false);

  const compareCacheKey = (b: string) => `compare_cache:${b}`;

  const loadCompareCache = (b: string) => {
    const raw = sessionStorage.getItem(compareCacheKey(b));
    if (!raw) return null;
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : null;
    } catch {
      return null;
    }
  };

  const saveCompareCache = (b: string, data: CompareItem[]) => {
    sessionStorage.setItem(compareCacheKey(b), JSON.stringify(data));
    sessionStorage.setItem("last_compare_batch_id", b);
    sessionStorage.setItem("last_compare_results", JSON.stringify(data));
  };

  useEffect(() => {
    const b = sessionStorage.getItem("last_batch_id");
    if (!b) {
      console.warn("ไม่พบ last_batch_id ใน sessionStorage");
    }
    setBatchId(b || null);

    const cachedPairs = b ? loadCompareCache(b) : null;
    if (cachedPairs) {
      setPairs(cachedPairs);
    } else {
      const saved = sessionStorage.getItem("last_compare_results");
      if (saved) {
        try {
          const arr = JSON.parse(saved);
          if (Array.isArray(arr)) setPairs(arr);
        } catch {}
      }
    }
  }, []);

  useEffect(() => {
    if (!batchId) {
      setDocuments([]);
      return;
    }

    api
      .get<DocItem[]>("/documents", {
        params: { batch_id: batchId },
      })
      .then((res) => setDocuments(Array.isArray(res.data) ? res.data : []))
      .catch(() => {
        setDocuments([]);
      });
  }, [batchId]);

  const loadPairs = useCallback(
    async (force = false) => {
      if (!batchId) {
        alert("ไม่พบชุดงาน กรุณาไปหน้า Dashboard ก่อน");
        return;
      }

      if (!force) {
        const cached = loadCompareCache(batchId);
        if (cached && cached.length > 0) {
          setPairs(cached);
          return;
        }
      }

      setLoadingPairs(true);
      try {
        const res = await api.get<CompareItem[]>("/compare", {
          params: { batch_id: batchId },
        });

        const data = Array.isArray(res.data) ? res.data : [];
        setPairs(data);
        saveCompareCache(batchId, data);

        if (data.length === 0) {
          alert("ไม่พบผลการเปรียบเทียบของชุดนี้");
        }
      } catch (e: any) {
        if (e?.response?.status === 401) return;
        alert(e?.response?.data?.detail || "ดึงผลเปรียบเทียบไม่สำเร็จ");
      } finally {
        setLoadingPairs(false);
      }
    },
    [batchId],
  );

  useEffect(() => {
    if (!batchId) return;
    if (pairs.length > 0) return;
    loadPairs();
  }, [batchId, pairs.length, loadPairs]);

  const scores = useMemo(
    () => pairs.map(getScore).filter((x) => Number.isFinite(x)),
    [pairs],
  );

  const suggested = useMemo(() => buildSuggestedThresholds(scores), [scores]);

  useEffect(() => {
    setDidInitThreshold(false);
    setSelectedPreset(null);
  }, [batchId]);

  useEffect(() => {
    if (!suggested || didInitThreshold) return;

    const v = Number(suggested.mid.toFixed(2));
    setThreshold(v);
    setThresholdInput(v.toFixed(2));
    setSelectedPreset("mid");
    setDidInitThreshold(true);
  }, [suggested, didInitThreshold]);

  const displayDocName = (docId: string) => {
    const found = documents.find((d) => d.doc_id === docId);
    return found?.file_name || docId;
  };

  const loadDendrogram = useCallback(async () => {
    if (!pairs.length || !documents.length) return;

    setLoadingDendro(true);
    try {
      const body = {
        doc_ids: documents.map((d) => d.doc_id),
        method: "single",
        pairs: pairs.map((p) => ({
          doc_1: p.doc_1,
          doc_2: p.doc_2,
          final_score: getScore(p),
        })),
      };

      const res = await api.post("/dendrogram", body);
      setDendro(res.data);
    } catch (err: any) {
      if (err?.response?.status === 401) return;
      console.error("loadDendrogram error:", err);
      setDendro(null);
    } finally {
      setLoadingDendro(false);
    }
  }, [pairs, documents]);

  useEffect(() => {
    if (pairs.length > 0 && documents.length > 0) {
      loadDendrogram();
    }
  }, [pairs, documents, loadDendrogram]);

  const safeSetThreshold = (raw: string) => {
    setThresholdInput(raw);
    setSelectedPreset(null);

    const v = parseFloat(raw);
    if (Number.isFinite(v)) {
      const clamped = Math.max(0, Math.min(1, v));
      setThreshold(clamped);
    }
  };

  const normalizeThresholdInput = () => {
    const v = parseFloat(thresholdInput);

    if (!Number.isFinite(v)) {
      setThresholdInput(threshold.toFixed(2));
      return;
    }

    const clamped = Math.max(0, Math.min(1, v));
    setThreshold(clamped);
    setThresholdInput(clamped.toFixed(2));
  };

  const sweepData = useMemo(() => {
    if (!pairs.length) return [];

    const cleanScores = pairs.map(getScore).filter((x) => Number.isFinite(x));
    if (!cleanScores.length) return [];

    const minScore = Math.max(
      0.7,
      Math.floor((Math.min(...cleanScores) - 0.02) * 100) / 100,
    );
    const maxScore = Math.min(
      0.99,
      Math.ceil((Math.max(...cleanScores) + 0.02) * 100) / 100,
    );

    const out: SweepPoint[] = [];

    for (let t = minScore; t <= maxScore + 0.0001; t += 0.01) {
      out.push(buildSingleLinkageStats(documents, pairs, Number(t.toFixed(2))));
    }

    return out;
  }, [documents, pairs]);

  if (!authReady) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Threshold
              </label>

              <input
                type="text"
                inputMode="decimal"
                value={thresholdInput}
                onChange={(e) => safeSetThreshold(e.target.value)}
                onBlur={normalizeThresholdInput}
                className="w-full border border-gray-300 rounded-md px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="0.80"
                style={{ color: "#000000" }}
              />

              {suggested && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-gray-600 mr-1">
                    ค่าแนะนำ threshold ชุดข้อมูลนี้
                  </span>

                  {(["loose", "mid", "strict"] as const).map((k) => {
                    const value = Number(suggested[k].toFixed(2));
                    const isActive = selectedPreset === k;
                    const label =
                      k === "loose" ? "ตํ่า" : k === "mid" ? "กลาง" : "สูง";

                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => {
                          setThreshold(value);
                          setThresholdInput(value.toFixed(2));
                          setSelectedPreset(k);
                        }}
                        className={[
                          "px-3 py-1 rounded-full text-xs border transition",
                          isActive
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-900 hover:bg-gray-50",
                        ].join(" ")}
                      >
                        {label} {value.toFixed(2)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  ข้อมูลชุดปัจจุบัน
                </label>

                <span className="relative inline-flex group">
                  <AlertCircle className="w-5 h-5 text-gray-500 cursor-pointer" />
                  <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 hidden group-hover:block whitespace-nowrap rounded-md border bg-white px-3 py-2 text-xs text-gray-700 shadow">
                    ชุดงาน {batchId || "-"}
                    <br />
                    จำนวนคู่เอกสาร {pairs.length}
                    <br />
                    จำนวนเอกสาร {documents.length}
                  </div>
                </span>
              </div>

              <div className="bg-gray-50 rounded-md px-4 py-3 border border-gray-200 space-y-2">
                <div className="text-sm text-gray-600">
                  <span className="font-medium">จำนวนเอกสาร</span>{" "}
                  <span className="text-gray-900">{documents.length}</span>
                </div>
                <div className="text-sm text-gray-600">
                  <span className="font-medium">จำนวนคู่เอกสาร</span>{" "}
                  <span className="text-gray-900">{pairs.length}</span>
                </div>
                {loadingPairs && (
                  <div className="text-sm text-blue-600 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    กำลังโหลดผลเปรียบเทียบ
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-6 h-full flex flex-col">
          <h3 className="text-lg font-semibold text-gray-900">
            กราฟแสดงผลการเปลี่ยนแปลงจำนวนเอกสารตาม Threshold
          </h3>

          <div className="rounded-xl border bg-gray-50 p-4 flex-1 flex flex-col">
            {sweepData.length > 0 ? (
              <>
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sweepData}>
                      <CartesianGrid strokeDasharray="3 3" />

                      <XAxis
                        dataKey="threshold"
                        type="number"
                        domain={["dataMin", "dataMax"]}
                        tickFormatter={(v) => Number(v).toFixed(2)}
                      />

                      <YAxis allowDecimals={false} />

                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload || !payload.length)
                            return null;

                          const p = payload[0].payload as SweepPoint;

                          return (
                            <div
                              style={{
                                background: "#111827",
                                border: "1px solid #111827",
                                borderRadius: 10,
                                color: "#fff",
                                boxShadow: "0 10px 20px rgba(0,0,0,0.25)",
                                padding: "10px 12px",
                                fontSize: 12,
                              }}
                            >
                              <div
                                style={{
                                  color: "#E5E7EB",
                                  fontWeight: 700,
                                  marginBottom: 8,
                                }}
                              >
                                Threshold {p.threshold.toFixed(2)}
                              </div>
                              <div>จำนวนกลุ่ม {p.groupCount} กลุ่ม</div>
                              <div>
                                ไฟล์ที่อยู่ในกลุ่มทั้งหมด {p.clusteredDocCount}{" "}
                                ไฟล์
                              </div>
                            </div>
                          );
                        }}
                      />

                      <ReferenceLine
                        x={threshold}
                        stroke="#dc2626"
                        strokeWidth={3}
                        strokeDasharray="6 6"
                      />

                      <Line
                        type="monotone"
                        dataKey="clusteredDocCount"
                        stroke="#2563eb"
                        strokeWidth={3}
                        dot={{ r: 4, cursor: "pointer" }}
                        activeDot={{
                          r: 6,
                          onClick: (e: any) => {
                            const t = e?.payload?.threshold;
                            if (typeof t === "number") {
                              setThreshold(t);
                              setThresholdInput(t.toFixed(2));
                              setSelectedPreset(null);
                            }
                          },
                        }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-4 pt-3 border-t min-h-[1px] text-xs text-gray-700 space-y-2">
                  <p>เส้นแดงคือค่าที่เลือกอยู่ตอนนี้ {threshold.toFixed(2)}</p>
                  <p className="text-blue-600">
                    แนะนำให้เลือกช่วงเส้นกราฟเริ่มลดลง
                    และค่อยๆดูกลุ่มเอกสารเปลื่ยนแปลงไปเรื่อยๆ
                  </p>
                </div>
              </>
            ) : (
              <div className="h-[320px] rounded-lg border bg-white px-6 py-5 flex items-center justify-center text-gray-500">
                ยังไม่มีข้อมูลพอสำหรับแสดงกราฟ threshold sweep
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-6 h-full flex flex-col">
          <div className="min-h-[72px] mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                กราฟกิ่งไม้การจัดกลุ่มของเอกสาร
              </h3>
              <p className="text-xs text-gray-600 mt-1">
                ใช้ดูโครงสร้างการรวมกลุ่มของเอกสาร
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsDendroModalOpen(true)}
                disabled={!dendro}
                className="inline-flex items-center justify-center w-10 h-10 rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700"
                title="ขยายดูเต็มจอ"
              >
                <Maximize2 className="w-4 h-4" />
              </button>

              <button
                onClick={() => loadDendrogram()}
                disabled={loadingDendro || !pairs.length || !documents.length}
                className="inline-flex items-center justify-center w-10 h-10 rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors text-gray-700"
              >
                {loadingDendro ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <RefreshCw className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          <div className="rounded-xl border bg-gray-50 p-4 flex-1 flex flex-col">
            {dendro ? (
              <>
                <div className="flex-1 min-h-0">
                  <ClusterDendrogram
                    data={dendro}
                    threshold={threshold}
                    displayName={displayDocName}
                    viewportHeight={320}
                    showCutLine={true}
                    highlightByThreshold={true}
                  />
                </div>

                <div className="mt-4 pt-3 border-t min-h-[1px] text-xs text-gray-700 space-y-2">
                  <p>เส้นแดงคือค่าที่เลือกอยู่ตอนนี้ {threshold.toFixed(2)}</p>
                  <p className="text-blue-600">
                    เส้นกราฟกิ่งไม้สีเขียวแสดงเอกสารที่ยังเชื่อมกันอยู่ภายใต้ค่า
                    Threshold นี้
                  </p>
                </div>
              </>
            ) : (
              <div className="h-[320px] rounded-lg border bg-white px-6 py-5 flex items-center justify-center text-gray-500">
                {loadingDendro
                  ? "กำลังโหลด Dendrogram..."
                  : "ยังไม่มีข้อมูลสำหรับแสดงกราฟกิ่งไม้"}
              </div>
            )}
          </div>
        </div>
      </div>

      {isDendroModalOpen && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
          <div className="relative w-full max-w-7xl h-[90vh] bg-white rounded-2xl shadow-2xl border overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  กราฟกิ่งไม้การจัดกลุ่มของเอกสาร
                </h3>
                <p className="text-xs text-gray-600 mt-1">
                  ดูโครงสร้างการรวมกลุ่มของเอกสารได้ละเอียดมากขึ้น
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsDendroModalOpen(false)}
                className="inline-flex items-center justify-center w-10 h-10 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-gray-700"
                title="ปิด"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 p-4 bg-gray-50">
              <div className="w-full h-full rounded-xl border bg-white p-4">
                {dendro ? (
                  <div className="w-full h-full min-h-0">
                    <ClusterDendrogram
                      data={dendro}
                      threshold={threshold}
                      displayName={displayDocName}
                      viewportHeight={560}
                      showCutLine={true}
                      highlightByThreshold={true}
                    />
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-500">
                    ยังไม่มีข้อมูล Dendrogram
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
