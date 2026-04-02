import os
import sys
import copy
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

os.environ["TESTING"] = "1"

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

import main


class FakeResponse:
    def __init__(self, data=None):
        self.data = data if data is not None else []


class FakeVector:
    def __init__(self, values, metadata=None):
        self.values = values
        self.metadata = metadata or {}


class FakeBucket:
    def __init__(self):
        self.files = {}

    def upload(self, path, file, file_options=None):
        if hasattr(file, "read"):
            content = file.read()
        else:
            content = file
        self.files[path] = content
        return {"path": path}

    def download(self, path):
        return self.files[path]

    def remove(self, paths):
        for path in paths:
            self.files.pop(path, None)
        return {"removed": paths}

    def create_signed_url(self, path, expires_in):
        return {"signedURL": f"https://example.com/storage/{path}"}


class FakeStorage:
    def __init__(self):
        self.buckets = {}

    def from_(self, bucket_name):
        if bucket_name not in self.buckets:
            self.buckets[bucket_name] = FakeBucket()
        return self.buckets[bucket_name]


class FakeAuthAdmin:
    def get_user_by_id(self, user_id):
        user = SimpleNamespace(
            email="test@example.com",
            user_metadata={"full_name": "Test User"},
        )
        return SimpleNamespace(user=user)

    def update_user_by_id(self, user_id, payload):
        return {"id": user_id, "payload": payload}


class FakeAuth:
    def __init__(self):
        self.admin = FakeAuthAdmin()


class FakeTableQuery:
    def __init__(self, supabase, table_name):
        self.supabase = supabase
        self.table_name = table_name
        self._filters = []
        self._or_filters = []
        self._limit = None
        self._order_field = None
        self._order_desc = False
        self._action = "select"
        self._payload = None

    def select(self, fields="*"):
        self._action = "select"
        return self

    def eq(self, key, value):
        self._filters.append((key, value))
        return self

    def limit(self, n):
        self._limit = n
        return self

    def order(self, field, desc=False):
        self._order_field = field
        self._order_desc = desc
        return self

    def insert(self, payload):
        self._action = "insert"
        self._payload = payload
        return self

    def update(self, payload):
        self._action = "update"
        self._payload = payload
        return self

    def delete(self):
        self._action = "delete"
        return self

    def upsert(self, payload, on_conflict=None):
        self._action = "upsert"
        self._payload = payload
        self._on_conflict = on_conflict
        return self

    def or_(self, expr):
        parts = expr.split(",")
        parsed = []
        for part in parts:
            part = part.strip()
            if ".eq." in part:
                field, value = part.split(".eq.", 1)
                parsed.append((field, value))
        self._or_filters = parsed
        return self

    def _match_row(self, row):
        for key, value in self._filters:
            if row.get(key) != value:
                return False

        if self._or_filters:
            return any(row.get(field) == value for field, value in self._or_filters)

        return True

    def _filtered_rows(self):
        rows = self.supabase.tables[self.table_name]
        matched = [row for row in rows if self._match_row(row)]

        if self._order_field:
            matched = sorted(
                matched,
                key=lambda r: r.get(self._order_field, 0),
                reverse=self._order_desc,
            )

        if self._limit is not None:
            matched = matched[: self._limit]

        return matched

    def execute(self):
        table = self.supabase.tables[self.table_name]

        if self._action == "select":
            return FakeResponse(copy.deepcopy(self._filtered_rows()))

        if self._action == "insert":
            items = (
                self._payload if isinstance(self._payload, list) else [self._payload]
            )
            inserted = []

            for item in items:
                row = copy.deepcopy(item)
                self.supabase.counter += 1

                if "created_at" not in row:
                    row["created_at"] = f"2026-03-31T00:00:{self.supabase.counter:02d}Z"

                if "updated_at" not in row:
                    row["updated_at"] = row.get(
                        "created_at", f"2026-03-31T00:00:{self.supabase.counter:02d}Z"
                    )

                if self.table_name == "document_pairs" and "pair_key" not in row:
                    row["pair_key"] = main.make_pair_key(
                        row["doc_id_1"], row["doc_id_2"]
                    )

                table.append(row)
                inserted.append(copy.deepcopy(row))

            return FakeResponse(inserted)

        if self._action == "update":
            updated = []
            for row in table:
                if self._match_row(row):
                    row.update(copy.deepcopy(self._payload))
                    row["updated_at"] = self.supabase.counter + 1
                    updated.append(copy.deepcopy(row))
            return FakeResponse(updated)

        if self._action == "delete":
            remain = []
            deleted = []

            for row in table:
                if self._match_row(row):
                    deleted.append(copy.deepcopy(row))
                else:
                    remain.append(row)

            self.supabase.tables[self.table_name] = remain
            return FakeResponse(deleted)

        if self._action == "upsert":
            row = copy.deepcopy(self._payload)

            if self.table_name == "document_pairs" and "pair_key" not in row:
                row["pair_key"] = main.make_pair_key(row["doc_id_1"], row["doc_id_2"])

            keys = []
            if hasattr(self, "_on_conflict") and self._on_conflict:
                keys = [k.strip() for k in self._on_conflict.split(",")]

            found = None
            for existing in table:
                if keys and all(existing.get(k) == row.get(k) for k in keys):
                    found = existing
                    break

            if found:
                found.update(row)
                return FakeResponse([copy.deepcopy(found)])

            self.supabase.counter += 1
            if "created_at" not in row:
                row["created_at"] = self.supabase.counter
            if "updated_at" not in row:
                row["updated_at"] = row["created_at"]

            table.append(row)
            return FakeResponse([copy.deepcopy(row)])

        return FakeResponse([])


