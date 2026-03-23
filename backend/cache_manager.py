"""
Cache Manager for PDF Processing
Handles file hash calculation and cache operations
"""

import hashlib
from typing import Dict, Optional, Any
from supabase_client import supabase_admin


def calculate_file_hash(content: bytes) -> str:
    """คำนวณ SHA256 hash ของไฟล์"""
    return hashlib.sha256(content).hexdigest()


async def check_file_cache(
    file_hash: str, processing_mode: int
) -> Optional[Dict[str, Any]]:
    """เช็คว่าเคยประมวลผลไฟล์นี้แล้วหรือยัง"""
    try:
        result = (
            supabase_admin.from_("processed_files")
            .select("*")
            .eq("file_hash", file_hash)
            .eq("processing_mode", processing_mode)
            .limit(1)
            .execute()
        )

        if result.data:
            cache_data = result.data[0]

            # ✅ กัน cache เก่า/เสีย
            if processing_mode in (1, 3):
                if not (cache_data.get("text_vector_ids") or []):
                    print(
                        f"⚠️ Cache INVALID (no text_vector_ids): {file_hash[:8]}... -> treat as MISS"
                    )
                    return None

            if processing_mode in (2, 3):
                if not (cache_data.get("image_vector_ids") or []):
                    print(
                        f"⚠️ Cache INVALID (no image_vector_ids): {file_hash[:8]}... -> treat as MISS"
                    )
                    return None

            print(f"✅ Cache HIT: {file_hash[:8]}... (mode={processing_mode})")
            print(f"   Use count: {cache_data.get('use_count', 0)}")
            print(
                f"   Text vectors: {len(cache_data.get('text_vector_ids', []) or [])}"
            )
            print(
                f"   Image vectors: {len(cache_data.get('image_vector_ids', []) or [])}"
            )
            return cache_data

        print(f"❌ Cache MISS: {file_hash[:8]}... (mode={processing_mode})")
        return None

    except Exception as e:
        print(f"⚠️ Cache check error: {e}")
        return None


async def save_file_cache(
    file_hash: str,
    filename: str,
    file_size: int,
    storage_path: str,
    processing_mode: int,
    metadata: Dict[str, Any],
) -> bool:
    """บันทึกผลการประมวลผลลง cache (ใช้ UPSERT กันซ้ำ)"""
    try:
        cache_data = {
            "file_hash": file_hash,
            "original_filename": filename,
            "file_size": file_size,
            "storage_path": storage_path,
            "processing_mode": processing_mode,
            "text_length": metadata.get("text_length", 0),
            "image_count": metadata.get("image_count", 0),
            "removed_text_length": metadata.get("removed_text_length", 0),
            "text_vector_ids": metadata.get("text_vector_ids", []) or [],
            "image_vector_ids": metadata.get("image_vector_ids", []) or [],
        }

        (
            supabase_admin.from_("processed_files")
            .upsert(cache_data, on_conflict="file_hash,processing_mode")
            .execute()
        )

        print(f"💾 Saved cache: {file_hash[:8]}...")
        print(f"   Text vectors: {len(cache_data['text_vector_ids'])}")
        print(f"   Image vectors: {len(cache_data['image_vector_ids'])}")
        return True

    except Exception as e:
        print(f"⚠️ Cache save error: {e}")
        import traceback

        traceback.print_exc()
        return False


async def link_batch_file(
    batch_id: str,
    user_id: str,
    file_hash: str,
    processing_mode: int,
    doc_id: str,
    filename: str,
) -> bool:
    try:
        # ใช้ insert ปกติ (ไม่ upsert) เพื่อเลี่ยง ON CONFLICT error
        supabase_admin.from_("batch_files").upsert(
            {
                "batch_id": batch_id,
                "user_id": user_id,
                "file_hash": file_hash,
                "processing_mode": processing_mode,
                "doc_id": doc_id,
                "filename": filename,
            },
            on_conflict="batch_id,user_id,doc_id,processing_mode",
        ).execute()
        print(f"🔗 Linked batch: {batch_id} -> {doc_id} (mode={processing_mode})")
        return True
    except Exception as e:
        # ถ้า insert ซ้ำแล้วพัง ให้ ignore แบบนุ่มๆ
        msg = str(e)
        if "duplicate key" in msg or "already exists" in msg:
            print(f"ℹ️ batch_files already linked: {batch_id} -> {doc_id}")
            return True

        print(f"⚠️ Link batch error: {e}")
        import traceback

        traceback.print_exc()
        return False


async def update_file_usage(file_hash: str, processing_mode: int) -> bool:
    """อัพเดทสถิติการใช้งาน"""
    try:
        supabase_admin.rpc(
            "increment_file_usage", {"hash": file_hash, "mode": processing_mode}
        ).execute()
        print(f"📈 Updated usage: {file_hash[:8]}... (mode={processing_mode})")
        return True
    except Exception as e:
        print(f"⚠️ Usage update error: {e}")
        return False


async def get_cached_result(
    file_hash: str, processing_mode: int, doc_id: str
) -> Optional[Dict[str, Any]]:
    """สร้างผลลัพธ์จาก cache"""
    cached = await check_file_cache(file_hash, processing_mode)
    if not cached:
        return None

    return {
        "doc_id": doc_id,
        "status": "cached",
        "processing_mode": processing_mode,
        "text_length": cached.get("text_length", 0),
        "image_count": cached.get("image_count", 0),
        "removed_text_length": cached.get("removed_text_length", 0),
        "text_vector_ids": cached.get("text_vector_ids", []) or [],
        "image_vector_ids": cached.get("image_vector_ids", []) or [],
        "cached": True,
        "file_hash": file_hash,
        "use_count": cached.get("use_count", 1),
    }
