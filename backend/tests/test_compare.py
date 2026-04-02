from types import SimpleNamespace


def make_pair_result():
    return {
        "doc_1": "doc_001",
        "doc_2": "doc_002",
        "processing_mode": 1,
        "text_similarity": 0.91,
        "semantic_similarity": 0.89,
        "lexical_similarity": 0.87,
        "image_similarity": 0.0,
        "image_cosine_avg": 0.0,
        "image_phash_avg": 0.0,
        "matched_images": 0,
        "total_images": 0,
        "combined_score": 0.88,
        "final_score": 0.88,
        "level": "คล้ายระดับสูง",
    }


def seed_two_docs_for_compare(supabase, app_main):
    pdf_bytes = b"%PDF-1.4 compare data"

    path1 = "test-user/batch-compare/doc_001.pdf"
    path2 = "test-user/batch-compare/doc_002.pdf"

    supabase.storage.from_(app_main.BUCKET_NAME).upload(path1, pdf_bytes)
    supabase.storage.from_(app_main.BUCKET_NAME).upload(path2, pdf_bytes)

    supabase.from_("documents_duplicate").insert(
        {
            "doc_id": "doc_001",
            "file_name": "a.pdf",
            "storage_path": path1,
            "user_id": "test-user",
            "status": "success",
            "processing_mode": 1,
            "batch_id": "batch-compare",
            "image_count": 0,
        }
    ).execute()

    supabase.from_("documents_duplicate").insert(
        {
            "doc_id": "doc_002",
            "file_name": "b.pdf",
            "storage_path": path2,
            "user_id": "test-user",
            "status": "success",
            "processing_mode": 1,
            "batch_id": "batch-compare",
            "image_count": 0,
        }
    ).execute()


def test_compare_returns_empty_when_less_than_two_docs(client, supabase):
    supabase.from_("documents_duplicate").insert(
        {
            "doc_id": "doc_001",
            "file_name": "only.pdf",
            "storage_path": "test-user/batch-one/only.pdf",
            "user_id": "test-user",
            "status": "success",
            "processing_mode": 1,
            "batch_id": "batch-one",
            "image_count": 0,
        }
    ).execute()

    response = client.get("/compare", params={"batch_id": "batch-one"})
    assert response.status_code == 200
    assert response.json() == []


def test_compare_success_returns_pair_results(
    client, supabase, vector_db, pdf_processor, app_main
):
    seed_two_docs_for_compare(supabase, app_main)

    vector_db.text_index.vectors["text_doc_001"] = SimpleNamespace(
        values=[0.1, 0.2, 0.3],
        metadata={},
    )
    vector_db.text_index.vectors["text_doc_002"] = SimpleNamespace(
        values=[0.2, 0.3, 0.4],
        metadata={},
    )

    pdf_processor.compare_map[("doc_001", "doc_002")] = make_pair_result()

    response = client.get("/compare", params={"batch_id": "batch-compare"})
    assert response.status_code == 200

    data = response.json()
    assert len(data) == 1
    assert data[0]["doc_1"] == "doc_001"
    assert data[0]["doc_2"] == "doc_002"
    assert data[0]["combined_score"] == 0.88

    assert len(supabase.tables["document_pairs"]) == 1
    assert supabase.tables["document_pairs"][0]["batch_id"] == "batch-compare"


def test_compare_returns_existing_pair_rows_without_recompute(
    client, supabase, vector_db, app_main
):
    seed_two_docs_for_compare(supabase, app_main)

    vector_db.text_index.vectors["text_doc_001"] = SimpleNamespace(
        values=[0.1, 0.2, 0.3],
        metadata={},
    )
    vector_db.text_index.vectors["text_doc_002"] = SimpleNamespace(
        values=[0.2, 0.3, 0.4],
        metadata={},
    )

    supabase.from_("document_pairs").insert(
        {
            "batch_id": "batch-compare",
            "user_id": "test-user",
            "doc_id_1": "doc_001",
            "doc_id_2": "doc_002",
            "pair_key": app_main.make_pair_key("doc_001", "doc_002"),
            "processing_mode": 1,
            "text_score": 0.91,
            "semantic_score": 0.89,
            "lexical_score": 0.87,
            "image_score": 0.0,
            "image_cosine_avg": 0.0,
            "image_phash_avg": 0.0,
            "matched_images": 0,
            "total_images": 0,
            "final_score": 0.88,
            "status": "success",
            "error": None,
        }
    ).execute()

    response = client.get("/compare", params={"batch_id": "batch-compare"})
    assert response.status_code == 200

    data = response.json()
    assert len(data) == 1
    assert data[0]["combined_score"] == 0.88
    assert data[0]["level"] == "คล้ายระดับสูง"


def test_get_latest_batch_returns_latest(client, supabase):
    supabase.from_("batches").insert(
        {
            "batch_id": "old-batch",
            "user_id": "test-user",
            "processing_mode": 1,
            "use_template": False,
            "template_storage_path": None,
            "status": "active",
            "updated_at": 1,
        }
    ).execute()

    supabase.from_("batches").insert(
        {
            "batch_id": "new-batch",
            "user_id": "test-user",
            "processing_mode": 1,
            "use_template": False,
            "template_storage_path": None,
            "status": "active",
            "updated_at": 99,
        }
    ).execute()

    response = client.get("/batches/latest")
    assert response.status_code == 200
    assert response.json()["batch_id"] == "new-batch"


def test_preview_url_returns_signed_url(client, supabase, app_main):
    storage_path = "test-user/batch-preview/doc_preview.pdf"
    supabase.storage.from_(app_main.BUCKET_NAME).upload(
        storage_path, b"%PDF-1.4 preview"
    )

    supabase.from_("documents_duplicate").insert(
        {
            "doc_id": "doc_preview",
            "file_name": "preview.pdf",
            "storage_path": storage_path,
            "user_id": "test-user",
            "status": "success",
            "processing_mode": 1,
            "batch_id": "batch-preview",
            "image_count": 0,
        }
    ).execute()

    response = client.get(
        "/documents/doc_preview/preview-url",
        params={"batch_id": "batch-preview"},
    )
    assert response.status_code == 200

    data = response.json()
    assert "url" in data
    assert "https://example.com/storage/" in data["url"]
