"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const pageSize = 10;
const fallbackCategories = [
  "Thời trang",
  "Điện tử",
  "Gia dụng",
  "Mẹ và bé",
  "Làm đẹp",
  "Bách hóa"
];
const fallbackStatuses = ["active", "low_stock", "out_of_stock"];

const emptyForm = {
  name: "",
  category: "Thời trang",
  stock: "0",
  basePriceInput: "1.000",
  discountPercent: "0",
  description: "",
  featured: false
};

const statusLabels = {
  active: "Active",
  low_stock: "Low stock",
  out_of_stock: "Out of stock"
};

const commandNotes = [
  ["Create", "PutItemCommand"],
  ["Pagination", "ScanCommand + LastEvaluatedKey"],
  ["Stock Update", "UpdateItemCommand"],
  ["Edit", "UpdateItemCommand"],
  ["Delete", "DeleteItemCommand"]
];

const panelStyle = {
  border: "1px solid rgba(255, 255, 255, 0.7)",
  background: "rgba(255, 255, 255, 0.92)",
  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)"
};

const pageGridStyle = {
  display: "grid",
  gap: "20px"
};

const heroStyle = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
  padding: "20px",
  borderRadius: "28px",
  border: "1px solid rgba(255, 255, 255, 0.7)",
  background: "rgba(255, 255, 255, 0.82)",
  backdropFilter: "blur(12px)"
};

const statsGridStyle = {
  display: "grid",
  gap: "16px",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))"
};

const filterGridStyle = {
  display: "grid",
  gap: "12px",
  alignItems: "center",
  padding: "16px",
  borderRadius: "24px",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))"
};

const inputStyle = {
  width: "100%",
  height: "44px",
  padding: "0 12px",
  borderRadius: "12px",
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#0f172a",
  fontSize: "14px"
};

const textareaStyle = {
  width: "100%",
  minHeight: "112px",
  padding: "12px",
  borderRadius: "12px",
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#0f172a",
  fontSize: "14px"
};

const darkButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: "44px",
  padding: "0 20px",
  borderRadius: "12px",
  border: 0,
  background: "#0f172a",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 600
};

const primaryButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: "44px",
  padding: "0 20px",
  borderRadius: "12px",
  border: 0,
  background: "#2563eb",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 600
};

const secondaryButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: "40px",
  padding: "0 16px",
  borderRadius: "12px",
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#334155",
  fontSize: "14px",
  fontWeight: 600
};

const gridPanelsStyle = {
  display: "grid",
  gap: "20px",
  alignItems: "stretch",
  gridTemplateColumns: "minmax(0, 1fr) 380px"
};

const panelHeight = 760;

const tablePanelStyle = {
  ...panelStyle,
  display: "flex",
  flexDirection: "column",
  height: `${panelHeight}px`,
  minHeight: `${panelHeight}px`
};

const formPanelStyle = {
  ...panelStyle,
  display: "grid",
  gap: "16px",
  padding: "20px",
  height: `${panelHeight}px`,
  minHeight: `${panelHeight}px`,
  overflow: "auto"
};

const columnStyles = {
  product: { width: "32%" },
  category: { width: "13%" },
  price: { width: "17%" },
  stock: { width: "14%" },
  status: { width: "12%" },
  actions: { width: "12%" }
};

const inputClassName = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100";
const actionButtonClassName = "inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

function currency(value) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatNumberInput(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return new Intl.NumberFormat("vi-VN").format(Number(digits));
}

