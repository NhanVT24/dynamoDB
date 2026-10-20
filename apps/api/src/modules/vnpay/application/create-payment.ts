export interface CreatePaymentInput {
  email?: string; items: Array<{ productId: string; quantity: number }>;
  orderDescription?: string; bankCode?: string; locale?: "vn" | "en";
}
export interface PaymentCreationOptions { skipStockValidation?: boolean; expiresAt?: string; amount?: number; orderId?: string; }
export interface PaymentProductReader {
  find(id: string): Promise<{ name?: string; price?: number; stock?: number } | null>;
}
export interface PaymentLinkIssuer {
  issue(input: CreatePaymentInput, details: { ipAddress: string; amount: number; orderId?: string; createdAt: Date; expiresAt: Date }):
    Promise<{ paymentUrl: string; txnRef: string; amount: number; orderInfo: string; expiresAt: string; timeoutMinutes: number }>;
}

export class CreatePayment {
  constructor(private readonly products: PaymentProductReader, private readonly issuer: PaymentLinkIssuer,
    private readonly now: () => number = Date.now) {}
  async execute(input: CreatePaymentInput, ipAddress: string, options: PaymentCreationOptions = {}) {
    if (!input.items.length || input.items.length > 20) throw new Error("Invalid payment items");
    let total = 0;
    const quantities = new Map<string, number>();
    for (const item of input.items) {
      if (!item.productId || !Number.isSafeInteger(item.quantity) || item.quantity < 1) throw new Error("Invalid payment item");
      const quantity = (quantities.get(item.productId) ?? 0) + item.quantity;
      if (quantity > 50) throw new Error("Invalid payment quantity");
      quantities.set(item.productId, quantity);
    }
    // Checkout supplies the committed sale-price snapshot. Do not recompute
    // it from today's product price or reject a product deleted after the hold.
    if (options.amount === undefined || !options.skipStockValidation) {
      for (const [id, quantity] of quantities) {
        const product = await this.products.find(id);
        if (!product) throw new Error(`Product ${id} not found`);
        if (!options.skipStockValidation && Number(product.stock ?? 0) < quantity) throw new Error(`Insufficient stock for ${product.name}`);
        total += Number(product.price ?? 0) * quantity;
      }
    }
    const amount = options.amount ?? total;
    if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(amount * 100) || amount * 100 > 999999999999) {
      throw new Error("Payment amount must be a supported positive integer.");
    }
    const createdAt = new Date(this.now());
    const expiresAt = options.expiresAt ? new Date(options.expiresAt) : new Date(createdAt.getTime() + 300000);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= createdAt) throw new Error("Checkout reservation expired before payment creation.");
    return this.issuer.issue(input, { ipAddress, amount, orderId: options.orderId, createdAt, expiresAt });
  }
}
