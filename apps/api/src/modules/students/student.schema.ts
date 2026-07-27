import { z } from "zod";

export const createStudentSchema = z.object({
  fullName: z.string().min(2).max(100),
  email: z.email(),
  dateOfBirth: z.iso.date(),
  department: z.string().min(2).max(100)
});

export const updateStudentSchema = createStudentSchema.partial();
export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export type Student = CreateStudentInput & {
  id: string;
  entityType: "STUDENT";
  version: number;
  createdAt: string;
  updatedAt: string;
};
