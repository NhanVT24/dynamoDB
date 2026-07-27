import { createStudent } from "../modules/students/student.repository.js";

for (const student of [
  { fullName: "Nguyễn Văn An", email: "an@example.com", dateOfBirth: "2004-03-12", department: "Công nghệ thông tin" },
  { fullName: "Trần Minh Châu", email: "chau@example.com", dateOfBirth: "2003-11-08", department: "Kinh tế" }
]) {
  await createStudent(student);
}
console.log("Seeded sample students.");
