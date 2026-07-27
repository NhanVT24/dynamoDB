export const learningRoutes = async (app) => {
  app.get("/", async () => ({
    exercises: [
      "CRUD mặt hàng bằng Put/Get/Update/Delete",
      "Query mặt hàng theo danh mục qua GSI1",
      "Phân trang bằng LastEvaluatedKey và cursor",
      "TransactWrite checkout giỏ hàng + cập nhật tồn kho",
      "BatchWrite import danh sách mua sắm và retry UnprocessedItems",
      "ConditionExpression để tránh ghi đè/xóa nhầm",
      "TTL cho audit items",
      "PartiQL: so sánh với native DynamoDB commands"
    ]
  }));

  app.all("/*", async (_request, reply) =>
    reply.code(501).send({ message: "Bài tập DynamoDB: hãy tự triển khai endpoint này." })
  );
};
