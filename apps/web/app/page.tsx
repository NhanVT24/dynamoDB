type Student = {
  id: string;
  fullName: string;
  email: string;
  department: string;
  version: number;
};

async function getStudents(): Promise<Student[]> {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    const response = await fetch(`${apiUrl}/api/students`, { cache: "no-store" });
    if (!response.ok) return [];
    return (await response.json()).items;
  } catch {
    return [];
  }
}

export default async function Home() {
  const students = await getStudents();
  return (
    <>
      <section className="hero">
        <p className="eyebrow">DYNAMODB LEARNING PROJECT</p>
        <h1>Quản lý sinh viên</h1>
        <p>Khung giao diện cơ bản. Hãy tự thêm form, tìm kiếm, phân trang và đăng ký môn học.</p>
      </section>

      <section className="panel">
        <div className="panelTitle">
          <h2>Danh sách sinh viên</h2>
          <span>{students.length} bản ghi trên trang này</span>
        </div>
        {students.length === 0 ? (
          <div className="empty">
            Chưa có dữ liệu hoặc API chưa chạy. Thử <code>npm run db:seed</code>.
          </div>
        ) : (
          <div className="tableWrap">
            <table>
              <thead><tr><th>Họ tên</th><th>Email</th><th>Khoa</th><th>Version</th></tr></thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id}>
                    <td>{student.fullName}</td>
                    <td>{student.email}</td>
                    <td>{student.department}</td>
                    <td>v{student.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="roadmap">
        <h2>Bài tập tiếp theo</h2>
        <ol>
          <li>Thêm form CRUD sinh viên</li>
          <li>Tạo Course và Enrollment</li>
          <li>Query GSI + cursor pagination</li>
          <li>Transaction, batch và optimistic locking</li>
        </ol>
      </section>
    </>
  );
}
