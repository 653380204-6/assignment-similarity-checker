def test_cluster_empty_pairs_returns_400(client):
    response = client.post(
        "/cluster",
        json={
            "threshold": 0.85,
            "pairs": [],
        },
    )

    assert response.status_code == 400
    assert "ไม่มีข้อมูลคู่เอกสารให้จัดกลุ่ม" in response.text


def test_cluster_returns_clusters_and_suggested(client):
    response = client.post(
        "/cluster",
        json={
            "threshold": 0.85,
            "pairs": [
                {
                    "doc_1": "doc_001",
                    "doc_2": "doc_002",
                    "final_score": 0.95,
                },
                {
                    "doc_1": "doc_003",
                    "doc_2": "doc_004",
                    "final_score": 0.92,
                },
                {
                    "doc_1": "doc_001",
                    "doc_2": "doc_003",
                    "final_score": 0.40,
                },
            ],
        },
    )

    assert response.status_code == 200

    data = response.json()

    assert data["threshold"] == 0.85
    assert "suggested" in data
    assert data["total_clusters"] >= 2

    cluster_sets = [set(group) for group in data["clusters"]]

    assert {"doc_001", "doc_002"} in cluster_sets
    assert {"doc_003", "doc_004"} in cluster_sets


def test_cluster_from_batch_empty_returns_empty_payload(client, monkeypatch, app_main):
    async def fake_compare_documents_in_batch(batch_id, current_user):
        return []

    monkeypatch.setattr(
        app_main,
        "compare_documents_in_batch",
        fake_compare_documents_in_batch,
    )

    response = client.post(
        "/cluster-from-batch",
        json={
            "batch_id": "batch_001",
            "threshold": 0.80,
        },
    )

    assert response.status_code == 200

    data = response.json()

    assert data["batch_id"] == "batch_001"
    assert data["pair_count"] == 0
    assert data["cluster_count"] == 0
    assert data["clusters"] == []
    assert data["pairs"] == []
    assert data["suggested"] is None


def test_cluster_from_batch_success_returns_clusters_and_pairs(
    client,
    monkeypatch,
    app_main,
):
    async def fake_compare_documents_in_batch(batch_id, current_user):
        return [
            {
                "doc_1": "doc_001",
                "doc_2": "doc_002",
                "combined_score": 0.95,
                "final_score": 0.95,
            },
            {
                "doc_1": "doc_003",
                "doc_2": "doc_004",
                "combined_score": 0.91,
                "final_score": 0.91,
            },
            {
                "doc_1": "doc_001",
                "doc_2": "doc_003",
                "combined_score": 0.50,
                "final_score": 0.50,
            },
        ]

    monkeypatch.setattr(
        app_main,
        "compare_documents_in_batch",
        fake_compare_documents_in_batch,
    )

    response = client.post(
        "/cluster-from-batch",
        json={
            "batch_id": "batch_001",
            "threshold": 0.85,
        },
    )

    assert response.status_code == 200

    data = response.json()

    assert data["batch_id"] == "batch_001"
    assert data["threshold"] == 0.85
    assert data["pair_count"] == 3
    assert data["cluster_count"] >= 2
    assert len(data["pairs"]) == 3
    assert data["suggested"] is not None

    cluster_sets = [set(group) for group in data["clusters"]]

    assert {"doc_001", "doc_002"} in cluster_sets
    assert {"doc_003", "doc_004"} in cluster_sets
