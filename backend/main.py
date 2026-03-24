import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

import numpy as np
from dotenv import load_dotenv
from fastapi import (
    FastAPI,
    Depends,
    Query,
    UploadFile,
    File,
    HTTPException,
    Form,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from auth import get_current_user
from auth import router as auth_router
from dendrogram_api import router as dendrogram_router
from embedding import EmbeddingManager
from pdf_processing import PDFProcessor
from schemas import DocumentResult
from supabase_client import supabase_admin
from utils import (
    to_ascii_id,
    sanitize_filename,
    cleanup_temp_dir,
    validate_pdf_files,
)
from vector_db import VectorDBManager
from clustering_utils import cluster_by_threshold
from fastapi import Request

load_dotenv()

PREVIEW_EXPIRES_IN = 60 * 15
SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").rstrip("/")
BUCKET_NAME = "assignments"

FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:3000",
    ).split(",")
    if origin.strip()
]


def ensure_absolute_url(u: str) -> str:
    if u.startswith(("http://", "https://")):
        return u

    base = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    if not base:
        raise RuntimeError("SUPABASE_URL is not set")

    if not u.startswith("/"):
        u = "/" + u
    return base + u


app = FastAPI(
    title="PDF Plagiarism Detection API",
    version="2.0.0",
    description="API for detecting plagiarism in PDF documents using text and image analysis",
)


@app.middleware("http")
async def debug_origin(request: Request, call_next):
    print("DEBUG Origin:", request.headers.get("origin"))
    print("DEBUG Method:", request.method)
    print("DEBUG Path:", request.url.path)
    response = await call_next(request)
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(dendrogram_router)

# Global managers
pdf_processor = None
embedding_manager = None
vector_db_manager = None


# @app.get("/login")
# async def login():
#     """Simple login endpoint (placeholder)"""
#     return {"message": "Login successful"}


class Pair(BaseModel):
    doc_1: str
    doc_2: str
    final_score: Optional[float] = None
    combined_score: Optional[float] = None


class ClusterReq(BaseModel):
    threshold: Optional[float] = Field(None, ge=0.0, le=1.0)
    pairs: List[Pair]


class BatchClusterReq(BaseModel):
    batch_id: str
    threshold: Optional[float] = Field(None, ge=0.0, le=1.0)


class UpdateProfileRequest(BaseModel):
    full_name: str


@app.get("/auth/me")
async def get_me(current_user=Depends(get_current_user)):
    user_id = getattr(current_user, "id", None)
    auth_email = getattr(current_user, "email", None)

    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    user_id = str(user_id)

    full_name = None
    email = auth_email

    # 1) ดึงจาก Supabase Auth Users ก่อน
    try:
        auth_res = supabase_admin.auth.admin.get_user_by_id(user_id)
        auth_user = getattr(auth_res, "user", None)

        if auth_user:
            auth_email = getattr(auth_user, "email", None) or auth_email
            email = auth_email

            user_metadata = getattr(auth_user, "user_metadata", {}) or {}

            full_name = (
                user_metadata.get("full_name")
                or user_metadata.get("display_name")
                or user_metadata.get("name")
            )
    except Exception as e:
        print("get_user_by_id error =", e)

    # 2) fallback ไปที่ตาราง User ของคุณ
    try:
        res = (
            supabase_admin.from_("User")
            .select("auth_uid, email, full_name")
            .eq("auth_uid", user_id)
            .limit(1)
            .execute()
        )

        row = res.data[0] if res.data else None

        if row:
            if not full_name:
                full_name = row.get("full_name")
            if not email:
                email = row.get("email")
    except Exception as e:
        print("User table lookup error =", e)

    return {
        "id": user_id,
        "name": full_name or "User",
        "email": email,
    }


@app.put("/auth/profile")
async def update_profile(
    payload: UpdateProfileRequest,
    current_user=Depends(get_current_user),
):
    user_id = getattr(current_user, "id", None)

    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    user_id = str(user_id)
    full_name = (payload.full_name or "").strip()

    if not full_name:
        raise HTTPException(status_code=400, detail="กรุณากรอกชื่อ")

    try:
        supabase_admin.auth.admin.update_user_by_id(
            user_id, {"user_metadata": {"full_name": full_name}}
        )
    except Exception as e:
        print("update auth metadata error =", e)

    try:
        existing = (
            supabase_admin.from_("User")
            .select("auth_uid")
            .eq("auth_uid", user_id)
            .limit(1)
            .execute()
        )

        if existing.data:
            supabase_admin.from_("User").update({"full_name": full_name}).eq(
                "auth_uid", user_id
            ).execute()
    except Exception as e:
        print("update User table error =", e)

    email = getattr(current_user, "email", None)

    return {
        "id": user_id,
        "name": full_name,
        "email": email,
    }


@app.on_event("startup")
async def startup_event():
    """Initialize all components on startup"""
    global pdf_processor, embedding_manager, vector_db_manager

    print("Starting PDF Plagiarism Detection API...")

    try:
        # Initialize embedding manager
        print("Loading embedding models")
        embedding_manager = EmbeddingManager()
        await embedding_manager.initialize()

        # Initialize vector database
        print("Connecting to vector database")
        vector_db_manager = VectorDBManager()
        await vector_db_manager.initialize()

        # Initialize PDF processor
        print("Setting up PDF processor")
        pdf_processor = PDFProcessor(embedding_manager)

        print("All components is initialized")
    except Exception as e:
        print(f"Error during startup: {e}")
        raise e


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "message": "PDF Plagiarism Detection API",
        "status": "running",
        "version": "1.0.0",
    }


