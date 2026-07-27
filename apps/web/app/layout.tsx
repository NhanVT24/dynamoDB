import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Quản lý sinh viên",
  description: "Dự án học DynamoDB"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <header>
          <strong>Student DB Lab</strong>
          <span>Next.js · Node.js · DynamoDB</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
