def test_dendrogram_returns_empty_when_less_than_two_docs(client):
    response = client.post(
        "/dendrogram",
        json={
            "doc_ids": ["doc_001"],
            "pairs": [],
            "method": "single",
        },
    )

    assert response.status_code == 200

    data = response.json()
    assert data["docs"] == ["doc_001"]
    assert data["icoord"] == []
    assert data["dcoord"] == []
    assert data["leaf_order"] == ["doc_001"]
    assert data["method"] == "single"


def test_dendrogram_builds_from_pairs_successfully(client):
    response = client.post(
        "/dendrogram",
        json={
            "pairs": [
                {
                    "doc_1": "doc_001",
                    "doc_2": "doc_002",
                    "final_score": 0.95,
                },
                {
                    "doc_1": "doc_001",
                    "doc_2": "doc_003",
                    "final_score": 0.82,
                },
                {
                    "doc_1": "doc_002",
                    "doc_2": "doc_003",
                    "final_score": 0.80,
                },
            ],
            "method": "single",
        },
    )

    assert response.status_code == 200

    data = response.json()

    assert data["method"] == "single"
    assert sorted(data["docs"]) == ["doc_001", "doc_002", "doc_003"]
    assert sorted(data["leaf_order"]) == ["doc_001", "doc_002", "doc_003"]
    assert len(data["icoord"]) > 0
    assert len(data["dcoord"]) > 0


def test_dendrogram_uses_doc_ids_and_pairs_together(client):
    response = client.post(
        "/dendrogram",
        json={
            "doc_ids": ["doc_001", "doc_002", "doc_003", "doc_004"],
            "pairs": [
                {
                    "doc_1": "doc_001",
                    "doc_2": "doc_002",
                    "final_score": 0.91,
                },
                {
                    "doc_1": "doc_003",
                    "doc_2": "doc_004",
                    "final_score": 0.89,
                },
            ],
            "method": "single",
        },
    )

    assert response.status_code == 200

    data = response.json()

    assert data["method"] == "single"
    assert sorted(data["docs"]) == ["doc_001", "doc_002", "doc_003", "doc_004"]
    assert sorted(data["leaf_order"]) == ["doc_001", "doc_002", "doc_003", "doc_004"]
    assert len(data["icoord"]) > 0
    assert len(data["dcoord"]) > 0


def test_dendrogram_accepts_average_method(client):
    response = client.post(
        "/dendrogram",
        json={
            "pairs": [
                {
                    "doc_1": "doc_a",
                    "doc_2": "doc_b",
                    "final_score": 0.90,
                },
                {
                    "doc_1": "doc_a",
                    "doc_2": "doc_c",
                    "final_score": 0.70,
                },
                {
                    "doc_1": "doc_b",
                    "doc_2": "doc_c",
                    "final_score": 0.75,
                },
            ],
            "method": "average",
        },
    )

    assert response.status_code == 200

    data = response.json()
    assert data["method"] == "average"
    assert sorted(data["docs"]) == ["doc_a", "doc_b", "doc_c"]
    assert sorted(data["leaf_order"]) == ["doc_a", "doc_b", "doc_c"]
    assert len(data["icoord"]) > 0
    assert len(data["dcoord"]) > 0