@app.get("/health")
async def health_check():
    """Detailed health check"""
    return {
        "api": "healthy",
        "embedding_manager": (
            "loaded"
            if embedding_manager and embedding_manager.is_ready()
            else "not ready"
        ),
        "vector_db": (
            "connected"
            if vector_db_manager and vector_db_manager.is_connected()
            else "disconnected"
        ),
        "pdf_processor": "ready" if pdf_processor else "not ready",
    }


# /upload to Supabase bucket
# @app.post("/upload")
# async def upload_files_and_save_to_supabase(
#     files: List[UploadFile] = File(...),
#     current_user=Depends(get_current_user)
# ):
#     user_id = current_user.id
#     bucket_name = "pdf-files"
#     results = []

#     temp_dir = tempfile.mkdtemp()
#     try:
#         for file in files:
#             file_path = Path(temp_dir) / file.filename

#             with open(file_path, "wb") as buffer:
#                 shutil.copyfileobj(file.file, buffer)

#             with open(file_path, "rb") as f:
#                 file_content = f.read()

#             # Upload ขึ้น Supabase bucket
#             supabase.storage.from_(bucket_name).upload(
#                 path=storage.path,
#                 file=file_content,
#                 file_options={
#                     "content_type": "application/pdf",
#                 }
#             )

#             documents_data = {
#                 "file_name": file.filename,
#                 "doc_id_slug": to_ascii_id(file.filename),
#                 "storage_path": storage_path,
#                 "owner_id": user_id  # <-- จะได้บอกว่าไฟล์นี้เป็นของใคร
#             }

#             # บันทึกข้อมูลลงในตาราง documents ใน supabase
#             db_response = supabase.table(
#                 "documents").insert(documents_data).execute()

#             results.append({
#                 "file_name": file.filename,
#                 "status": "success",
#                 "data": db_response.data[0]

#             })

#     except Exception as e:
#         raise HTTPException(status_code=500, detail=f"Upload error: {str(e)}")
#     finally:
#         shutil.rmtree(temp_dir)     #<-- ให้ลบ folder tempfile ทิ้งเสมอไม่ว่าจะสำเร็จหรือไม่
#     return {"message": "Files uploaded successfully", "results": results}

# new upload endpoint
# code เดิม
# @app.post("/upload-pdfs")
# async def upload_and_process_pdfs_with_auth(
#     current_user=Depends(get_current_user),
#     # authorization: Optional[str] = Header(None),


#     files: List[UploadFile] = File(...),
#     processing_mode: int = Form(1, description="1=Text, 2=Images, 3=Both"),
#     use_template: bool = Form(False, description="Use template"),
#     template_file: Optional[UploadFile] = File(
#         None, description="Template PDF")
# ):
#     """
#     รับไฟล์, ตรวจสอบสิทธิ์, บันทึกลง Supabase
#     """

#     # current_user = await get_current_user(authorization)
#     user_id = current_user.id
#     bucket_name = "pdf.files"  # <-- ชื่อ Bucket บน Supabase
#     # token = authorization.split(" ")[1]

#     if not pdf_processor or not embedding_manager or not vector_db_manager:
#         raise HTTPException(status_code=503, detail="Service not ready.")
#     if processing_mode not in [1, 2, 3]:
#         raise HTTPException(status_code=400, detail="Invalid processing mode")
#     validate_pdf_files(files)
#     if use_template and not template_file:
#         raise HTTPException(status_code=400, detail="Template file required")

#     temp_dir = tempfile.mkdtemp(prefix="pdf_upload_")
#     try:
#         # supabase.auth.set_session(token)
#         supabase.postgrest.auth(os.environ["SUPABASE_SERVICE_ROLE_KEY"])
#         template_text = ""
#         if use_template and template_file:
#             template_path = os.path.join(temp_dir, template_file.filename)
#             with open(template_path, "wb") as buffer:
#                 shutil.copyfileobj(template_file.file, buffer)
#             template_text = pdf_processor.extract_template_text(template_path)

#         results = []

#         for file in files:
#             file_path_str = os.path.join(temp_dir, file.filename)
#             with open(file_path_str, "wb") as buffer:
#                 file.file.seek(0)
#                 shutil.copyfileobj(file.file, buffer)

#             try:
#                 with open(file_path_str, "rb") as f:
#                     file_content = f.read()
#                 storage_path = f"{user_id}/{file.filename}"

#                 supabase.storage.from_(bucket_name).upload(
#                     path=storage_path,
#                     file=file_content,
#                     # file_options={"contentType": "application/pdf"}
#                     file_options={"contentType": "application/pdf"}
#                 )

#                 document_data = {
#                     "file_name": file.filename,
#                     "doc_id_slug": to_ascii_id(file.filename),
#                     "storage_path": storage_path,
#                     "owner_id": user_id
#                 }
#                 supabase.table("documents").insert(document_data).execute()

#                 result = await pdf_processor.process_pdf(
#                     pdf_path=file_path_str,
#                     processing_mode=processing_mode,
#                     template_text=template_text,
#                     vector_db=vector_db_manager
#                 )
#                 results.append(result)

#             except Exception as e:
#                 print(f"Error processing {file.filename}: {e}")
#                 results.append({
#                     "doc_id": os.path.basename(file_path_str).split('.')[0],
#                     "status": "error", "error": str(e)
#                 })

#         return {
#             "message": "Files processed successfully",
#             "results": results
#         }
#     finally:
#         # supabase.auth.sign_out()
#         cleanup_temp_dir(temp_dir)


