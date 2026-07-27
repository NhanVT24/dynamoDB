import "./styles.css";

export const metadata = {
  title: "Admin quản lý sản phẩm",
  description: "Trang admin quản lý sản phẩm với Next.js, Node.js và DynamoDB"
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        <header className="topbar">
          <div>
            <strong>Admin sản phẩm</strong>
            <span>DynamoDB Product Management</span>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
