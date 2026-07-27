export const keys = {
  student: (id: string) => ({ PK: `STUDENT#${id}`, SK: "PROFILE" }),
  course: (id: string) => ({ PK: `COURSE#${id}`, SK: "META" }),
  enrollment: (studentId: string, courseId: string) => ({
    PK: `STUDENT#${studentId}`,
    SK: `COURSE#${courseId}`
  })
} as const;
