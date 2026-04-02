import hashlib
from io import BytesIO


def make_pdf_bytes():
    return b"%PDF-1.4 test pdf content"


def test_get_documents_filter_by_batch(client, supabase):
    supabase.from_("documents_duplicate").insert(
        {
            "doc_id": "doc_a",
            "file_name": "a.pdf",
            "status": "success",
            "processing_mode": 1,
            "text_length": 100,
            "image_count": 0,
            "removed_text_length": 0,
            "error": None,
            "user_id": "test-user",
            "batch_id": "batch_a",
        }
    ).execute()

    supabase.from_("documents_duplicate").insert(
        {
            "doc_id": "doc_b",
            "file_name": "b.pdf",
            "status": "success",
            "processing_mode": 1,
            "text_length": 90,
            "image_count": 0,
            "removed_text_length": 0,
            "error": None,
            "user_id": "test-user",
            "batch_id": "batch_b",
        }
    ).execute()

    response = client.get("/documents", params={"batch_id": "batch_a"})
    assert response.status_code == 200

    data = response.json()
    assert len(data) == 1
    assert data[0]["doc_id"] == "doc_a"
    assert data[0]["batch_id"] == "batch_a"


def test_upload_pdfs_invalid_processing_mode(client):
    fake_pdf = BytesIO(make_pdf_bytes())
    files = [("files", ("test.pdf", fake_pdf, "application/pdf"))]
    data = {
        "processing_mode": "999",
        "use_template": "false",
        "batch_id": "test-batch-001",
    }

    response = client.post("/upload-pdfs", files=files, data=data)
    assert response.status_code == 400
    assert "Invalid processing mode" in response.text


def test_upload_pdfs_requires_template_file_when_enabled(client):
    fake_pdf = BytesIO(make_pdf_bytes())
    files = [("files", ("test.pdf", fake_pdf, "application/pdf"))]
    data = {
        "processing_mode": "1",
        "use_template": "true",
        "batch_id": "batch-template-001",
    }

    response = client.post("/upload-pdfs", files=files, data=data)
    assert response.status_code == 400
    assert "template" in response.text.lower()


def test_upload_pdfs_success_new_batch(client, supabase, app_main):
    pdf_bytes = make_pdf_bytes()

    files = [("files", ("answer.pdf", BytesIO(pdf_bytes), "application/pdf"))]
    data = {
        "processing_mode": "1",
        "use_template": "false",
        "batch_id": "batch-success-001",
    }

    response = client.post("/upload-pdfs", files=files, data=data)
    assert response.status_code == 200

    payload = response.json()
    assert payload["batch_id"] == "batch-success-001"
    assert payload["processing_mode"] == 1
    assert payload["use_template"] is False
    assert len(payload["results"]) == 1
    assert payload["results"][0]["status"] == "success"
    assert payload["results"][0]["file_name"] == "answer.pdf"

    assert len(supabase.tables["batches"]) == 1
    assert supabase.tables["batches"][0]["batch_id"] == "batch-success-001"

    assert len(supabase.tables["documents_duplicate"]) == 1
    row = supabase.tables["documents_duplicate"][0]
    assert row["status"] == "success"
    assert row["batch_id"] == "batch-success-001"
    assert row["file_name"] == "answer.pdf"

    assert len(supabase.tables["batch_files"]) == 1

    storage_path = row["storage_path"]
    bucket = supabase.storage.from_(app_main.BUCKET_NAME)
    assert storage_path in bucket.files


def test_upload_pdfs_success_with_template(client, supabase):
    files = [
        ("files", ("answer.pdf", BytesIO(make_pdf_bytes()), "application/pdf")),
        (
            "template_file",
            ("template.pdf", BytesIO(make_pdf_bytes()), "application/pdf"),
        ),
    ]
    data = {
        "processing_mode": "1",
        "use_template": "true",
        "batch_id": "batch-template-ok",
    }

    response = client.post("/upload-pdfs", files=files, data=data)
    assert response.status_code == 200

    payload = response.json()
    assert payload["use_template"] is True
    assert len(payload["results"]) == 1
    assert payload["results"][0]["status"] == "success"

    assert len(supabase.tables["batches"]) == 1
    batch_row = supabase.tables["batches"][0]
    assert batch_row["use_template"] is True
    assert batch_row["template_storage_path"].endswith("__template__.pdf")


def test_upload_pdfs_rejects_mismatched_batch_mode(client, supabase):
    supabase.from_("batches").insert(
        {
            "batch_id": "locked-batch",
            "user_id": "test-user",
            "processing_mode": 1,
            "use_template": False,
            "template_storage_path": None,
            "status": "active",
        }
    ).execute()

    files = [("files", ("answer.pdf", BytesIO(make_pdf_bytes()), "application/pdf"))]
    data = {
        "processing_mode": "2",
        "use_template": "false",
        "batch_id": "locked-batch",
    }

    response = client.post("/upload-pdfs", files=files, data=data)
    assert response.status_code == 400
    assert "processing_mode=1" in response.text


def test_upload_pdfs_duplicate_file_in_same_batch_returns_duplicate(client, supabase):
    pdf_bytes = make_pdf_bytes()
    file_hash = hashlib.sha256(pdf_bytes).hexdigest()

    supabase.from_("batches").insert(
        {
            "batch_id": "dup-batch",
            "user_id": "test-user",
            "processing_mode": 1,
            "use_template": False,
            "template_storage_path": None,
            "status": "active",
        }
    ).execute()

    supabase.from_("documents_duplicate").insert(
        {
            "doc_id": "existing_doc",
            "file_name": "old.pdf",
            "storage_path": "test-user/dup-batch/existing_doc.pdf",
            "user_id": "test-user",
            "status": "success",
            "processing_mode": 1,
            "batch_id": "dup-batch",
            "file_hash": file_hash,
            "error": None,
        }
    ).execute()

    files = [("files", ("same.pdf", BytesIO(pdf_bytes), "application/pdf"))]
    data = {
        "processing_mode": "1",
        "use_template": "false",
        "batch_id": "dup-batch",
    }

    response = client.post("/upload-pdfs", files=files, data=data)
    assert response.status_code == 200

    payload = response.json()
    assert len(payload["results"]) == 1
    assert payload["results"][0]["status"] == "duplicate"
    assert payload["results"][0]["doc_id"] == "existing_doc"
