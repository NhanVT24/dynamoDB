import {
  All,
  Controller,
  Get,
  HttpCode,
  HttpStatus
} from "@nestjs/common";

@Controller("api/learning")
export class LearningController {
  @Get()
  listExercises() {
    return {
      exercises: [
        "CRUD mat hang bang Put/Get/Update/Delete",
        "Query mat hang theo danh muc qua GSI1",
        "Phan trang bang LastEvaluatedKey va cursor",
        "TransactWrite checkout gio hang + cap nhat ton kho",
        "BatchWrite import danh sach mua sam va retry UnprocessedItems",
        "ConditionExpression de tranh ghi de/xoa nham",
        "TTL cho audit items",
        "PartiQL: so sanh voi native DynamoDB commands"
      ]
    };
  }

  @All("*")
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  notImplemented() {
    return { message: "Bai tap DynamoDB: hay tu trien khai endpoint nay." };
  }
}
