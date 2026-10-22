import { Product, type NewProductDetails } from "../../domain/product.js";
import type { ProductCreator } from "../ports/product-creator.js";
import { assertProductActor, type ProductActor } from "../product-access.js";

export class CreateProduct<TResult> {
  constructor(
    private readonly products: ProductCreator<TResult>,
    private readonly newId: () => string,
    private readonly now: () => Date
  ) {}

  async execute(command: { details: NewProductDetails; actor: ProductActor }): Promise<TResult> {
    assertProductActor(command.actor);
    const product = Product.create(this.newId(), command.actor.subject, command.details);
    const timestamp = this.now().toISOString();
    return this.products.create({
      product, createdAt: timestamp, updatedAt: timestamp
    });
  }
}
