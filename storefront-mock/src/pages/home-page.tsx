import { CategoryStrip } from "../components/home/category-strip";
import { HeroBanner } from "../components/home/hero-banner";
import { ProductShowcase } from "../components/home/product-showcase";
import { bestSellerProducts, featuredProducts, flashSaleProducts, newArrivals, storeCategories } from "../data/catalog";
import { useCart } from "../stores/cart-store";
import type { StoreProduct } from "../types/store";

export function HomePage() {
  const { addCatalogItem } = useCart();

  function handleAddToCart(product: StoreProduct) {
    if (product.status === "out_of_stock") return;
    addCatalogItem(product, 1);
  }

  return (
    <>
      <HeroBanner />
      <CategoryStrip categories={storeCategories} />
      <ProductShowcase
        id="featured"
        eyebrow="Featured"
        title="Sản phẩm nổi bật cho khu vực banner và đề xuất đầu trang"
        description="Các thẻ sản phẩm ưu tiên ảnh lớn, giá rõ, nút thao tác nhanh và hover mô tả để vừa có tính trưng bày vừa giữ cảm giác bán hàng."
        products={featuredProducts}
        onAddToCart={handleAddToCart}
      />
      <ProductShowcase
        eyebrow="Best Seller"
        title="Nhóm bán chạy tạo cảm giác storefront đang có giao dịch thật"
        description="Section này giúp phần thân trang đỡ rời rạc hơn và giống pattern đề xuất của các sàn thương mại điện tử phổ biến."
        products={bestSellerProducts}
        onAddToCart={handleAddToCart}
      />
      <ProductShowcase
        eyebrow="Flash Pick"
        title="Các deal giá tốt để làm khu vực khuyến mãi"
        description="Phù hợp để sau này nối thêm campaign, countdown hoặc thanh toán sandbox mà không cần đổi lại layout lớn."
        products={flashSaleProducts}
        onAddToCart={handleAddToCart}
      />
      <ProductShowcase
        eyebrow="Newest"
        title="Sản phẩm mới về được sắp theo newest ổn định"
        description="Danh sách này đã sort theo updatedAt giảm dần nên không còn cảm giác hiển thị ngẫu nhiên như trước."
        products={newArrivals}
        onAddToCart={handleAddToCart}
      />
    </>
  );
}
