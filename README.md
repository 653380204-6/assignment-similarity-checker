# Assignment Similarity Checker

ระบบตรวจสอบความคล้ายคลึงของเอกสาร PDF สำหรับช่วยวิเคราะห์ความคล้ายของงานที่อัปโหลดเข้าสู่ระบบ โดยรองรับการประมวลผลทั้งข้อความ รูปภาพ และโหมดผสม พร้อมหน้าแสดงผลการเปรียบเทียบ การจัดกลุ่มเอกสาร และการวิเคราะห์ผลบนหน้าเว็บ

## คุณสมบัติหลัก

- อัปโหลดไฟล์ PDF หลายไฟล์ในหนึ่ง batch
- รองรับ 3 โหมดการประมวลผล
  - Text
  - Images
  - Both
- รองรับการใช้ template file เพื่อตัดข้อความส่วนกลางออกก่อนเปรียบเทียบ
- แสดงผลคะแนนความคล้ายของเอกสารเป็นรายคู่
- แสดงผลการจัดกลุ่มเอกสารตาม threshold
- มีหน้า Analysis สำหรับดู histogram แนวโน้ม threshold และ dendrogram

## โครงสร้างโปรเจค

```text
assignment-similarity-checker-dev/
├─ frontend/
├─ backend/
├─ README.md
└─ README_DATABASE_SETUP.md
```

## เทคโนโลยีที่ใช้

### Frontend
- Next.js
- React
- TypeScript
- Tailwind CSS
- Recharts
- Plotly
- Axios

### Backend
- FastAPI
- Python
- Supabase
- Pinecone
- LaBSE
- CLIP

## การเริ่มต้นใช้งาน

### 1. Clone project

```bash
git clone <your-repository-url>
cd assignment-similarity-checker-dev
```

### 2. ตั้งค่าฐานข้อมูลและบริการที่เกี่ยวข้อง

การตั้งค่า Supabase Pinecone และตัวแปรสภาพแวดล้อมที่เกี่ยวข้องกับฐานข้อมูล ให้ดูที่ไฟล์นี้

[README_DATABASE_SETUP.md](./README_DATABASE_SETUP.md)

## การใช้งาน Frontend

### ตำแหน่งโฟลเดอร์

```bash
cd frontend
```

### ติดตั้ง dependencies

```bash
npm install
```

### รันระบบแบบ development

```bash
npm run dev
```

จากนั้นเปิดเบราว์เซอร์ที่

```text
http://localhost:3000
```

### หน้าที่สำคัญของ Frontend

- หน้า Home สำหรับแนะนำระบบ
- หน้า Dashboard สำหรับอัปโหลดไฟล์และเริ่มตรวจสอบ
- หน้า Clustering สำหรับดูผลการจัดกลุ่มเอกสาร
- หน้า Analysis สำหรับดู histogram threshold sweep และ dendrogram
- หน้า Login และ Register สำหรับผู้ใช้งาน

### หมายเหตุของ Frontend

Frontend จะเรียกใช้งาน API จาก Backend ผ่านตัวแปร environment ของฝั่งหน้าเว็บ ดังนั้นต้องตั้งค่า URL ของ backend ให้ถูกต้องก่อนรัน

ตัวอย่างเช่น

```env
NEXT_PUBLIC_API_URL=http://localhost:8089
```

## การใช้งาน Backend

### ตำแหน่งโฟลเดอร์

```bash
cd backend
```

### สร้าง virtual environment

```bash
python -m venv venv
```

เปิดใช้งานบน Windows

```bash
venv\Scripts\activate
```

เปิดใช้งานบน macOS หรือ Linux

```bash
source venv/bin/activate
```

### ติดตั้ง dependencies

```bash
pip install -r requirements.txt
```

### รัน backend

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8089
```

หรือถ้าโปรเจคคุณใช้ entry file อื่น เช่น `app.main:app` ให้ปรับตามโครงสร้างจริงของ backend

### URL สำหรับทดสอบ backend

```text
http://localhost:8089
```

### ตัวอย่าง endpoint ที่ใช้งานบ่อย

- `GET /health` สำหรับตรวจสอบว่า backend ทำงานอยู่หรือไม่
- `POST /upload-pdfs` สำหรับอัปโหลดเอกสารเข้าสู่ระบบ
- `GET /compare?batch_id=...` สำหรับดูผลเปรียบเทียบรายคู่
- `GET /documents?batch_id=...` สำหรับดูรายการเอกสารใน batch
- `GET /documents/{doc_id}/preview-url?batch_id=...` สำหรับขอลิงก์ preview เอกสาร
- `POST /dendrogram` สำหรับสร้างข้อมูล dendrogram
- `GET /auth/me` สำหรับดึงข้อมูลผู้ใช้ที่ล็อกอินอยู่

## ลำดับการเปิดระบบ

แนะนำให้เปิดใช้งานตามลำดับนี้

1. ตั้งค่าฐานข้อมูลและ services ตาม `README_DATABASE_SETUP.md`
2. รัน Backend ก่อน
3. รัน Frontend ตามหลัง
4. เปิด `http://localhost:3000` เพื่อใช้งานหน้าเว็บ

## Environment Variables

ไฟล์ `.env` หรือ `.env.local` ของแต่ละส่วนควรถูกตั้งค่าให้ครบก่อนใช้งาน

### Frontend

ตัวอย่างตัวแปรที่มักต้องใช้

```env
NEXT_PUBLIC_API_URL=http://localhost:8089
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Backend

ตัวอย่างตัวแปรที่มักต้องใช้

```env
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_service_role_key
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX=your_pinecone_index_name
```

รายละเอียดทั้งหมดให้ดูที่

[README_DATABASE_SETUP.md](./README_DATABASE_SETUP.md)

## การใช้งานระบบแบบย่อ

1. เข้าสู่ระบบผ่านหน้าเว็บ
2. อัปโหลดไฟล์ PDF ที่ต้องการตรวจสอบ
3. เลือกโหมดการประมวลผล
4. เริ่มการประมวลผล
5. ดูผลการเปรียบเทียบเอกสารบนหน้า Dashboard
6. ดูผลการจัดกลุ่มบนหน้า Clustering
7. วิเคราะห์ค่าคะแนนและ threshold บนหน้า Analysis

## หมายเหตุเพิ่มเติม

- ระบบนี้ออกแบบมาเพื่อช่วยวิเคราะห์ความคล้ายของเอกสาร ไม่ได้ตัดสินการคัดลอกแทนผู้สอนโดยอัตโนมัติ
- หาก backend เชื่อมต่อฐานข้อมูลหรือ vector database ไม่ได้ ระบบจะไม่สามารถประมวลผลเอกสารได้
- หากใช้งานในเครื่องตัวเอง ความเร็วของระบบจะขึ้นอยู่กับสเปกเครื่องและการเชื่อมต่อบริการภายนอก

## คำแนะนำสำหรับการพัฒนาต่อ

- แยกค่า environment เป็นไฟล์ของ frontend และ backend อย่างชัดเจน
- ไม่ควร commit secret key ลงใน repository
- ควรเพิ่มตัวอย่าง `.env.example` สำหรับผู้ที่ clone โปรเจคไปใช้งานต่อ

