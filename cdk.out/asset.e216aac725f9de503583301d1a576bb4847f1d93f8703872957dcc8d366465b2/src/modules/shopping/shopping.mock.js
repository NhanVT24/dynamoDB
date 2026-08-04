export const mockShoppingItems = [
    {
        id: "mock-1",
        entityType: "PRODUCT",
        name: "Ao 1",
        category: "Thoi trang",
        brand: "FlexWear",
        sku: "MOCK-0001",
        stock: 12,
        price: 199000,
        originalPrice: 249000,
        status: "active",
        rating: 4.8,
        soldCount: 120,
        featured: true,
        description: "San pham mock de test Lambda function URL.",
        updatedAt: "2026-08-01T08:00:00.000Z"
    },
    {
        id: "mock-2",
        entityType: "PRODUCT",
        name: "Tai nghe 2",
        category: "Dien tu",
        brand: "SoundMax",
        sku: "MOCK-0002",
        stock: 8,
        price: 499000,
        originalPrice: 599000,
        status: "low_stock",
        rating: 4.7,
        soldCount: 86,
        featured: false,
        description: "Du lieu mau de ban thu API tren AWS Lambda.",
        updatedAt: "2026-08-01T08:05:00.000Z"
    },
    {
        id: "mock-3",
        entityType: "PRODUCT",
        name: "Noi 3",
        category: "Gia dung",
        brand: "HomePro",
        sku: "MOCK-0003",
        stock: 0,
        price: 329000,
        originalPrice: 389000,
        status: "out_of_stock",
        rating: 4.6,
        soldCount: 52,
        featured: false,
        description: "Mock item cho route demo khong can DynamoDB.",
        updatedAt: "2026-08-01T08:10:00.000Z"
    }
];
export function listMockShoppingItems() {
    return [...mockShoppingItems];
}
export function getMockShoppingItem(id) {
    return mockShoppingItems.find((item) => item.id === id) ?? null;
}
