"use client";

import { useEffect, useMemo, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const pageSize = 5;
const fallbackCategories = ["Thoi trang", "Dien tu", "Gia dung", "Me va be", "Lam dep", "Bach hoa"];
const fallbackStatuses = ["active", "low_stock", "out_of_stock"];
const emptyForm = {
  name: "",
  category: "Thoi trang",
  brand: "Chưa có",
  sku: "",
  stock: 0,
  price: 1000,
  originalPrice: 1000,
  imageUrl: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80",
  location: "TP.HCM",
  description: "",
  rating: 4.8,
  soldCount: 0,
  featured: false
};

const categoryLabels = {
  "Thoi trang": "Thời trang",
  "Dien tu": "Điện tử",
  "Gia dung": "Gia dụng",
  "Me va be": "Mẹ và bé",
  "Lam dep": "Làm đẹp",
  "Bach hoa": "Bách hóa"
};

const statusLabels = {
  active: "Đang bán",
  low_stock: "Sắp hết",
  out_of_stock: "Hết hàng"
};

const commandNotes = [
  ["Thêm", "PutItemCommand"],
  ["Đọc", "GetItemCommand"],
  ["Phân trang", "ScanCommand + LastEvaluatedKey"],
  ["Tăng tồn", "UpdateItemCommand"],
  ["Sửa", "UpdateItemCommand"],
  ["Xóa", "DeleteItemCommand"]
];

function currency(value) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function categoryLabel(category) {
  return categoryLabels[category] ?? category;
}

function statusLabel(status) {
  return statusLabels[status] ?? status;
}

function statusClass(status) {
  if (status === "active") return "success";
  if (status === "low_stock") return "warning";
  return "danger";
}

function makeSku(name) {
  const prefix = String(name || "SP")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 12)
    .toUpperCase() || "SP";
  return `${prefix}-${Date.now().toString().slice(-6)}`;
}

async function readApiError(response, fallback) {
  try {
    const data = await response.json();
    if (data.issues?.length) {
      return data.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    }
    return data.message ?? fallback;
  } catch {
    return fallback;
  }
}