# โค้ดใหม่
@app.post("/upload-pdfs")
async def upload_and_process_pdfs_with_auth(
    current_user=Depends(get_current_user),
    files: List[UploadFile] = File(...),
    processing_mode: int = Form(1),
    use_template: bool = Form(False),
    batch_id: str = Form(...),
    template_file: Optional[UploadFile] = File(None),
):
    # ---------- auth header check ----------

    if not pdf_processor or not embedding_manager or not vector_db_manager:
        raise HTTPException(status_code=503, detail="Service not ready.")

    if processing_mode not in [1, 2, 3]:
        raise HTTPException(status_code=400, detail="Invalid processing mode")

    validate_pdf_files(files)
    if use_template and not template_file:
        raise HTTPException(status_code=400, detail="Template file required")

    temp_dir = tempfile.mkdtemp(prefix="pdf_upload_")

    try:
        # ---------- template ----------
        template_text = ""
        if use_template and template_file:
            template_safe_name = sanitize_filename(
                template_file.filename or "template.pdf"
            )
            template_path = os.path.join(temp_dir, template_safe_name)
            with open(template_path, "wb") as buffer:
                template_file.file.seek(0)
                shutil.copyfileobj(template_file.file, buffer)
            template_text = pdf_processor.extract_template_text(template_path)

        results = []

        for file in files:
            # ---------- original name (ไว้โชว์ใน UI) ----------
            original_filename = file.filename or "unnamed.pdf"

            # ---------- safe name (กัน path พังตอนเขียน temp) ----------
            safe_filename = sanitize_filename(original_filename)
            file_path_str = os.path.join(temp_dir, safe_filename)

            # ---------- ext ----------
            ext = Path(safe_filename).suffix.lower() or ".pdf"

            # ---------- doc_id กันชน ----------
            base_id = to_ascii_id(original_filename)
            doc_id = f"{base_id}_{uuid4().hex[:8]}"

            # ---------- storage key ต้องปลอดภัย (ห้ามใช้ชื่อไทย/เว้นวรรค) ----------
            storage_file = f"{doc_id}{ext}"
            storage_path = f"{current_user.id}/{batch_id}/{storage_file}"

            try:
                # 1) upsert แถว (สถานะ processing)
                supabase_admin.from_("documents_duplicate").upsert(
                    {
                        "file_name": original_filename,  # ✅ เก็บชื่อจริง (ไทยได้) ไว้แสดงผล
                        "doc_id": doc_id,
                        "storage_path": storage_path,  # ✅ key ปลอดภัย
                        "user_id": current_user.id,
                        "status": "processing",
                        "processing_mode": processing_mode,
                        "batch_id": batch_id,
                        "error": None,
                    }
                ).execute()

                # 2) save temp file
                with open(file_path_str, "wb") as buffer:
                    file.file.seek(0)
                    shutil.copyfileobj(file.file, buffer)

                with open(file_path_str, "rb") as f:
                    file_content = f.read()

                # 3) upload ไป Supabase Storage
                print(
                    f"Uploading '{original_filename}' to Supabase Storage as '{storage_file}'"
                )
                supabase_admin.storage.from_("assignments").upload(
                    path=storage_path,
                    file=file_content,
                    file_options={
                        "content-type": "application/pdf",
                        "upsert": "true",  # ✅ ต้องเป็น str ไม่ใช่ bool
                    },
                )

                # 4) process pdf
                print(f"Processing PDF content for '{doc_id}'")
                metadata = await pdf_processor.process_pdf(
                    pdf_path=file_path_str,
                    doc_id=doc_id,
                    processing_mode=processing_mode,
                    template_text=template_text,
                    vector_db=vector_db_manager,
                    user_id=current_user.id,
                    batch_id=batch_id,
                )

                # 5) update success ✅ (แก้บั๊กเดิม)
                update_data = {
                    "status": "success",
                    "text_length": metadata.get("text_length"),
                    "image_count": metadata.get("image_count"),
                    "removed_text_length": metadata.get("removed_text_length"),
                    "error": None,
                }

                supabase_admin.from_("documents_duplicate").update(update_data).eq(
                    "doc_id", doc_id
                ).eq("user_id", current_user.id).eq("batch_id", batch_id).execute()

                results.append(
                    {
                        "doc_id": doc_id,
                        "file_name": original_filename,
                        "status": "success",
                        "text_length": metadata.get("text_length"),
                        "image_count": metadata.get("image_count"),
                        "removed_text_length": metadata.get("removed_text_length"),
                        "batch_id": batch_id,
                    }
                )

            except Exception as e:
                error_message = str(e)
                print(f"❌ Error on '{doc_id}': {error_message}")

                # update error เฉพาะแถวนี้
                supabase_admin.from_("documents_duplicate").update(
                    {"status": "error", "error": error_message}
                ).eq("doc_id", doc_id).eq("user_id", current_user.id).eq(
                    "batch_id", batch_id
                ).execute()

                results.append(
                    {
                        "doc_id": doc_id,
                        "file_name": original_filename,
                        "status": "error",
                        "error": error_message,
                        "batch_id": batch_id,
                    }
                )

        return {"message": "All files processed", "results": results}

    finally:
        cleanup_temp_dir(temp_dir)


# old compare_documents
# @app.get("/compare")
# async def compare_documents():
#     """
#     Compare all processed documents for similarity

#     Returns similarity scores between all document pairs
#     """
#     if not pdf_processor or not vector_db_manager:
#         raise HTTPException(status_code=503, detail="Service not ready")

