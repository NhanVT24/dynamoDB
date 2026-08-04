import "./styles.css";
import type { ReactNode } from "react";
import { Roboto } from "next/font/google";

const roboto = Roboto({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "700"]
});

export const metadata = {
  title: "Admin Product Management",
  description: "Thu nghiem viec tuong tac CRUD voi DynamoDB"
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="vi">
      <body
        className={`${roboto.className} min-h-screen text-slate-900`}
        style={{
          minHeight: "100vh",
          color: "#0f172a"
        }}
      >
        <header
          className="border-b border-slate-200 bg-white/85 backdrop-blur"
          style={{
            borderBottom: "1px solid #e2e8f0",
            background: "rgba(255, 255, 255, 0.85)",
            backdropFilter: "blur(14px)",
            boxShadow: "0 10px 30px rgba(15, 23, 42, 0.05)"
          }}
        >
          <div
            className="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between px-5"
            style={{
              width: "100%",
              maxWidth: "1280px",
              minHeight: "64px",
              margin: "0 auto",
              padding: "0 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between"
            }}
          >
            <div>
              <strong
                className="block text-xl font-semibold tracking-tight text-slate-900"
                style={{ display: "block", fontSize: "20px", fontWeight: 600, color: "#0f172a" }}
              >
                Admin Product Management
              </strong>
              <span
                className="text-sm text-slate-500"
                style={{ fontSize: "14px", color: "#64748b" }}
              >
                DynamoDB Product Management
              </span>
            </div>
          </div>
        </header>
        <main
          className="mx-auto w-full max-w-7xl px-5 py-6 md:py-8"
          style={{
            width: "100%",
            maxWidth: "1280px",
            margin: "0 auto",
            padding: "24px 20px 32px"
          }}
        >
          {children}
        </main>
      </body>
    </html>
  );
}
