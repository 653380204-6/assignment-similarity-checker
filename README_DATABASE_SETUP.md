# README_DATABASE_SETUP

คู่มือนี้อธิบายการตั้งค่า database และ services ที่เกี่ยวข้องสำหรับโปรเจค Assignment Similarity Checker โดยเน้นการใช้งานร่วมกับ Supabase และ Pinecone

## สิ่งที่ต้องมี

- Supabase project
- Pinecone account และ index
- ไฟล์ `schema.sql`
- ไฟล์ `data.sql` ถ้าต้องการนำข้อมูลเดิมกลับมาใช้
- Frontend และ Backend ของโปรเจคนี้

## ภาพรวมสถาปัตยกรรม

โปรเจคนี้ใช้

- **Supabase** สำหรับ database authentication และ storage
- **Pinecone** สำหรับเก็บ vector embeddings
- **Backend FastAPI** สำหรับประมวลผล PDF และเชื่อมต่อ services ต่าง ๆ
- **Frontend Next.js** สำหรับหน้าจอผู้ใช้

## 1 สร้าง Supabase Project

1. เข้าไปที่ Supabase Dashboard
2. สร้าง project ใหม่
3. ตั้งชื่อ project และกำหนด database password
4. รอจน project พร้อมใช้งาน

## 2 ค่าที่ต้องคัดลอกจาก Supabase

หลังจากสร้าง project แล้ว ให้เตรียมค่าต่อไปนี้

### สำหรับ Frontend

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

ดูได้จาก

- `Project Settings > Data API`
- หรือหน้า `Connect` และหน้า settings ที่เกี่ยวข้อง

### สำหรับ Backend

- `SUPABASE_URL`
- `SUPABASE_KEY` หรือ `SUPABASE_SERVICE_ROLE_KEY`

โดยทั่วไป backend ควรใช้ **service role key** เพื่อให้เข้าถึงตารางและ storage ได้ครบตามที่ระบบต้องใช้

## 3 ตั้งค่า Database Schema

ถ้าคุณมีไฟล์ `schema.sql` อยู่แล้ว ให้ import เข้าไปใน Supabase project ใหม่

### วิธีที่ง่ายสุดผ่านหน้าเว็บ

1. เปิด `SQL Editor`
2. สร้าง query ใหม่
3. วางเนื้อหาจากไฟล์ `schema.sql`
4. กด Run

ไฟล์ `schema.sql` ของโปรเจคนี้จะสร้างองค์ประกอบสำคัญ เช่น

- extension ที่ระบบใช้
- ตาราง `public."User"`
- ตาราง `public.documents_duplicate`
- ตาราง `public.batch_files`
- ตาราง `public.batches`
- ตาราง `public.document_pairs`
- view `public.v_compare_results`
- functions และ triggers ที่เกี่ยวข้อง
- indexes foreign keys grants และการเปิดใช้ RLS

> หมายเหตุ
> ถ้า `schema.sql` ของคุณอ้างถึง Supabase schemas เช่น `auth.users` หรือ extensions ของ Supabase ควร import ใน Supabase project จะเหมาะที่สุด

## 4 นำข้อมูลเดิมกลับมาใช้

ถ้าคุณมีไฟล์ `data.sql` และต้องการนำข้อมูลเดิมกลับมาใช้

### กรณีข้อมูลไม่ใหญ่มาก

สามารถทดลอง import ผ่าน `SQL Editor` ได้โดย

1. เปิด `SQL Editor`
2. สร้าง query ใหม่
3. วางเนื้อหาจาก `data.sql`
4. กด Run

### กรณีข้อมูลเยอะ

แนะนำให้ใช้เครื่องมือภายนอกเช่น `psql` ในการ import เพื่อให้เสถียรกว่า

ถ้าคุณยังไม่มี `data.sql` แต่มีแค่ `schema.sql` ระบบจะได้เฉพาะโครงสร้างตาราง ไม่ได้ข้อมูลเดิม

## 5 ตารางหลักของระบบ

ตารางที่สำคัญในโปรเจคนี้ได้แก่

### `public."User"`
ใช้เก็บข้อมูลผู้ใช้ของระบบ เช่น

- `auth_uid`
- `email`
- `full_name`

### `public.documents_duplicate`
ใช้เก็บข้อมูลเอกสารที่อัปโหลด เช่น

- ชื่อไฟล์
- `doc_id`
- `storage_path`
- `batch_id`
- `processing_mode`
- สถานะการประมวลผล
- จำนวนข้อความและรูปภาพ

### `public.batch_files`
ใช้เก็บความสัมพันธ์ของไฟล์ในแต่ละ batch

### `public.batches`
ใช้เก็บข้อมูลระดับ batch เช่น

- เจ้าของ batch
- processing mode
- การใช้ template
- สถานะของ batch

### `public.document_pairs`
ใช้เก็บผลการเปรียบเทียบเอกสารเป็นรายคู่ เช่น

- `doc_id_1`
- `doc_id_2`
- `text_score`
- `image_score`
- `final_score`
- สถานะการประมวลผล

## 6 Authentication ใน Supabase

โปรเจคนี้อ้างอิง `auth.users` ของ Supabase ดังนั้นควรเปิดใช้งาน Auth ใน project

สิ่งที่ควรตรวจสอบ