#     try:
#         # Get all embeddings from vector database
#         text_embeddings = await vector_db_manager.get_all_text_embeddings()
#         image_embeddings, image_hashes = await vector_db_manager.get_all_image_embeddings()

#         # Get document list
#         doc_ids = list(pdf_processor.get_document_ids())

#         if len(doc_ids) < 2:
#             return {
#                 "message": "Need at least 2 documents to compare",
#                 "comparisons": [],
#                 "total_documents": len(doc_ids),
#                 "total_comparisons": 0
#             }

#         # Perform comparisons
#         comparison_results = []
#         for i in range(len(doc_ids)):
#             for j in range(i + 1, len(doc_ids)):
#                 id1, id2 = doc_ids[i], doc_ids[j]

#                 # Calculate similarities
#                 result = pdf_processor.compare_documents(
#                     id1, id2,
#                     text_embeddings,
#                     image_embeddings,
#                     image_hashes
#                 )

#                 if result:
#                     comparison_results.append(result)

#         return {
#             "comparisons": comparison_results,
#             "total_documents": len(doc_ids),
#             "total_comparisons": len(comparison_results)
#         }

#     except Exception as e:
#         raise HTTPException(
#             status_code=500, detail=f"Comparison error: {str(e)}")


# new compare_documents
# ในไฟล์ main.py

# ใน main.py - แทนที่ฟังก์ชัน compare_documents เดิม


