"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { useDropzone } from "react-dropzone";
import api from "@/lib/api";
import { useRouter } from "next/navigation";
import { useAuthGuard } from "@/lib/useAuthGuard";
import {
  Upload,
  FileText,
  Image as ImageIcon,
  Settings,
  Play,
  Trash2,
  Download,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  BarChart3,
  RefreshCw,
  ArrowRight,
  FolderOpen,
  X,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
} from "lucide-react";

interface DocumentResult {
  doc_id: string;
  file_name?: string;
  status: string;
  processing_mode: number;
  text_length?: number;
  image_count?: number;
  removed_text_length?: number;
  error?: string;
  cached?: boolean;
  batch_id?: string;
}

interface ComparisonResult {
  doc_1: string;
  doc_2: string;
  combined_score: number;
  text_similarity: number;
  semantic_similarity: number;
  lexical_similarity: number;
  image_similarity: number;
  image_cosine_avg: number;
  image_phash_avg: number;
  matched_images: number;
  total_images: number;
  level: string;
  processing_mode: number;
}

type TabType = "upload" | "compare";
type CompareFilter = "all" | "very" | "high" | "low";
type SortOrder = "desc" | "asc";

export default function DashboardPage() {
  const authReady = useAuthGuard("/login");
  const router = useRouter();
  const didInitRef = useRef(false);

  const [activeTab, setActiveTab] = useState<TabType>("upload");
  const [pageLoading, setPageLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [comparisonResults, setComparisonResults] = useState<
    ComparisonResult[] | null
  >(null);
  const [isComparing, setIsComparing] = useState(false);

  const [files, setFiles] = useState<File[]>([]);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [processingMode, setProcessingMode] = useState(1);
  const [useTemplate, setUseTemplate] = useState(false);

  const [uploadResults, setUploadResults] = useState<DocumentResult[]>([]);
  const [documents, setDocuments] = useState<DocumentResult[]>([]);
  const [lastBatchId, setLastBatchId] = useState<string | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [showFileModal, setShowFileModal] = useState(false);
  const [showUploadResultModal, setShowUploadResultModal] = useState(false);

  const [compareFilter, setCompareFilter] = useState<CompareFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const [docsLoading, setDocsLoading] = useState(false);
  const [batchMode, setBatchMode] = useState<number | null>(null);

  // ===== Pair PDF Preview (2-up) =====
  const [pairOpen, setPairOpen] = useState(false);
  const [pairLoading, setPairLoading] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);

  const [pairDoc1, setPairDoc1] = useState<string | null>(null);
  const [pairDoc2, setPairDoc2] = useState<string | null>(null);

  const [pairSigned1, setPairSigned1] = useState<string | null>(null);
  const [pairSigned2, setPairSigned2] = useState<string | null>(null);

  const [pairBlob1, setPairBlob1] = useState<string | null>(null);
  const [pairBlob2, setPairBlob2] = useState<string | null>(null);

  const [pairIndex, setPairIndex] = useState<number | null>(null);

  const [batchUsesTemplate, setBatchUsesTemplate] = useState<boolean | null>(
    null,
  );
  const [pendingOpenUpload, setPendingOpenUpload] = useState(false);

  const templateCacheKey = (batchId: string) => `batch_template:${batchId}`;

  const loadBatchTemplateState = useCallback((batchId?: string | null) => {
    if (typeof window === "undefined") return;

    if (!batchId) {
      setBatchUsesTemplate(null);
      return;
    }

    const saved = localStorage.getItem(templateCacheKey(batchId));

    if (saved === "true") {
      setBatchUsesTemplate(true);
    } else if (saved === "false") {
      setBatchUsesTemplate(false);
    } else {
      setBatchUsesTemplate(null);
    }
  }, []);

  // ===== Helpers (cache keys) =====
  const compareCacheKey = (batchId: string) => `compare_cache:${batchId}`;

  const clearCompareCaches = (batchId?: string | null) => {
    sessionStorage.removeItem("last_compare_results");
    sessionStorage.removeItem("last_compare_batch_id");
    if (batchId) sessionStorage.removeItem(compareCacheKey(batchId));
  };

  // ===== Counts (FIX: ไม่ซ้ำ) =====
  const countVery =
    comparisonResults?.filter((r) => r.level === "คล้ายระดับสูง").length ?? 0;
  const countHigh =
    comparisonResults?.filter((r) => r.level === "คล้ายระดับกลาง").length ?? 0;
  const countLow =
    comparisonResults?.filter((r) => r.level === "คล้ายระดับต่ำ").length ?? 0;

  // batch ที่ใช้งานจริง
  const effectiveBatchId = useMemo(
    () => activeBatchId || lastBatchId,
    [activeBatchId, lastBatchId],
  );

  // โหมดของ batch ปัจจุบัน
  const currentBatchMode = useMemo(() => {
    return documents?.[0]?.processing_mode ?? null;
  }, [documents]);

  // ล็อกโหมดเมื่อ batch มีเอกสารแล้ว
  const batchHasDocuments = useMemo(
    () => documents.length > 0,
    [documents.length],
  );

  const modeLocked = useMemo(() => {
    return !!effectiveBatchId && batchHasDocuments;
  }, [effectiveBatchId, batchHasDocuments]);

  const templateLocked = useMemo(() => {
    return !!effectiveBatchId && batchHasDocuments;
  }, [effectiveBatchId, batchHasDocuments]);

  const activeModeForTemplate = currentBatchMode ?? processingMode;
  const imageModeNoTemplate = activeModeForTemplate === 2;
  const templateDisabled = templateLocked || imageModeNoTemplate;
  const mustUploadTemplate = !templateDisabled && useTemplate && !templateFile;

  const uploadLocked = false;

  const modeLockMessage = "โหมดของชุดนี้ถูกล็อกไว้จนกว่าจะลบเอกสารทั้งหมด";
  const templateLockMessage = imageModeNoTemplate
    ? "โหมดรูปภาพเท่านั้นไม่รองรับ Template"
    : "Template ของชุดนี้ถูกล็อกไว้จนกว่าจะลบเอกสารทั้งหมด";

  const getModeText = (mode: number) => {
    switch (mode) {
      case 1:
        return "ข้อความ";
      case 2:
        return "รูปภาพ";
      case 3:
        return "ทั้งสอง";
      default:
        return "ไม่ระบุ";
    }
  };

  const onSelectMode = (m: number) => {
    if (modeLocked && currentBatchMode && m !== currentBatchMode) {
      alert(
        `ชุดงานนี้ใช้โหมด ${getModeText(currentBatchMode)} อยู่แล้ว กรุณาลบเอกสารทั้งหมดก่อนหากต้องการเปลี่ยนโหมด`,
      );
      return;
    }

    setProcessingMode(m);

    if (m === 2) {
      setUseTemplate(false);
      setTemplateFile(null);
    }
  };

  const normalizeKey = (s: string) => (s || "").trim().replace(/\.pdf$/i, "");

  // ✅ safer: ตัด hash เฉพาะ doc_id ที่ขึ้นต้นด้วยเลข 8 หลัก_ (กันชื่อไฟล์ที่ลงท้ายด้วย deadbeef จริงๆ)
  const stripTailHash = (s: string) => {
    const t = (s || "").trim();
    if (!/^\d{8}_/.test(t)) return t;
    return t.replace(/_[0-9a-f]{8}$/i, "");
  };

  const docIdToName = useMemo(() => {
    const map: Record<string, string> = {};

    for (const d of documents) {
      const name = d.file_name || d.doc_id;

      map[d.doc_id] = name;
      map[normalizeKey(d.doc_id)] = name;

      const base = stripTailHash(d.doc_id);
      map[base] = name;
      map[normalizeKey(base)] = name;

      if (d.file_name) {
        map[d.file_name] = d.file_name;
        map[normalizeKey(d.file_name)] = d.file_name;

        const baseName = stripTailHash(d.file_name);
        map[baseName] = d.file_name;
        map[normalizeKey(baseName)] = d.file_name;
      }
    }

    return map;
  }, [documents]);

  const docKeyToId = useMemo(() => {
    const map: Record<string, string> = {};

    for (const d of documents) {
      const id = d.doc_id;
      const name = d.file_name || d.doc_id;

      map[id] = id;
      map[normalizeKey(id)] = id;

      const baseId = stripTailHash(id);
      map[baseId] = id;
      map[normalizeKey(baseId)] = id;

      if (d.file_name) {
        map[d.file_name] = id;
        map[normalizeKey(d.file_name)] = id;

        const baseName = stripTailHash(d.file_name);
        map[baseName] = id;
        map[normalizeKey(baseName)] = id;
      }

      map[name] = id;
      map[normalizeKey(name)] = id;
    }

    return map;
  }, [documents]);

  const resolveToDocId = (raw: string) => {
    return (
      docKeyToId[raw] ||
      docKeyToId[normalizeKey(raw)] ||
      docKeyToId[stripTailHash(raw)] ||
      docKeyToId[normalizeKey(stripTailHash(raw))] ||
      null
    );
  };

  const displayDocName = (id: string) =>
    docIdToName[id] ||
    docIdToName[normalizeKey(id)] ||
    docIdToName[stripTailHash(id)] ||
    docIdToName[normalizeKey(stripTailHash(id))] ||
    id;

  const getLevelColor = (level: string) => {
    switch (level) {
      case "คล้ายระดับสูง":
        return "text-red-600 bg-red-50 border-red-200";
      case "คล้ายระดับกลาง":
        return "text-orange-600 bg-orange-50 border-orange-200";
      case "คล้ายระดับต่ำ":
        return "text-blue-600 bg-blue-50 border-blue-200";
      default:
        return "text-gray-600 bg-gray-50 border-gray-200";
    }
  };

  const getModeIcon = (mode: number) => {
    switch (mode) {
      case 1:
        return <FileText className="w-4 h-4" />;
      case 2:
        return <ImageIcon className="w-4 h-4" />;
      case 3:
        return <Settings className="w-4 h-4" />;
      default:
        return <Settings className="w-4 h-4" />;
    }
  };

  const formatScore = (score: number) => (score * 100).toFixed(2) + "%";

  const fetchDocuments = useCallback(async (batchId?: string) => {
    if (typeof window === "undefined") return [];

    const token = sessionStorage.getItem("access_token");
    if (!token) {
      setDocuments([]);
      setBatchMode(null);
      return [];
    }

    setDocsLoading(true);
    try {
      const url = batchId ? `/documents?batch_id=${batchId}` : `/documents`;
      const response = await api.get<DocumentResult[]>(url);

      const docs = Array.isArray(response.data) ? response.data : [];
      setDocuments(docs);

      if (docs.length > 0) {
        setBatchMode(docs[0].processing_mode);
      } else {
        setBatchMode(null);
      }

      return docs;
    } catch (error: any) {
      console.error("Failed to fetch documents:", error);
      setDocuments([]);
      setBatchMode(null);
      return [];
    } finally {
      setDocsLoading(false);
    }
  }, []);

  // ✅ compare filter ใช้ “ลิสต์ที่แสดงจริง”
  const filteredResults = useMemo(() => {
    const arr = comparisonResults ? [...comparisonResults] : [];
    switch (compareFilter) {
      case "very":
        return arr.filter((r) => r.level === "คล้ายระดับสูง");
      case "high":
        return arr.filter((r) => r.level === "คล้ายระดับกลาง");
      case "low":
        return arr.filter((r) => r.level === "คล้ายระดับต่ำ");
      default:
        return arr;
    }
  }, [comparisonResults, compareFilter]);

  const sortedResults = useMemo(() => {
    const arr = [...filteredResults];
    arr.sort((a, b) =>
      sortOrder === "desc"
        ? b.combined_score - a.combined_score
        : a.combined_score - b.combined_score,
    );
    return arr;
  }, [filteredResults, sortOrder]);

  const goPair = (delta: number) => {
    if (pairIndex === null) return;
    const nextIndex = pairIndex + delta;
    if (nextIndex < 0 || nextIndex >= sortedResults.length) return;

    const next = sortedResults[nextIndex];
    openPairPreview(next.doc_1, next.doc_2, nextIndex);
  };

  // Dropzone handlers
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const pdfFiles = acceptedFiles.filter(
      (file) => file.type === "application/pdf",
    );

    if (pdfFiles.length !== acceptedFiles.length) {
      alert("กรุณาอัปโหลดเฉพาะไฟล์ PDF เท่านั้น");
    }

    setFiles((prev) => [...prev, ...pdfFiles]);
  }, []);

  const onTemplateDrop = useCallback((acceptedFiles: File[]) => {
    const pdfFile = acceptedFiles.find(
      (file) => file.type === "application/pdf",
    );
    if (pdfFile) {
      setTemplateFile(pdfFile);
    } else {
      alert("กรุณาอัปโหลดไฟล์ PDF สำหรับ Template");
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    multiple: true,
    noClick: true,
    noDrag: false,
    noKeyboard: false,
    disabled: false,
  });

  const {
    getRootProps: getTemplateRootProps,
    getInputProps: getTemplateInputProps,
    isDragActive: isTemplateDragActive,
    open: openTemplate,
  } = useDropzone({
    onDrop: onTemplateDrop,
    accept: { "application/pdf": [".pdf"] },
    multiple: false,
    noClick: templateLocked,
    noDrag: templateLocked,
    noKeyboard: templateLocked,
    disabled: templateLocked,
  });

  useEffect(() => {
    loadBatchTemplateState(effectiveBatchId);
  }, [effectiveBatchId, loadBatchTemplateState]);

  useEffect(() => {
    if (batchHasDocuments) {
      setUseTemplate(!!batchUsesTemplate);
    }
  }, [batchHasDocuments, batchUsesTemplate]);

  useEffect(() => {
    if (activeTab === "upload" && pendingOpenUpload) {
      const id = window.requestAnimationFrame(() => {
        open();
        setPendingOpenUpload(false);
      });

      return () => window.cancelAnimationFrame(id);
    }
  }, [activeTab, pendingOpenUpload, open]);

  const getCurrentBatchId = () => activeBatchId || lastBatchId;

  const startNewBatch = () => {
    const b = uuidv4();
    setActiveBatchId(b);
    setLastBatchId(b);
    sessionStorage.setItem("last_batch_id", b);

    setComparisonResults(null);
    clearCompareCaches(b);

    setDocuments([]);
    setBatchMode(null);

    return b;
  };

  // Load saved data
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    if (typeof window === "undefined") return;

    const token = sessionStorage.getItem("access_token");
    if (!token) {
      setPageLoading(false);
      return;
    }

    setPageLoading(false);

    const savedLegacy = sessionStorage.getItem("last_compare_results");
    if (savedLegacy) {
      try {
        setComparisonResults(JSON.parse(savedLegacy));
      } catch {}
    }

    const savedBatch = sessionStorage.getItem("last_batch_id");

    const run = async () => {
      try {
        if (savedBatch) {
          setLastBatchId(savedBatch);
          setActiveBatchId(savedBatch);

          const cached = sessionStorage.getItem(compareCacheKey(savedBatch));
          if (cached) {
            try {
              setComparisonResults(JSON.parse(cached));
              setActiveTab("compare");
            } catch {}
          }

          await fetchDocuments(savedBatch);
          return;
        }

        const res = await api.get("/batches/latest", {
          timeout: 15000,
        });

        const b = res.data?.batch_id;
        if (b) {
          setLastBatchId(b);
          setActiveBatchId(b);
          sessionStorage.setItem("last_batch_id", b);

          const cached = sessionStorage.getItem(compareCacheKey(b));
          if (cached) {
            try {
              setComparisonResults(JSON.parse(cached));
              setActiveTab("compare");
            } catch {}
          }

          await fetchDocuments(b);
        } else {
          await fetchDocuments(undefined);
        }
      } catch {
        setDocuments([]);
        setBatchMode(null);
      }
    };

    run();
  }, [fetchDocuments]);

  // File management
  const removeFile = (index: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== index));
  const removeTemplateFile = () => setTemplateFile(null);

  const clearFiles = () => {
    if (files.length === 0) return;
    if (!confirm("ต้องการลบไฟล์ที่เลือกทั้งหมดหรือไม่?")) return;
    setFiles([]);
  };

  // API handlers
  const handleCompare = useCallback(
    async (batchId: string, forceRefresh: boolean = false) => {
      setBusy(true);
      setIsComparing(true);

      try {
        if (!forceRefresh) {
          const cached = sessionStorage.getItem(compareCacheKey(batchId));
          if (cached) {
            try {
              const parsed = JSON.parse(cached);
              if (Array.isArray(parsed)) {
                setComparisonResults(parsed);
                setActiveBatchId(batchId);
                setLastBatchId(batchId);
                sessionStorage.setItem("last_batch_id", batchId);
                setActiveTab("compare");
                await fetchDocuments(batchId);
                return;
              }
            } catch {}
          }
        }

        const res = await api.get(`/compare`, {
          params: { batch_id: batchId },
        });

        const data = Array.isArray(res.data)
          ? res.data
          : (res.data?.comparisons ?? []);

        setComparisonResults(data);
        setActiveBatchId(batchId);
        setLastBatchId(batchId);
        sessionStorage.setItem("last_batch_id", batchId);

        await fetchDocuments(batchId);

        sessionStorage.setItem(compareCacheKey(batchId), JSON.stringify(data));
        sessionStorage.setItem("last_compare_batch_id", batchId);
        sessionStorage.setItem("last_compare_results", JSON.stringify(data));

        setActiveTab("compare");
      } catch (err: any) {
        console.error(err);
        if (err?.response?.status === 401) return;

        alert("เกิดข้อผิดพลาดในการเปรียบเทียบไฟล์");
      } finally {
        setIsComparing(false);
        setBusy(false);
      }
    },
    [fetchDocuments],
  );

  const handleProcessAndCompare = useCallback(async () => {
    if (documents.length < 2) {
      alert("ต้องมีอย่างน้อย 2 เอกสาร");
      return;
    }

    const batchId = activeBatchId || lastBatchId;
    if (!batchId) {
      alert("ไม่พบ batch สำหรับเปรียบเทียบ");
      return;
    }

    await handleCompare(batchId);
  }, [documents, activeBatchId, lastBatchId, handleCompare]);

  const handleUpload = useCallback(async () => {
    if (files.length === 0) return alert("กรุณาเลือกไฟล์ก่อนอัปโหลด");
    if (mustUploadTemplate) {
      return alert("กรุณาอัปโหลดไฟล์ Template");
    }

    const token = sessionStorage.getItem("access_token");
    if (!token) {
      alert("กรุณาเข้าสู่ระบบก่อนใช้งาน");
      router.push("/login");
      return;
    }

    setBusy(true);
    setUploadResults([]);

    try {
      let batchId = getCurrentBatchId();
      if (!batchId) batchId = startNewBatch();

      if (batchMode && batchMode !== processingMode) {
        alert(
          `ชุดงานนี้ใช้โหมด ${getModeText(batchMode)} อยู่แล้ว กรุณาลบเอกสารทั้งหมดก่อนหากต้องการเปลี่ยนโหมด`,
        );
        return;
      }

      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      formData.append("processing_mode", processingMode.toString());
      formData.append("use_template", useTemplate.toString());
      formData.append("batch_id", batchId);

      if (useTemplate && templateFile) {
        formData.append("template_file", templateFile);
      }

      const response = await api.post(`/upload-pdfs`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        timeout: 300000,
      });

      if (response.status === 200 && response.data) {
        setUploadResults(response.data.results || []);
        setFiles([]);
        setTemplateFile(null);

        localStorage.setItem(
          templateCacheKey(batchId),
          useTemplate ? "true" : "false",
        );
        setBatchUsesTemplate(useTemplate);

        setActiveBatchId(batchId);
        setLastBatchId(batchId);
        sessionStorage.setItem("last_batch_id", batchId);

        // สำคัญมาก ล้างผล compare เก่าของ batch นี้
        setComparisonResults(null);
        clearCompareCaches(batchId);

        await fetchDocuments(batchId);
        setShowUploadResultModal(true);
      }
    } catch (error: any) {
      console.error("Upload error:", error);
      if (error?.response?.status === 401) return;

      alert(
        `ข้อผิดพลาด: ${
          error?.response?.data?.detail || "เกิดข้อผิดพลาดในการอัปโหลดไฟล์"
        }`,
      );
    } finally {
      setBusy(false);
    }
  }, [
    files,
    processingMode,
    useTemplate,
    templateFile,
    router,
    fetchDocuments,
    batchMode,
    clearCompareCaches,
  ]);

  const handleClearAll = async () => {
    if (!confirm("คุณแน่ใจหรือไม่ที่จะลบเอกสารทั้งหมด")) return;

    setBusy(true);
    try {
      const token = sessionStorage.getItem("access_token");
      if (!token) {
        alert("กรุณาเข้าสู่ระบบก่อนใช้งาน");
        router.push("/login");
        return;
      }

      await api.delete(`/documents`);

      const b = activeBatchId || lastBatchId;

      setDocuments([]);
      setUploadResults([]);
      setComparisonResults(null);
      setFiles([]);
      setTemplateFile(null);
      setUseTemplate(false);
      setLastBatchId(null);
      setActiveBatchId(null);
      setSelectedDocId(null);
      setActiveTab("upload");
      setBatchUsesTemplate(null);

      if (b) {
        localStorage.removeItem(templateCacheKey(b));
        clearCompareCaches(b);
      }

      sessionStorage.removeItem("last_batch_id");

      await fetchDocuments(undefined);

      alert("ลบเอกสารทั้งหมดเรียบร้อยแล้ว");
    } catch (e: any) {
      console.error(e);
      if (e?.response?.status === 401) return;

      alert("เกิดข้อผิดพลาดในการลบเอกสาร");
    } finally {
      setBusy(false);
    }
  };

  // ✅ Delete single document (เคลียร์ cache ของ batch ด้วย)
  const handleDeleteDocument = async (docId: string) => {
    const name = displayDocName(docId);
    if (!confirm(`ต้องการลบเอกสาร ${name} หรือไม่`)) return;

    setBusy(true);
    try {
      const token = sessionStorage.getItem("access_token");
      if (!token) {
        alert("กรุณาเข้าสู่ระบบก่อนใช้งาน");
        return;
      }

      await api.delete(`/documents/${docId}`);

      const b = activeBatchId || lastBatchId;
      const docsAfterDelete = await fetchDocuments(b ?? undefined);

      if (b && docsAfterDelete.length === 0) {
        localStorage.removeItem(templateCacheKey(b));
        setBatchUsesTemplate(null);
        setUseTemplate(false);
        setTemplateFile(null);
      }

      setComparisonResults(null);
      clearCompareCaches(b);

      if (selectedDocId === docId) setSelectedDocId(null);

      alert(`ลบเอกสาร ${name} เรียบร้อยแล้ว`);
    } catch (error: any) {
      console.error("Delete document error:", error);
      if (error?.response?.status === 401) return;

      alert(
        `เกิดข้อผิดพลาดในการลบเอกสาร: ${
          error?.response?.data?.detail || error.message
        }`,
      );
    } finally {
      setBusy(false);
    }
  };

  const exportResults = () => {
    const rows = sortedResults;

    if (!rows || rows.length === 0) {
      alert("ไม่มีผลการเปรียบเทียบให้ Export");
      return;
    }

    const csvEscape = (value: unknown) => {
      const s = String(value ?? "");
      const needsQuote = /[",\n\r]/.test(s);
      const escaped = s.replace(/"/g, '""');
      return needsQuote ? `"${escaped}"` : escaped;
    };

    const header = [
      "เอกสาร 1",
      "เอกสาร 2",
      "คะแนนรวม",
      "ความคล้ายข้อความ",
      "ความคล้าย Semantic",
      "ความคล้าย Lexical",
      "ความคล้ายรูปภาพ",
      "รูปภาพที่ตรงกัน",
      "รูปภาพทั้งหมด",
      "ระดับความคล้าย",
    ];

    const body = rows.map((r) => [
      displayDocName(r.doc_1),
      displayDocName(r.doc_2),
      formatScore(r.combined_score),
      formatScore(r.text_similarity),
      formatScore(r.semantic_similarity),
      formatScore(r.lexical_similarity),
      formatScore(r.image_similarity),
      r.matched_images,
      r.total_images,
      r.level,
    ]);

    const csv = [header, ...body]
      .map((row) => row.map(csvEscape).join(","))
      .join("\n");

    const filename = `plagiarism_results_${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const revokePairBlobs = () => {
    if (pairBlob1) URL.revokeObjectURL(pairBlob1);
    if (pairBlob2) URL.revokeObjectURL(pairBlob2);
  };

  useEffect(() => {
    return () => {
      if (pairBlob1) URL.revokeObjectURL(pairBlob1);
      if (pairBlob2) URL.revokeObjectURL(pairBlob2);
    };
  }, [pairBlob1, pairBlob2]);

  const fetchPreviewBlobUrl = async (docId: string, batchId?: string) => {
    const params = batchId ? { batch_id: batchId } : undefined;

    const res = await api.get(
      `/documents/${encodeURIComponent(docId)}/preview-url`,
      { params },
    );

    const signedUrl: string | undefined = res.data?.url;
    if (!signedUrl) throw new Error("No preview url returned");

    const pdfRes = await fetch(signedUrl);
    if (!pdfRes.ok) throw new Error("Failed to fetch PDF blob");

    const blob = await pdfRes.blob();
    const blobUrl = URL.createObjectURL(
      new Blob([blob], { type: "application/pdf" }),
    );

    return { signedUrl, blobUrl };
  };

  const openPairPreview = async (
    doc1Raw: string,
    doc2Raw: string,
    index?: number,
  ) => {
    if (typeof index === "number") setPairIndex(index);
    const doc1 = resolveToDocId(doc1Raw);
    const doc2 = resolveToDocId(doc2Raw);

    if (!doc1 || !doc2) {
      setPairOpen(true);
      setPairLoading(false);
      setPairError(
        "หา doc_id ไม่เจอ (ค่า doc_1/doc_2 จาก compare อาจเป็นชื่อไฟล์)",
      );
      return;
    }

    const b = activeBatchId || lastBatchId || undefined;

    setPairOpen(true);
    setPairLoading(true);
    setPairError(null);

    setPairDoc1(doc1);
    setPairDoc2(doc2);

    revokePairBlobs();
    setPairBlob1(null);
    setPairBlob2(null);
    setPairSigned1(null);
    setPairSigned2(null);

    try {
      const [a, bb] = await Promise.all([
        fetchPreviewBlobUrl(doc1, b),
        fetchPreviewBlobUrl(doc2, b),
      ]);

      setPairSigned1(a.signedUrl);
      setPairSigned2(bb.signedUrl);
      setPairBlob1(a.blobUrl);
      setPairBlob2(bb.blobUrl);
    } catch (e: any) {
      setPairError(e?.message || "เปิดพรีวิวไม่สำเร็จ");
    } finally {
      setPairLoading(false);
    }
  };

  const closePairPreview = () => {
    revokePairBlobs();
    setPairOpen(false);
    setPairLoading(false);
    setPairError(null);

    setPairDoc1(null);
    setPairDoc2(null);

    setPairSigned1(null);
    setPairSigned2(null);
    setPairBlob1(null);
    setPairBlob2(null);
  };

  // ✅ Right sidebar component
  const DocumentSidebar = () => {
    return (
      <div className="bg-white rounded-lg shadow border border-gray-100 flex flex-col lg:max-h-[calc(100vh-180px)]">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-gray-900">เอกสารในระบบ</h3>
            <button
              onClick={() =>
                fetchDocuments((activeBatchId || lastBatchId) ?? undefined)
              }
              className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
              title="รีเฟรช"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {documents.length > 0 && (
            <>
              <p className="text-xs text-gray-600">
                {documents.length} ไฟล์พร้อมเปรียบเทียบ
              </p>

              <div className="mt-2 flex flex-wrap gap-2">
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${
                    batchUsesTemplate
                      ? "bg-blue-50 text-blue-700 border-blue-200"
                      : "bg-gray-50 text-gray-600 border-gray-200"
                  }`}
                >
                  {batchUsesTemplate ? (
                    <CheckCircle className="w-3.5 h-3.5" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5" />
                  )}
                  {batchUsesTemplate ? "ใช้ Template" : "ไม่ใช้ Template"}
                </span>

                {currentBatchMode && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border bg-gray-50 text-gray-700 border-gray-200">
                    {getModeIcon(currentBatchMode)}
                    {getModeText(currentBatchMode)}
                  </span>
                )}
              </div>
            </>
          )}

          <div className="mt-4 space-y-2">
            <button
              data-testid="compare-button"
              onClick={handleProcessAndCompare}
              disabled={busy || isComparing || documents.length < 2}
              className="w-full px-3 py-2.5 text-sm font-semibold rounded-lg text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
            >
              {isComparing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  กำลังเปรียบเทียบ...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  เปรียบเทียบเอกสาร
                </>
              )}
            </button>

            {documents.length > 0 && (
              <button
                onClick={() => {
                  setActiveTab("upload");
                  setPendingOpenUpload(true);
                }}
                className="w-full px-3 py-2.5 text-sm font-semibold rounded-lg text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4" />
                อัปโหลดเอกสารเพิ่มเติม
              </button>
            )}

            {documents.length < 2 && (
              <div className="p-2 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-xs text-yellow-800 text-center flex items-center justify-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  ต้องมีอย่างน้อย 2 เอกสาร
                </p>
              </div>
            )}

            {documents.length > 0 && (
              <button
                onClick={handleClearAll}
                className="w-full px-3 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition flex items-center justify-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5" />
                ลบเอกสารทั้งหมด
              </button>
            )}
          </div>
        </div>

        <div className="p-4 flex-1 overflow-hidden flex flex-col">
          {documents.length === 0 ? (
            <div className="text-center py-10">
              <FolderOpen className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-900 mb-1">
                ยังไม่มีเอกสาร
              </p>
              <p className="text-xs text-gray-500">อัปโหลดไฟล์เพื่อเริ่มต้น</p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
              {documents.map((doc, idx) => {
                const active = selectedDocId === doc.doc_id;
                return (
                  <div
                    key={`${doc.doc_id}-${idx}`}
                    className={`relative group p-3 rounded-lg border transition ${
                      active
                        ? "border-blue-400 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    <button
                      onClick={() =>
                        setSelectedDocId(active ? null : doc.doc_id)
                      }
                      className="w-full text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                            active ? "bg-blue-100" : "bg-gray-100"
                          }`}
                        >
                          <FileText
                            className={`w-5 h-5 ${
                              active ? "text-blue-600" : "text-gray-600"
                            }`}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {doc.file_name || doc.doc_id || "ไม่ทราบชื่อไฟล์"}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-gray-500 flex items-center gap-1">
                              {getModeIcon(doc.processing_mode)}
                              {getModeText(doc.processing_mode)}
                            </span>
                          </div>
                          {doc.cached && (
                            <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">
                              ⚡ Cache
                            </span>
                          )}
                        </div>
                      </div>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDocument(doc.doc_id);
                      }}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg"
                      title="ลบเอกสาร"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    {doc.status === "error" && (
                      <div className="mt-2 text-xs text-red-600 flex items-center gap-1">
                        <XCircle className="w-3 h-3" />
                        ผิดพลาด
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  if (!authReady || pageLoading) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-[calc(100vh-72px)] py-6 flex flex-col">
        {/* Tabs Navigation - เหลือแค่ 2 tabs */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px">
              <button
                onClick={() => setActiveTab("upload")}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 transition ${
                  activeTab === "upload"
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                <Upload className="w-5 h-5" />
                <span>อัปโหลดไฟล์</span>
              </button>

              <button
                onClick={() => setActiveTab("compare")}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 transition ${
                  activeTab === "compare"
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                <BarChart3 className="w-5 h-5" />
                <span>ผลการเปรียบเทียบ</span>
                {comparisonResults && comparisonResults.length > 0 && (
                  <span className="ml-1 px-2 py-0.5 text-xs font-semibold bg-green-100 text-green-600 rounded-full">
                    {comparisonResults.length}
                  </span>
                )}
              </button>
            </nav>
          </div>
        </div>

        {/* 2-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT: main content */}
          <div className="lg:col-span-8">
            <div
              className={`bg-white rounded-lg shadow p-8 ${
                activeTab === "upload"
                  ? "lg:min-h-[calc(100vh-180px)] flex flex-col"
                  : ""
              }`}
            >
              {/* Tab: Upload */}
              {activeTab === "upload" && (
                <div className="flex flex-col">
                  <div className="mb-8">
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">
                      อัปโหลดไฟล์ PDF
                    </h2>
                    <p className="text-gray-600">
                      เลือกโหมดการตรวจสอบและอัปโหลดไฟล์ที่ต้องการวิเคราะห์
                    </p>
                  </div>

                  {/* Processing Mode */}
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      โหมดการประมวลผล
                    </label>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div
                        title={
                          modeLocked && currentBatchMode !== 1
                            ? modeLockMessage
                            : ""
                        }
                        className={
                          modeLocked && currentBatchMode !== 1
                            ? "cursor-not-allowed"
                            : ""
                        }
                      >
                        <button
                          onClick={() => onSelectMode(1)}
                          disabled={modeLocked && currentBatchMode !== 1}
                          className={`w-full p-4 border-2 rounded-lg text-left transition ${
                            processingMode === 1
                              ? "border-blue-500 bg-blue-50"
                              : "border-gray-200 hover:border-gray-300"
                          } ${
                            modeLocked && currentBatchMode !== 1
                              ? "opacity-50 cursor-not-allowed"
                              : ""
                          }`}
                        >
                          <div className="flex items-center mb-2">
                            <FileText className="w-5 h-5 mr-2.5 text-blue-600" />
                            <span className="font-semibold text-sm text-gray-900">
                              ข้อความเท่านั้น
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 leading-snug">
                            วิเคราะห์เนื้อหาข้อความ
                          </p>
                        </button>
                      </div>

                      <div
                        title={
                          modeLocked && currentBatchMode !== 2
                            ? modeLockMessage
                            : ""
                        }
                        className={
                          modeLocked && currentBatchMode !== 2
                            ? "cursor-not-allowed"
                            : ""
                        }
                      >
                        <button
                          onClick={() => onSelectMode(2)}
                          disabled={modeLocked && currentBatchMode !== 2}
                          className={`w-full p-4 border-2 rounded-lg text-left transition ${
                            processingMode === 2
                              ? "border-blue-500 bg-blue-50"
                              : "border-gray-200 hover:border-gray-300"
                          } ${
                            modeLocked && currentBatchMode !== 2
                              ? "opacity-50 cursor-not-allowed"
                              : ""
                          }`}
                        >
                          <div className="flex items-center mb-2">
                            <ImageIcon className="w-5 h-5 mr-2.5 text-purple-600" />
                            <span className="font-semibold text-sm text-gray-900">
                              รูปภาพเท่านั้น
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 leading-snug">
                            วิเคราะห์รูปภาพและแผนภาพ
                          </p>
                        </button>
                      </div>

                      <div
                        title={
                          modeLocked && currentBatchMode !== 3
                            ? modeLockMessage
                            : ""
                        }
                        className={
                          modeLocked && currentBatchMode !== 3
                            ? "cursor-not-allowed"
                            : ""
                        }
                      >
                        <button
                          onClick={() => onSelectMode(3)}
                          disabled={modeLocked && currentBatchMode !== 3}
                          className={`w-full p-4 border-2 rounded-lg text-left transition ${
                            processingMode === 3
                              ? "border-blue-500 bg-blue-50"
                              : "border-gray-200 hover:border-gray-300"
                          } ${
                            modeLocked && currentBatchMode !== 3
                              ? "opacity-50 cursor-not-allowed"
                              : ""
                          }`}
                        >
                          <div className="flex items-center mb-2">
                            <Settings className="w-5 h-5 mr-2.5 text-green-600" />
                            <span className="font-semibold text-sm text-gray-900">
                              ข้อความ + รูปภาพ
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 leading-snug">
                            วิเคราะห์ทั้งสองแบบ
                          </p>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Template Option */}

                  <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50">
                    <div className="px-6 py-3 flex items-center">
                      <label
                        className={`flex items-center gap-2 select-none ${
                          templateDisabled
                            ? "cursor-not-allowed opacity-60"
                            : "cursor-pointer"
                        }`}
                        title={templateDisabled ? templateLockMessage : ""}
                      >
                        <input
                          type="checkbox"
                          id="useTemplate"
                          checked={useTemplate}
                          disabled={templateDisabled}
                          onChange={(e) => setUseTemplate(e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                        />
                        <span className="text-sm font-medium text-gray-700">
                          ใช้ไฟล์ Template เพื่อลบข้อความซ้ำ
                        </span>
                      </label>
                    </div>

                    {imageModeNoTemplate ? (
                      <div className="px-6 pb-3 space-y-1 -mt-1">
                        <p className="text-xs font-medium text-gray-700">
                          โหมดรูปภาพเท่านั้นไม่รองรับ Template
                        </p>
                        <p className="text-xs text-gray-500">
                          Template ใช้ได้เฉพาะโหมดข้อความ และ ข้อความ + รูปภาพ
                        </p>
                      </div>
                    ) : documents.length > 0 ? (
                      <div className="px-6 pb-3 space-y-1 -mt-1">
                        <p
                          className={`text-xs font-medium ${
                            batchUsesTemplate
                              ? "text-blue-700"
                              : "text-gray-600"
                          }`}
                        >
                          {batchUsesTemplate
                            ? "Batch นี้ใช้ Template อยู่"
                            : "Batch นี้ไม่ได้ใช้ Template"}
                        </p>
                        <p className="text-xs text-gray-500">
                          หลังเริ่มประมวลผล ระบบจะซ่อนช่องอัปโหลด Template
                          และใช้ค่าของ batch นี้ต่อไป
                        </p>
                      </div>
                    ) : null}

                    {useTemplate && !templateDisabled && (
                      <div className="px-6 pb-4">
                        <div
                          {...getTemplateRootProps()}
                          className={`w-full box-border border-2 border-dashed rounded-lg p-6 text-center transition ${
                            isTemplateDragActive
                              ? "border-blue-400 bg-blue-50 cursor-pointer"
                              : "border-gray-300 bg-white hover:border-gray-400 cursor-pointer"
                          }`}
                        >
                          <input
                            {...getTemplateInputProps()}
                            data-testid="template-input"
                          />
                          {templateFile ? (
                            <div className="flex items-center justify-between">
                              <div className="flex items-center min-w-0">
                                <FileText className="w-5 h-5 text-blue-600 mr-3 shrink-0" />
                                <div className="text-left min-w-0">
                                  <p className="text-sm font-medium text-gray-900 truncate">
                                    {templateFile.name}
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    {(
                                      templateFile.size /
                                      (1024 * 1024)
                                    ).toFixed(2)}{" "}
                                    MB
                                  </p>
                                </div>
                              </div>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeTemplateFile();
                                }}
                                className="ml-3 shrink-0 text-red-600 hover:text-red-700"
                              >
                                <XCircle className="w-5 h-5" />
                              </button>
                            </div>
                          ) : (
                            <div>
                              <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                              <p className="text-sm text-gray-600">
                                วางไฟล์ Template PDF หรือคลิกเพื่อเลือก
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Drop Zone */}
                  <div>
                    <div
                      {...getRootProps({
                        onClick: (e) => {
                          e.preventDefault();
                          open();
                        },
                      })}
                      className={`border-2 border-dashed rounded-lg p-16 text-center transition mb-6 flex-1 min-h-0 flex flex-col justify-center ${
                        isDragActive
                          ? "border-blue-400 bg-blue-50 cursor-pointer"
                          : "border-gray-300 bg-gray-50 hover:border-gray-400 cursor-pointer"
                      }`}
                    >
                      <input {...getInputProps()} data-testid="upload-input" />
                      <Upload className="w-16 h-16 text-gray-400 mx-auto mb-4" />

                      {isDragActive ? (
                        <p className="text-xl text-blue-600 font-medium">
                          วางไฟล์ PDF ที่นี่...
                        </p>
                      ) : (
                        <div>
                          <p className="text-xl text-gray-700 mb-2 font-medium">
                            ลากไฟล์ PDF มาที่นี่
                          </p>
                          <p className="text-sm text-gray-500">
                            รองรับการลากวางหลายไฟล์
                            หรือกดปุ่มด้านล่างเพื่อเลือกไฟล์
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Selected Files Trigger */}
                  {files.length > 0 && (
                    <div className="mb-6 flex items-center justify-between">
                      <p className="text-sm text-gray-600">
                        เลือกแล้ว {files.length} ไฟล์
                      </p>

                      <button
                        onClick={() => setShowFileModal(true)}
                        className="text-sm text-blue-600 hover:underline"
                      >
                        ดูไฟล์ที่เลือก
                      </button>
                    </div>
                  )}

                  {showFileModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                      <div className="bg-white rounded-xl w-full max-w-lg shadow-lg">
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b">
                          <h3 className="text-lg font-semibold text-gray-900">
                            ไฟล์ที่เลือก ({files.length})
                          </h3>
                          <button onClick={() => setShowFileModal(false)}>
                            <X className="w-5 h-5 text-gray-500 hover:text-gray-700" />
                          </button>
                        </div>

                        {/* Body */}
                        <div className="space-y-2 max-h-80 overflow-y-auto px-6 py-4">
                          {files.map((file, index) => (
                            <div
                              key={index}
                              className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-100"
                            >
                              <div className="flex items-center min-w-0 flex-1">
                                <FileText className="w-5 h-5 text-blue-600 mr-3 shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-gray-900 truncate">
                                    {file.name}
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    {(file.size / (1024 * 1024)).toFixed(2)} MB
                                  </p>
                                </div>
                              </div>

                              <button
                                onClick={() => removeFile(index)}
                                className="ml-3 text-gray-400 hover:text-red-600 transition shrink-0"
                              >
                                <XCircle className="w-5 h-5" />
                              </button>
                            </div>
                          ))}
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 border-t flex items-center justify-between">
                          <button
                            onClick={clearFiles}
                            className="text-sm text-red-600 hover:text-red-700 flex items-center gap-1"
                          >
                            <Trash2 className="w-4 h-4" />
                            ลบทั้งหมด
                          </button>

                          <button
                            onClick={() => {
                              setShowFileModal(false);
                              handleUpload();
                            }}
                            disabled={files.length === 0 || busy}
                            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-semibold transition"
                          >
                            อัปโหลดไฟล์
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Upload Button */}

                  <div>
                    <button
                      data-testid="upload-button"
                      onClick={() => {
                        if (files.length === 0) {
                          open();
                          return;
                        }
                        handleUpload();
                      }}
                      disabled={busy || mustUploadTemplate}
                      className="w-full flex items-center justify-center px-6 py-4 text-lg font-semibold rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
                    >
                      {busy ? (
                        <>
                          <Loader2 className="w-6 h-6 mr-2 animate-spin" />
                          กำลังอัปโหลด...
                        </>
                      ) : files.length === 0 ? (
                        <>
                          <FolderOpen className="w-6 h-6 mr-2" />
                          เลือกไฟล์
                        </>
                      ) : (
                        <>
                          <Upload className="w-6 h-6 mr-2" />
                          {documents.length > 0
                            ? "อัปโหลดเอกสารเพิ่มเติม"
                            : "อัปโหลดไฟล์"}
                        </>
                      )}
                    </button>
                  </div>

                  {/* Upload Results */}
                </div>
              )}

              {showUploadResultModal && (
                <div
                  data-testid="upload-success-modal"
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
                >
                  <div className="bg-white rounded-xl w-full max-w-xl shadow-lg">
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b">
                      <h3 className="text-lg font-semibold text-green-700 flex items-center gap-2">
                        <CheckCircle className="w-5 h-5" />
                        อัปโหลดสำเร็จ!
                      </h3>
                      <button onClick={() => setShowUploadResultModal(false)}>
                        <X className="w-5 h-5 text-gray-500 hover:text-gray-700" />
                      </button>
                    </div>

                    {/* Body */}
                    <div className="max-h-80 overflow-y-auto px-6 py-4 space-y-2">
                      {uploadResults.map((result, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg"
                        >
                          <span className="text-sm font-medium text-gray-900">
                            {result.file_name || result.doc_id}
                          </span>

                          <span className="px-2 py-0.5 text-xs font-medium bg-green-200 text-green-800 rounded">
                            สำเร็จ
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-4 border-t flex justify-between">
                      <button
                        onClick={() => setShowUploadResultModal(false)}
                        className="text-sm text-gray-600 hover:underline"
                      >
                        ปิด
                      </button>

                      <button
                        onClick={async () => {
                          setShowUploadResultModal(false);

                          const batchId =
                            sessionStorage.getItem("last_batch_id") ||
                            activeBatchId ||
                            lastBatchId;

                          if (!batchId) {
                            alert("ไม่พบ batch สำหรับเปรียบเทียบ");
                            return;
                          }

                          await handleCompare(batchId); // ✅ สั่ง compare จริง แล้วไปแท็บผลให้เอง
                        }}
                        disabled={isComparing}
                        className="bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white px-5 py-2 rounded-lg font-semibold inline-flex items-center gap-2"
                      >
                        {isComparing ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            กำลังเปรียบเทียบ...
                          </>
                        ) : (
                          "เปรียบเทียบเอกสาร"
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab: Compare & Results */}
              {activeTab === "compare" && (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex items-start justify-between mb-6">
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 mb-1">
                        ผลการเปรียบเทียบ
                      </h2>
                      <p className="text-sm text-gray-600">
                        วิเคราะห์ความคล้ายคลึงระหว่างเอกสาร
                      </p>
                    </div>

                    {comparisonResults && comparisonResults.length > 0 && (
                      <div className="flex items-center gap-2">
                        {/* ✅ Export เดิม */}
                        <button
                          onClick={exportResults}
                          className="px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition flex items-center gap-2"
                        >
                          <Download className="w-4 h-4" />
                          Export CSV
                        </button>
                      </div>
                    )}
                  </div>

                  {comparisonResults && comparisonResults.length > 0 ? (
                    <>
                      {/* Stats Summary */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                          <div className="text-center">
                            <p className="text-xs text-gray-600 mb-1">
                              ผลการเปรียบเทียบ
                            </p>
                            <p className="text-2xl font-bold text-gray-900">
                              {comparisonResults.length}
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={() =>
                            setCompareFilter((v) =>
                              v === "very" ? "all" : "very",
                            )
                          }
                          className={`bg-red-50 rounded-xl p-3 border transition ${
                            compareFilter === "very"
                              ? "border-red-400 ring-2 ring-red-200"
                              : "border-red-100"
                          }`}
                        >
                          <div className="text-center">
                            <p className="text-xs text-gray-600 mb-1">
                              คล้ายระดับสูง
                            </p>
                            <p className="text-2xl font-bold text-red-600">
                              {countVery}
                            </p>
                          </div>
                        </button>

                        <button
                          onClick={() =>
                            setCompareFilter((v) =>
                              v === "high" ? "all" : "high",
                            )
                          }
                          className={`bg-orange-50 rounded-xl p-3 border transition ${
                            compareFilter === "high"
                              ? "border-orange-400 ring-2 ring-orange-200"
                              : "border-orange-100"
                          }`}
                        >
                          <div className="text-center">
                            <p className="text-xs text-gray-600 mb-1">
                              คล้ายระดับกลาง
                            </p>
                            <p className="text-2xl font-bold text-orange-600">
                              {countHigh}
                            </p>
                          </div>
                        </button>

                        <button
                          onClick={() =>
                            setCompareFilter((v) =>
                              v === "low" ? "all" : "low",
                            )
                          }
                          className={`bg-green-50 rounded-xl p-3 border transition ${
                            compareFilter === "low"
                              ? "border-green-400 ring-2 ring-green-200"
                              : "border-green-100"
                          }`}
                        >
                          <div className="text-center">
                            <p className="text-xs text-gray-600 mb-1">
                              คล้ายระดับตํ่า
                            </p>
                            <p className="text-2xl font-bold text-green-600">
                              {countLow}
                            </p>
                          </div>
                        </button>
                      </div>

                      {/* ✅ Controls ใต้กล่องสรุป: เหลือแค่ icon */}
                      <div className="mt-4 mb-6 flex items-center justify-between">
                        <div className="text-sm text-gray-600">
                          กำลังแสดง:{" "}
                          <span className="font-semibold text-gray-900">
                            {sortedResults.length}
                          </span>{" "}
                          รายการ
                          {compareFilter !== "all" && (
                            <span className="ml-2 text-xs text-gray-500">
                              (กรอง:{" "}
                              {compareFilter === "very"
                                ? "คล้ายระดับสูง"
                                : compareFilter === "high"
                                  ? "คล้ายระดับกลาง"
                                  : "คล้ายระดับตํ่า"}
                              )
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setSortOrder((v) => (v === "desc" ? "asc" : "desc"))
                          }
                          className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-900"
                          title={
                            sortOrder === "desc"
                              ? "คะแนนมาก → น้อย"
                              : "คะแนนน้อย → มาก"
                          }
                        >
                          {sortOrder === "desc" ? (
                            <ArrowDownWideNarrow className="w-5 h-5" />
                          ) : (
                            <ArrowUpNarrowWide className="w-5 h-5" />
                          )}
                        </button>
                      </div>

                      {/* Results List */}
                      <div className="space-y-3 overflow-y-auto min-h-0 pr-1">
                        {sortedResults.map((result, index) => {
                          const isImageOnly = result.processing_mode === 2;
                          const isTextOnly = result.processing_mode === 1;

                          return (
                            <div
                              key={index}
                              onClick={() =>
                                openPairPreview(
                                  result.doc_1,
                                  result.doc_2,
                                  index,
                                )
                              }
                              className="border rounded-xl p-4 hover:shadow-md transition cursor-pointer hover:bg-gray-50"
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  openPairPreview(
                                    result.doc_1,
                                    result.doc_2,
                                    index,
                                  );
                                }
                              }}
                            >
                              {/* Row: doc names + score */}
                              <div className="flex items-start justify-between gap-4 mb-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                                      <FileText className="w-4 h-4 text-gray-600" />
                                    </div>
                                    <span className="text-sm font-semibold text-gray-900 truncate">
                                      {displayDocName(result.doc_1)}
                                    </span>
                                  </div>

                                  <ArrowRight className="w-4 h-4 text-gray-400 shrink-0" />

                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                                      <FileText className="w-4 h-4 text-gray-600" />
                                    </div>
                                    <span className="text-sm font-semibold text-gray-900 truncate">
                                      {displayDocName(result.doc_2)}
                                    </span>
                                  </div>

                                  <span
                                    className={`px-2.5 py-0.5 text-xs font-medium rounded-full border shrink-0 ${getLevelColor(
                                      result.level,
                                    )}`}
                                  >
                                    {result.level}
                                  </span>
                                </div>

                                <div className="text-right shrink-0">
                                  <div className="text-2xl font-bold text-gray-900 leading-none">
                                    {formatScore(result.combined_score)}
                                  </div>
                                  <div className="text-xs text-gray-500 mt-1">
                                    คะแนนรวม
                                  </div>
                                </div>
                              </div>

                              {/* Metrics */}
                              <div
                                className={`grid gap-3 ${
                                  isImageOnly
                                    ? "grid-cols-3"
                                    : "grid-cols-2 md:grid-cols-4"
                                }`}
                              >
                                {/* TEXT */}
                                {!isImageOnly && (
                                  <>
                                    <div className="bg-blue-50 rounded-xl p-3 text-center border border-blue-100">
                                      <div className="text-xl font-bold text-blue-600 mb-0.5 leading-none">
                                        {formatScore(result.text_similarity)}
                                      </div>
                                      <div className="text-[11px] text-blue-700 font-medium">
                                        ความคล้ายข้อความ
                                      </div>
                                    </div>

                                    <div className="bg-purple-50 rounded-xl p-3 text-center border border-purple-100">
                                      <div className="text-xl font-bold text-purple-600 mb-0.5 leading-none">
                                        {formatScore(
                                          result.semantic_similarity,
                                        )}
                                      </div>
                                      <div className="text-[11px] text-purple-700 font-medium">
                                        Semantic
                                      </div>
                                      <div className="text-[10px] text-purple-500 mt-0.5">
                                        ความหมายของข้อความ
                                      </div>
                                    </div>

                                    <div className="bg-indigo-50 rounded-xl p-3 text-center border border-indigo-100">
                                      <div className="text-xl font-bold text-indigo-600 mb-0.5 leading-none">
                                        {formatScore(result.lexical_similarity)}
                                      </div>
                                      <div className="text-[11px] text-indigo-700 font-medium">
                                        Lexical
                                      </div>
                                      <div className="text-[10px] text-indigo-500 mt-0.5">
                                        คำที่เหมือนกัน
                                      </div>
                                    </div>
                                  </>
                                )}

                                {/* IMAGE */}
                                {!isTextOnly && (
                                  <div className="bg-green-50 rounded-xl p-3 text-center border border-green-100">
                                    <div className="text-xl font-bold text-green-600 mb-0.5 leading-none">
                                      {formatScore(result.image_similarity)}
                                    </div>
                                    <div className="text-[11px] text-green-700 font-medium">
                                      ความคล้ายรูปภาพ
                                    </div>
                                    <div className="text-[10px] text-green-500 mt-0.5">
                                      CLIP + pHash
                                    </div>
                                  </div>
                                )}

                                {/* IMAGE ONLY MODE */}
                                {isImageOnly && result.total_images > 0 && (
                                  <>
                                    <div className="bg-blue-50 rounded-xl p-3 text-center border border-blue-100">
                                      <div className="text-xl font-bold text-blue-600 mb-0.5 leading-none">
                                        {formatScore(result.image_cosine_avg)}
                                      </div>
                                      <div className="text-[11px] text-blue-700 font-medium">
                                        CLIP
                                      </div>
                                    </div>

                                    <div className="bg-purple-50 rounded-xl p-3 text-center border border-purple-100">
                                      <div className="text-xl font-bold text-purple-600 mb-0.5 leading-none">
                                        {formatScore(result.image_phash_avg)}
                                      </div>
                                      <div className="text-[11px] text-purple-700 font-medium">
                                        pHash
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-14">
                      <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-3" />
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">
                        ยังไม่มีผลการเปรียบเทียบ
                      </h3>
                      <p className="text-sm text-gray-600 mb-5">
                        กรุณาอัปโหลดเอกสารและกดปุ่มเปรียบเทียบ
                      </p>
                      <button
                        onClick={() => setActiveTab("upload")}
                        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition inline-flex items-center gap-2"
                      >
                        <Upload className="w-4 h-4" />
                        ไปหน้าอัปโหลด
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: sticky docs panel */}
          <div className="lg:col-span-4">
            <div className="lg:sticky lg:top-8 lg:max-h-[calc(100vh-180px)]">
              <DocumentSidebar />
            </div>
          </div>
        </div>
      </div>
      {pairOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={closePairPreview}
        >
          <div
            className="bg-white rounded-2xl w-[96vw] max-w-7xl h-[90vh] shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div className="min-w-0">
                <div className="text-sm text-gray-500">
                  พรีวิวเอกสาร (2 ไฟล์)
                </div>
                <div className="text-base font-semibold text-gray-900 truncate">
                  {pairDoc1 ? displayDocName(pairDoc1) : "-"}{" "}
                  <span className="text-gray-400 mx-2">vs</span>{" "}
                  {pairDoc2 ? displayDocName(pairDoc2) : "-"}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    goPair(-1);
                  }}
                  disabled={pairIndex === null || pairIndex <= 0 || pairLoading}
                  className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-sm text-gray-900"
                  title="คู่ก่อนหน้า"
                >
                  ◀ ก่อนหน้า
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    goPair(1);
                  }}
                  disabled={
                    pairIndex === null ||
                    pairIndex >= sortedResults.length - 1 ||
                    pairLoading
                  }
                  className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-sm text-gray-900"
                  title="คู่ถัดไป"
                >
                  ถัดไป ▶
                </button>

                {/* (option) แสดงเลขลำดับ */}
                <div className="text-xs text-gray-500 px-2">
                  {pairIndex !== null
                    ? `${pairIndex + 1}/${sortedResults.length}`
                    : "-"}
                </div>
                {pairSigned1 && (
                  <a
                    href={pairSigned1}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm text-gray-900"
                    title="เปิดไฟล์ซ้ายในแท็บใหม่"
                    onClick={(e) => e.stopPropagation()}
                  >
                    เปิดซ้าย
                  </a>
                )}
                {pairSigned2 && (
                  <a
                    href={pairSigned2}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm text-gray-900"
                    title="เปิดไฟล์ขวาในแท็บใหม่"
                    onClick={(e) => e.stopPropagation()}
                  >
                    เปิดขวา
                  </a>
                )}
                <button
                  onClick={closePairPreview}
                  className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm text-gray-900"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 bg-gray-50 p-4">
              {pairLoading ? (
                <div className="h-full flex items-center justify-center text-gray-700">
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  กำลังโหลดพรีวิว...
                </div>
              ) : pairError ? (
                <div className="h-full flex items-center justify-center text-red-600">
                  {pairError}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
                  {/* Left */}
                  <div className="bg-white border rounded-xl overflow-hidden flex flex-col">
                    <div className="px-4 py-2 border-b text-sm font-medium text-gray-900 truncate">
                      {pairDoc1 ? displayDocName(pairDoc1) : "-"}
                    </div>
                    <div className="flex-1">
                      {pairBlob1 ? (
                        <object
                          data={pairBlob1}
                          type="application/pdf"
                          className="w-full h-full"
                        >
                          <div className="p-6 text-gray-700">
                            เบราว์เซอร์ไม่รองรับการแสดง PDF —
                            {pairBlob1 && (
                              <a
                                className="ml-2 text-blue-600 underline"
                                href={pairBlob1}
                                target="_blank"
                                rel="noreferrer"
                              >
                                เปิดแท็บใหม่
                              </a>
                            )}
                          </div>
                        </object>
                      ) : (
                        <div className="h-full flex items-center justify-center text-gray-500">
                          ไม่พบพรีวิว
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right */}
                  <div className="bg-white border rounded-xl overflow-hidden flex flex-col">
                    <div className="px-4 py-2 border-b text-sm font-medium text-gray-900 truncate">
                      {pairDoc2 ? displayDocName(pairDoc2) : "-"}
                    </div>
                    <div className="flex-1">
                      {pairBlob2 ? (
                        <object
                          data={pairBlob2}
                          type="application/pdf"
                          className="w-full h-full"
                        >
                          <div className="p-6 text-gray-700">
                            เบราว์เซอร์ไม่รองรับการแสดง PDF —
                            {pairBlob2 && (
                              <a
                                className="ml-2 text-blue-600 underline"
                                href={pairBlob2}
                                target="_blank"
                                rel="noreferrer"
                              >
                                เปิดแท็บใหม่
                              </a>
                            )}
                          </div>
                        </object>
                      ) : (
                        <div className="h-full flex items-center justify-center text-gray-500">
                          ไม่พบพรีวิว
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