- เปิด Email Auth ถ้าระบบใช้สมัครสมาชิกด้วยอีเมล
- ตั้งค่า redirect URL สำหรับ frontend
- ถ้าระบบสร้างข้อมูลลง `public."User"` อัตโนมัติ ให้ตรวจสอบว่ามี function และ trigger ที่เกี่ยวข้องครบ

จาก schema ของโปรเจคนี้มี function `handle_new_user()` สำหรับเพิ่มข้อมูลผู้ใช้เข้าสู่ตาราง `public."User"`

## 7 Storage ที่ควรมีใน Supabase

แม้ไฟล์นี้เน้น database แต่ระบบของคุณยังต้องใช้ **Storage bucket** สำหรับเก็บ PDF ด้วย

แนะนำให้สร้าง bucket เช่น

- `assignments`

และให้ backend เป็นผู้จัดการอัปโหลดไฟล์เข้าสู่ bucket นี้

ข้อมูลที่เชื่อมกับ storage จะถูกเก็บในตาราง เช่น `documents_duplicate.storage_path`

## 8 ตั้งค่า Pinecone

ระบบนี้ไม่ได้ใช้แค่ database อย่างเดียว แต่ยังต้องมี vector database สำหรับ embeddings ด้วย

สิ่งที่ต้องเตรียม

- `PINECONE_API_KEY`
- ชื่อ index เช่น `PINECONE_INDEX`
- environment ของ Pinecone ตามที่ account ของคุณกำหนด

Backend จะใช้ Pinecone เพื่อเก็บ embeddings ของข้อความและรูปภาพที่สกัดจาก PDF

## 9 ตัวอย่าง Environment Variables

## Frontend `.env.local`

```env
NEXT_PUBLIC_API_URL=http://localhost:8089
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## Backend `.env`

```env
APP_NAME=PDF Plagiarism Detection API
APP_ENV=development
APP_HOST=0.0.0.0
APP_PORT=8089

SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_service_role_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX=your_pinecone_index_name

FRONTEND_ORIGINS=http://localhost:3000
```

> หมายเหตุ
> ชื่อ environment variables จริงอาจต่างกันเล็กน้อยตามโครงสร้าง backend ของคุณ ให้ตรวจสอบจากไฟล์ config หรือไฟล์ที่เรียก `os.getenv()` ใน backend อีกครั้ง

## 10 ขั้นตอนแนะนำในการตั้งค่าระบบใหม่

1. สร้าง Supabase project
2. ตั้งค่า Auth ให้พร้อมใช้งาน
3. สร้าง bucket สำหรับเก็บไฟล์ PDF
4. import `schema.sql`
5. import `data.sql` ถ้ามี
6. สร้าง Pinecone index
7. ตั้งค่า `.env` ของ backend
8. ตั้งค่า `.env.local` ของ frontend
9. รัน backend
10. รัน frontend
11. ทดสอบ login upload และ compare

## 11 วิธีตรวจสอบว่า setup สำเร็จ

### ฝั่ง Supabase

ควรเห็นตารางหลักใน `Table Editor` เช่น

- `User`
- `documents_duplicate`
- `batch_files`
- `batches`
- `document_pairs`

### ฝั่ง Backend

เมื่อรัน backend แล้ว ควรเรียก endpoint เช่น

- `GET /health`

แล้วระบบตอบกลับได้ปกติ

### ฝั่ง Frontend

ควรสามารถ

- สมัครสมาชิกหรือเข้าสู่ระบบ
- อัปโหลดไฟล์ PDF
- เรียกดูเอกสารใน batch
- เรียกผล compare ได้

## 12 ปัญหาที่พบบ่อย

### import schema แล้ว error เรื่อง extension
ให้ตรวจสอบว่า import ใน Supabase project ไม่ใช่ PostgreSQL ทั่วไป

### import schema แล้ว error เรื่อง `auth.users`
แปลว่าปลายทางอาจไม่มี Supabase Auth schema ครบ หรือไม่ได้อยู่ใน Supabase environment

### login ได้แต่ backend เข้าถึงข้อมูลไม่ได้
ให้ตรวจสอบว่า backend ใช้ service role key ถูกต้อง

### อัปโหลดไฟล์ไม่ได้
ให้ตรวจสอบ bucket ใน Supabase Storage และสิทธิ์การเข้าถึง

### เปรียบเทียบเอกสารไม่ได้
ให้ตรวจสอบว่า Pinecone ถูกตั้งค่าถูกต้อง และ backend อ่านค่า API key ได้

## 13 ข้อแนะนำด้านความปลอดภัย

- อย่า commit secret keys ลง Git repository
- อย่าแชร์ service role key ต่อสาธารณะ
- ควรเก็บ `.env` ไว้นอก version control
- ถ้าเผลอแชร์ database password หรือ API key ให้รีเซ็ตทันที

## 14 ไฟล์ที่ควรมีในโปรเจค

```text
assignment-similarity-checker-dev/
├─ frontend/
├─ backend/
├─ schema.sql
├─ data.sql
├─ README.md
└─ README_DATABASE_SETUP.md
```

## 15 สรุป

ถ้าคุณต้องการให้โปรเจคนี้ทำงานได้ครบ ควรเตรียมอย่างน้อย

- Supabase project
- database schema
- storage bucket
- auth settings
- Pinecone index
- environment variables ของ frontend และ backend

หลังจากตั้งค่าครบแล้ว ให้กลับไปดูขั้นตอนการเปิดระบบต่อที่ไฟล์หลัก

[README.md](./README.md)