@app.get("/compare", summary="Compare documents within a specific batch")
async def compare_documents_in_batch(
    batch_id: str, current_user=Depends(get_current_user)
):
    if not pdf_processor or not vector_db_manager:
        raise HTTPException(status_code=503, detail="Service not ready")

    user_id = current_user.id
    print(f"\n========== COMPARISON REQUEST ==========")
    print(f"User ID: {user_id}")
    print(f"Batch ID: {batch_id}")

    # helper: chunk list
    def chunked(items: List[str], size: int = 500):
        for i in range(0, len(items), size):
            yield items[i : i + size]

    try:
        # 0) ดึงรายการเอกสารจาก DB (ชัวร์สุด)
        docs = (
            supabase_admin.from_("documents_duplicate")
            .select(
                "doc_id, processing_mode, storage_path, image_count, file_name, status"
            )
            .eq("user_id", user_id)
            .eq("batch_id", batch_id)
            .neq("status", "error")
            .order("created_at", desc=True)
            .execute()
        ).data or []

        if len(docs) < 2:
            print(f"⚠️ Need at least 2 documents, found {len(docs)}")
            return []

        # เอา doc_id แบบไม่ซ้ำ (กันกรณี upsert/หลายแถว)
        seen = set()
        docs_unique = []
        for d in docs:
            did = d["doc_id"]
            if did not in seen:
                seen.add(did)
                docs_unique.append(d)

        if len(docs_unique) < 2:
            print(f"⚠️ Need at least 2 unique documents, found {len(docs_unique)}")
            return []

        all_doc_ids = [d["doc_id"] for d in docs_unique]
        print(f"📋 Document IDs (from DB): {all_doc_ids}")

        # 1) สร้าง IDs เพื่อ fetch จาก Pinecone แบบตรง ๆ
        text_ids = [f"text_{doc_id}" for doc_id in all_doc_ids]

        image_ids = []
        image_count_map = {}
        mode_map = {}
        storage_map = {}

        for d in docs_unique:
            doc_id = d["doc_id"]
            mode = int(d.get("processing_mode") or 3)
            mode_map[doc_id] = mode
            storage_map[doc_id] = d.get("storage_path")

            n = int(d.get("image_count") or 0)
            image_count_map[doc_id] = n

            # สร้าง id รูปตาม image_count
            for i in range(n):
                image_ids.append(f"image_{doc_id}_{i}")

        # 2) fetch text vectors
        text_embeddings_raw: Dict[str, np.ndarray] = {}
        if text_ids:
            for batch in chunked(text_ids, 500):
                res = vector_db_manager.text_index.fetch(ids=batch)
                if getattr(res, "vectors", None):
                    for vid, v in res.vectors.items():
                        # v.values is list[float]
                        text_embeddings_raw[vid] = np.array(v.values, dtype=np.float32)

        # 3) fetch image vectors + phash จาก metadata (ไม่ต้อง fetch ทีละรูป)
        image_embeddings_raw: Dict[str, np.ndarray] = {}
        image_hashes_raw: Dict[str, str] = {}

        if image_ids:
            for batch in chunked(image_ids, 500):
                res = vector_db_manager.image_index.fetch(ids=batch)
                if getattr(res, "vectors", None):
                    for vid, v in res.vectors.items():
                        image_embeddings_raw[vid] = np.array(v.values, dtype=np.float32)
                        md = v.metadata or {}
                        image_hashes_raw[vid] = md.get("phash", "") or ""

        print(
            f"📊 Retrieved(fetch): {len(text_embeddings_raw)} text, {len(image_embeddings_raw)} image vectors"
        )

        # 4) กรอง doc ที่ “มี embedding ครบตามโหมด” กัน compare พัง
        # - mode 1 ต้องมี text
        # - mode 2 ต้องมี image อย่างน้อย 1
        # - mode 3 ขอมีอย่างน้อยอย่างใดอย่างหนึ่ง (แต่ปกติควรมีทั้งคู่ถ้าประมวลผลครบ)
        doc_has_text = set(
            [k[5:] for k in text_embeddings_raw.keys() if k.startswith("text_")]
        )

        doc_has_image = set()
        for vid in image_embeddings_raw.keys():
            # vid: image_{doc_id}_{i}  (doc_id อาจมี _ ได้)
            remaining = vid[6:]
            parts = remaining.split("_")
            if len(parts) >= 2:
                doc_id = "_".join(parts[:-1])
                doc_has_image.add(doc_id)

        effective_doc_ids = []
        for doc_id in all_doc_ids:
            mode = mode_map.get(doc_id, 3)
            if mode == 1 and doc_id not in doc_has_text:
                continue
            if mode == 2 and doc_id not in doc_has_image:
                continue
            if (
                mode == 3
                and (doc_id not in doc_has_text)
                and (doc_id not in doc_has_image)
            ):
                continue
            effective_doc_ids.append(doc_id)

        if len(effective_doc_ids) < 2:
            print(
                f"⚠️ Not enough docs with embeddings after filtering: {len(effective_doc_ids)}"
            )
            return []

        print(f"✅ Effective docs for compare: {effective_doc_ids}")

        # 5) โหลด text จาก storage เฉพาะ doc ที่ต้องใช้ text
        print("\n📚 Loading document texts from Supabase Storage...")
        doc_texts = {}
        doc_metadata = {}

        for doc_id in effective_doc_ids:
            try:
                storage_path = storage_map.get(doc_id)
                processing_mode = mode_map.get(doc_id, 3)
                need_text = processing_mode in [1, 3]

                if need_text and storage_path:
                    try:
                        file_data = supabase_admin.storage.from_(
                            "assignments"
                        ).download(storage_path)

                        with tempfile.NamedTemporaryFile(
                            suffix=".pdf", delete=False
                        ) as tmp:
                            tmp.write(file_data)
                            tmp_path = tmp.name

                        extracted_text = pdf_processor.extract_text_from_pdf(tmp_path)
                        doc_texts[doc_id] = extracted_text

                        os.unlink(tmp_path)

                        print(
                            f"  ✓ {doc_id}: {len(extracted_text)} chars (Mode {processing_mode})"
                        )

                    except Exception as e:
                        print(f"  ⚠️ Could not extract text for {doc_id}: {e}")
                        doc_texts[doc_id] = ""
                else:
                    doc_texts[doc_id] = ""
                    print(f"  {doc_id}: Skip text (Mode {processing_mode})")

                doc_metadata[doc_id] = {
                    "processing_mode": processing_mode,
                    "text_length": len(doc_texts.get(doc_id, "")),
                    "has_template": False,
                }

            except Exception as e:
                print(f"  ⚠️ Error loading {doc_id}: {e}")
                doc_texts[doc_id] = ""
                doc_metadata[doc_id] = {"processing_mode": 1}

        # 6) อัปเดต pdf_processor cache
        for doc_id, text in doc_texts.items():
            pdf_processor.raw_texts[doc_id] = text
            pdf_processor.document_metadata[doc_id] = doc_metadata.get(
                doc_id, {"processing_mode": 3}
            )

        # 7) เตรียมข้อมูลเข้า compare
        text_embeddings_for_compare = text_embeddings_raw
        image_embeddings_for_compare = image_embeddings_raw
        image_hashes_for_compare = image_hashes_raw

        # 8) เปรียบเทียบทุกคู่
        comparison_results = []
        total_pairs = (len(effective_doc_ids) * (len(effective_doc_ids) - 1)) // 2
        print(f"\n🔄 Starting {total_pairs} comparisons...")

        for i in range(len(effective_doc_ids)):
            for j in range(i + 1, len(effective_doc_ids)):
                id1, id2 = effective_doc_ids[i], effective_doc_ids[j]
                print(f"\n  Comparing: {id1} vs {id2}")

                result = pdf_processor.compare_documents(
                    id1,
                    id2,
                    text_embeddings_for_compare,
                    image_embeddings_for_compare,
                    image_hashes_for_compare,
                )

                if result:
                    print(f"    ✓ Combined score: {result['combined_score']:.4f}")
                    comparison_results.append(result)
                else:
                    print(f"    ⚠️ Comparison returned None")

        sorted_results = sorted(
            comparison_results, key=lambda x: x["combined_score"], reverse=True
        )

        print(f"\n========== COMPARISON COMPLETE ==========")
        print(f"Total comparisons: {len(sorted_results)}")
        if sorted_results:
            print(f"Highest score: {sorted_results[0]['combined_score']:.4f}")
            print(f"Lowest score: {sorted_results[-1]['combined_score']:.4f}")

        return sorted_results

    except Exception as e:
        print(f"❌ Error during comparison: {e}")
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Comparison error: {str(e)}")


# old def get_documents
# @app.get("/documents, response_model=List[DocumentResult]")
# async def get_documents(user=Depends(get_current_user)):
#     """Get list of all processed documents"""
#     if not pdf_processor:
#         raise HTTPException(status_code=503, detail="Service not ready")

#     doc_ids = list(pdf_processor.get_document_ids())

#     # Get document stats
#     document_details = []
#     for doc_id in doc_ids:
#         doc_info = pdf_processor.get_document_info(doc_id)
#         if doc_info:
#             document_details.append(doc_info)


