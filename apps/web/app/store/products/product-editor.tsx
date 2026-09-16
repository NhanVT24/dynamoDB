"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { authenticatedFetch, type AuthSession } from "../../lib/cognito-auth";
import type { ManagedProduct } from "../store-types";

type ProductEditorProps = {
  session: AuthSession;
  initialProduct?: ManagedProduct;
  onSaved: (product: ManagedProduct) => void;
  onCancel?: () => void;
};

const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
const defaultImageUrl = "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80";
const categories = [
  { value: "Thoi trang", label: "Thời trang" },
  { value: "Dien tu", label: "Điện tử" },
  { value: "Gia dung", label: "Gia dụng" },
  { value: "Me va be", label: "Mẹ và bé" },
  { value: "Lam dep", label: "Làm đẹp" },
  { value: "Bach hoa", label: "Bách hóa" }
] as const;

function createSku(name: string) {
  const prefix = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .toUpperCase()
    .slice(0, 20) || "PRODUCT";
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`.slice(0, 40);
}

async function readApiError(response: Response) {
  const payload = await response.json().catch(() => null) as { message?: string | string[] } | null;
  if (Array.isArray(payload?.message)) return payload.message.join(", ");
  return payload?.message || `Request failed (HTTP ${response.status}).`;
}

export default function ProductEditor({ session, initialProduct, onSaved, onCancel }: ProductEditorProps) {
  const isEditing = Boolean(initialProduct);
  const [name, setName] = useState(initialProduct?.name ?? "");
  const [brand, setBrand] = useState(initialProduct?.brand ?? "");
  const [category, setCategory] = useState(initialProduct?.category ?? categories[0].value);
  const [stock, setStock] = useState(String(initialProduct?.stock ?? 1));
  const [price, setPrice] = useState(String(initialProduct?.price ?? 1000));
  const [originalPrice, setOriginalPrice] = useState(String(initialProduct?.originalPrice ?? initialProduct?.price ?? 1000));
  const [imageUrl, setImageUrl] = useState(initialProduct?.imageUrl ?? defaultImageUrl);
  const [location, setLocation] = useState(initialProduct?.location ?? "TP.HCM");
  const [description, setDescription] = useState(initialProduct?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const hasRequiredPermission = isEditing
    ? session.role === "admin" || session.permissions.includes("products:update-own")
    : session.role === "admin" || session.permissions.includes("products:create");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasRequiredPermission) {
      setMessage(isEditing ? "Bạn không có quyền sửa sản phẩm." : "Bạn không có quyền thêm sản phẩm.");
      return;
    }

    const parsedStock = Number(stock);
    const parsedPrice = Number(price);
    const parsedOriginalPrice = Math.max(parsedPrice, Number(originalPrice));
    if (!Number.isInteger(parsedStock) || parsedStock < 1) {
      setMessage("Tồn kho phải là số nguyên lớn hơn 0 để sản phẩm xuất hiện trên storefront.");
      return;
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice < 1000) {
      setMessage("Giá bán phải từ 1.000 trở lên.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const payload = {
        name: name.trim(),
        brand: brand.trim(),
        category,
        sku: initialProduct?.sku || createSku(name),
        stock: parsedStock,
        price: parsedPrice,
        originalPrice: parsedOriginalPrice,
        imageUrl: imageUrl.trim(),
        location: location.trim(),
        description: description.trim(),
        ...(isEditing
          ? { version: initialProduct!.version }
          : { rating: 4.8, soldCount: 0, featured: false })
      };
      const response = await authenticatedFetch(
        `${apiUrl}/api/shopping-items${isEditing ? `/${initialProduct!.id}` : ""}`,
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }
      );
      if (!response.ok) throw new Error(await readApiError(response));
      onSaved(await response.json() as ManagedProduct);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể lưu sản phẩm.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass = "mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-950 outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100";

  return (
    <form onSubmit={submit} className="grid gap-5 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_28px_80px_-56px_rgba(15,23,42,0.35)] sm:p-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-500">Product workspace</p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-950">{isEditing ? "Update product" : "Add product"}</h1>
        <p className="mt-2 text-sm text-slate-600">{isEditing ? "Bạn chỉ có thể sửa sản phẩm do chính mình tạo." : "Sản phẩm sau khi tạo sẽ mở ngay tại trang chi tiết."}</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">Tên sản phẩm<input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={120} required /></label>
        <label className="text-sm font-semibold text-slate-700">Thương hiệu<input className={inputClass} value={brand} onChange={(event) => setBrand(event.target.value)} minLength={2} maxLength={80} required /></label>
        <label className="text-sm font-semibold text-slate-700">Danh mục<select className={inputClass} value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">Tồn kho<input className={inputClass} type="number" min="1" step="1" value={stock} onChange={(event) => setStock(event.target.value)} required /></label>
        <label className="text-sm font-semibold text-slate-700">Giá bán<input className={inputClass} type="number" min="1000" step="1000" value={price} onChange={(event) => setPrice(event.target.value)} required /></label>
        <label className="text-sm font-semibold text-slate-700">Giá gốc<input className={inputClass} type="number" min="1000" step="1000" value={originalPrice} onChange={(event) => setOriginalPrice(event.target.value)} required /></label>
        <label className="text-sm font-semibold text-slate-700 md:col-span-2">URL hình ảnh<input className={inputClass} type="url" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} maxLength={500} required /></label>
        <label className="text-sm font-semibold text-slate-700 md:col-span-2">Khu vực<input className={inputClass} value={location} onChange={(event) => setLocation(event.target.value)} minLength={2} maxLength={80} required /></label>
        <label className="text-sm font-semibold text-slate-700 md:col-span-2">Mô tả<textarea className="mt-2 min-h-32 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100" value={description} onChange={(event) => setDescription(event.target.value)} minLength={10} maxLength={500} required /></label>
      </div>

      {imageUrl ? <img src={imageUrl} alt="Product preview" className="h-64 w-full rounded-3xl border border-slate-200 object-cover" /> : null}
      {message ? <p role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{message}</p> : null}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy || !hasRequiredPermission} className="rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Saving..." : isEditing ? "Save changes" : "Create product"}</button>
        {onCancel ? <button type="button" onClick={onCancel} disabled={busy} className="rounded-full bg-slate-100 px-6 py-3 text-sm font-semibold text-slate-700">Cancel</button> : null}
      </div>
    </form>
  );
}
