import "./styles.css";
import type { ReactNode } from "react";
import { Roboto } from "next/font/google";
import { AppChrome } from "./components/AppChrome";
import { LanguageProvider } from "../src/i18n/LanguageProvider";

const roboto = Roboto({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "700"]
});

export const metadata = {
  title: "Supermarket Platform",
  description: "Shop products and manage your NovaX Market account."
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body
        className={`${roboto.className} min-h-screen text-slate-900`}
        style={{
          minHeight: "100vh",
          color: "#0f172a"
        }}
      >
        <LanguageProvider><AppChrome>{children}</AppChrome></LanguageProvider>
      </body>
    </html>
  );
}
