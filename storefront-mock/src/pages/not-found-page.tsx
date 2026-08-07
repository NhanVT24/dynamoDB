import { Link } from "react-router-dom";
import { useTheme } from "../stores/theme-store";

export function NotFoundPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <section className="px-4 py-24 sm:px-6 lg:px-8">
      <div
        className={`mx-auto max-w-3xl rounded-[2rem] border p-10 text-center ${
          isDark
            ? "border-white/10 bg-white/5"
            : "border-slate-200 bg-white shadow-[0_28px_80px_-56px_rgba(15,23,42,0.35)]"
        }`}
      >
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-orange-500">404</p>
        <h1 className={`mt-4 text-4xl font-semibold tracking-tight ${isDark ? "text-white" : "text-slate-950"}`}>
          Trang này chưa được dựng trong storefront mock
        </h1>
        <p className={`mt-4 text-sm leading-7 ${isDark ? "text-slate-300" : "text-slate-500"}`}>
          Mình đã dọn các flow cũ để tập trung vào home, listing, detail và cart drawer theo hướng storefront thương mại điện tử mới.
        </p>
        <Link to="/" className="mt-8 inline-flex rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white">
          Về trang chủ
        </Link>
      </div>
    </section>
  );
}
