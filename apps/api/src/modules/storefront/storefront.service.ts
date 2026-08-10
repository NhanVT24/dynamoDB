import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { TtlCache } from "../../common/cache/ttl-cache.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { shoppingListQuerySchema } from "../shopping/shopping.query-schemas.js";
import { createStorefrontOrder, getStorefrontProductById, listOrdersByCustomer, listStorefrontProducts } from "./storefront.repository.js";
import type { CreateStorefrontOrderInput } from "./storefront.schema.js";

type ProductRecord = Record<string, any>;
type PublicProductListResponse = {
  items: PublicProductSummary[];
  pageInfo: {
    limit: number;
    cursor: string | null;
    nextCursor: string | null;
    hasNextPage: boolean;
  };
};
type PublicProductSummary = {
  id: string;
  name: string;
  category: string;
  brand: string;
  price: number;
  originalPrice: number;
  status: string;
  stock: number;
  imageUrl?: string;
  rating?: number;
  soldCount?: number;
  location?: string;
  featured?: boolean;
  updatedAt?: string;
};

type PublicProductDetail = PublicProductSummary & {
  description?: string;
  sku?: string;
  attributes: Record<string, unknown>;
};

const listCache = new TtlCache<PublicProductListResponse>(20_000);
const detailCache = new TtlCache<PublicProductDetail>(30_000);

function buildListCacheKey(query: Record<string, unknown>) {
  return JSON.stringify(Object.keys(query).sort().map((key) => [key, query[key as keyof typeof query]]));
}

function toPublicProductSummary(item: ProductRecord): PublicProductSummary {
  return {
    id: String(item.id),
    name: String(item.name ?? ""),
    category: String(item.category ?? ""),
    brand: String(item.brand ?? ""),
    price: Number(item.price ?? 0),
    originalPrice: Number(item.originalPrice ?? item.price ?? 0),
    status: String(item.status ?? ""),
    stock: Number(item.stock ?? 0),
    imageUrl: item.imageUrl ? String(item.imageUrl) : undefined,
    rating: item.rating == null ? undefined : Number(item.rating),
    soldCount: item.soldCount == null ? undefined : Number(item.soldCount),
    location: item.location ? String(item.location) : undefined,
    featured: Boolean(item.featured),
    updatedAt: item.updatedAt ? String(item.updatedAt) : undefined
  };
}

function toPublicProductDetail(item: ProductRecord): PublicProductDetail {
  const {
    PK: _pk,
    SK: _sk,
    entityType: _entityType,
    version: _version,
    searchName: _searchName,
    searchField: _searchField,
    createdAt: _createdAt,
    id,
    name,
    category,
    brand,
    price,
    originalPrice,
    status,
    stock,
    imageUrl,
    rating,
    soldCount,
    location,
    featured,
    updatedAt,
    description,
    sku,
    ...attributes
  } = item;

  return {
    id: String(id),
    name: String(name ?? ""),
    category: String(category ?? ""),
    brand: String(brand ?? ""),
    price: Number(price ?? 0),
    originalPrice: Number(originalPrice ?? price ?? 0),
    status: String(status ?? ""),
    stock: Number(stock ?? 0),
    imageUrl: imageUrl ? String(imageUrl) : undefined,
    rating: rating == null ? undefined : Number(rating),
    soldCount: soldCount == null ? undefined : Number(soldCount),
    location: location ? String(location) : undefined,
    featured: Boolean(featured),
    updatedAt: updatedAt ? String(updatedAt) : undefined,
    description: description ? String(description) : undefined,
    sku: sku ? String(sku) : undefined,
    attributes
  };
}

@Injectable()
export class StorefrontService {
  private readonly logger = new Logger(StorefrontService.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  async listProducts(rawQuery: Record<string, unknown>) {
    const query = shoppingListQuerySchema.parse(rawQuery);
    const cacheKey = buildListCacheKey(query);
    const cached = listCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const result = await listStorefrontProducts(query);
    const shaped = {
      items: result.items.map((item) => toPublicProductSummary(item)),
      pageInfo: {
        limit: result.limit,
        cursor: result.cursor,
        nextCursor: result.nextCursor,
        hasNextPage: result.hasNextPage
      }
    };

    listCache.set(cacheKey, shaped);
    return shaped;
  }

  async getProductById(id: string) {
    const cached = detailCache.get(id);
    if (cached) {
      return cached;
    }

    const item = await getStorefrontProductById(id);
    if (!item) throw new NotFoundException("Product not found");

    const shaped = toPublicProductDetail(item);
    detailCache.set(id, shaped);
    return shaped;
  }

  async createOrder(email: string, input: CreateStorefrontOrderInput) {
    const order = await createStorefrontOrder({ email, items: input.items });
    this.invalidateProductCaches(input.items.map((item) => item.productId));
    this.logger.log(`order.created orderId=${order.id} customer=${email} status=${order.status} totalAmount=${order.totalAmount} itemCount=${order.items.length}`);

    await this.notificationsService.createPendingNotification({
      email,
      channel: "system",
      title: "Don hang dang cho xu ly",
      message: `Don hang ${order.id} da vao hang doi xu ly thong bao he thong.`,
      metadata: {
        orderId: order.id,
        totalAmount: order.totalAmount,
        itemCount: order.items.length
      }
    });

    await this.notificationsService.createPendingNotification({
      email,
      channel: "email",
      title: "Email xac nhan dang cho gui",
      message: `He thong da xep hang email xac nhan cho don ${order.id}. Don se chuyen sang done sau khi gui xong.`,
      metadata: {
        orderId: order.id,
        template: "order-confirmation"
      }
    });

    await this.notificationsService.publishAuditLog({
      eventType: "storefront.order.created",
      email,
      resourceId: order.id,
      metadata: {
        totalAmount: order.totalAmount,
        itemCount: order.items.length,
        status: order.status
      }
    });

    this.logger.log(`order.enqueued orderId=${order.id} notificationChannels=system,email audit=true`);

    return order;
  }

  listMyOrders(email: string) {
    return listOrdersByCustomer(email);
  }

  private invalidateProductCaches(productIds: string[]) {
    listCache.clear();
    for (const productId of productIds) {
      detailCache.delete(productId);
    }
  }
}
