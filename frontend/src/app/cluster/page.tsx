"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api";
import { useRouter } from "next/navigation";
import { Loader2, ArrowLeft, Download, AlertCircle } from "lucide-react";
import { useAuthGuard } from "@/lib/useAuthGuard";

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
  const clean = scores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);

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

function revokeUrl(url: string | null) {
  if (url) URL.revokeObjectURL(url);
}

export default function ClusterPage() {
  const authReady = useAuthGuard("/login");

  const router = useRouter();

  const [threshold, setThreshold] = useState<number>(0.8);
  const [pairs, setPairs] = useState<CompareItem[]>([]);
  const [clusters, setClusters] = useState<string[][]>([]);
  const [documents, setDocuments] = useState<DocItem[]>([]);

  const [batchId, setBatchId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [fetchingPairs, setFetchingPairs] = useState(false);

  const [openGroupIndex, setOpenGroupIndex] = useState<number | null>(null);
  const [pickSide, setPickSide] = useState<"left" | "right">("left");
  const [pickerOpen, setPickerOpen] = useState(true);

  const [leftPick, setLeftPick] = useState<string | null>(null);
  const [rightPick, setRightPick] = useState<string | null>(null);

  const [leftBlobUrl, setLeftBlobUrl] = useState<string | null>(null);
  const [rightBlobUrl, setRightBlobUrl] = useState<string | null>(null);
  const [leftLoading, setLeftLoading] = useState(false);
  const [rightLoading, setRightLoading] = useState(false);

  const [previewDoc, setPreviewDoc] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [selectedPreset, setSelectedPreset] = useState<
    "loose" | "mid" | "strict" | null
  >(null);

  const leftRequestIdRef = useRef(0);
  const rightRequestIdRef = useRef(0);
  const previewRequestIdRef = useRef(0);

  const compareCacheKey = useCallback((b: string) => `compare_cache:${b}`, []);

  const loadCompareCache = useCallback(
    (b: string) => {
      const raw = sessionStorage.getItem(compareCacheKey(b));
      if (!raw) return null;

      try {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? (arr as CompareItem[]) : null;
      } catch {
        return null;
      }
    },
    [compareCacheKey],
  );

  const saveCompareCache = useCallback(
    (b: string, data: CompareItem[]) => {
      sessionStorage.setItem(compareCacheKey(b), JSON.stringify(data));
      sessionStorage.setItem("last_compare_batch_id", b);
    },
    [compareCacheKey],
  );

  const clusterCacheKey = useCallback((b: string) => `cluster_cache:${b}`, []);

  const loadClusterCache = useCallback(
    (b: string) => {
      const raw = sessionStorage.getItem(clusterCacheKey(b));
      if (!raw) return null;

      try {
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.clusters)) return null;

        return {
          threshold: Number(parsed.threshold ?? 0.8),
          clusters: parsed.clusters as string[][],
        };
      } catch {
        return null;
      }
    },
    [clusterCacheKey],
  );

  const saveClusterCache = useCallback(
    (b: string, data: { threshold: number; clusters: string[][] }) => {
      sessionStorage.setItem(clusterCacheKey(b), JSON.stringify(data));
    },
    [clusterCacheKey],
  );

  const clearClusterCache = useCallback(
    (b: string) => {
      sessionStorage.removeItem(clusterCacheKey(b));
    },
    [clusterCacheKey],
  );

  useEffect(() => {
    const b = sessionStorage.getItem("last_batch_id");
    if (!b) {
      console.warn("ไม่พบ last_batch_id ใน sessionStorage");
    }
    setBatchId(b || null);
  }, []);

  const docIdToName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const d of documents) {
      map[d.doc_id] = d.file_name || d.doc_id;
    }
    return map;
  }, [documents]);

  const displayDocName = useCallback(
    (docId: string) => docIdToName[docId] || docId,
    [docIdToName],
  );

  const scores = useMemo(
    () => pairs.map(getScore).filter((x) => Number.isFinite(x)),
    [pairs],
  );

  const suggested = useMemo(() => buildSuggestedThresholds(scores), [scores]);

  useEffect(() => {
    if (!batchId) {
      setPairs([]);
      setClusters([]);
      return;
    }

    const cachedPairs = loadCompareCache(batchId);
    setPairs(cachedPairs ?? []);

    const cachedCluster = loadClusterCache(batchId);
    if (cachedCluster) {
      setThreshold(cachedCluster.threshold);
      setClusters(cachedCluster.clusters);
    } else {
      setClusters([]);
    }

    setOpenGroupIndex(null);
  }, [batchId, loadCompareCache, loadClusterCache]);

  useEffect(() => {
    if (!batchId) {
      setDocuments([]);
      return;
    }

    api
      .get<DocItem[]>(`/documents?batch_id=${encodeURIComponent(batchId)}`)
      .then((res) => setDocuments(Array.isArray(res.data) ? res.data : []))
      .catch((e: any) => {
        if (e?.response?.status === 401) {
          setDocuments([]);
          return;
        }
        setDocuments([]);
      });
  }, [batchId]);

  const loadPairs = useCallback(
    async (force = false): Promise<CompareItem[]> => {
      if (!batchId) {
        alert("ไม่พบชุดงาน กรุณาไปหน้า Dashboard แล้วเลือกหรือสร้างชุดงานก่อน");
        return [];
      }

      if (!force) {
        const cached = loadCompareCache(batchId);
        if (cached !== null) {
          setPairs(cached);
          return cached;
        }
      }

      setFetchingPairs(true);
      try {
        const res = await api.get<CompareItem[]>(`/compare`, {
          params: { batch_id: batchId },
        });

        const data = Array.isArray(res.data) ? res.data : [];
        setPairs(data);
        saveCompareCache(batchId, data);

        if (force) {
          clearClusterCache(batchId);
          setClusters([]);
        }

        if (data.length === 0) {
          alert("ไม่พบผลการเปรียบเทียบของชุดนี้");
        }

        return data;
      } catch (e: any) {
        if (e?.response?.status === 401) return [];

        alert(e?.response?.data?.detail || "ดึงผลเปรียบเทียบไม่สำเร็จ");
        return [];
      } finally {
        setFetchingPairs(false);
      }
    },
    [batchId, loadCompareCache, saveCompareCache, clearClusterCache],
  );

  const handleCluster = async () => {
    const workingPairs = pairs.length > 0 ? pairs : await loadPairs(false);

    if (workingPairs.length === 0) return;

    setLoading(true);
    try {
      const body = {
        threshold,
        pairs: workingPairs.map((p) => ({
          doc_1: p.doc_1,
          doc_2: p.doc_2,
          final_score:
            typeof p.final_score === "number"
              ? p.final_score
              : (p.combined_score ?? 0),
        })),
      };

      const res = await api.post(`/cluster`, body);

      const nextClusters = Array.isArray(res.data?.clusters)
        ? res.data.clusters
        : [];

      const nextThreshold =
        typeof res.data?.threshold === "number"
          ? res.data.threshold
          : threshold;

      setClusters(nextClusters);
      setThreshold(nextThreshold);

      if (batchId) {
        saveClusterCache(batchId, {
          threshold: nextThreshold,
          clusters: nextClusters,
        });
      }
    } catch (e: any) {
      if (e?.response?.status === 401) return;
      alert(e?.response?.data?.detail || "เกิดข้อผิดพลาดในการจัดกลุ่ม");
    } finally {
      setLoading(false);
    }
  };

  const safeSetThreshold = (raw: string) => {
    const v = parseFloat(raw);
    setThreshold(Number.isFinite(v) ? v : 0.8);
    setSelectedPreset(null);
  };

  const exportClusters = () => {
    if (clusters.length === 0) {
      alert("ไม่มีข้อมูลกลุ่มให้ Export");
      return;
    }

    const csvRows = ["กลุ่ม,ลำดับ,ชื่อเอกสาร"];

    const safe = (s: string) =>
      `"${String(s)
        .replaceAll('"', '""')
        .replaceAll("\r\n", "\n")
        .replaceAll("\n", " ")}"`;

    clusters.forEach((group, i) => {
      group.forEach((doc, docIndex) => {
        csvRows.push(`${i + 1},${docIndex + 1},${safe(displayDocName(doc))}`);
      });
    });

    const csvContent = csvRows.join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);

    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `clusters_${new Date().toISOString().split("T")[0]}.csv`,
    );

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  };

  const loadPdfBlobUrl = useCallback(
    async (docId: string, side: "left" | "right") => {
      if (!batchId) return;

      const requestIdRef =
        side === "left" ? leftRequestIdRef : rightRequestIdRef;
      requestIdRef.current += 1;
      const requestId = requestIdRef.current;

      const setLoadingState =
        side === "left" ? setLeftLoading : setRightLoading;
      const setBlobState = side === "left" ? setLeftBlobUrl : setRightBlobUrl;

      setLoadingState(true);

      try {
        const res = await api.get(
          `/documents/${encodeURIComponent(docId)}/preview-url`,
          {
            params: { batch_id: batchId },
          },
        );

        const signedUrl = res.data?.url;
        if (!signedUrl) throw new Error("No preview url returned");

        const pdfRes = await fetch(signedUrl);
        if (!pdfRes.ok) throw new Error("โหลด PDF ไม่สำเร็จ");

        const blob = await pdfRes.blob();
        const blobUrl = URL.createObjectURL(
          new Blob([blob], { type: "application/pdf" }),
        );

        if (requestId !== requestIdRef.current) {
          URL.revokeObjectURL(blobUrl);
          return;
        }

        setBlobState((prev) => {
          revokeUrl(prev);
          return blobUrl;
        });
      } catch (e: any) {
        if (e?.response?.status === 401) return;
        alert(e?.response?.data?.detail || "โหลดพรีวิว PDF ไม่สำเร็จ");
      } finally {
        if (requestId === requestIdRef.current) {
          setLoadingState(false);
        }
      }
    },
    [batchId],
  );

  useEffect(() => {
    if (openGroupIndex === null) {
      leftRequestIdRef.current += 1;
      rightRequestIdRef.current += 1;

      setLeftLoading(false);
      setRightLoading(false);

      setLeftBlobUrl((prev) => {
        revokeUrl(prev);
        return null;
      });

      setRightBlobUrl((prev) => {
        revokeUrl(prev);
        return null;
      });

      return;
    }

    setLeftBlobUrl((prev) => {
      revokeUrl(prev);
      return null;
    });

    setRightBlobUrl((prev) => {
      revokeUrl(prev);
      return null;
    });

    if (leftPick) loadPdfBlobUrl(leftPick, "left");
    if (rightPick) loadPdfBlobUrl(rightPick, "right");
  }, [openGroupIndex, leftPick, rightPick, loadPdfBlobUrl]);

  const openPreview = useCallback(
    async (docId: string) => {
      if (!batchId) {
        alert("ไม่พบข้อมูลสำหรับพรีวิว");
        return;
      }

      previewRequestIdRef.current += 1;
      const requestId = previewRequestIdRef.current;

      setPreviewDoc(docId);
      setPreviewUrl(null);
      setPreviewLoading(true);

      setPreviewBlobUrl((prev) => {
        revokeUrl(prev);
        return null;
      });

      try {
        const res = await api.get(
          `/documents/${encodeURIComponent(docId)}/preview-url`,
          {
            params: { batch_id: batchId },
          },
        );

        const signedUrl = res.data?.url;
        if (!signedUrl) throw new Error("No preview url returned");

        if (requestId !== previewRequestIdRef.current) return;

        setPreviewUrl(signedUrl);

        const pdfRes = await fetch(signedUrl);
        if (!pdfRes.ok) throw new Error("โหลด PDF ไม่สำเร็จ");

        const blob = await pdfRes.blob();
        const blobUrl = URL.createObjectURL(
          new Blob([blob], { type: "application/pdf" }),
        );

        if (requestId !== previewRequestIdRef.current) {
          URL.revokeObjectURL(blobUrl);
          return;
        }

        setPreviewBlobUrl(blobUrl);
      } catch (e: any) {
        if (e?.response?.status === 401) return;

        alert(e?.response?.data?.detail || "สร้างลิงก์พรีวิวไม่สำเร็จ");

        if (requestId === previewRequestIdRef.current) {
          setPreviewDoc(null);
          setPreviewUrl(null);
        }
      } finally {
        if (requestId === previewRequestIdRef.current) {
          setPreviewLoading(false);
        }
      }
    },
    [batchId],
  );

  const closePreview = useCallback(() => {
    previewRequestIdRef.current += 1;
    setPreviewLoading(false);
    setPreviewDoc(null);
    setPreviewUrl(null);

    setPreviewBlobUrl((prev) => {
      revokeUrl(prev);
      return null;
    });
  }, []);

  useEffect(() => {
    return () => {
      revokeUrl(leftBlobUrl);
      revokeUrl(rightBlobUrl);
      revokeUrl(previewBlobUrl);
    };
  }, [leftBlobUrl, rightBlobUrl, previewBlobUrl]);

  const totalPairs = scores.length;

  const passedTotal = useMemo(() => {
    return scores.filter((s) => s >= threshold).length;
  }, [scores, threshold]);

  const notPassedTotal = totalPairs - passedTotal;

  const totalDocsInClusters = useMemo(() => {
    return clusters.reduce((sum, group) => sum + group.length, 0);
  }, [clusters]);

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
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={Number.isFinite(threshold) ? threshold : ""}
                onChange={(e) => safeSetThreshold(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                placeholder="0.80"
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
                      k === "loose" ? "ตำ่" : k === "mid" ? "กลาง" : "สูง";

                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => {
                          setThreshold(value);
                          setSelectedPreset(k);
                        }}
                        className={[
                          "px-3 py-1 rounded-full text-xs border transition",
                          isActive
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-900 hover:bg-gray-50 border-gray-300",
                        ].join(" ")}
                        title={`p=${
                          suggested[
                            k === "loose"
                              ? "p_loose"
                              : k === "mid"
                                ? "p_mid"
                                : "p_strict"
                          ]
                        }`}
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
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-6">
            <button
              onClick={() => loadPairs(true)}
              disabled={fetchingPairs}
              className="flex items-center px-4 py-2 bg-gray-200 rounded-md hover:bg-gray-300 disabled:opacity-60 disabled:cursor-not-allowed transition-colors text-black"
              title="ดึงผล compare ล่าสุดของ batch นี้"
            >
              {fetchingPairs ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  กำลังดึงผล
                </>
              ) : (
                "โหลดผลเปรียบเทียบล่าสุด"
              )}
            </button>

            <button
              onClick={handleCluster}
              disabled={loading || pairs.length === 0}
              className="flex items-center px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  กำลังจัดกลุ่ม
                </>
              ) : (
                "หาผลลัพธ์เอกสาร"
              )}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
          <div className="rounded-lg border bg-blue-50 border-blue-200 p-4">
            <div className="text-xs text-blue-700">จำนวนกลุ่ม</div>
            <div className="text-lg font-semibold text-blue-900">
              {clusters.length} กลุ่ม
            </div>
            <div className="text-xs text-blue-700 mt-1">
              เอกสารรวม {totalDocsInClusters} ไฟล์
            </div>
          </div>

          <div className="rounded-lg border bg-white p-4">
            <div className="text-xs text-gray-500">Threshold ปัจจุบัน</div>
            <div className="text-lg font-semibold text-gray-900">
              {threshold.toFixed(2)}
            </div>
            <div className="text-xs text-gray-600 mt-1">
              ใช้ค่านี้ในการจัดกลุ่ม
            </div>
          </div>
        </div>

        {clusters.length > 0 ? (
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  ผลลัพธ์เอกสาร
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  พบ {clusters.length} กลุ่ม
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={exportClusters}
                  disabled={clusters.length === 0}
                  className="inline-flex items-center px-4 py-2 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export CSV
                </button>

                <button
                  onClick={() => router.push("/analysis")}
                  className="px-4 py-2 border border-blue-200 text-blue-700 rounded-md hover:bg-blue-50 transition-colors"
                >
                  ไปที่หน้าวิเคราะห์ผล
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {clusters.map((group, i) => (
                <div
                  key={i}
                  className="border rounded-xl p-4 bg-gray-50 text-black"
                >
                  <div className="flex items-center justify-between mb-3 gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center justify-center w-8 h-8 bg-blue-600 text-white rounded-full text-sm font-bold">
                        {i + 1}
                      </span>

                      <div>
                        <div className="font-medium text-blue-700">
                          กลุ่ม {i + 1}
                        </div>
                        <div className="text-xs text-gray-500">
                          {group.length} ไฟล์
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setOpenGroupIndex(i);
                        setLeftPick(group[0] ?? null);
                        setRightPick(group[1] ?? null);
                        setPickSide("left");
                        setPickerOpen(true);
                      }}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      ดูเอกสารในกลุ่ม
                    </button>
                  </div>

                  <div className="text-sm text-gray-700 pl-11 space-y-1">
                    {group.map((doc, docIndex) => (
                      <div key={docIndex} className="flex items-start">
                        <span className="text-gray-500 mr-2 font-mono">
                          {docIndex + 1})
                        </span>
                        <button
                          onClick={() => openPreview(doc)}
                          className="text-blue-600 hover:underline text-left"
                        >
                          {displayDocName(doc)}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
            <p className="text-gray-500">
              ยังไม่มีผลการจัดกลุ่ม กดโหลดผลเปรียบเทียบล่าสุด แล้วกดเริ่ม
              Clustering
            </p>
          </div>
        )}
      </div>

      {openGroupIndex !== null &&
        (() => {
          const group = clusters[openGroupIndex] || [];
          const leftDoc = leftPick;
          const rightDoc = rightPick;

          return (
            <div
              className="fixed inset-0 z-40 bg-black/40 overflow-y-auto pt-20"
              onClick={() => setOpenGroupIndex(null)}
            >
              <div
                className="min-h-full w-full flex items-start justify-center p-4 pt-24"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="bg-white rounded-xl w-full max-w-7xl shadow-lg">
                  <div className="flex items-center justify-between px-5 py-3 border-b">
                    <div>
                      <h3 className="font-semibold text-gray-900">
                        พรีวิวเอกสารในกลุ่ม {openGroupIndex + 1}
                      </h3>
                      <p className="text-xs text-gray-500 mt-1">
                        เลือกไฟล์ด้านล่างเพื่อกำหนดฝั่งซ้ายและขวา
                      </p>
                    </div>

                    <button
                      onClick={() => setOpenGroupIndex(null)}
                      className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-900 text-sm"
                    >
                      ปิด
                    </button>
                  </div>

                  <div className="p-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="rounded-xl border bg-white p-3">
                        <div className="flex items-center justify-between mb-2 gap-3">
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {leftDoc ? displayDocName(leftDoc) : "-"}
                          </div>

                          {leftDoc && (
                            <button
                              onClick={() => openPreview(leftDoc)}
                              className="text-sm text-blue-600 hover:underline shrink-0"
                            >
                              เปิดเต็ม
                            </button>
                          )}
                        </div>

                        {leftLoading ? (
                          <div className="h-[70vh] flex items-center justify-center text-gray-500">
                            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                            กำลังโหลด
                          </div>
                        ) : leftBlobUrl ? (
                          <object
                            key={leftBlobUrl}
                            data={leftBlobUrl}
                            type="application/pdf"
                            className="w-full h-[70vh]"
                          />
                        ) : (
                          <div className="h-[70vh] flex items-center justify-center text-gray-500">
                            ไม่มีไฟล์
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl border bg-white p-3">
                        <div className="flex items-center justify-between mb-2 gap-3">
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {rightDoc ? displayDocName(rightDoc) : "-"}
                          </div>

                          {rightDoc && (
                            <button
                              onClick={() => openPreview(rightDoc)}
                              className="text-sm text-blue-600 hover:underline shrink-0"
                            >
                              เปิดเต็ม
                            </button>
                          )}
                        </div>

                        {rightLoading ? (
                          <div className="h-[70vh] flex items-center justify-center text-gray-500">
                            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                            กำลังโหลด
                          </div>
                        ) : rightBlobUrl ? (
                          <object
                            key={rightBlobUrl}
                            data={rightBlobUrl}
                            type="application/pdf"
                            className="w-full h-[70vh]"
                          />
                        ) : (
                          <div className="h-[70vh] flex items-center justify-center text-gray-500">
                            ไม่มีไฟล์
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 border-t">
                      <button
                        onClick={() => setPickerOpen((v) => !v)}
                        className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <span>
                          เลือกไฟล์ในกลุ่ม
                          <span className="text-xs text-gray-500 ml-2">
                            ซ้าย {leftPick ? displayDocName(leftPick) : "-"} •
                            ขวา {rightPick ? displayDocName(rightPick) : "-"}
                          </span>
                        </span>

                        <span className="text-blue-600">
                          {pickerOpen ? "ปิด ▲" : "เปิด ▼"}
                        </span>
                      </button>

                      {pickerOpen && (
                        <div className="px-5 pb-4">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-xs text-gray-500">
                              เลือกฝั่ง
                            </span>

                            <button
                              type="button"
                              onClick={() => setPickSide("left")}
                              className={`px-3 py-1 rounded-full text-sm border transition ${
                                pickSide === "left"
                                  ? "bg-blue-600 text-white border-blue-600 ring-2 ring-blue-200"
                                  : "bg-white text-gray-900 hover:bg-gray-50 border-gray-300"
                              }`}
                            >
                              ซ้าย
                            </button>

                            <button
                              type="button"
                              onClick={() => setPickSide("right")}
                              className={`px-3 py-1 rounded-full text-sm border transition ${
                                pickSide === "right"
                                  ? "bg-green-600 text-white border-green-600 ring-2 ring-green-200"
                                  : "bg-white text-gray-900 hover:bg-gray-50 border-gray-300"
                              }`}
                            >
                              ขวา
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                            {group.map((doc) => {
                              const isLeft = doc === leftPick;
                              const isRight = doc === rightPick;

                              const cls = isLeft
                                ? "bg-blue-600 text-white border-blue-600"
                                : isRight
                                  ? "bg-green-600 text-white border-green-600"
                                  : "bg-white text-gray-900 hover:bg-gray-50 border-gray-300";

                              return (
                                <button
                                  key={doc}
                                  type="button"
                                  onClick={() => {
                                    if (pickSide === "left") {
                                      setLeftPick(doc);
                                    } else {
                                      setRightPick(doc);
                                    }
                                  }}
                                  className={`px-3 py-1 rounded-full text-sm border transition ${cls}`}
                                >
                                  {displayDocName(doc)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      {previewDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={closePreview}
        >
          <div
            className="bg-white rounded-xl w-full max-w-6xl h-[90vh] shadow-lg flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900 truncate">
                  เอกสาร {previewDoc ? displayDocName(previewDoc) : "-"}
                </h3>
                <p className="text-xs text-gray-500">โหลดด้วย Signed URL</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {previewUrl && (
                  <>
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-900"
                    >
                      เปิดแท็บใหม่
                    </a>

                    <a
                      href={previewUrl}
                      download
                      className="text-sm px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-900"
                    >
                      ดาวน์โหลด
                    </a>
                  </>
                )}

                <button
                  onClick={closePreview}
                  className="text-sm px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-900"
                >
                  ปิด
                </button>
              </div>
            </div>

            <div className="flex-1 bg-gray-50">
              {previewLoading ? (
                <div className="h-full flex items-center justify-center text-gray-600">
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  กำลังโหลดพรีวิว
                </div>
              ) : previewBlobUrl ? (
                <object
                  key={previewBlobUrl}
                  data={previewBlobUrl}
                  type="application/pdf"
                  className="w-full h-full"
                >
                  <div className="h-full flex items-center justify-center text-gray-700 p-6">
                    เบราว์เซอร์ไม่สามารถแสดง PDF ได้
                    <a
                      href={previewBlobUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 text-blue-600 underline"
                    >
                      กดเปิดแท็บใหม่
                    </a>
                  </div>
                </object>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-600">
                  ไม่พบลิงก์พรีวิว
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
