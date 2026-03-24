"use client";

import { useEffect, useMemo, useState } from "react";
import { User, Mail, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import MainHeader from "@/components/MainHeader";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

export default function ProfilePage() {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [initialName, setInitialName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const firstLetter = useMemo(() => {
    const name = fullName?.trim() || email?.trim() || "U";
    return name.charAt(0).toUpperCase();
  }, [fullName, email]);

  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true);
      setError("");
      setMessage("");

      try {
        const token = sessionStorage.getItem("access_token");

        if (!token) {
          setError("กรุณาเข้าสู่ระบบก่อน");
          setLoading(false);
          return;
        }

        const res = await fetch(`${API_BASE}/auth/me`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          throw new Error("ไม่สามารถโหลดข้อมูลโปรไฟล์ได้");
        }

        const data = await res.json();

        const name = data.name || "";
        const userEmail = data.email || "";

        setFullName(name);
        setInitialName(name);
        setEmail(userEmail);

        if (name) {
          sessionStorage.setItem("user_name", name);
        }
        if (userEmail) {
          sessionStorage.setItem("user_email", userEmail);
        }
      } catch (err: any) {
        setError(err.message || "เกิดข้อผิดพลาดในการโหลดข้อมูล");
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const token = sessionStorage.getItem("access_token");

      if (!token) {
        throw new Error("กรุณาเข้าสู่ระบบก่อน");
      }

      const res = await fetch(`${API_BASE}/auth/profile`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          full_name: fullName,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "บันทึกข้อมูลไม่สำเร็จ");
      }

      const savedName = data.name || fullName;

      setFullName(savedName);
      setInitialName(savedName);
      setMessage("บันทึกข้อมูลเรียบร้อยแล้ว");
      sessionStorage.setItem("user_name", savedName);
    } catch (err: any) {
      setError(err.message || "เกิดข้อผิดพลาดในการบันทึกข้อมูล");
    } finally {
      setSaving(false);
    }
  };

  const isChanged = fullName.trim() !== initialName.trim();

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="กลับ"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 shadow-sm transition hover:bg-gray-50"
          >
            <Undo2 className="h-5 w-5" />
          </button>
        </div>

        <h1 className="text-3xl font-bold text-gray-900">โปรไฟล์ของฉัน</h1>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <section className="lg:col-span-3">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gray-100 text-3xl font-semibold text-gray-600">
                  {firstLetter}
                </div>

                <p className="mt-5 text-2xl font-semibold text-gray-900">
                  {fullName || "ผู้ใช้งาน"}
                </p>

                <p className="mt-1 break-all text-sm text-gray-400">
                  {email || "ไม่พบอีเมล"}
                </p>
              </div>
            </div>
          </section>

          <section className="lg:col-span-9">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm md:p-8">
              <div>
                <h2 className="text-2xl font-semibold text-gray-900">
                  ข้อมูลโปรไฟล์
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  แก้ไขข้อมูลส่วนตัวของคุณ
                </p>
              </div>

              {loading ? (
                <div className="py-16 text-center text-gray-500">
                  กำลังโหลดข้อมูล
                </div>
              ) : (
                <div className="mt-8 space-y-6">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-800">
                      ชื่อที่แสดง
                    </label>

                    <div className="flex h-12 items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 focus-within:border-blue-500">
                      <User className="h-4 w-4 text-gray-400" />
                      <input
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        type="text"
                        placeholder="กรอกชื่อที่ต้องการแสดง"
                        className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-300"
                      />
                    </div>

                    <p className="mt-2 text-sm text-gray-400">
                      ชื่อนี้จะแสดงบนโปรไฟล์ของคุณ
                    </p>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-800">
                      อีเมล
                    </label>

                    <div className="flex h-12 items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4">
                      <Mail className="h-4 w-4 text-gray-400" />
                      <input
                        value={email}
                        type="email"
                        disabled
                        className="w-full bg-transparent text-sm text-gray-400 outline-none"
                      />
                    </div>

                    <p className="mt-2 text-sm text-gray-400">
                      อีเมลนี้ใช้สำหรับเข้าสู่ระบบและยังแก้ไขไม่ได้
                    </p>
                  </div>

                  {message && (
                    <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                      {message}
                    </div>
                  )}

                  {error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {error}
                    </div>
                  )}

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving || !isChanged || !fullName.trim()}
                      className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-6 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? "กำลังบันทึก" : "บันทึกการเปลี่ยนแปลง"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