function parseFormattedNumber(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

function computeDiscountPercent(originalPrice, price) {
  if (!originalPrice || originalPrice <= 0 || price >= originalPrice) return 0;
  return Math.round(((originalPrice - price) / originalPrice) * 100);
}

function computeSalePrice(basePrice, discountPercent) {
  const boundedDiscount = Math.min(99, Math.max(0, Number(discountPercent) || 0));
  return Math.max(1000, Math.round(basePrice * (100 - boundedDiscount) / 100));
}

function statusLabel(status) {
  return statusLabels[status] ?? status;
}

function matchesClientFilters(item, filters = {}) {
  if (!item) return false;
  if (filters.category && filters.category !== "all" && item.category !== filters.category) return false;
  if (filters.status && item.status !== filters.status) return false;

  if (filters.search?.trim()) {
    const search = filters.search.trim().toLowerCase();
    const haystack = [
      item.name,
      item.description,
      item.brand,
      item.sku,
      item.category
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (!haystack.includes(search)) return false;
  }

  return true;
}

function badgeClassName(status) {
  if (status === "active") return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  if (status === "low_stock") return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
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

function Field({ children, className = "" }) {
  return <label className={`grid gap-2 text-sm font-semibold text-slate-700 ${className}`}>{children}</label>;
}

function StatCard({ label, value }) {
  return (
    <article className="rounded-2xl border border-white/70 bg-white/90 p-5 backdrop-blur" style={panelStyle}>
      <span className="text-sm text-slate-500">{label}</span>
      <strong className="mt-2 block text-2xl font-semibold tracking-tight text-slate-900">{value}</strong>
    </article>
  );
}

export default function ShoppingManager() {
  const [items, setItems] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [categories, setCategories] = useState(fallbackCategories);
  const [statuses] = useState(fallbackStatuses);
  const [filters, setFilters] = useState({ category: "all", status: "", search: "", sort: "stock:desc" });
  const [cursorHistory, setCursorHistory] = useState([null]);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [pageInput, setPageInput] = useState("1");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [editingVersion, setEditingVersion] = useState(0);
  const [message, setMessage] = useState("Loading product data...");
  const [busy, setBusy] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const stockHoldTimeoutRef = useRef(null);
  const stockHoldIntervalRef = useRef(null);

  const previewBasePrice = parseFormattedNumber(form.basePriceInput);
  const previewDiscount = Math.min(99, Math.max(0, Number(form.discountPercent) || 0));
  const previewSalePrice = computeSalePrice(previewBasePrice, previewDiscount);

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
      if (nextFilters.sort) {
        const [sortBy, sortDirection] = nextFilters.sort.split(":");
        params.set("sortBy", sortBy);
        params.set("sortDirection", sortDirection);
      }

      const response = await fetch(`${apiUrl}/api/shopping-items/all?${params.toString()}`);
      if (!response.ok) throw new Error(await readApiError(response, "Failed to load product summary"));
      const data = await response.json();
      setAllItems(data.items ?? []);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loadItems(targetCursor = null, nextFilters = filters, nextIndex = 0, nextHistory = cursorHistory) {
    setBusy(true);
    try {
      const params = new URLSearchParams({ limit: String(pageSize) });
      if (targetCursor) params.set("cursor", targetCursor);
      if (nextFilters.category !== "all") params.set("category", nextFilters.category);
      if (nextFilters.status) params.set("status", nextFilters.status);
      if (nextFilters.search.trim()) params.set("search", nextFilters.search.trim());
      if (nextFilters.sort) {
        const [sortBy, sortDirection] = nextFilters.sort.split(":");
        params.set("sortBy", sortBy);
        params.set("sortDirection", sortDirection);
      }

      const response = await fetch(`${apiUrl}/api/shopping-items?${params.toString()}`);
      if (!response.ok) throw new Error(await readApiError(response, "Failed to load products"));

      const data = await response.json();
      setItems(data.items ?? []);
      setCursorHistory(nextHistory);
      setCursorIndex(nextIndex);
      setPageInput(String(nextIndex + 1));
      setNextCursor(data.nextCursor ?? null);
      setHasNextPage(Boolean(data.hasNextPage));
      setMessage(`Loaded ${data.items?.length ?? 0} products`);
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

  useEffect(() => {
    setSearchDraft(filters.search);
  }, [filters.search]);

  useEffect(() => {
    const normalizedDraft = searchDraft.trim();
    const normalizedFilter = filters.search.trim();

    if (normalizedDraft === normalizedFilter) return;

    const timeoutId = window.setTimeout(() => {
      updateFilter("search", searchDraft);
    }, 2000);

    return () => window.clearTimeout(timeoutId);
  }, [searchDraft, filters.search]);

  useEffect(() => () => {
    if (stockHoldTimeoutRef.current) {
      window.clearTimeout(stockHoldTimeoutRef.current);
    }

    if (stockHoldIntervalRef.current) {
      window.clearInterval(stockHoldIntervalRef.current);
    }
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
      stock: String(item.stock ?? 0),
      basePriceInput: formatNumberInput(item.originalPrice ?? item.price),
      discountPercent: String(computeDiscountPercent(Number(item.originalPrice ?? item.price), Number(item.price))),
      description: item.description ?? "",
      featured: Boolean(item.featured)
    });
    setMessage(`Editing "${item.name}"`);
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
    const history = [...cursorHistory.slice(0, cursorIndex + 1), nextCursor];
    loadItems(nextCursor, filters, history.length - 1, history);
  }

  function goPreviousPage() {
    if (cursorIndex === 0) return;
    const previousIndex = cursorIndex - 1;
    loadItems(cursorHistory[previousIndex], filters, previousIndex, cursorHistory);
  }

  function stopStockHold() {
    if (stockHoldTimeoutRef.current) {
      window.clearTimeout(stockHoldTimeoutRef.current);
      stockHoldTimeoutRef.current = null;
    }

    if (stockHoldIntervalRef.current) {
      window.clearInterval(stockHoldIntervalRef.current);
      stockHoldIntervalRef.current = null;
    }
  }

  function startStockHold(item, incrementBy) {
    stopStockHold();
    stockHoldTimeoutRef.current = window.setTimeout(() => {
      stockHoldIntervalRef.current = window.setInterval(() => {
        updateStock(item, incrementBy);
      }, 180);
    }, 350);
  }

  async function goToPage() {
    const targetPage = Math.max(1, Number(pageInput) || 1);

    setBusy(true);
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        limit: String(pageSize)
      });
      if (filters.category !== "all") params.set("category", filters.category);
      if (filters.status) params.set("status", filters.status);
      if (filters.search.trim()) params.set("search", filters.search.trim());
      if (filters.sort) {
        const [sortBy, sortDirection] = filters.sort.split(":");
        params.set("sortBy", sortBy);
        params.set("sortDirection", sortDirection);
      }

      const cursorResponse = await fetch(`${apiUrl}/api/shopping-items/page-cursor?${params.toString()}`);
      if (!cursorResponse.ok) throw new Error(await readApiError(cursorResponse, "Failed to resolve page cursor"));

      const cursorData = await cursorResponse.json();
      const resolvedIndex = Math.max(0, Number(cursorData.page ?? 1) - 1);
      const resolvedHistory = Array.isArray(cursorData.cursorHistory) && cursorData.cursorHistory.length > 0
        ? cursorData.cursorHistory
        : [null];

      await loadItems(cursorData.cursor ?? null, filters, resolvedIndex, resolvedHistory);

      if (cursorData.reachedEnd) {
        setMessage(`Only ${cursorData.page} pages are currently available`);
      }
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
      if (!response.ok) throw new Error(await readApiError(response, "Stock update failed"));
      const updated = await response.json();
      setItems((current) => current.map((row) => row.id === updated.id ? updated : row));
      setAllItems((current) => current.map((row) => row.id === updated.id ? updated : row));
      setMessage(`Updated stock for "${updated.name}"`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitForm(event) {
    event.preventDefault();
    setBusy(true);

    const normalizedName = form.name.trim();
    const originalPrice = Math.max(1000, parseFormattedNumber(form.basePriceInput));
    const discountPercent = Math.min(99, Math.max(0, Number(form.discountPercent) || 0));
    const price = computeSalePrice(originalPrice, discountPercent);

    const payload = {
      name: normalizedName,
      category: form.category,
      brand: "Unknown",
      sku: makeSku(normalizedName),
      stock: Number(form.stock),
      price,
      originalPrice,
      imageUrl: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80",
      location: "TP.HCM",
      description: form.description.trim() || `Product ${normalizedName} was quickly created from the admin page.`,
      rating: 4.8,
      soldCount: 0,
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
        throw new Error(await readApiError(response, editingId ? "Failed to update product" : "Failed to create product"));
      }

      const savedItem = await response.json();
      setMessage(editingId ? "Product updated successfully" : "Product created successfully");
      resetForm();

      if (editingId) {
        const history = resetPagination();
        await loadItems(null, filters, 0, history);
        await loadSummary(filters);
        return;
      }

      setAllItems((current) => [savedItem, ...current]);

      if (matchesClientFilters(savedItem, filters)) {
        const history = [null];
        setCursorHistory(history);
        setCursorIndex(0);
        setNextCursor(null);
        setHasNextPage(true);
        setItems((current) => [savedItem, ...current].slice(0, pageSize));
      } else {
        const history = resetPagination();
        await loadItems(null, filters, 0, history);
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(item) {
    const confirmed = window.confirm(`Delete product "${item.name}"?`);
    if (!confirmed) return;

    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/shopping-items/${item.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to delete product"));
      if (editingId === item.id) resetForm();
      setMessage(`Deleted "${item.name}"`);
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
    <div className="grid gap-5" style={pageGridStyle}>
      <section className="flex flex-col gap-4 rounded-[28px] border border-white/70 bg-white/80 p-5 backdrop-blur md:flex-row md:items-center md:justify-between" style={heroStyle}>
        <div>
          <p className="m-0 text-sm uppercase tracking-[0.25em] text-slate-500" style={{ margin: 0, fontSize: "13px", letterSpacing: "0.25em", color: "#64748b" }}>
            Product Admin
          </p>
          <h1 className="mt-2 text-3xl bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent font-semibold tracking-tight text-slate-900" style={{ margin: "8px 0 0", fontSize: "32px", fontWeight: 600, color: "#0f172a" }}>
            Product List
          </h1>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" style={statsGridStyle}>
        <StatCard label="Total Products" value={summary.totalProducts} />
        <StatCard label="Low Stock" value={summary.lowStock} />
        <StatCard label="Out of Stock" value={summary.outOfStock} />
        <StatCard label="Inventory Value" value={currency(summary.inventoryValue)} />
      </section>

      <section className="grid gap-3 rounded-3xl border bg-color-blue border-white/70 bg-white/90 p-4 md:grid-cols-[minmax(280px,1.4fr)_220px_minmax(0,272px)]" style={{ ...panelStyle, ...filterGridStyle }}>
        <input
          className={inputClassName}
          style={inputStyle}
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              updateFilter("search", searchDraft);
            }
          }}
          placeholder="Search by product name"
        />
        <select className={inputClassName} style={inputStyle} value={filters.category} onChange={(event) => updateFilter("category", event.target.value)}>
          <option value="all">All categories</option>
          {categories.map((category) => (
            <option key={category} value={category}>{category}</option>
          ))}
        </select>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
          <select className={inputClassName} style={{ ...inputStyle, flex: 1 }} value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>
            <option value="">All statuses</option>
            {statuses.map((item) => (
              <option key={item} value={item}>{statusLabel(item)}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              const [, direction = "desc"] = filters.sort.split(":");
              updateFilter("sort", `stock:${direction === "asc" ? "desc" : "asc"}`);
            }}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-base font-bold text-slate-700 transition hover:bg-slate-50"
            style={{ height: "40px", width: "40px", padding: 0, borderRadius: "10px", flexShrink: 0 }}
            title={filters.sort.endsWith(":asc") ? "Sort stock ascending" : "Sort stock descending"}
          >
            {filters.sort.endsWith(":asc") ? "↑" : "↓"}
          </button>
        </div>
      </section>

      <section className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_380px]" style={gridPanelsStyle}>
        <div className="flex h-full min-h-full flex-col overflow-hidden rounded-3xl border border-white/70 bg-white/90" style={tablePanelStyle}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #e2e8f0" }}>
            <div>
              <h2 className="text-xl font-semibold text-slate-900" style={{ margin: 0, fontSize: "20px", fontWeight: 600 }}>Products</h2>
            
            </div>
            <span className="max-w-xs text-sm text-slate-500 md:text-right" style={{ maxWidth: "320px", fontSize: "14px", color: "#64748b" }}>
              {message}
            </span>
          </div>

          <div className="flex-1 overflow-auto" style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            <table className="min-w-full border-separate border-spacing-0" style={{ width: "100%", minWidth: "980px", borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed" }}>
              <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
                <tr>
                  <th style={{ ...columnStyles.product, padding: "12px 16px" }} className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Product</th>
                  <th style={{ ...columnStyles.category, padding: "12px 10px" }} className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Category</th>
                  <th style={{ ...columnStyles.price, padding: "12px 10px" }} className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Price</th>
                  <th style={{ ...columnStyles.stock, padding: "12px 10px" }} className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Inventory</th>
                  <th style={{ ...columnStyles.status, padding: "12px 10px" }} className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Status</th>
                  <th style={{ ...columnStyles.actions, padding: "12px 10px" }} className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={{ padding: "64px 20px", textAlign: "center", fontSize: "14px", color: "#64748b" }}>
                      No products match the current filters.
                    </td>
                  </tr>
                ) : items.map((item) => {
                  const discountPercent = computeDiscountPercent(Number(item.originalPrice ?? item.price), Number(item.price));

                  return (
                    <tr key={item.id} className="transition hover:bg-slate-50/80" style={{ height: "68px" }}>
                      <td style={{ ...columnStyles.product, padding: "12px 16px" }} className="border-b border-slate-100 align-middle">
                        <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: "10px" }}>
                          <img src={item.imageUrl} alt={item.name} style={{ width: "40px", height: "40px", borderRadius: "12px", border: "1px solid #e2e8f0", objectFit: "cover", flexShrink: 0 }} />
                          <div style={{ minWidth: 0, overflow: "hidden" }}>
                            <strong className="block text-sm font-semibold text-slate-900" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</strong>
                            <span style={{ marginTop: "2px", fontSize: "12px", color: "#64748b", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              SKU {item.sku}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td style={{ ...columnStyles.category, padding: "12px 10px", fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} className="border-b border-slate-100 text-slate-600">{item.category}</td>
                      <td style={{ ...columnStyles.price, padding: "12px 10px" }} className="border-b border-slate-100">
                        <strong className="block text-sm font-semibold text-slate-900" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currency(item.price)}</strong>
                        <small style={{ marginTop: "2px", fontSize: "12px" }} className="block text-slate-500">
                          {discountPercent > 0 ? `${discountPercent}% off from ${currency(item.originalPrice)}` : "No discount"}
                        </small>
                      </td>
                      <td style={{ ...columnStyles.stock, padding: "12px 10px" }} className="border-b border-slate-100">
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", minWidth: "120px" }}>
                          <button
                            type="button"
                            onClick={() => updateStock(item, -1)}
                            onMouseDown={() => startStockHold(item, -1)}
                            onMouseUp={stopStockHold}
                            onMouseLeave={stopStockHold}
                            onTouchStart={() => startStockHold(item, -1)}
                            onTouchEnd={stopStockHold}
                            disabled={busy || Number(item.stock) <= 0}
                            className={`${actionButtonClassName} bg-rose-50 text-rose-700 hover:bg-rose-100`}
                            style={{ minWidth: "32px", padding: "0 8px" }}
                          >
                            -
                          </button>
                          <strong className="inline-flex min-w-10 justify-center text-sm font-semibold text-slate-900">{item.stock}</strong>
                          <button
                            type="button"
                            onClick={() => updateStock(item, 1)}
                            onMouseDown={() => startStockHold(item, 1)}
                            onMouseUp={stopStockHold}
                            onMouseLeave={stopStockHold}
                            onTouchStart={() => startStockHold(item, 1)}
                            onTouchEnd={stopStockHold}
                            disabled={busy}
                            className={`${actionButtonClassName} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
                            style={{ minWidth: "32px", padding: "0 8px" }}
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td style={{ ...columnStyles.status, padding: "12px 10px" }} className="border-b border-slate-100">
                        <span className={`inline-flex min-h-8 items-center justify-center rounded-full px-3 text-xs font-bold ${badgeClassName(item.status)}`} style={{ minWidth: "96px", whiteSpace: "nowrap" }}>
                          {statusLabel(item.status)}
                        </span>
                      </td>
                      <td style={{ ...columnStyles.actions, padding: "12px 10px" }} className="border-b border-slate-100">
                        <div style={{ display: "flex", flexWrap: "nowrap", gap: "6px", width: "100%" }}>
                          <button type="button" onClick={() => startEdit(item)} disabled={busy} className={`${actionButtonClassName} bg-blue-50 text-blue-700 hover:bg-blue-100`} style={{ flex: "1 1 0", minWidth: "48px", padding: "0 8px" }}>Edit</button>
                          <button type="button" onClick={() => removeItem(item)} disabled={busy} className={`${actionButtonClassName} bg-rose-50 text-rose-700 hover:bg-rose-100`} style={{ flex: "1 1 0", minWidth: "58px", padding: "0 8px" }}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "flex-end", padding: "16px 20px", borderTop: "1px solid #e2e8f0" }}>
            <button type="button" onClick={goPreviousPage} disabled={busy || cursorIndex === 0} className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" style={secondaryButtonStyle}>
              Previous
            </button>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", borderRadius: "12px", background: "#f1f5f9", padding: "6px 10px", fontSize: "14px", color: "#475569" }}>
              <span>Page</span>
              <input
                className={inputClassName}
                style={{ ...inputStyle, width: "72px", height: "36px" }}
                inputMode="numeric"
                value={pageInput}
                onChange={(event) => setPageInput(event.target.value.replace(/\D/g, "") || "1")}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    goToPage();
                  }
                }}
              />
            </label>
            <button type="button" onClick={goNextPage} disabled={busy || !hasNextPage} className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50" style={{ ...darkButtonStyle, height: "40px", padding: "0 16px" }}>
              {hasNextPage ? "Next" : "Last Page"}
            </button>
          </div>
        </div>

        <form onSubmit={submitForm} className="grid h-full gap-4 rounded-3xl border border-white/70 bg-white/90 p-5" style={formPanelStyle}>
          <div style={{ borderBottom: "1px solid #e2e8f0", paddingBottom: "16px" }}>
            <h2 className="text-xl font-semibold text-slate-900" style={{ margin: 0, fontSize: "20px", fontWeight: 600 }}>
              {editingId ? "Edit Product" : "Add Product"}
            </h2>
            <p className="mt-1 text-sm text-slate-500" style={{ margin: "4px 0 0", fontSize: "14px", color: "#64748b" }}>
              Only keep the fields admins actually need to edit often.
            </p>
          </div>

          <Field>
            <span>Product Name</span>
            <input className={inputClassName} style={inputStyle} value={form.name} onChange={(event) => updateField("name", event.target.value)} required />
          </Field>

          <Field>
            <span>Category</span>
            <select className={inputClassName} style={inputStyle} value={form.category} onChange={(event) => updateField("category", event.target.value)}>
              {categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <span>Base Price</span>
              <input
                className={inputClassName}
                style={inputStyle}
                inputMode="numeric"
                value={form.basePriceInput}
                onChange={(event) => updateField("basePriceInput", formatNumberInput(event.target.value))}
                placeholder="1.000.000"
                required
              />
            </Field>
            <Field>
              <span>Discount (%)</span>
              <input
                className={inputClassName}
                style={inputStyle}
                type="number"
                min="0"
                max="99"
                value={form.discountPercent}
                onChange={(event) => updateField("discountPercent", event.target.value)}
              />
            </Field>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-500">Final selling price</span>
              <strong className="text-lg font-semibold text-slate-900">{currency(previewSalePrice)}</strong>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Base price: {currency(previewBasePrice || 0)} · Discount: {previewDiscount}%
            </p>
          </div>

          <Field>
            <span>Opening Stock</span>
            <input
              className={inputClassName}
              style={inputStyle}
              type="number"
              min="0"
              value={form.stock}
              onChange={(event) => updateField("stock", event.target.value)}
              required
            />
          </Field>

          <Field>
            <span>Description</span>
            <textarea className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100" style={textareaStyle} value={form.description} onChange={(event) => updateField("description", event.target.value)} placeholder="Optional short note for the product..." />
          </Field>

          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={form.featured} onChange={(event) => updateField("featured", event.target.checked)} />
            Mark as featured product
          </label>

          <div style={{ marginTop: "auto", display: "flex", flexWrap: "wrap", gap: "12px", paddingTop: "8px" }}>
            <button disabled={busy} type="submit" className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50" style={primaryButtonStyle}>
              {editingId ? "Save Changes" : "Create Product"}
            </button>
            {editingId ? (
              <button disabled={busy} type="button" onClick={resetForm} className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" style={{ ...secondaryButtonStyle, height: "44px", padding: "0 20px" }}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        {commandNotes.map(([label, command]) => (
          <div key={label} className="rounded-2xl border border-white/70 bg-white/90 p-4" style={panelStyle}>
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</span>
            <code className="mt-2 block text-sm text-slate-700">{command}</code>
          </div>
        ))}
      </section>
    </div>
  );
}