export default function ShoppingManager() {
  const [items, setItems] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [categories, setCategories] = useState(fallbackCategories);
  const [statuses] = useState(fallbackStatuses);
  const [filters, setFilters] = useState({ category: "all", status: "", search: "" });
  const [stockDrafts, setStockDrafts] = useState({});
  const [cursorHistory, setCursorHistory] = useState([null]);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [editingVersion, setEditingVersion] = useState(0);
  const [message, setMessage] = useState("Đang tải dữ liệu sản phẩm...");
  const [busy, setBusy] = useState(false);

  const summary = useMemo(() => {
    const totalProducts = allItems.length;
    const lowStock = allItems.filter((item) => item.status === "low_stock").length;
    const outOfStock = allItems.filter((item) => item.status === "out_of_stock").length;
    const inventoryValue = allItems.reduce((sum, item) => sum + Number(item.stock) * Number(item.price), 0);
    return { totalProducts, lowStock, outOfStock, inventoryValue };
  }, [allItems]);

  async function loadMeta() {
    try {
      const response = await fetch(`${apiUrl}/api/shopping-items/meta`);
      if (!response.ok) return;
      const data = await response.json();
      setCategories(data.categories ?? fallbackCategories);
    } catch {
      setCategories(fallbackCategories);
    }
  }

  async function loadSummary(nextFilters = filters) {
    try {
      const params = new URLSearchParams({ pageLimit: "50", maxPages: "10" });
      if (nextFilters.category !== "all") params.set("category", nextFilters.category);
      if (nextFilters.status) params.set("status", nextFilters.status);
      if (nextFilters.search.trim()) params.set("search", nextFilters.search.trim());

      const response = await fetch(`${apiUrl}/api/shopping-items/all?${params.toString()}`);
      if (!response.ok) throw new Error(await readApiError(response, "Không tải được thống kê sản phẩm"));
      const data = await response.json();
      setAllItems(data.items ?? []);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loadItems(targetCursor = null, nextFilters = filters, nextIndex = 0, nextHistory = cursorHistory) {
    setBusy(true);
    try {
      const params = new URLSearchParams({
        limit: String(pageSize)
      });
      if (targetCursor) params.set("cursor", targetCursor);
      if (nextFilters.category !== "all") params.set("category", nextFilters.category);
      if (nextFilters.status) params.set("status", nextFilters.status);
      if (nextFilters.search.trim()) params.set("search", nextFilters.search.trim());

      const response = await fetch(`${apiUrl}/api/shopping-items?${params.toString()}`);
      if (!response.ok) throw new Error(await readApiError(response, "Không tải được danh sách sản phẩm"));

      const data = await response.json();
      setItems(data.items ?? []);
      setCursorHistory(nextHistory);
      setCursorIndex(nextIndex);
      setNextCursor(data.nextCursor ?? null);
      setHasNextPage(Boolean(data.hasNextPage));
      setMessage(`Đã tải ${data.items?.length ?? 0} sản phẩm`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadMeta();
    loadItems(null, filters, 0, [null]);
    loadSummary(filters);
  }, []);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setEditingId("");
    setEditingVersion(0);
    setForm(emptyForm);
  }

  function resetPagination() {
    const history = [null];
    setCursorHistory(history);
    setCursorIndex(0);
    setNextCursor(null);
    return history;
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditingVersion(item.version);
    setForm({
      name: item.name,
      category: item.category,
      brand: item.brand,
      sku: item.sku,
      stock: item.stock,
      price: item.price,
      originalPrice: item.originalPrice ?? item.price,
      imageUrl: item.imageUrl,
      location: item.location,
      description: item.description,
      rating: item.rating,
      soldCount: item.soldCount,
      featured: Boolean(item.featured)
    });
    setMessage(`Đang sửa "${item.name}"`);
  }

  function updateFilter(field, value) {
    const nextFilters = { ...filters, [field]: value };
    setFilters(nextFilters);
    const history = resetPagination();
    loadItems(null, nextFilters, 0, history);
    loadSummary(nextFilters);
  }

  function goNextPage() {
    if (!nextCursor) return;
    const history = [...cursorHistory, nextCursor];
    loadItems(nextCursor, filters, history.length - 1, history);
  }

  function goPreviousPage() {
    if (cursorIndex === 0) return;
    const previousIndex = cursorIndex - 1;
    loadItems(cursorHistory[previousIndex], filters, previousIndex, cursorHistory);
  }

  async function readItem(item) {
    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/shopping-items/${item.id}`);
      if (!response.ok) throw new Error(await readApiError(response, "Đọc sản phẩm thất bại"));
      const freshItem = await response.json();
      setMessage(`Đã đọc "${freshItem.name}" bằng GetItemCommand. PK=${freshItem.PK}`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateStock(item, incrementBy) {
    const amount = Number(incrementBy);
    if (!Number.isFinite(amount) || amount === 0) return;

    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/shopping-items/${item.id}/increment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "stock", incrementBy: amount })
      });
      if (!response.ok) throw new Error(await readApiError(response, "Cập nhật tồn kho thất bại"));
      const updated = await response.json();
      setItems((current) => current.map((row) => row.id === updated.id ? updated : row));
      setAllItems((current) => current.map((row) => row.id === updated.id ? updated : row));
      setStockDrafts((current) => ({ ...current, [item.id]: "" }));
      setMessage(`Đã cập nhật tồn kho "${updated.name}"`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitForm(event) {
    event.preventDefault();
    setBusy(true);

    const normalizedPrice = Number(form.price);
    const normalizedOriginalPrice = Number(form.originalPrice) || normalizedPrice;
    const normalizedName = form.name.trim();
    const payload = {
      ...form,
      name: normalizedName,
      brand: form.brand.trim() || "Chưa có",
      sku: form.sku.trim() || makeSku(normalizedName),
      imageUrl: form.imageUrl.trim() || emptyForm.imageUrl,
      location: form.location.trim() || "TP.HCM",
      description: form.description.trim() || `Sản phẩm ${normalizedName} được tạo nhanh từ trang admin.`,
      stock: Number(form.stock),
      price: normalizedPrice,
      originalPrice: normalizedOriginalPrice,
      rating: Number(form.rating),
      soldCount: Number(form.soldCount),
      featured: Boolean(form.featured)
    };

    try {
      const response = await fetch(
        editingId ? `${apiUrl}/api/shopping-items/${editingId}` : `${apiUrl}/api/shopping-items`,
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editingId ? { ...payload, version: editingVersion } : payload)
        }
      );
      if (!response.ok) {
        throw new Error(await readApiError(response, editingId ? "Sửa sản phẩm thất bại" : "Thêm sản phẩm thất bại"));
      }

      setMessage(editingId ? "Đã lưu thay đổi sản phẩm" : "Đã thêm sản phẩm mới");
      resetForm();
      const history = resetPagination();
      await loadItems(null, filters, 0, history);
      await loadSummary(filters);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(item) {
    const confirmed = window.confirm(`Xóa sản phẩm "${item.name}"?`);
    if (!confirmed) return;

    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/shopping-items/${item.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readApiError(response, "Xóa sản phẩm thất bại"));
      if (editingId === item.id) resetForm();
      setMessage(`Đã xóa "${item.name}"`);
      const history = resetPagination();
      await loadItems(null, filters, 0, history);
      await loadSummary(filters);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adminPage">
      <section className="pageTitle">
        <div>
          <p>Quản trị sản phẩm</p>
          <h1>Danh sách sản phẩm</h1>
        </div>
        <button type="button" onClick={resetForm}>Thêm sản phẩm</button>
      </section>

      <section className="statsGrid">
        <article className="statCard">
          <span>Tổng sản phẩm</span>
          <strong>{summary.totalProducts}</strong>
        </article>
        <article className="statCard">
          <span>Tồn kho thấp</span>
          <strong>{summary.lowStock}</strong>
        </article>
        <article className="statCard">
          <span>Hết hàng</span>
          <strong>{summary.outOfStock}</strong>
        </article>
        <article className="statCard">
          <span>Giá trị tồn kho</span>
          <strong>{currency(summary.inventoryValue)}</strong>
        </article>
      </section>

      <section className="filterBar">
        <input
          value={filters.search}
          onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === "Enter") updateFilter("search", event.currentTarget.value);
          }}
          placeholder="Tìm theo tên sản phẩm"
        />
        <select value={filters.category} onChange={(event) => updateFilter("category", event.target.value)}>
          <option value="all">Tất cả danh mục</option>
          {categories.map((category) => (
            <option key={category} value={category}>{categoryLabel(category)}</option>
          ))}
        </select>
        <select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>
          <option value="">Tất cả trạng thái</option>
          {statuses.map((item) => (
            <option key={item} value={item}>{statusLabel(item)}</option>
          ))}
        </select>
        <button type="button" onClick={() => updateFilter("search", filters.search)} disabled={busy}>Lọc</button>
      </section>

      <section className="adminGrid">
        <div className="tablePanel">
          <div className="panelHead">
            <h2>Sản phẩm</h2>
            <span>{message}</span>
          </div>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Sản phẩm</th>
                  <th>Danh mục</th>
                  <th>Giá</th>
                  <th>Tồn kho</th>
                  <th>Trạng thái</th>
                  <th>Phiên bản</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="emptyCell">Không có sản phẩm phù hợp bộ lọc hiện tại.</td>
                  </tr>
                ) : items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="productCell">
                        <img src={item.imageUrl} alt={item.name} />
                        <div>
                          <strong>{item.name}</strong>
                          <span>{item.brand} · SKU {item.sku}</span>
                        </div>
                      </div>
                    </td>
                    <td>{categoryLabel(item.category)}</td>
                    <td>
                      <strong>{currency(item.price)}</strong>
                      <small>{currency(item.originalPrice)}</small>
                    </td>
                    <td>
                      <div className="stockControl">
                        <strong>{item.stock}</strong>
                        <button type="button" onClick={() => updateStock(item, 1)} disabled={busy}>+1</button>
                        <button type="button" onClick={() => updateStock(item, 5)} disabled={busy}>+5</button>
                        <input
                          type="number"
                          placeholder="+/-"
                          value={stockDrafts[item.id] ?? ""}
                          onChange={(event) => setStockDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                        />
                        <button type="button" onClick={() => updateStock(item, stockDrafts[item.id])} disabled={busy}>Cộng</button>
                      </div>
                    </td>
                    <td><span className={`badge ${statusClass(item.status)}`}>{statusLabel(item.status)}</span></td>
                    <td>v{item.version}</td>
                    <td>
                      <div className="rowActions">
                        <button type="button" className="secondary" onClick={() => readItem(item)} disabled={busy}>Đọc</button>
                        <button type="button" className="secondary" onClick={() => startEdit(item)} disabled={busy}>Sửa</button>
                        <button type="button" className="danger" onClick={() => removeItem(item)} disabled={busy}>Xóa</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button type="button" className="secondary" onClick={goPreviousPage} disabled={busy || cursorIndex === 0}>Trước</button>
            <div className="paginationStatus">
              <span>Trang {cursorIndex + 1}</span>
            </div>
            <button type="button" onClick={goNextPage} disabled={busy || !hasNextPage}>
              {hasNextPage ? "Sau" : "Hết trang"}
            </button>
          </div>
        </div>

        <form className="formPanel" onSubmit={submitForm}>
          <div className="panelHead">
            <h2>{editingId ? "Sửa sản phẩm" : "Thêm sản phẩm"}</h2>
            <span>{editingId ? `Version ${editingVersion}` : "PutItemCommand"}</span>
          </div>

          <label>
            Tên sản phẩm
            <input value={form.name} onChange={(event) => updateField("name", event.target.value)} required />
          </label>
          <label>
            Danh mục
            <select value={form.category} onChange={(event) => updateField("category", event.target.value)}>
              {categories.map((category) => (
                <option key={category} value={category}>{categoryLabel(category)}</option>
              ))}
            </select>
          </label>
          <div className="formRow">
            <label>
              Thương hiệu
              <input value={form.brand} onChange={(event) => updateField("brand", event.target.value)} required />
            </label>
            <label>
              SKU
              <input placeholder="Bỏ trống để tự tạo" value={form.sku} onChange={(event) => updateField("sku", event.target.value)} />
            </label>
          </div>
          <div className="formRow">
            <label>
              Giá bán
              <input type="number" min="1000" value={form.price} onChange={(event) => updateField("price", event.target.value)} required />
            </label>
            <label>
              Giá gốc
              <input type="number" min="1000" value={form.originalPrice} onChange={(event) => updateField("originalPrice", event.target.value)} required />
            </label>
          </div>
          <div className="formRow">
            <label>
              Tồn kho
              <input type="number" min="0" value={form.stock} onChange={(event) => updateField("stock", event.target.value)} required />
            </label>
            <label>
              Đã bán
              <input type="number" min="0" value={form.soldCount} onChange={(event) => updateField("soldCount", event.target.value)} required />
            </label>
          </div>
          <div className="formRow">
            <label>
              Đánh giá
              <input type="number" min="0" max="5" step="0.1" value={form.rating} onChange={(event) => updateField("rating", event.target.value)} required />
            </label>
            <label>
              Kho
              <input value={form.location} onChange={(event) => updateField("location", event.target.value)} required />
            </label>
          </div>
          <label>
            Ảnh sản phẩm
            <input type="url" value={form.imageUrl} onChange={(event) => updateField("imageUrl", event.target.value)} required />
          </label>
          <label>
            Mô tả
            <textarea placeholder="Bỏ trống để tự tạo mô tả ngắn" value={form.description} onChange={(event) => updateField("description", event.target.value)} rows={3} />
          </label>
          <label className="checkLine">
            <input type="checkbox" checked={form.featured} onChange={(event) => updateField("featured", event.target.checked)} />
            Sản phẩm nổi bật
          </label>

          <div className="formActions">
            <button disabled={busy} type="submit">{editingId ? "Lưu sửa" : "Thêm mới"}</button>
            {editingId ? <button disabled={busy} type="button" className="secondary" onClick={resetForm}>Hủy</button> : null}
          </div>
        </form>
      </section>

      <section className="commandPanel">
        {commandNotes.map(([label, command]) => (
          <div key={label}>
            <span>{label}</span>
            <code>{command}</code>
          </div>
        ))}
      </section>
    </div>
  );
}
