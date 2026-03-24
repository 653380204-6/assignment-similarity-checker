from pydantic import BaseModel, EmailStr
from typing import Optional, List

# โมเดลสำหรับรับข้อมูลตอนสมัครสมาชิก


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str


# โมเดลสำหรับรับข้อมูลตอนเข้าสู่ระบบ


class UserLogin(BaseModel):
    email: EmailStr
    password: str


# โมเดลสำหรับข้อมูลที่จะส่งกลับไปให้ User (เพื่อความปลอดภัย ไม่ส่ง password กลับไป)


class UserResponse(BaseModel):
    id: str
    email: EmailStr


# Pydantic class สำหรับผลลัพธ์ของเอกสาร
class DocumentResult(BaseModel):
    doc_id: str
    status: Optional[str] = None
    processing_mode: Optional[int] = None
    text_length: Optional[int] = None
    image_count: Optional[int] = None
    removed_text_length: Optional[int] = None
    error: Optional[str] = None
    file_name: Optional[str] = None  # ✅ ต้องมี
    created_at: Optional[str] = None
    batch_id: Optional[str] = None


class PairScore(BaseModel):
    doc_1: str
    doc_2: str
    final_score: Optional[float] = None
    combined_score: Optional[float] = None


class ClusterReq(BaseModel):
    threshold: Optional[float] = None
    pairs: List[PairScore]


class BatchClusterReq(BaseModel):
    batch_id: str
    threshold: Optional[float] = None
