"use client";

import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

type Props = {
  docId: string;
  batchId: string | null;
  width?: number;
  onClick?: () => void;
};

export default function PdfThumb({
  docId,
  batchId,
  width = 200,
  onClick,
}: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
  }, []);

  const previewPath = useMemo(() => {
    return `/documents/${encodeURIComponent(docId)}/preview-url`;
  }, [docId]);

  useEffect(() => {
    let localUrl: string | null = null;
    const ctrl = new AbortController();

    const run = async () => {
      setLoading(true);
      setBlobUrl(null);

      try {
        const res = await api.get(previewPath, {
          params: batchId ? { batch_id: batchId } : undefined,
          signal: ctrl.signal,
        });

        const signedUrl = res.data?.url;
        if (!signedUrl) throw new Error("no signed url");

        const pdfRes = await fetch(signedUrl, {
          signal: ctrl.signal,
        });

        if (!pdfRes.ok) {
          throw new Error("โหลด PDF ไม่สำเร็จ");
        }

        const blob = await pdfRes.blob();
        localUrl = URL.createObjectURL(
          new Blob([blob], { type: "application/pdf" }),
        );
        setBlobUrl(localUrl);
      } catch (e: any) {
        if (ctrl.signal.aborted) return;
        if (e?.response?.status === 401) return;
        setBlobUrl(null);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    };

    run();

    return () => {
      ctrl.abort();
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [previewPath, batchId]);

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left w-full rounded-lg border bg-white hover:bg-gray-50 p-2"
      title="คลิกเพื่อดูเต็ม"
    >
      <div className="w-full flex justify-center">
        {loading ? (
          <div className="h-[220px] w-full flex items-center justify-center text-gray-500 text-sm">
            Loading...
          </div>
        ) : blobUrl ? (
          <Document file={blobUrl} loading="">
            <Page
              pageNumber={1}
              width={width}
              renderTextLayer={false}
              renderAnnotationLayer={false}
            />
          </Document>
        ) : (
          <div className="h-[220px] w-full flex items-center justify-center text-gray-500 text-sm">
            No preview
          </div>
        )}
      </div>

      <div className="mt-2 text-xs text-gray-700 truncate">{docId}</div>
    </button>
  );
}
