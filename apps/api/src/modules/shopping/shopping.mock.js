const mockItems = [
  {
    id: "0f8fad5b-d9cb-469f-a165-708677289501",
    entityType: "PRODUCT",
    name: "Ao thun basic cotton",
    category: "Thoi trang",
    brand: "Local Brand",
    sku: "TS-001",
    stock: 24,
    price: 179000,
    originalPrice: 229000,
    status: "active",
    rating: 4.7,
    soldCount: 128,
    featured: true,
    imageUrl: "https://example.com/mock-shirt.jpg",
    location: "TP.HCM",
    description: "San pham mock de test Lambda function URL.",
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-01T08:00:00.000Z"
  },
  {
    id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    entityType: "PRODUCT",
    name: "Noi chien khong dau 5L",
    category: "Gia dung",
    brand: "Kitchen Home",
    sku: "GD-105",
    stock: 8,
    price: 1299000,
    originalPrice: 1599000,
    status: "low_stock",
    rating: 4.8,
    soldCount: 67,
    featured: false,
    imageUrl: "https://example.com/mock-airfryer.jpg",
    location: "Can Tho",
    description: "Du lieu mau de ban thu API tren AWS Lambda.",
    createdAt: "2026-08-01T08:05:00.000Z",
    updatedAt: "2026-08-01T08:05:00.000Z"
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440000",
    entityType: "PRODUCT",
    name: "Sua rua mat diu nhe",
    category: "Lam dep",
    brand: "Skin First",
    sku: "LD-220",
    stock: 0,
    price: 245000,
    originalPrice: 299000,
    status: "out_of_stock",
    rating: 4.6,
    soldCount: 211,
    featured: true,
    imageUrl: "https://example.com/mock-cleanser.jpg",
    location: "Ha Noi",
    description: "Mock item cho route demo, khong can DynamoDB.",
    createdAt: "2026-08-01T08:10:00.000Z",
    updatedAt: "2026-08-01T08:10:00.000Z"
  }
];

export function listMockShoppingItems() {
  return {
    items: mockItems,
    limit: mockItems.length,
    cursor: null,
    nextCursor: null,
    hasNextPage: false
  };
}

export function getMockShoppingItem(id) {
  return mockItems.find((item) => item.id === id) ?? null;
}