class FakeSupabaseAdmin:
    def __init__(self):
        self.storage = FakeStorage()
        self.auth = FakeAuth()
        self.reset()

    def reset(self):
        self.counter = 0
        self.tables = {
            "User": [
                {
                    "auth_uid": "test-user",
                    "email": "test@example.com",
                    "full_name": "Test User",
                    "created_at": 1,
                    "updated_at": 1,
                }
            ],
            "documents_duplicate": [],
            "document_pairs": [],
            "batch_files": [],
            "batches": [],
        }

    def from_(self, table_name):
        if table_name not in self.tables:
            self.tables[table_name] = []
        return FakeTableQuery(self, table_name)


class DummyEmbeddingManager:
    def is_ready(self):
        return True


class DummyIndex:
    def __init__(self):
        self.vectors = {}

    def fetch(self, ids=None):
        ids = ids or []
        return SimpleNamespace(
            vectors={
                vector_id: self.vectors[vector_id]
                for vector_id in ids
                if vector_id in self.vectors
            }
        )

    def delete(self, *args, **kwargs):
        return None

    def query(self, *args, **kwargs):
        return SimpleNamespace(matches=[])


class DummyVectorDBManager:
    def __init__(self):
        self.text_index = DummyIndex()
        self.image_index = DummyIndex()

    def is_connected(self):
        return True

    async def initialize(self):
        return None

    async def get_text_index_stats(self):
        return {}

    async def get_image_index_stats(self):
        return {}

    async def delete_document_embeddings_by_ids(self, *args, **kwargs):
        return None

    async def delete_document_embeddings_for_user(self, *args, **kwargs):
        return None


class DummyPDFProcessor:
    def __init__(self):
        self.raw_texts = {}
        self.document_metadata = {}
        self.compare_map = {}

    def extract_template_text(self, path):
        return "template text"

    def extract_text_from_pdf(self, path):
        return "dummy text"

    async def process_pdf(self, **kwargs):
        return {
            "text_length": 120,
            "image_count": 0,
            "removed_text_length": 15,
        }

    def compare_documents(self, id1, id2, *args, **kwargs):
        key = tuple(sorted((id1, id2)))
        return copy.deepcopy(self.compare_map.get(key))

    def get_document_ids(self):
        return []


fake_supabase = FakeSupabaseAdmin()
main.supabase_admin = fake_supabase
main.embedding_manager = DummyEmbeddingManager()
main.vector_db_manager = DummyVectorDBManager()
main.pdf_processor = DummyPDFProcessor()


def fake_user():
    return SimpleNamespace(id="test-user", email="test@example.com")


main.app.dependency_overrides[main.get_current_user] = fake_user


@pytest.fixture(autouse=True)
def reset_test_state():
    fake_supabase.reset()
    main.embedding_manager = DummyEmbeddingManager()
    main.vector_db_manager = DummyVectorDBManager()
    main.pdf_processor = DummyPDFProcessor()
    main.app.dependency_overrides[main.get_current_user] = fake_user
    yield


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def app_main():
    return main


@pytest.fixture
def supabase():
    return fake_supabase


@pytest.fixture
def vector_db():
    return main.vector_db_manager


@pytest.fixture
def pdf_processor():
    return main.pdf_processor
