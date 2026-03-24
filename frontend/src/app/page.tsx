"use client";

import MainHeader from "@/components/MainHeader";
import { FileSearch, Upload, BarChart3, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

export default function LandingPage() {
  return (
    <div className="h-screen bg-white overflow-hidden flex flex-col">
      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-6 py-20 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div>
          <h2 className="text-4xl font-bold text-gray-900 leading-tight">
            ระบบตรวจสอบความคล้ายคลึง
            <span className="block text-indigo-600 mt-2">ของชิ้นงาน</span>
          </h2>
          <p className="mt-6 text-lg text-gray-600">
            วิเคราะห์ความคล้ายคลึงของเอกสาร PDF เพื่อช่วยลดเวลาการตรวจสอบ
          </p>

          <div className="mt-8 flex space-x-4">
            {/* ปุ่มนี้แนะนำให้ไป dashboard (มันจะกันไว้เองถ้าไม่ล็อกอิน) */}
            <LinkButton href="/dashboard" primary>
              เริ่มใช้งาน
            </LinkButton>
            <LinkButton href="/signup">สมัครใช้งาน</LinkButton>
          </div>
        </div>

        <div className="bg-gray-50 rounded-xl p-8 border">
          <div className="grid grid-cols-2 gap-6">
            <Feature
              icon={<Upload />}
              title="อัปโหลด PDF"
              desc="รองรับหลายไฟล์ พร้อมจัดการเป็นชุดงาน"
            />
            <Feature
              icon={<FileSearch />}
              title="วิเคราะห์อัตโนมัติ"
              desc="ตรวจสอบทั้งข้อความและรูปภาพ"
            />
            <Feature
              icon={<BarChart3 />}
              title="ดูผลลัพธ์ชัดเจน"
              desc="แสดงคะแนนและระดับความคล้าย"
            />
            <Feature
              icon={<ShieldCheck />}
              title="ลดการลอกงาน"
              desc="ช่วยตัดสินใจอย่างมีข้อมูลสนับสนุน"
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function Feature({
  icon,
  title,
  desc,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start space-x-3">
      <div className="p-2 bg-indigo-100 text-indigo-600 rounded-md">{icon}</div>
      <div>
        <h4 className="font-medium text-gray-900">{title}</h4>
        <p className="text-sm text-gray-600">{desc}</p>
      </div>
    </div>
  );
}

function LinkButton({
  href,
  children,
  primary,
}: {
  href: string;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "px-6 py-3 rounded-md bg-indigo-600 text-white text-base font-medium hover:bg-indigo-700"
          : "px-6 py-3 rounded-md border border-gray-300 text-gray-700 text-base hover:bg-gray-50"
      }
    >
      {children}
    </Link>
  );
}

import Link from "next/link";
