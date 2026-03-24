from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter(tags=["dendrogram"])  # ต้องอยู่บนสุดระดับไฟล์


class PairIn(BaseModel):
    doc_1: str
    doc_2: str
    final_score: float  # 0..1


class DendroReq(BaseModel):
    doc_ids: Optional[List[str]] = None
    pairs: List[PairIn]
    method: str = "single"


def _condensed_index(i: int, j: int, n: int) -> int:
    return n * i - (i * (i + 1)) // 2 + (j - i - 1)


@router.post("/dendrogram")
def build_dendrogram(req: DendroReq):
    try:
        import numpy as np
        from scipy.cluster.hierarchy import linkage, dendrogram
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SciPy import failed: {e}")

    doc_set = set(req.doc_ids or [])
    for p in req.pairs:
        doc_set.add(p.doc_1)
        doc_set.add(p.doc_2)
    docs = sorted(list(doc_set))
    n = len(docs)

    if n < 2:
        return {
            "docs": docs,
            "icoord": [],
            "dcoord": [],
            "leaf_order": docs,
            "method": req.method,
        }

    idx = {d: i for i, d in enumerate(docs)}
    m = n * (n - 1) // 2
    cd = np.ones(m, dtype=float)

    for p in req.pairs:
        a = idx.get(p.doc_1)
        b = idx.get(p.doc_2)
        if a is None or b is None or a == b:
            continue
        i, j = (a, b) if a < b else (b, a)
        k = _condensed_index(i, j, n)
        dist = float(1.0 - max(0.0, min(1.0, p.final_score)))
        if dist < cd[k]:
            cd[k] = dist

    Z = linkage(cd, method=req.method)
    dd = dendrogram(Z, labels=docs, no_plot=True)

    return {
        "docs": docs,
        "icoord": dd["icoord"],
        "dcoord": dd["dcoord"],
        "leaf_order": dd["ivl"],
        "method": req.method,
    }
