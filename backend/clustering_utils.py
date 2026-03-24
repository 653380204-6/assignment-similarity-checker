def cluster_by_threshold(results: list, threshold: float) -> list:
    if threshold is None:
        raise ValueError("threshold must be provided")
    """
    จัดกลุ่มเอกสารตาม similarity threshold โดยใช้ connected components algorithm
    
    Args:
        results: list of tuples [(doc_1, doc_2, score), ...]
                 ตัวอย่าง: [("A.pdf", "B.pdf", 0.96), ("B.pdf", "C.pdf", 0.91)]
        threshold: ค่า similarity ขั้นต่ำ (0.0-1.0) ที่ถือว่าเอกสารคล้ายกันพอ
                   ค่าเริ่มต้น = 0.90
    
    Returns:
        list of clusters: แต่ละ cluster เป็น list ของชื่อเอกสาร
                         เฉพาะกลุ่มที่มีมากกว่า 1 เอกสาร
                         ตัวอย่าง: [["A.pdf", "B.pdf"], ["C.pdf", "D.pdf"]]
    
    Algorithm:
        1. สร้างกราฟโดยเอกสารเป็น nodes
        2. เชื่อมเอกสารที่มี similarity ≥ threshold
        3. หากลุ่มด้วย DFS (Depth-First Search)
    """

    # ตรวจสอบ input
    if not results:
        return []

    # ขั้นที่ 1: รวบรวมชื่อเอกสารทั้งหมด (unique)
    docs = set()
    for doc1, doc2, score in results:
        docs.add(doc1)
        docs.add(doc2)
    docs = sorted(docs)  # เรียงตัวอักษรเพื่อความสม่ำเสมอ

    # ขั้นที่ 2: สร้าง adjacency list (กราฟ)
    # adj[doc] = set of documents ที่เชื่อมต่อกับ doc
    adj = {d: set() for d in docs}

    # เชื่อมเอกสารที่มี similarity ≥ threshold
    for doc1, doc2, score in results:
        if score >= threshold:
            adj[doc1].add(doc2)
            adj[doc2].add(doc1)

    # ขั้นที่ 3: หา connected components ด้วย DFS
    visited = set()  # เก็บเอกสารที่เยี่ยมแล้ว
    clusters = []  # เก็บกลุ่มที่พบ

    for d in docs:
        # ข้ามถ้าเยี่ยมแล้ว
        if d in visited:
            continue

        # เริ่ม DFS จากเอกสาร d
        stack = [d]
        component = []
        visited.add(d)

        # DFS loop
        while stack:
            u = stack.pop()
            component.append(u)

            # เยี่ยมเอกสารที่เชื่อมต่อ
            for v in adj[u]:
                if v not in visited:
                    visited.add(v)
                    stack.append(v)

        # เก็บเฉพาะกลุ่มที่มีมากกว่า 1 เอกสาร
        # (เอกสารเดี่ยวไม่ถือว่าเป็นกลุ่มลอกเลียนแบบ)
        if len(component) > 1:
            clusters.append(sorted(component))

    return clusters
