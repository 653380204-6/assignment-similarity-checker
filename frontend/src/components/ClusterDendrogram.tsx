"use client";

import dynamic from "next/dynamic";
import React, { useMemo } from "react";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false }) as any;

type DendroData = {
  icoord: number[][];
  dcoord: number[][];
  leaf_order: string[];
  method: string;
};

function shortenName(name: string, maxLen = 30) {
  if (!name) return "";
  return name.length > maxLen ? `${name.slice(0, maxLen)}...` : name;
}

export default function ClusterDendrogram({
  data,
  threshold,
  displayName,
  viewportHeight = 320,
  leafGap = 24,
  showCutLine = true,
  showMeta = true,
  highlightByThreshold = false,
}: {
  data: DendroData;
  threshold: number;
  displayName: (id: string) => string;
  viewportHeight?: number;
  leafGap?: number;
  showCutLine?: boolean;
  showMeta?: boolean;
  highlightByThreshold?: boolean;
}) {
  const cutX = 1 - threshold;

  const rawLeafBase = 5;
  const rawLeafStep = 10;

  const mapRawY = (y: number) =>
    rawLeafBase + ((y - rawLeafBase) / rawLeafStep) * leafGap;

  const leafY = useMemo(
    () => data.leaf_order.map((_, i) => rawLeafBase + leafGap * i),
    [data.leaf_order, leafGap],
  );

  const fullLeafText = useMemo(
    () => data.leaf_order.map((id, i) => `${i + 1}. ${displayName(id)}`),
    [data.leaf_order, displayName],
  );

  const shortLeafText = useMemo(
    () => fullLeafText.map((t) => shortenName(t, 50)),
    [fullLeafText],
  );
  const maxDistance = useMemo(() => {
    const flat = data.dcoord.flat();
    return flat.length ? Math.max(...flat) : 1;
  }, [data.dcoord]);

  const xMax = useMemo(() => {
    const actualMax = Math.max(maxDistance, cutX);
    return actualMax > 0 ? actualMax * 1.08 : 0.1;
  }, [maxDistance, cutX]);

  const maxLabelLength = useMemo(
    () => Math.max(...shortLeafText.map((t) => t.length), 10),
    [shortLeafText],
  );

  const leftMargin = useMemo(() => {
    return Math.min(Math.max(280, maxLabelLength * 8 + 40), 460);
  }, [maxLabelLength]);

  const plotHeight = useMemo(() => {
    return Math.max(
      viewportHeight,
      data.leaf_order.length * (leafGap + 16) + 180,
    );
  }, [data.leaf_order.length, viewportHeight, leafGap]);

  const tickVals = useMemo(() => {
    const n = 6;
    return Array.from({ length: n + 1 }, (_, i) =>
      Number(((xMax * i) / n).toFixed(2)),
    );
  }, [xMax]);

  const traces = useMemo(() => {
    const activeX: (number | null)[] = [];
    const activeY: (number | null)[] = [];

    const inactiveX: (number | null)[] = [];
    const inactiveY: (number | null)[] = [];

    const allX: (number | null)[] = [];
    const allY: (number | null)[] = [];

    for (let i = 0; i < data.icoord.length; i++) {
      const ys = data.icoord[i];
      const xs = data.dcoord[i];
      const mappedYs = ys.map(mapRawY);

      const mergeDistance = xs[1];

      if (highlightByThreshold) {
        const isActive = mergeDistance <= cutX;

        if (isActive) {
          activeX.push(xs[0], xs[1], xs[2], xs[3], null);
          activeY.push(
            mappedYs[0],
            mappedYs[1],
            mappedYs[2],
            mappedYs[3],
            null,
          );
        } else {
          inactiveX.push(xs[0], xs[1], xs[2], xs[3], null);
          inactiveY.push(
            mappedYs[0],
            mappedYs[1],
            mappedYs[2],
            mappedYs[3],
            null,
          );
        }
      } else {
        allX.push(xs[0], xs[1], xs[2], xs[3], null);
        allY.push(mappedYs[0], mappedYs[1], mappedYs[2], mappedYs[3], null);
      }
    }

    const maxY = Math.max(...leafY) + leafGap / 2;
    const minY = Math.min(...leafY) - leafGap / 2;

    return [
      {
        type: "scatter",
        mode: "lines",
        x: data.leaf_order.flatMap(() => [0, xMax, null]),
        y: data.leaf_order.flatMap((_, i) => [leafY[i], leafY[i], null]),
        name: "leaf guide",
        hoverinfo: "skip",
        showlegend: false,
        line: {
          color: "#cbd5e1",
          width: 0.8,
          dash: "dot",
        },
      },

      ...(highlightByThreshold
        ? [
            {
              type: "scatter",
              mode: "lines",
              x: inactiveX,
              y: inactiveY,
              name: "inactive",
              hoverinfo: "skip",
              showlegend: false,
              line: {
                color: "#94a3b8",
                width: 1.4,
              },
            },
            {
              type: "scatter",
              mode: "lines",
              x: activeX,
              y: activeY,
              name: "active",
              hoverinfo: "skip",
              showlegend: false,
              line: {
                color: "#16a34a",
                width: 2.4,
              },
            },
          ]
        : [
            {
              type: "scatter",
              mode: "lines",
              x: allX,
              y: allY,
              name: "Dendrogram",
              hoverinfo: "skip",
              showlegend: false,
              line: {
                color: "#2563eb",
                width: 1.5,
              },
            },
          ]),

      ...(showCutLine
        ? [
            {
              type: "scatter",
              mode: "lines",
              x: [cutX, cutX],
              y: [minY, maxY],
              name: `cut sim ≥ ${threshold.toFixed(2)}`,
              hoverinfo: "skip",
              showlegend: false,
              line: {
                color: "#dc2626",
                width: 2,
                dash: "dash",
              },
            },
          ]
        : []),
    ] as any[];
  }, [
    data,
    leafY,
    xMax,
    cutX,
    threshold,
    leafGap,
    showCutLine,
    highlightByThreshold,
  ]);

  return (
    <div className="h-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col">
      <div
        className="overflow-auto rounded-lg border border-slate-200"
        style={{ height: `${viewportHeight}px` }}
      >
        <Plot
          data={traces}
          layout={{
            autosize: true,
            height: plotHeight,
            margin: { l: leftMargin, r: 20, t: 16, b: 42 },
            xaxis: {
              range: [0, xMax],
              tickvals: tickVals,
              zeroline: false,
              showline: true,
              linecolor: "#cbd5e1",
              linewidth: 1,
              gridcolor: "#e5e7eb",
              tickfont: {
                size: 12,
                color: "#374151",
              },
              fixedrange: true,
            },
            yaxis: {
              tickmode: "array",
              tickvals: leafY,
              ticktext: shortLeafText,
              showticklabels: true,
              tickfont: {
                size: 12,
                color: "#111827",
              },
              ticklen: 0,
              ticklabelposition: "outside left",
              side: "left",
              zeroline: false,
              showline: false,
              gridcolor: "#f1f5f9",
              autorange: "reversed",
              automargin: false,
              fixedrange: true,
            },
            showlegend: false,
            hovermode: false,
            plot_bgcolor: "#ffffff",
            paper_bgcolor: "#ffffff",
          }}
          config={{
            displayModeBar: false,
            responsive: true,
            scrollZoom: false,
          }}
          style={{ width: "100%" }}
        />
      </div>
    </div>
  );
}
