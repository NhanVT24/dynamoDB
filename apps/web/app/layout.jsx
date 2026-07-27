import "./styles.css";

export const metadata = {
  title: "Quản lý mua sắm siêu thị",
  description: "Dự án học DynamoDB với CRUD mua sắm"
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        <header>
          <strong>Siêu thị Dynamo</strong>
          <span>Next.js / Node.js / DynamoDB</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
