import "./styles.css";
import type { ReactNode } from "react";
import { Roboto } from "next/font/google";
import { AppChrome } from "./components/AppChrome";

const roboto = Roboto({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "700"]
});

export const metadata = {
  title: "Supermarket Platform",
  description: "Admin management va storefront client cho du an DynamoDB"
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
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
