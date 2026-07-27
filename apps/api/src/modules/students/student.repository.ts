import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import { keys } from "../../db/keys.js";
import type { CreateStudentInput, Student } from "./student.schema.js";

const TableName = env.DYNAMODB_TABLE_NAME;

export async function createStudent(input: CreateStudentInput): Promise<Student> {
  const now = new Date().toISOString();
  const student: Student = {
    ...input,
    id: crypto.randomUUID(),
    entityType: "STUDENT",
    version: 1,
    createdAt: now,
    updatedAt: now
  };

  await db.send(new PutCommand({
    TableName,
    Item: {
      ...keys.student(student.id),
      ...student,
      GSI1PK: `EMAIL#${student.email.toLowerCase()}`,
      GSI1SK: `STUDENT#${student.id}`
    },
    ConditionExpression: "attribute_not_exists(PK)"
  }));

  // TODO: Email uniqueness across different PKs needs a transaction with a
  // dedicated lock item (e.g. PK=EMAIL#x, SK=LOCK). A GSI alone is not unique.
  return student;
}

export async function getStudent(id: string): Promise<Student | null> {
  const result = await db.send(new GetCommand({
    TableName,
    Key: keys.student(id),
    ConsistentRead: true
  }));
  return (result.Item as Student | undefined) ?? null;
}

export async function listStudents(limit = 20, cursor?: string) {
  const ExclusiveStartKey = cursor
    ? JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    : undefined;
  const result = await db.send(new ScanCommand({
    TableName,
    FilterExpression: "entityType = :type",
    ExpressionAttributeValues: { ":type": "STUDENT" },
    Limit: limit,
    ExclusiveStartKey
  }));
  return {
    items: (result.Items ?? []) as Student[],
    nextCursor: result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64url")
      : null
  };
}

export async function updateStudent(id: string, patch: Partial<CreateStudentInput>, version: number) {
  const names: Record<string, string> = { "#version": "version" };
  const values: Record<string, unknown> = {
    ":expectedVersion": version,
    ":one": 1,
    ":updatedAt": new Date().toISOString()
  };
  const setters = ["updatedAt = :updatedAt", "#version = #version + :one"];

  for (const [field, value] of Object.entries(patch)) {
    names[`#${field}`] = field;
    values[`:${field}`] = value;
    setters.push(`#${field} = :${field}`);
  }

  // TODO: Khi email đổi, đồng thời cập nhật GSI1PK và email lock bằng transaction.
  const result = await db.send(new UpdateCommand({
    TableName,
    Key: keys.student(id),
    UpdateExpression: `SET ${setters.join(", ")}`,
    ConditionExpression: "attribute_exists(PK) AND #version = :expectedVersion",
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValues: "ALL_NEW"
  }));
  return result.Attributes as Student;
}

export async function deleteStudent(id: string) {
  // TODO: Dùng TransactWrite để chặn xóa khi còn enrollment hoặc xóa cascade.
  await db.send(new DeleteCommand({
    TableName,
    Key: keys.student(id),
    ConditionExpression: "attribute_exists(PK)"
  }));
}
