"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function clearAuthStorage() {
  sessionStorage.removeItem("access_token");
  sessionStorage.removeItem("last_batch_id");
  sessionStorage.removeItem("last_compare_results");
  sessionStorage.removeItem("last_compare_batch_id");
  sessionStorage.removeItem("user_email");
  sessionStorage.removeItem("user_name");
  sessionStorage.removeItem("email");
  sessionStorage.removeItem("user");
}

function isTokenExpired(token: string) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const exp = payload?.exp;

    if (!exp) return true;

    return Date.now() >= exp * 1000;
  } catch {
    return true;
  }
}

export function useAuthGuard(redirectTo: string = "/login") {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem("access_token");

    if (!token || isTokenExpired(token)) {
      clearAuthStorage();
      router.replace(redirectTo);
      return;
    }

    setAuthReady(true);
  }, [router, redirectTo]);

  return authReady;
}