#     return {
#         "documents": doc_ids,
#         "document_details": document_details,
#         "count": len(doc_ids)
#     }
# new def get_documents
@app.get("/documents", response_model=List[DocumentResult])
async def get_documents(
    batch_id: Optional[str] = Query(None),  # ✅ เพิ่มรับ batch_id จาก query string
    user=Depends(get_current_user),
):
    try:
        print(f"[GET /documents] user_id = {user.id}, batch_id = {batch_id}")

        query = (
            supabase_admin.from_("documents_duplicate")
            .select(
                "doc_id, status, processing_mode, text_length, image_count, removed_text_length, error, file_name, created_at, batch_id"
            )
            .eq("user_id", user.id)
        )

        # ✅ ถ้ามี batch_id ให้กรองตาม batch_id
        if batch_id:
            query = query.eq("batch_id", batch_id)

        query_res = query.order("created_at", desc=True).execute()

        print(f"[GET /documents] rows = {len(query_res.data) if query_res.data else 0}")
        return query_res.data or []

    except Exception as e:
        print(f"[GET /documents] Error fetching documents from Supabase: {e}")
        raise HTTPException(
            status_code=500, detail="Could not fetch documents from database."
        )


def to_score01(x: Any) -> float:
    """รับ score ได้ทั้ง 0.9856, 98.56, '98.56%', '0.9856' แล้วคืนค่า 0..1"""
    if x is None:
        return 0.0
    if isinstance(x, str):
        s = x.strip()
        if s.endswith("%"):
            s = s[:-1].strip()
        try:
            v = float(s)
        except ValueError:
            return 0.0
    else:
        try:
            v = float(x)
        except (TypeError, ValueError):
            return 0.0

    if v > 1.0 and v <= 100.0:
        v = v / 100.0
    if v < 0.0:
        v = 0.0
    if v > 1.0:
        v = 1.0
    return v


def quantile(values: List[float], p: float) -> float:
    """quantile แบบไม่พึ่ง numpy"""
    if not values:
        return 0.8
    a = sorted(values)
    p = max(0.0, min(1.0, p))
    idx = (len(a) - 1) * p
    lo = int(idx)
    hi = min(lo + 1, len(a) - 1)
    w = idx - lo
    return a[lo] * (1 - w) + a[hi] * w


def suggest_thresholds(
    scores01: List[float], p_mid: float = 0.80, spread: float = 0.05
) -> Dict[str, float]:
    """คืนค่าแนะนำ threshold 3 ระดับจาก distribution ของรอบนั้น"""
    p_loose = max(0.0, p_mid - spread)
    p_strict = min(1.0, p_mid + spread)
    return {
        "p_loose": p_loose,
        "p_mid": p_mid,
        "p_strict": p_strict,
        "loose": quantile(scores01, p_loose),
        "mid": quantile(scores01, p_mid),
        "strict": quantile(scores01, p_strict),
    }


@app.post("/cluster")
async def cluster_documents(
    request: ClusterReq, current_user=Depends(get_current_user)  # ← ใช้จาก schemas.py
):
    """
    รับ threshold และ pairs จาก frontend
    คืนกลุ่มเอกสารที่ลอกกัน
    """
    try:
        results: List[Tuple[str, str, float]] = []
        scores01: List[float] = []

        for pair in request.pairs:
            raw = (
                pair.final_score
                if pair.final_score is not None
                else (pair.combined_score or 0.0)
            )
            score01 = to_score01(raw)
            results.append((pair.doc_1, pair.doc_2, score01))
            scores01.append(score01)

        if not results:
            raise HTTPException(status_code=400, detail="ไม่มีข้อมูลคู่เอกสารให้จัดกลุ่ม")

        # suggested thresholds (แนะนำ) จาก distribution ของรอบนี้
        suggested = suggest_thresholds(scores01, p_mid=0.80, spread=0.05)

        # ถ้า user ไม่ส่ง threshold มา ให้ใช้ค่ากลางที่แนะนำ (mid) แทน 0.8
        threshold = (
            to_score01(request.threshold)
            if request.threshold is not None
            else suggested["mid"]
        )

        # (optional) กันลากเป็นพวง: top_k=5, mutual_top_k=True
        clusters = cluster_by_threshold(
            results,
            threshold=threshold,
            # top_k=5,
            # mutual_top_k=True,
        )

        return {
            "total_clusters": len(clusters),
            "threshold": threshold,
            "suggested": suggested,  # ✅ frontend เอาไปโชว์ ผ่อน/กลาง/เข้ม ได้เลย
            "clusters": clusters,
        }

    except Exception as e:
        print(f"❌ Clustering error: {e}")
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/cluster-from-batch")
async def cluster_from_batch(
    payload: BatchClusterReq,
    current_user=Depends(get_current_user),
):
    """
    ดึงผลเปรียบเทียบจาก batch_id แล้วจัดกลุ่มให้ + ค่าแนะนำ threshold
    """
    try:
        comparison_results = await compare_documents_in_batch(
            batch_id=payload.batch_id, current_user=current_user
        )

        if not comparison_results:
            return {
                "batch_id": payload.batch_id,
                "threshold": payload.threshold or 0.8,
                "pair_count": 0,
                "cluster_count": 0,
                "clusters": [],
                "pairs": [],
                "suggested": None,
            }

        results: List[Tuple[str, str, float]] = []
        scores01: List[float] = []

        for r in comparison_results:
            raw = r.get("final_score")
            if raw is None:
                raw = r.get("combined_score", 0.0)

            score01 = to_score01(raw)
            results.append((r["doc_1"], r["doc_2"], score01))
            scores01.append(score01)

        suggested = suggest_thresholds(scores01, p_mid=0.80, spread=0.05)

        threshold = (
            to_score01(payload.threshold)
            if payload.threshold is not None
            else suggested["mid"]
        )

        clusters = cluster_by_threshold(
            results,
            threshold=threshold,
            # top_k=5,
            # mutual_top_k=True,
        )

        return {
            "batch_id": payload.batch_id,
            "threshold": threshold,
            "suggested": suggested,  # ✅ ส่งกลับไปให้ UI ใช้ได้
            "pair_count": len(results),
            "cluster_count": len(clusters),
            "clusters": clusters,
            "pairs": comparison_results,
        }

    except Exception as e:
        print(f"❌ Batch clustering error: {e}")
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/documents")
async def clear_documents(current_user=Depends(get_current_user)):
    if not vector_db_manager:
        raise HTTPException(status_code=503, detail="Service not ready")

    user_id = current_user.id

    # 1) ดึง path ทั้งหมดของ user จาก DB
    rows = (
        supabase_admin.from_("documents_duplicate")
        .select("storage_path")
        .eq("user_id", user_id)
        .execute()
    ).data or []

    paths = [r["storage_path"] for r in rows if r.get("storage_path")]

    # 2) ลบไฟล์ใน Storage
    try:
        if paths:
            supabase_admin.storage.from_("assignments").remove(paths)
    except Exception as e:
        print("[WARN] bulk storage delete failed:", e)

    # 3) ลบ vectors เฉพาะ user ใน Pinecone
    try:
        vector_db_manager.text_index.delete(filter={"user_id": {"$eq": user_id}})
    except Exception as e:
        print("[WARN] pinecone text delete failed:", e)

    try:
        vector_db_manager.image_index.delete(filter={"user_id": {"$eq": user_id}})
    except Exception as e:
        print("[WARN] pinecone image delete failed:", e)

    # 4) ลบ DB rows
    supabase_admin.from_("documents_duplicate").delete().eq(
        "user_id", user_id
    ).execute()

    return {"status": "ok", "message": "Deleted all documents for current user"}


