"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        const detail = String(data?.detail || "");

        if (response.status === 401) {
          throw new Error(detail || "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
        }

        throw new Error(detail || "เข้าสู่ระบบไม่สำเร็จ");
      }

      if (!data.access_token) {
        throw new Error("Access token not found in response");
      }

      sessionStorage.removeItem("access_token");
      sessionStorage.removeItem("last_batch_id");
      sessionStorage.removeItem("last_compare_results");
      sessionStorage.removeItem("last_compare_batch_id");
      sessionStorage.removeItem("user_email");
      sessionStorage.removeItem("user_name");
      sessionStorage.removeItem("email");
      sessionStorage.removeItem("user");

      sessionStorage.setItem("access_token", data.access_token);

      try {
        const meRes = await fetch(`${API_BASE}/auth/me`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${data.access_token}`,
          },
        });

        if (meRes.ok) {
          const meData = await meRes.json();

          if (meData.email) {
            sessionStorage.setItem("user_email", meData.email);
          }

          if (meData.name) {
            sessionStorage.setItem("user_name", meData.name);
          }
        }
      } catch (e) {
        console.error("Fetch /auth/me failed", e);
      }

      router.replace("/dashboard");
    } catch (err: any) {
      const message = String(err?.message || "").toLowerCase();

      if (
        message.includes("failed to fetch") ||
        message.includes("networkerror") ||
        message.includes("load failed") ||
        message.includes("fetch") ||
        message.includes("abort")
      ) {
        setError("เข้าสู่ระบบไม่สำเร็จ");
      } else {
        setError(err?.message || "เข้าสู่ระบบไม่สำเร็จ");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-2xl border shadow-sm p-6">
        <div className="flex items-center justify-center gap-10 border-b mb-6">
          <Link
            href="/signup"
            className="py-3 text-sm font-semibold text-gray-500 hover:text-purple-700"
          >
            สมัครสมาชิก
          </Link>
          <span className="py-3 text-sm font-semibold text-purple-700 border-b-2 border-purple-600">
            เข้าสู่ระบบ
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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
                placeholder="Enter your email address"
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
                placeholder="Enter your password"
                className="w-full outline-none text-sm text-gray-900 placeholder:text-gray-300"
                required
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
            {isLoading ? "Logging In..." : "Log in"}
          </button>

          <div className="text-center text-xs text-gray-500">
            ยังไม่มีบัญชี{" "}
            <Link href="/signup" className="text-blue-600 hover:underline">
              สมัครสมาชิก
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
