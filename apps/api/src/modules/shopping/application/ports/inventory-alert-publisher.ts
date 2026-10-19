export interface InventoryStockAlert {
  productId: string;
  productName: string;
  sku?: string;
  stock: number;
  previousStock: number;
  status: "low_stock" | "out_of_stock";
  previousStatus: string;
  source: "admin.update";
}

export interface InventoryAlertPublisher {
  publish(alert: InventoryStockAlert): Promise<void>;
}
