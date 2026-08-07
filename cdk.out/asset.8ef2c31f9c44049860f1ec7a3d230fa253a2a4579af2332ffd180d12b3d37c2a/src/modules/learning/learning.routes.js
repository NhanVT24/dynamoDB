export const learningRoutes = async (app) => {
    app.get("/", async () => ({
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
    }));
    app.all("/*", async (_request, reply) => reply.code(501).send({ message: "Bai tap DynamoDB: hay tu trien khai endpoint nay." }));
};
