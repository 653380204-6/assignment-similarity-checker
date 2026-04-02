"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { Eye, EyeOff, Lock, Mail, User } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

export default function SignupPage() {
  const [full_name, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    if (password !== confirmPassword) {
      setError("รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน");
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, full_name }),
      });

      const data = await response.json();

      if (!response.ok) {
        const detail = String(data.detail || "").toLowerCase();

        if (
          detail.includes("already registered") ||
          detail.includes("already exists") ||
          detail.includes("user already registered")
        ) {
          throw new Error(
            "อีเมลนี้ถูกใช้งานแล้ว กรุณาใช้อีเมลอื่นหรือเข้าสู่ระบบ",
          );
        }

        throw new Error(data.detail || "สมัครสมาชิกไม่สำเร็จ");
      }

      setSuccess("สมัครสมาชิกสำเร็จแล้ว กรุณาเข้าสู่ระบบ");

      setFullName("");
      setEmail("");
      setPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      const message = String(err?.message || "").toLowerCase();

      if (
        message.includes("failed to fetch") ||
        message.includes("networkerror") ||
        message.includes("load failed") ||
        message.includes("fetch")
      ) {
        setError("สมัครสมาชิกไม่สำเร็จ");
      } else {
        setError(err?.message || "สมัครสมาชิกไม่สำเร็จ");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-2xl border shadow-sm p-6">
        <div className="flex items-center justify-center gap-10 border-b mb-6">
          <span className="py-3 text-sm font-semibold text-purple-700 border-b-2 border-purple-600">
            สมัครสมาชิก
          </span>
          <Link
            href="/login"
            className="py-3 text-sm font-semibold text-gray-500 hover:text-purple-700"
          >
            เข้าสู่ระบบ
          </Link>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-2">
              Full name
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 h-11 bg-white focus-within:border-blue-500">
              <User className="w-4 h-4 text-gray-500" />
              <input
                value={full_name}
                onChange={(e) => setFullName(e.target.value)}
                type="text"
                placeholder="Enter your name"
                className="w-full outline-none text-sm text-gray-900 placeholder:text-gray-300"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-2">
              Email
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 h-11 bg-white focus-within:border-blue-500">
              <Mail className="w-4 h-4 text-gray-500" />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="user@example.com"
                className="w-full outline-none text-sm text-gray-900 placeholder:text-gray-300"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-2">
              Password
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 h-11 bg-white focus-within:border-blue-500">
              <Lock className="w-4 h-4 text-gray-500" />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type={showPw ? "text" : "password"}
                placeholder="At least 6 characters"
                className="w-full outline-none text-sm text-gray-900 placeholder:text-gray-300"
                required
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="text-gray-500 hover:text-gray-700 transition"
                aria-label="toggle-password"
              >
                {showPw ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-2">
              Confirm password
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 h-11 bg-white focus-within:border-blue-500">
              <Lock className="w-4 h-4 text-gray-500" />
              <input
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                type={showConfirmPw ? "text" : "password"}
                placeholder="Confirm your password"
                className="w-full outline-none text-sm text-gray-900 placeholder:text-gray-300"
                required
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPw((v) => !v)}
                className="text-gray-500 hover:text-gray-700 transition"
                aria-label="toggle-confirm-password"
              >
                {showConfirmPw ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {success && (
            <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
              {success}
            </div>
          )}

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full h-11 rounded-xl bg-blue-600 text-white font-semibold disabled:opacity-50 hover:bg-blue-700 transition"
          >
            {isLoading ? "Signing Up..." : "Sign up"}
          </button>

          {success && (
            <Link
              href="/login"
              className="block w-full text-center h-11 leading-[44px] rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
            >
              ไปหน้าเข้าสู่ระบบ
            </Link>
          )}

          <div className="text-center text-xs text-gray-500">
            มีบัญชีแล้ว{" "}
            <Link href="/login" className="text-blue-600 hover:underline">
              เข้าสู่ระบบ
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
