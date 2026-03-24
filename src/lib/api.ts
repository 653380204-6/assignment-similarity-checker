import axios from "axios";

let isRedirecting = false;

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000",
});

api.interceptors.request.use(
  (config) => {
    if (typeof window !== "undefined") {
      const token = sessionStorage.getItem("access_token");

      if (token) {
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${token}`;
      }
    }

    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (typeof window !== "undefined" && error?.response?.status === 401) {
      sessionStorage.removeItem("access_token");
      sessionStorage.removeItem("last_batch_id");
      sessionStorage.removeItem("last_compare_results");
      sessionStorage.removeItem("last_compare_batch_id");
      sessionStorage.removeItem("user_email");
      sessionStorage.removeItem("user_name");
      sessionStorage.removeItem("email");
      sessionStorage.removeItem("user");

      if (!isRedirecting && window.location.pathname !== "/login") {
        isRedirecting = true;
        window.location.replace("/login");
      }
    }

    return Promise.reject(error);
  }
);

export default api;