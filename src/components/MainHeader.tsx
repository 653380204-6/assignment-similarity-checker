"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import api from "@/lib/api";
import {
  Home,
  FileSearch,
  BarChart3,
  LogIn,
  UserPlus,
  LogOut,
  LineChart,
  User,
  Settings,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  protected: boolean;
};

export default function MainHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement | null>(null);

  const hideHeader = pathname === "/login" || pathname === "/signup";

  const [authReady, setAuthReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");

  const navItems: NavItem[] = [
    { href: "/", label: "หน้าหลัก", icon: Home, protected: false },
    {
      href: "/dashboard",
      label: "ตรวจความคล้ายคลึง",
      icon: FileSearch,
      protected: true,
    },
    {
      href: "/cluster",
      label: "การจัดกลุ่ม",
      icon: BarChart3,
      protected: true,
    },
    {
      href: "/analysis",
      label: "วิเคราะห์ผล",
      icon: LineChart,
      protected: true,
    },
  ];

  const readToken = () => {
    if (typeof window === "undefined") return false;
    return !!sessionStorage.getItem("access_token");
  };

  const readUserEmail = () => {
    if (typeof window === "undefined") return "";
    return (
      sessionStorage.getItem("user_email") ||
      sessionStorage.getItem("email") ||
      ""
    );
  };

  const readUserName = () => {
    if (typeof window === "undefined") return "";
    return sessionStorage.getItem("user_name") || "";
  };

  const clearAuthState = () => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("access_token");
      sessionStorage.removeItem("last_batch_id");
      sessionStorage.removeItem("last_compare_results");
      sessionStorage.removeItem("last_compare_batch_id");
      sessionStorage.removeItem("user_email");
      sessionStorage.removeItem("user_name");
      sessionStorage.removeItem("email");
      sessionStorage.removeItem("user");
    }

    setAuthed(false);
    setUserEmail("");
    setUserName("");
    setMenuOpen(false);
  };

  const fetchUserProfile = async () => {
    if (typeof window === "undefined") return;

    const token = sessionStorage.getItem("access_token");
    if (!token) {
      clearAuthState();
      return;
    }

    try {
      const res = await api.get("/auth/me");
      const data = res.data || {};

      const email = data.email || "";
      const name = data.name || "";

      setAuthed(true);
      setUserEmail(email);
      setUserName(name);

      if (email) sessionStorage.setItem("user_email", email);
      if (name) sessionStorage.setItem("user_name", name);
    } catch (error: any) {
      if (error?.response?.status === 401) {
        clearAuthState();
      }
    }
  };

  useLayoutEffect(() => {
    const syncAuth = async () => {
      setAuthReady(false);

      const hasToken = readToken();

      if (!hasToken) {
        clearAuthState();
        setAuthReady(true);
        return;
      }

      const email = readUserEmail();
      const name = readUserName();

      setAuthed(true);
      setUserEmail(email);
      setUserName(name);

      if (!email || !name) {
        await fetchUserProfile();
      }

      setAuthReady(true);
    };

    syncAuth();

    const onStorage = () => {
      syncAuth();
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [pathname]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname?.startsWith(href);
  };

  const goProtected = (href: string) => {
    if (!readToken()) {
      router.push("/login");
      return;
    }
    router.push(href);
  };

  const logout = () => {
    clearAuthState();
    router.push("/");
  };

  const linkClass = (href: string) =>
    `inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm transition ${
      isActive(href)
        ? "bg-indigo-50 text-indigo-700"
        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
    }`;

  if (hideHeader) return null;

  return (
    <header className="sticky top-0 z-50 border-b bg-white">
      <div className="w-full px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-2xl font-bold text-indigo-600">
          Assignment Similarity Checker
        </Link>

        <nav className="hidden md:flex items-center gap-2">
          {navItems.map(
            ({ href, label, icon: Icon, protected: isProtected }) =>
              isProtected ? (
                <button
                  key={href}
                  type="button"
                  onClick={() => goProtected(href)}
                  className={linkClass(href)}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ) : (
                <Link key={href} href={href} className={linkClass(href)}>
                  <Icon className="w-4 h-4" />
                  {label}
                </Link>
              ),
          )}
        </nav>

        <div className="flex items-center gap-3">
          {!authReady ? (
            <div className="h-10 w-28 rounded-md bg-gray-100 animate-pulse" />
          ) : !authed ? (
            <>
              <button
                onClick={() => router.push("/login")}
                className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
              >
                <LogIn className="w-4 h-4" />
                เข้าสู่ระบบ
              </button>

              <button
                onClick={() => router.push("/signup")}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
              >
                <UserPlus className="w-4 h-4" />
                สมัครใช้งาน
              </button>
            </>
          ) : (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
                className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              >
                <User className="w-4 h-4" />
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${
                    menuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-2 w-72 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
                  <div className="px-4 py-3 border-b bg-gray-50">
                    <p className="text-base font-semibold text-gray-900">
                      {userName || "User"}
                    </p>
                    <p className="mt-1 text-xs font-normal text-gray-400 break-all">
                      {userEmail || "ไม่พบอีเมลผู้ใช้"}
                    </p>
                  </div>

                  <div className="p-2">
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        router.push("/profile");
                      }}
                      className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <Settings className="w-4 h-4" />
                      แก้โปรไฟล์
                    </button>

                    <button
                      type="button"
                      onClick={logout}
                      className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                    >
                      <LogOut className="w-4 h-4" />
                      ออกจากระบบ
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
