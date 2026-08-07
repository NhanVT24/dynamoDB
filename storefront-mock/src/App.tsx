import { Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/app-shell";
import { HomePage } from "./pages/home-page";
import { NotFoundPage } from "./pages/not-found-page";
import { ProductDetailPage } from "./pages/product-detail-page";
import { ProductsPage } from "./pages/products-page";

export default function App() {
  return (
    <AppShell>
      <Suspense fallback={<div className="mx-auto max-w-7xl px-6 py-16 text-sm text-slate-500">Đang tải storefront client...</div>}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/:slug" element={<ProductDetailPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
