import type { ReactNode } from "react";
import { CartDrawer } from "../cart/cart-drawer";
import { SiteHeader } from "./site-header";
import { useTheme } from "../../stores/theme-store";

export function AppShell({ children }: { children: ReactNode }) {
  const { theme } = useTheme();

  return (
    <div
      className={`min-h-screen transition-colors duration-300 ${
        theme === "dark"
          ? "bg-[#0b1220] text-slate-100"
          : "bg-[linear-gradient(180deg,_#f6f8fc_0%,_#eef3ff_26%,_#ffffff_100%)] text-slate-950"
      }`}
    >
      <div
        className={`pointer-events-none fixed inset-x-0 top-0 z-0 h-[34rem] ${
          theme === "dark"
            ? "bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.25),_transparent_36%),radial-gradient(circle_at_right,_rgba(14,165,233,0.12),_transparent_34%)]"
            : "bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.16),_transparent_38%),radial-gradient(circle_at_right,_rgba(249,115,22,0.12),_transparent_32%)]"
        }`}
      />
      <SiteHeader />
      <CartDrawer />
      <main className="relative z-10">{children}</main>
    </div>
  );
}