@app.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, current_user=Depends(get_current_user)):
    if not vector_db_manager:
        raise HTTPException(status_code=503, detail="Service not ready")

    user_id = current_user.id

    # 1) หาใน DB ก่อน
    res = (
        supabase_admin.from_("documents_duplicate")
        .select("doc_id, storage_path, batch_id, image_count")
        .eq("doc_id", doc_id)
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    # ถ้าไม่มีแล้ว ให้ถือว่าลบแล้ว (ไม่ error)
    if not res.data:
        return {
            "status": "ok",
            "doc_id": doc_id,
            "message": "Already deleted or not found",
        }

    row = res.data[0]
    storage_path = row.get("storage_path")
    batch_id = row.get("batch_id")

    image_count = int(row.get("image_count") or 0)

    # 2) ลบใน Storage
    try:
        if storage_path:
            supabase_admin.storage.from_("assignments").remove([storage_path])
    except Exception as e:
        print("[WARN] storage delete failed:", e)

    # 3) ลบใน Pinecone
    try:
        await vector_db_manager.delete_document_embeddings_by_ids(
            doc_id=doc_id,
            image_count=image_count,
        )
        await vector_db_manager.delete_document_embeddings_for_user(
            doc_id=doc_id, user_id=user_id, batch_id=batch_id
        )
    except Exception as e:
        print("[WARN] pinecone delete failed:", e)

    # 4) ลบ row ใน DB
    supabase_admin.from_("documents_duplicate").delete().eq("doc_id", doc_id).eq(
        "user_id", user_id
    ).execute()

    return {"status": "ok", "doc_id": doc_id}


@app.get("/stats")
async def get_stats(current_user=Depends(get_current_user)):
    """ให้ข้อมูลสถิติเกี่ยวกับเอกสารที่ประมวลผลแล้วของผู้ใช้"""
    if not vector_db_manager:
        raise HTTPException(status_code=503, detail="Service not ready")

    try:
        text_stats = await vector_db_manager.get_text_index_stats()
        image_stats = await vector_db_manager.get_image_index_stats()

        return {
            "text_embeddings": text_stats,
            "image_embeddings": image_stats,
            "total_documents": (
                len(pdf_processor.get_document_ids()) if pdf_processor else 0
            ),
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stats error: {str(e)}")


# if __name__ == "__main__":
#     uvicorn.run(
#         "main:app",
#         host="0.0.0.0",
#         port=8000,
#         reload=True,
#         log_level="info"
#     )

# เพิ่ม endpoint นี้ใน main.py เพื่อ debug


@app.get("/debug/simple/{batch_id}")
async def simple_debug(batch_id: str, current_user=Depends(get_current_user)):
    """Simple debug endpoint - ดูว่ามีข้อมูลอะไรใน Pinecone บ้าง"""
    if not vector_db_manager or not vector_db_manager.is_connected():
        return {"error": "Vector DB not connected"}

    try:
        print(f"\n========== SIMPLE DEBUG: {batch_id} ==========")

        result = {
            "batch_id": batch_id,
            "text_vectors": [],
            "image_vectors": [],
            "errors": [],
        }

        # 1. ดู text index
        try:
            print("Querying text index...")
            text_response = vector_db_manager.text_index.query(
                vector=[0.0] * 768, top_k=100, include_metadata=True  # TEXT_DIMENSION
            )

            print(f"Found {len(text_response.matches)} text vectors")

            for match in text_response.matches:
                vec_info = {
                    "id": match.id,
                    "metadata": match.metadata if match.metadata else {},
                }
                result["text_vectors"].append(vec_info)

                # แสดงใน console
                print(f"  Text Vector: {match.id}")
                if match.metadata:
                    print(f"    Metadata: {match.metadata}")

        except Exception as e:
            error_msg = f"Text index error: {str(e)}"
            print(f"❌ {error_msg}")
            result["errors"].append(error_msg)

        # 2. ดู image index
        try:
            print("\nQuerying image index...")
            image_response = vector_db_manager.image_index.query(
                vector=[0.0] * 768, top_k=100, include_metadata=True  # IMAGE_DIMENSION
            )

            print(f"Found {len(image_response.matches)} image vectors")

            for match in image_response.matches:
                vec_info = {
                    "id": match.id,
                    "metadata": match.metadata if match.metadata else {},
                }
                result["image_vectors"].append(vec_info)

                # แสดงใน console
                print(f"  Image Vector: {match.id}")
                if match.metadata:
                    print(f"    Metadata: {match.metadata}")

        except Exception as e:
            error_msg = f"Image index error: {str(e)}"
            print(f"❌ {error_msg}")
            result["errors"].append(error_msg)

        # 3. Filter เฉพาะ batch นี้
        result["batch_text_vectors"] = [
            v
            for v in result["text_vectors"]
            if v.get("metadata", {}).get("batch_id") == batch_id
        ]

        result["batch_image_vectors"] = [
            v
            for v in result["image_vectors"]
            if v.get("metadata", {}).get("batch_id") == batch_id
        ]

        print(f"\n========== SUMMARY ==========")
        print(f"Total text vectors: {len(result['text_vectors'])}")
        print(f"Total image vectors: {len(result['image_vectors'])}")
        print(f"Batch text vectors: {len(result['batch_text_vectors'])}")
        print(f"Batch image vectors: {len(result['batch_image_vectors'])}")

        return result

    except Exception as e:
        print(f"❌ Fatal error: {e}")
        import traceback

        traceback.print_exc()
        return {"error": str(e), "traceback": traceback.format_exc()}


@app.get("/debug/test-filter/{batch_id}")
async def test_filter(batch_id: str, current_user=Depends(get_current_user)):
    """ทดสอบว่า filter ใน Pinecone ทำงานหรือไม่"""
    if not vector_db_manager or not vector_db_manager.is_connected():
        return {"error": "Vector DB not connected"}

    try:
        print(f"\n========== TESTING FILTER: {batch_id} ==========")

        # ทดสอบ filter แบบต่างๆ
        test_results = {}

        # Test 1: ไม่ใช้ filter
        try:
            response = vector_db_manager.text_index.query(
                vector=[0.0] * 768, top_k=10, include_metadata=True
            )
            test_results["no_filter"] = {
                "count": len(response.matches),
                "vectors": [
                    {"id": m.id, "metadata": m.metadata} for m in response.matches
                ],
            }
            print(f"No filter: {len(response.matches)} results")
        except Exception as e:
            test_results["no_filter"] = {"error": str(e)}

        # Test 2: Filter แบบ $eq
        try:
            response = vector_db_manager.text_index.query(
                vector=[0.0] * 768,
                top_k=10,
                filter={"batch_id": {"$eq": batch_id}},
                include_metadata=True,
            )
            test_results["filter_eq"] = {
                "count": len(response.matches),
                "vectors": [
                    {"id": m.id, "metadata": m.metadata} for m in response.matches
                ],
            }
            print(f"Filter $eq: {len(response.matches)} results")
        except Exception as e:
            test_results["filter_eq"] = {"error": str(e)}

        # Test 3: Filter แบบง่าย
        try:
            response = vector_db_manager.text_index.query(
                vector=[0.0] * 768,
                top_k=10,
                filter={"batch_id": batch_id},
                include_metadata=True,
            )
            test_results["filter_simple"] = {
                "count": len(response.matches),
                "vectors": [
                    {"id": m.id, "metadata": m.metadata} for m in response.matches
                ],
            }
            print(f"Filter simple: {len(response.matches)} results")
        except Exception as e:
            test_results["filter_simple"] = {"error": str(e)}

        return {"batch_id": batch_id, "tests": test_results}

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback

        traceback.print_exc()
        return {"error": str(e)}


@app.get("/batches/latest")
async def get_latest_batch(current_user=Depends(get_current_user)):
    """
    ใช้ตอน login ใหม่ เพื่อดึง batch ล่าสุดของ user
    """
    try:
        res = (
            supabase_admin.from_("documents_duplicate")
            .select("batch_id, created_at")
            .eq("user_id", current_user.id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )

        if not res.data:
            return None

        return {"batch_id": res.data[0]["batch_id"]}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/documents/{doc_id}/preview-url")
async def get_preview_url(
    doc_id: str,
    batch_id: Optional[str] = Query(None),
    current_user=Depends(get_current_user),
):
    q = (
        supabase_admin.from_("documents_duplicate")
        .select("storage_path")
        .eq("doc_id", doc_id)
        .eq("user_id", current_user.id)
    )

    # ✅ ถ้าส่ง batch_id มา → เอาไฟล์ของรอบนั้นเท่านั้น
    if batch_id:
        q = q.eq("batch_id", batch_id)

    res = q.order("created_at", desc=True).limit(1).execute()

    if not res.data:
        raise HTTPException(status_code=404, detail="Document not found for this batch")

    path = res.data[0].get("storage_path")
    if not path:
        raise HTTPException(status_code=404, detail="Storage path not found")

    signed = supabase_admin.storage.from_(BUCKET_NAME).create_signed_url(
        path, expires_in=PREVIEW_EXPIRES_IN
    )

    signed_url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("url")
    if not signed_url:
        raise HTTPException(
            status_code=500, detail=f"Cannot create signed url: {signed}"
        )

    return {"url": ensure_absolute_url(signed_url), "expires_in": PREVIEW_EXPIRES_IN}
