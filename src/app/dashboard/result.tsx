"use client";

import { useState, useEffect } from 'react';

export default function ResultPage() {
  // 1. สร้าง State เพื่อเก็บข้อมูลผลลัพธ์ที่จะแสดงผล
  const [results, setResults] = useState([]);

  // 2. ใช้ useEffect เพื่อสั่งให้โค้ดทำงาน "หลังจาก" ที่คอมโพเนนต์ถูกสร้างขึ้นแล้วเท่านั้น
  //    เพื่อความปลอดภัย เพราะ sessionStorage มีอยู่แค่ในฝั่งเบราว์เซอร์
  useEffect(() => {
    // 3. หยิบข้อมูลจากกล่อง 'comparisonResults' ใน sessionStorage
    const storedResults = sessionStorage.getItem('comparisonResults');

    // 4. เช็คว่ามีข้อมูลอยู่จริงหรือไม่
    if (storedResults) {
      // 5. แปลง "ข้อความ" กลับมาเป็น Object/Array ที่ใช้งานได้
      const parsedResults = JSON.parse(storedResults);
      setResults(parsedResults);
    }
  }, []); // [] หมายถึงให้ useEffect ทำงานแค่ครั้งเดียวตอนเปิดหน้านี้
}

