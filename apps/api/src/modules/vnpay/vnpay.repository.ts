import { GetItemCommand, PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { env } from "../../config/env.js";
import { rawDb } from "../../database/dynamodb/client.js";

const TableName = env.DYNAMODB_TABLE_NAME;

function toDynamoItem(item: Record<string, unknown>) {
  return marshall(item, { removeUndefinedValues: true });
}

type PaymentSessionRecord = {
  PK: string;
  SK: string;
  entityType: "PAYMENT_SESSION";
  txnRef: string;
  email?: string;
  orderInfo: string;
  amount: number;
  status: "pending" | "success" | "failed";
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
  paymentEventEnqueuedAt?: string;
  responseCode?: string;
  transactionNo?: string;
  bankCode?: string;
  payDate?: string;
};

export async function createPaymentSession(input: {
  txnRef: string;
  email?: string;
  orderInfo: string;
  amount: number;
}) {
  const now = new Date().toISOString();
  const record: PaymentSessionRecord = {
    PK: `PAYMENT#${input.txnRef}`,
    SK: "DETAIL",
    entityType: "PAYMENT_SESSION",
    txnRef: input.txnRef,
    email: input.email?.trim().toLowerCase() || undefined,
    orderInfo: input.orderInfo,
    amount: input.amount,
    status: "pending",
    createdAt: now,
    updatedAt: now
  };

  await rawDb.send(new PutItemCommand({
    TableName,
    Item: toDynamoItem(record),
    ConditionExpression: "attribute_not_exists(PK)"
  }));

  return record;
}

export async function getPaymentSessionByTxnRef(txnRef: string) {
  const result = await rawDb.send(new GetItemCommand({
    TableName,
    Key: toDynamoItem({
      PK: `PAYMENT#${txnRef}`,
      SK: "DETAIL"
    })
  }));

  return result.Item ? (unmarshall(result.Item) as PaymentSessionRecord) : null;
}

export async function updatePaymentSessionStatus(input: {
  txnRef: string;
  status: "success" | "failed";
  responseCode: string;
  transactionNo: string;
  bankCode: string;
  payDate: string;
}) {
  const now = new Date().toISOString();

  await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: toDynamoItem({
      PK: `PAYMENT#${input.txnRef}`,
      SK: "DETAIL"
    }),
    ConditionExpression: "attribute_exists(PK)",
    UpdateExpression: "SET #status = :status, updatedAt = :updatedAt, paidAt = :paidAt, responseCode = :responseCode, transactionNo = :transactionNo, bankCode = :bankCode, payDate = :payDate",
    ExpressionAttributeNames: {
      "#status": "status"
    },
    ExpressionAttributeValues: toDynamoItem({
      ":status": input.status,
      ":updatedAt": now,
      ":paidAt": now,
      ":responseCode": input.responseCode,
      ":transactionNo": input.transactionNo,
      ":bankCode": input.bankCode,
      ":payDate": input.payDate
    })
  }));
}

export async function markPaymentEventEnqueued(txnRef: string) {
  const now = new Date().toISOString();

  await rawDb.send(new UpdateItemCommand({
    TableName,
    Key: toDynamoItem({
      PK: `PAYMENT#${txnRef}`,
      SK: "DETAIL"
    }),
    ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(paymentEventEnqueuedAt)",
    UpdateExpression: "SET paymentEventEnqueuedAt = :paymentEventEnqueuedAt, updatedAt = :updatedAt",
    ExpressionAttributeValues: toDynamoItem({
      ":paymentEventEnqueuedAt": now,
      ":updatedAt": now
    })
  }));
}
