"use client";

import type { ChangeEvent, CSSProperties, FormEvent, KeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

type Status = "active" | "low_stock" | "out_of_stock";
type SearchField = "name" | "brand";
type SortValue = "updatedAt:desc" | "updatedAt:asc" | "stock:desc";

type ProductItem = {
  id: string;
  name: string;
  brand?: string;
  category: string;
  stock: number;
  price: number;
  originalPrice?: number;
  description?: string;
  sku?: string;
  status: Status;
  updatedAt?: string;
  createdAt?: string;
  imageUrl?: string;
  version?: number;
};
type PanelMode = "product" | "sale";
type SaleCampaignStatus = "scheduled" | "active" | "ended" | "cancelled";

type SaleCampaign = {
  id: string;
  name: string;
  campaignStatus: SaleCampaignStatus;
  discountPercent: number;
  productIds: string[];
  startAt: string;
  endAt: string;
};

type SaleCampaignProductsResponse = {
  campaign: SaleCampaign;
  items: ProductItem[];
};

type SaleCampaignProductRemovalResponse = {
  campaign: SaleCampaign;
  closed: boolean;
};

type FormState = {
  name: string;
  brand: string;
  category: string;
  stock: string;
  basePriceInput: string;
  discountPercent: string;
  description: string;
  imageUrl: string;
};

type Filters = {
  category: string;
  status: "" | Status;
  updatedAtFrom: string;
  searchField: SearchField;
  search: string;
  sort: SortValue;
};

type CursorPageResponse = {
  page?: number;
  cursor?: string | null;
  cursorHistory?: Array<string | null>;
  reachedEnd?: boolean;
};

type ListResponse = {
  items?: ProductItem[];
  nextCursor?: string | null;
  hasNextPage?: boolean;
};

type ListAllResponse = {
  items?: ProductItem[];
};

type MetaResponse = {
  categories?: string[];
  searchFields?: SearchField[];
};

type ShoppingManagerProps = {
  authToken?: string;
  headerActions?: ReactNode;
  canManageProducts?: boolean;
};

type PresignedUploadResponse = {
  bucket: string;
  key: string;
  contentType: string;
  uploadUrl: string;
  fileUrl: string;
  expiresIn: number;
};

const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
const pageSize = 10;
const fallbackCategories = [
  "\u0054h\u1eddi trang",
  "\u0110i\u1ec7n t\u1eed",
  "Gia d\u1ee5ng",
  "M\u1eb9 v\u00e0 b\u00e9",
  "L\u00e0m \u0111\u1eb9p",
  "B\u00e1ch h\u00f3a"
];
const fallbackStatuses = ["active", "low_stock", "out_of_stock"];
const fallbackSearchFields: SearchField[] = ["name", "brand"];

const categoryLabels = {
  "Thoi trang": "Th\u1eddi trang",
  "Dien tu": "\u0110i\u1ec7n t\u1eed",
  "Gia dung": "Gia d\u1ee5ng",
  "Me va be": "M\u1eb9 v\u00e0 b\u00e9",
  "Lam dep": "L\u00e0m \u0111\u1eb9p",
  "Bach hoa": "B\u00e1ch h\u00f3a"
};

const emptyForm: FormState = {
  name: "",
  brand: "",
  category: "\u0054h\u1eddi trang",
  stock: "0",
  basePriceInput: "1.000",
  discountPercent: "0",
  description: "",
  imageUrl: "",
};
const toLocalDateTimeInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

const statusLabels = {
  active: "Active",
  low_stock: "Low stock",
  out_of_stock: "Out of stock"
};

const searchFieldLabels = {
  name: "Product name",
  brand: "Brand"
};

const panelStyle: CSSProperties = {
  border: "1px solid rgba(255, 255, 255, 0.7)",
  background: "rgba(255, 255, 255, 0.92)",
  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)"
};

const pageGridStyle: CSSProperties = {
  display: "grid",
  gap: "12px"
};

const statsGridStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))"
};

const filterGridStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  alignItems: "center",
  padding: "10px",
  borderRadius: "20px",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))"
};

const inputStyle: CSSProperties = {
  width: "100%",
  height: "40px",
  padding: "0 12px",
  borderRadius: "12px",
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#0f172a",
  fontSize: "14px"
};

const textareaStyle: CSSProperties = {
  width: "100%",
  minHeight: "112px",
  padding: "12px",
  borderRadius: "12px",
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#0f172a",
  fontSize: "14px"
};

const darkButtonStyle: CSSProperties = {
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

const primaryButtonStyle: CSSProperties = {
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

const secondaryButtonStyle: CSSProperties = {
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

const gridPanelsStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  alignItems: "stretch",
  gridTemplateColumns: "minmax(0, 1fr) 360px"
};

const panelHeight = "clamp(440px, calc(100dvh - 250px), 640px)";

const tablePanelStyle: CSSProperties = {
  ...panelStyle,
  display: "flex",
  flexDirection: "column",
  height: panelHeight,
  minHeight: panelHeight
};

const formPanelStyle: CSSProperties = {
  ...panelStyle,
  display: "grid",
  gap: "12px",
  padding: "16px",
  height: panelHeight,
  minHeight: panelHeight,
  overflow: "auto"
};

const columnStyles: Record<string, CSSProperties> = {
  product: { width: "26%" },
  category: { width: "12%" },
  price: { width: "16%" },
  stock: { width: "12%" },
  updatedAt: { width: "14%" },
  status: { width: "10%" },
  actions: { width: "10%" }
};

const inputClassName = "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100";
const actionButtonClassName = "inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

function currency(value: number | string | undefined | null) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatNumberInput(value: number | string | undefined | null) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return new Intl.NumberFormat("vi-VN").format(Number(digits));
}

function parseFormattedNumber(value: number | string | undefined | null) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

function computeDiscountPercent(originalPrice: number, price: number) {
  if (!originalPrice || originalPrice <= 0 || price >= originalPrice) return 0;
  return Math.round(((originalPrice - price) / originalPrice) * 100);
}

function computeSalePrice(basePrice: number, discountPercent: number | string) {
  const boundedDiscount = Math.min(99, Math.max(0, Number(discountPercent) || 0));
  return Math.max(1000, Math.round(basePrice * (100 - boundedDiscount) / 100));
}

function formatDateTime(value: string | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function statusLabel(status: string) {
  return statusLabels[status] ?? status;
}

function normalizeCategoryValue(category: string | undefined) {
  const normalized = String(category ?? "").trim().toLowerCase();

  if (!normalized || normalized === "all") return "all";
  if (normalized.includes("thoi trang") || normalized.includes("th\u1eddi trang")) return "Thoi trang";
  if (normalized.includes("dien tu") || normalized.includes("\u0111i\u1ec7n t\u1eed")) return "Dien tu";
  if (normalized.includes("gia dung") || normalized.includes("gia d\u1ee5ng")) return "Gia dung";
  if (normalized.includes("me va be") || normalized.includes("m\u1eb9 v\u00e0 b\u00e9")) return "Me va be";
  if (normalized.includes("lam dep") || normalized.includes("l\u00e0m \u0111\u1eb9p")) return "Lam dep";
  if (normalized.includes("bach hoa") || normalized.includes("b\u00e1ch h\u00f3a")) return "Bach hoa";

  return category;
}

function categoryLabel(category: string) {
  return categoryLabels[normalizeCategoryValue(category)] ?? category;
}

function toUpdatedAtFromIso(dateValue: string) {
  if (!dateValue) return "";
  return `${dateValue}T00:00:00.000Z`;
}

function fromUpdatedAtFromIso(dateValue: string) {
  if (!dateValue) return "";
  return String(dateValue).slice(0, 10);
}

function matchesClientFilters(item: ProductItem | null | undefined, filters: Partial<Filters> = {}) {
  if (!item) return false;
  if (filters.category && filters.category !== "all" && normalizeCategoryValue(item.category) !== normalizeCategoryValue(filters.category)) return false;
  if (filters.status && item.status !== filters.status) return false;

  if (filters.search?.trim()) {
    const search = filters.search.trim().toLowerCase();
    const searchField = filters.searchField ?? "name";
    const haystack = (
      searchField === "brand"
        ? [item.brand]
        : [item.name, item.description, item.brand, item.sku, item.category]
    )
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (!haystack.includes(search)) return false;
  }

  return true;
}

function badgeClassName(status: Status) {
  if (status === "active") return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  if (status === "low_stock") return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
}

function makeSku(name: string) {
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

async function readApiError(response: Response, fallback: string) {
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

async function logApiFailure(response: Response, fallback: string, context: string) {
  const message = await readApiError(response, fallback);
  console.error("[shopping-api] request failed", {
    context,
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    message
  });
  return message;
}

function Field({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <label className={`grid gap-2 text-sm font-semibold text-slate-700 ${className}`}>{children}</label>;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="rounded-2xl border border-white/70 bg-white/90 px-4 py-3 backdrop-blur" style={panelStyle}>
      <span className="text-xs text-slate-500">{label}</span>
      <strong className="mt-1 block text-xl font-semibold tracking-tight text-slate-900">{value}</strong>
    </article>
  );
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-slate-200/80 ${className}`} />;
}

function ShoppingManagerSkeleton() {
  return (
    <div style={pageGridStyle}>
      <section className="flex justify-center rounded-2xl border border-white/70 bg-white/80 px-4 py-3 backdrop-blur" style={panelStyle}>
        <div className="grid justify-items-center gap-2">
          <SkeletonBlock className="h-5 w-32" />
          <SkeletonBlock className="h-3 w-56" />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" style={statsGridStyle}>
        {Array.from({ length: 4 }).map((_, index) => (
          <article key={index} className="rounded-2xl border border-white/70 bg-white/90 px-4 py-3 backdrop-blur" style={panelStyle}>
            <SkeletonBlock className="h-4 w-24" />
            <SkeletonBlock className="mt-2 h-6 w-24" />
          </article>
        ))}
      </section>

      <section className="grid gap-3 rounded-3xl border border-white/70 bg-white/90 p-4 md:grid-cols-2 xl:grid-cols-4" style={{ ...panelStyle, ...filterGridStyle }}>
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="grid gap-2">
            <SkeletonBlock className="h-4 w-24" />
            <SkeletonBlock className="h-11 w-full rounded-xl" />
          </div>
        ))}
      </section>

      <section className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_380px]" style={gridPanelsStyle}>
        <div className="product-manager-panel flex h-full min-h-full flex-col overflow-hidden rounded-3xl border border-white/70 bg-white/90" style={tablePanelStyle}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #e2e8f0" }}>
            <SkeletonBlock className="h-7 w-36" />
            <SkeletonBlock className="h-4 w-40" />
          </div>
          <div className="grid gap-3 px-5 py-4">
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="grid grid-cols-[2.2fr_1fr_1.2fr_1fr_1fr_0.9fr_1fr] items-center gap-3 rounded-2xl border border-slate-100 px-3 py-3">
                <div className="flex items-center gap-3">
                  <SkeletonBlock className="h-10 w-10 rounded-xl" />
                  <div className="grid flex-1 gap-2">
                    <SkeletonBlock className="h-4 w-32" />
                    <SkeletonBlock className="h-3 w-24" />
                  </div>
                </div>
                <SkeletonBlock className="h-4 w-16" />
                <SkeletonBlock className="h-4 w-20" />
                <SkeletonBlock className="h-4 w-14" />
                <SkeletonBlock className="h-4 w-20" />
                <SkeletonBlock className="h-8 w-24 rounded-full" />
                <SkeletonBlock className="h-9 w-full rounded-xl" />
              </div>
            ))}
          </div>
        </div>

        <div className="product-manager-panel grid h-full gap-4 rounded-3xl border border-white/70 bg-white/90 p-5" style={formPanelStyle}>
          <div style={{ borderBottom: "1px solid #e2e8f0", paddingBottom: "16px" }} className="grid gap-3">
            <SkeletonBlock className="h-7 w-40" />
            <SkeletonBlock className="h-4 w-56" />
          </div>
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="grid gap-2">
              <SkeletonBlock className="h-4 w-24" />
              <SkeletonBlock className="h-11 w-full rounded-xl" />
            </div>
          ))}
          <SkeletonBlock className="h-24 w-full rounded-2xl" />
          <div className="flex gap-3 pt-2">
            <SkeletonBlock className="h-11 w-32 rounded-xl" />
            <SkeletonBlock className="h-11 w-24 rounded-xl" />
          </div>
        </div>
      </section>
    </div>
  );
}

export default function ShoppingManager({
  authToken = "",
  headerActions = null,
  canManageProducts = false
}: ShoppingManagerProps) {
  const [items, setItems] = useState<ProductItem[]>([]);
  const [allItems, setAllItems] = useState<ProductItem[]>([]);
  const [categories, setCategories] = useState(fallbackCategories);
  const [statuses] = useState(fallbackStatuses);
  const [searchFields, setSearchFields] = useState<SearchField[]>(fallbackSearchFields);
  const [filters, setFilters] = useState<Filters>({ category: "all", status: "", updatedAtFrom: "", searchField: "name", search: "", sort: "updatedAt:desc" });
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([null]);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [pageInput, setPageInput] = useState("1");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [editingVersion, setEditingVersion] = useState(0);
  const [panelMode, setPanelMode] = useState<PanelMode>("product");
  const [saleName, setSaleName] = useState("");
  const [saleDiscountPercent, setSaleDiscountPercent] = useState("10");
  const [saleStartAt, setSaleStartAt] = useState(() => toLocalDateTimeInput(new Date(Date.now() + 10 * 60_000)));
  const [saleEndAt, setSaleEndAt] = useState(() => toLocalDateTimeInput(new Date(Date.now() + 70 * 60_000)));
  const [saleProductIds, setSaleProductIds] = useState<string[]>([]);
  const [saleCampaigns, setSaleCampaigns] = useState<SaleCampaign[]>([]);
  const [saleCampaignsLoading, setSaleCampaignsLoading] = useState(false);
  const [cancellingSaleId, setCancellingSaleId] = useState("");
  const [selectedSaleCampaign, setSelectedSaleCampaign] = useState<SaleCampaign | null>(null);
  const [selectedSaleProducts, setSelectedSaleProducts] = useState<ProductItem[]>([]);
  const [saleProductsLoading, setSaleProductsLoading] = useState(false);
  const [removingSaleProductId, setRemovingSaleProductId] = useState("");
  const [message, setMessage] = useState("Loading product data...");
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const stockHoldTimeoutRef = useRef<number | null>(null);
  const stockHoldIntervalRef = useRef<number | null>(null);
  const filtersRef = useRef(filters);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const previewBasePrice = parseFormattedNumber(form.basePriceInput);
  const previewDiscount = Math.min(99, Math.max(0, Number(form.discountPercent) || 0));
  const previewSalePrice = computeSalePrice(previewBasePrice, previewDiscount);
  const isViewerOnly = !canManageProducts;
  const isInitialLoading = busy && items.length === 0 && allItems.length === 0;
  const liveOrUpcomingSaleCampaigns = saleCampaigns.filter((campaign) => campaign.campaignStatus === "scheduled" || campaign.campaignStatus === "active");
  const displayedProducts = selectedSaleCampaign ? selectedSaleProducts : items;
  const isSaleProductSelectionMode = panelMode === "sale" && !selectedSaleCampaign;

  const summary = useMemo(() => {
    const totalProducts = allItems.length;
    const lowStock = allItems.filter((item) => item.status === "low_stock").length;
    const outOfStock = allItems.filter((item) => item.status === "out_of_stock").length;
    const inventoryValue = allItems.reduce((sum, item) => sum + Number(item.stock) * Number(item.price), 0);
    return { totalProducts, lowStock, outOfStock, inventoryValue };
  }, [allItems]);

  const brandSuggestions = useMemo(() => (
    [...new Set(allItems.map((item) => item.brand).filter(Boolean))]
      .sort((left, right) => String(left).localeCompare(String(right)))
  ), [allItems]);

  function buildRequestHeaders(extraHeaders: HeadersInit = {}) {
    const headers = new Headers(extraHeaders);

    if (authToken) {
      headers.set("Authorization", `Bearer ${authToken}`);
    }

    return headers;
  }

  async function loadMeta() {
    try {
      const response = await fetch(`${apiUrl}/api/shopping-items/meta`, {
        headers: buildRequestHeaders()
      });
      if (!response.ok) return;
      const data = (await response.json()) as MetaResponse;
      setCategories((data.categories ?? fallbackCategories).map(normalizeCategoryValue));
      setSearchFields((data.searchFields ?? fallbackSearchFields) as SearchField[]);
    } catch {
      setCategories(fallbackCategories.map(normalizeCategoryValue));
      setSearchFields(fallbackSearchFields);
    }
  }

  async function loadSummary(nextFilters: Filters = filters) {
    try {
      const params = new URLSearchParams({ pageLimit: "48", maxPages: "10" });
      if (normalizeCategoryValue(nextFilters.category) !== "all") params.set("category", normalizeCategoryValue(nextFilters.category));
      if (nextFilters.status) params.set("status", nextFilters.status);
      if (nextFilters.updatedAtFrom) params.set("updatedAtFrom", nextFilters.updatedAtFrom);
      if (nextFilters.searchField && nextFilters.searchField !== "name") params.set("searchField", nextFilters.searchField);
      if (nextFilters.search.trim()) params.set("search", nextFilters.search.trim());
      if (nextFilters.sort) {
        const [sortBy, sortDirection] = nextFilters.sort.split(":");
        params.set("sortBy", sortBy);
        params.set("sortDirection", sortDirection);
      }

      const response = await fetch(`${apiUrl}/api/shopping-items/all?${params.toString()}`, {
        headers: buildRequestHeaders()
      });
      if (!response.ok) throw new Error(await logApiFailure(response, "Failed to load product summary", "loadSummary"));
      const data = (await response.json()) as ListAllResponse;
      setAllItems(data.items ?? []);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loadItems(targetCursor: string | null = null, nextFilters: Filters = filters, nextIndex = 0, nextHistory: Array<string | null> = cursorHistory) {
    setBusy(true);
    try {
      const params = new URLSearchParams({ limit: String(pageSize) });
      if (targetCursor) params.set("cursor", targetCursor);
      if (normalizeCategoryValue(nextFilters.category) !== "all") params.set("category", normalizeCategoryValue(nextFilters.category));
      if (nextFilters.status) params.set("status", nextFilters.status);
      if (nextFilters.updatedAtFrom) params.set("updatedAtFrom", nextFilters.updatedAtFrom);
      if (nextFilters.searchField && nextFilters.searchField !== "name") params.set("searchField", nextFilters.searchField);
      if (nextFilters.search.trim()) params.set("search", nextFilters.search.trim());
      if (nextFilters.sort) {
        const [sortBy, sortDirection] = nextFilters.sort.split(":");
        params.set("sortBy", sortBy);
        params.set("sortDirection", sortDirection);
      }

      const response = await fetch(`${apiUrl}/api/shopping-items?${params.toString()}`, {
        headers: buildRequestHeaders()
      });
      if (!response.ok) throw new Error(await logApiFailure(response, "Failed to load products", "loadItems"));

      const data = (await response.json()) as ListResponse;
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
    filtersRef.current = filters;
  }, [filters]);

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

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
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

  function startEdit(item: ProductItem) {
    if (isViewerOnly) {
      setMessage("account does not have permission to edit products");
      return;
    }

    setEditingId(item.id);
    setEditingVersion(item.version);
    setForm({
      name: item.name,
      brand: item.brand ?? "",
      category: item.category,
      stock: String(item.stock ?? 0),
      basePriceInput: formatNumberInput(item.originalPrice ?? item.price),
      discountPercent: String(computeDiscountPercent(Number(item.originalPrice ?? item.price), Number(item.price))),
      description: item.description ?? "",
      imageUrl: item.imageUrl ?? ""
    });
    setMessage(`Editing "${item.name}"`);
  }

  async function uploadProductImage(file: File) {
    if (!file.type.startsWith("image/")) {
      throw new Error("Only image files are supported.");
    }

    const presignResponse = await fetch(`${apiUrl}/api/uploads/presign`, {
      method: "POST",
      headers: buildRequestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        fileName: file.name,
        contentType: file.type,
        scope: "products"
      })
    });

    if (!presignResponse.ok) {
      throw new Error(await logApiFailure(presignResponse, "Cannot create image upload link", "uploadProductImage:presign"));
    }

    const presignData = await presignResponse.json() as PresignedUploadResponse;
    const uploadResponse = await fetch(presignData.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type
      },
      body: file
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload to S3 failed with status ${uploadResponse.status}.`);
    }

    return presignData.fileUrl;
  }

  async function handleImagePickerChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setImageBusy(true);
    try {
      const fileUrl = await uploadProductImage(file);
      updateField("imageUrl", fileUrl);
      setMessage(editingId ? "Successfully updated product image." : "Successfully added product image.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to upload image.");
    } finally {
      setImageBusy(false);
      event.target.value = "";
    }
  }

  function updateFilter<K extends keyof Filters>(field: K, value: Filters[K] | string) {
    const nextValue = field === "category"
      ? normalizeCategoryValue(value)
      : field === "updatedAtFrom"
        ? toUpdatedAtFromIso(value)
        : value;
    const nextFilters = { ...filtersRef.current, [field]: nextValue };
    filtersRef.current = nextFilters;
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

  function startStockHold(item: ProductItem, incrementBy: number) {
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
      if (normalizeCategoryValue(filters.category) !== "all") params.set("category", normalizeCategoryValue(filters.category));
      if (filters.status) params.set("status", filters.status);
      if (filters.updatedAtFrom) params.set("updatedAtFrom", filters.updatedAtFrom);
      if (filters.searchField && filters.searchField !== "name") params.set("searchField", filters.searchField);
      if (filters.search.trim()) params.set("search", filters.search.trim());
      if (filters.sort) {
        const [sortBy, sortDirection] = filters.sort.split(":");
        params.set("sortBy", sortBy);
        params.set("sortDirection", sortDirection);
      }

      const cursorResponse = await fetch(`${apiUrl}/api/shopping-items/page-cursor?${params.toString()}`, {
        headers: buildRequestHeaders()
      });
      if (!cursorResponse.ok) throw new Error(await logApiFailure(cursorResponse, "Failed to resolve page cursor", "goToPage"));

      const cursorData = (await cursorResponse.json()) as CursorPageResponse;
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

  async function updateStock(item: ProductItem, incrementBy: number) {
    if (isViewerOnly) {
      setMessage("Account does not have permission to update stock.");
      return;
    }

    const amount = Number(incrementBy);
    if (!Number.isFinite(amount) || amount === 0) return;

    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/shopping-items/${item.id}/increment`, {
        method: "PATCH",
        headers: buildRequestHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ field: "stock", incrementBy: amount })
      });
      if (!response.ok) throw new Error(await logApiFailure(response, "Stock update failed", "updateStock"));
      const updated = (await response.json()) as ProductItem;
      setItems((current) => current.map((row) => row.id === updated.id ? updated : row));
      setAllItems((current) => current.map((row) => row.id === updated.id ? updated : row));
      setMessage(`Updated stock for "${updated.name}"`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isViewerOnly) {
      setMessage("Account does not have permission to create or update products.");
      return;
    }

    setBusy(true);

    const normalizedName = form.name.trim();
    const normalizedBrand = form.brand.trim();
    const normalizedCategory = normalizeCategoryValue(
      String(form.category ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/gi, "d")
    );
    const originalPrice = Math.max(1000, parseFormattedNumber(form.basePriceInput));
    const discountPercent = Math.min(99, Math.max(0, Number(form.discountPercent) || 0));
    const price = computeSalePrice(originalPrice, discountPercent);

    try {
      const payload = {
        name: normalizedName,
        category: normalizedCategory,
        brand: normalizedBrand || "Unknown",
        sku: makeSku(normalizedName),
        stock: Number(form.stock),
        price,
        originalPrice,
        imageUrl: form.imageUrl.trim() || "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80",
        location: "TP.HCM",
        description: form.description.trim() || `Product ${normalizedName} was quickly created from the admin page.`,
        rating: 4.8,
        soldCount: 0
      };

      const response = await fetch(
        editingId ? `${apiUrl}/api/shopping-items/${editingId}` : `${apiUrl}/api/shopping-items`,
        {
          method: editingId ? "PATCH" : "POST",
          headers: buildRequestHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(editingId ? { ...payload, version: editingVersion } : payload)
        }
      );
      if (!response.ok) {
        throw new Error(await logApiFailure(
          response,
          editingId ? "Failed to update product" : "Failed to create product",
          editingId ? "submitForm:update" : "submitForm:create"
        ));
      }

      const savedItem = (await response.json()) as ProductItem;
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

  function toggleSaleProduct(productId: string) {
    setSaleProductIds((current) => current.includes(productId)
      ? current.filter((id) => id !== productId)
      : [...current, productId]);
  }

  async function loadSaleCampaigns() {
    setSaleCampaignsLoading(true);
    try {
      const response = await fetch(`${apiUrl}/api/sales`, {
        headers: buildRequestHeaders()
      });
      if (!response.ok) throw new Error(await logApiFailure(response, "Failed to load sale campaigns", "loadSaleCampaigns"));
      const campaigns = (await response.json()) as SaleCampaign[];
      setSaleCampaigns(campaigns);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load sale campaigns.");
    } finally {
      setSaleCampaignsLoading(false);
    }
  }

  async function cancelSaleCampaign(campaign: SaleCampaign) {
    setCancellingSaleId(campaign.id);
    try {
      const response = await fetch(`${apiUrl}/api/sales/${campaign.id}/cancel`, {
        method: "POST",
        headers: buildRequestHeaders()
      });
      if (!response.ok) throw new Error(await logApiFailure(response, "Failed to cancel sale campaign", "cancelSaleCampaign"));
      setMessage(`Cancelled sale campaign \"${campaign.name}\".`);
      await loadSaleCampaigns();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to cancel sale campaign.");
    } finally {
      setCancellingSaleId("");
    }
  }

  async function viewSaleCampaignProducts(campaign: SaleCampaign) {
    setSelectedSaleCampaign(campaign);
    setSelectedSaleProducts([]);
    setSaleProductsLoading(true);
    try {
      const response = await fetch(`${apiUrl}/api/sales/${campaign.id}/products`, {
        headers: buildRequestHeaders()
      });
      if (!response.ok) throw new Error(await logApiFailure(response, "Failed to load sale campaign products", "viewSaleCampaignProducts"));
      const data = (await response.json()) as SaleCampaignProductsResponse;
      setSelectedSaleCampaign(data.campaign);
      setSelectedSaleProducts(data.items);
    } catch (error) {
      setSelectedSaleCampaign(null);
      setMessage(error instanceof Error ? error.message : "Failed to load sale campaign products.");
    } finally {
      setSaleProductsLoading(false);
    }
  }

  async function removeProductFromSaleCampaign(product: ProductItem) {
    if (!selectedSaleCampaign) return;

    setRemovingSaleProductId(product.id);
    try {
      const response = await fetch(`${apiUrl}/api/sales/${selectedSaleCampaign.id}/products/${product.id}/remove`, {
        method: "POST",
        headers: buildRequestHeaders()
      });
      if (!response.ok) throw new Error(await logApiFailure(response, "Failed to remove product from sale campaign", "removeProductFromSaleCampaign"));
      const result = (await response.json()) as SaleCampaignProductRemovalResponse;
      if (result.closed) {
        clearSaleCampaignProducts();
        setMessage(`Removed \"${product.name}\" and closed the empty sale campaign.`);
      } else {
        setSelectedSaleCampaign(result.campaign);
        setSelectedSaleProducts((current) => current.filter((item) => item.id !== product.id));
        setMessage(`Removed \"${product.name}\" from \"${result.campaign.name}\".`);
      }
      await loadSaleCampaigns();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to remove product from sale campaign.");
    } finally {
      setRemovingSaleProductId("");
    }
  }

  function clearSaleCampaignProducts() {
    setSelectedSaleCampaign(null);
    setSelectedSaleProducts([]);
  }

  async function submitSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saleProductIds.length === 0) {
      setMessage("Choose at least one product for the sale campaign.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/sales`, {
        method: "POST",
        headers: buildRequestHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          name: saleName,
          discountPercent: Number(saleDiscountPercent),
          startAt: new Date(saleStartAt).toISOString(),
          endAt: new Date(saleEndAt).toISOString(),
          productIds: saleProductIds
        })
      });
      if (!response.ok) throw new Error(await logApiFailure(response, "Failed to schedule sale", "submitSale"));
      setSaleName("");
      setSaleProductIds([]);
      setMessage("Sale campaign scheduled successfully.");
      await loadSaleCampaigns();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to schedule sale.");
    } finally {
      setBusy(false);
    }
  }

  if (isInitialLoading) {
    return <ShoppingManagerSkeleton />;
  }

  return (
    <div className="grid gap-5" style={pageGridStyle}>
      <section className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-center backdrop-blur" style={panelStyle}>
        <p className="m-0 text-base font-semibold text-slate-900">Product Admin</p>
        <p className="mt-1 text-xs text-slate-500">Manage products, inventory, and scheduled sales from one workspace.</p>
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-2 xl:grid-cols-4" style={statsGridStyle}>
          <StatCard label="Total Products" value={summary.totalProducts} />
          <StatCard label="Low Stock" value={summary.lowStock} />
          <StatCard label="Out of Stock" value={summary.outOfStock} />
          <StatCard label="Inventory Value" value={currency(summary.inventoryValue)} />
        </div>
        {headerActions}
      </section>

      {isViewerOnly ? (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800" style={panelStyle}>
          This account does not have permission to manage products. You can view the product list, but you cannot create, edit, or delete products.
        </section>
      ) : null}

      <section className="grid gap-3 rounded-3xl border bg-color-blue border-white/70 bg-white/90 p-4 md:grid-cols-2 xl:grid-cols-4" style={{ ...panelStyle, ...filterGridStyle }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
          <select
            className={inputClassName}
            style={{ ...inputStyle, width: "160px", flexShrink: 0 }}
            value={filters.searchField}
            onChange={(event) => updateFilter("searchField", event.target.value)}
          >
            {searchFields.map((field) => (
              <option key={field} value={field}>{searchFieldLabels[field] ?? field}</option>
            ))}
          </select>
          <input
            className={inputClassName}
            style={{ ...inputStyle, flex: 1 }}
            list={filters.searchField === "brand" ? "brand-search-suggestions" : undefined}
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                updateFilter("search", searchDraft);
              }
            }}
            placeholder={`Search by ${String(searchFieldLabels[filters.searchField] ?? filters.searchField).toLowerCase()}`}
          />
          {filters.searchField === "brand" ? (
            <datalist id="brand-search-suggestions">
              {brandSuggestions.map((brand) => (
                <option key={brand} value={brand} />
              ))}
            </datalist>
          ) : null}
        </div>
        <select className={inputClassName} style={inputStyle} value={filters.category} onChange={(event) => updateFilter("category", event.target.value)}>
          <option value="all">All categories</option>
          {categories.map((category) => (
            <option key={category} value={category}>{categoryLabel(category)}</option>
          ))}
        </select>
        <input
          className={inputClassName}
          style={inputStyle}
          type="date"
          value={fromUpdatedAtFromIso(filters.updatedAtFrom)}
          onChange={(event) => updateFilter("updatedAtFrom", event.target.value)}
          title="Updated from date"
        />
        <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
          <select className={inputClassName} style={{ ...inputStyle, flex: 1 }} value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>
            <option value="">All statuses</option>
            {statuses.map((item) => (
              <option key={item} value={item}>{statusLabel(item)}</option>
            ))}
          </select>
          <select
            className={inputClassName}
            style={{ ...inputStyle, flex: 1 }}
            value={filters.sort}
            onChange={(event) => updateFilter("sort", event.target.value)}
            title="Sort products"
          >
            <option value="updatedAt:desc">Newest first</option>
            <option value="updatedAt:asc">Oldest first</option>
            <option value="stock:desc">Stock high to low</option>
          </select>
          <button
            type="button"
            onClick={() => {
              const [, direction = "desc"] = filters.sort.split(":");
              updateFilter("sort", `stock:${direction === "asc" ? "desc" : "asc"}`);
            }}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-base font-bold text-slate-700 transition hover:bg-slate-50"
            style={{ display: "none", height: "40px", width: "40px", padding: 0, borderRadius: "10px", flexShrink: 0 }}
            title={filters.sort.endsWith(":asc")
                ? "Sort stock ascending"
                : "Sort stock descending"}
          >
            {filters.sort.endsWith(":asc") ? "↑" : "↓"}
          </button>
        </div>
      </section>

      <section className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_380px]" style={gridPanelsStyle}>
        <div className="product-manager-panel flex h-full min-h-full flex-col overflow-hidden rounded-3xl border border-white/70 bg-white/90" style={tablePanelStyle}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #e2e8f0" }}>
            <div>
              <h2 className="text-base font-semibold text-slate-900" style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>{selectedSaleCampaign ? selectedSaleCampaign.name : "Products"}</h2>
              {selectedSaleCampaign ? <button type="button" onClick={clearSaleCampaignProducts} className="mt-1 text-xs font-semibold text-orange-700 hover:text-orange-800">All products</button> : null}
            </div>
            <span className="max-w-xs text-xs text-slate-500 md:text-right" style={{ maxWidth: "320px", fontSize: "12px", color: "#64748b" }}>
              {message}
            </span>
          </div>

          <div className="flex-1 overflow-auto" style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            <table className="min-w-full border-separate border-spacing-0" style={{ width: "100%", minWidth: "1080px", borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed" }}>
              <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
                <tr>
                  {isSaleProductSelectionMode ? <th className="w-12 border-b border-slate-200 text-center text-xs font-bold uppercase tracking-[0.2em] text-orange-600">Add</th> : null}
                  <th style={{ ...columnStyles.product, padding: "12px 16px" }} className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Product</th>
                  <th style={{ ...columnStyles.category, padding: "12px 10px" }} className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Category</th>
                  <th style={{ ...columnStyles.price, padding: "12px 10px" }} className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Price</th>
                  <th style={{ ...columnStyles.stock, padding: "12px 10px" }} className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Inventory</th>
                  <th style={{ ...columnStyles.updatedAt, padding: "12px 10px" }} className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Updated</th>
                  <th style={{ ...columnStyles.status, padding: "12px 10px" }} className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Status</th>
                  {panelMode === "product" || selectedSaleCampaign ? <th style={{ ...columnStyles.actions, padding: "12px 10px" }} className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {saleProductsLoading ? (
                  <tr><td colSpan={7} style={{ padding: "64px 20px", textAlign: "center", fontSize: "14px", color: "#64748b" }}>Loading sale campaign products...</td></tr>
                ) : displayedProducts.length === 0 ? (
                  <tr>
                    <td colSpan={isSaleProductSelectionMode || panelMode === "product" || selectedSaleCampaign ? 7 : 6} style={{ padding: "64px 20px", textAlign: "center", fontSize: "14px", color: "#64748b" }}>
                      {selectedSaleCampaign ? "This campaign has no available product records." : "No products match the current filters."}
                    </td>
                  </tr>
                ) : displayedProducts.map((item) => {
                  const discountPercent = computeDiscountPercent(Number(item.originalPrice ?? item.price), Number(item.price));

                  return (
                    <tr
                      key={item.id}
                      onDoubleClick={() => {
                        if (!isViewerOnly && !selectedSaleCampaign) {
                          startEdit(item);
                        }
                      }}
                      className={`cursor-pointer transition hover:bg-slate-50/80 ${editingId === item.id ? "bg-blue-50/80" : ""}`}
                      style={{ height: "68px" }}
                    >
                      {isSaleProductSelectionMode ? <td className="border-b border-slate-100 text-center"><input type="checkbox" aria-label={`Add ${item.name} to sale`} checked={saleProductIds.includes(item.id)} onChange={() => toggleSaleProduct(item.id)} disabled={busy} /></td> : null}
                      <td style={{ ...columnStyles.product, padding: "12px 16px" }} className="border-b border-slate-100 align-middle">
                        <div className="group relative" style={{ minWidth: 0, display: "flex", alignItems: "center", gap: "10px" }}>
                          <img src={item.imageUrl} alt={item.name} style={{ width: "40px", height: "40px", borderRadius: "12px", border: "1px solid #e2e8f0", objectFit: "cover", flexShrink: 0 }} />
                          <div style={{ minWidth: 0, overflow: "hidden" }}>
                            <strong className="block text-sm font-semibold text-slate-900" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</strong>
                            <span style={{ marginTop: "2px", fontSize: "12px", color: "#64748b", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              SKU {item.sku}
                            </span>
                          </div>
                          {item.description ? (
                            <div className="pointer-events-none absolute left-12 top-1/2 z-20 hidden w-72 -translate-y-1/2 rounded-2xl bg-slate-950 px-4 py-3 text-xs font-medium leading-5 text-white shadow-2xl group-hover:block">
                              {item.description}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td style={{ ...columnStyles.category, padding: "12px 10px", fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} className="border-b border-slate-100 text-slate-600">{categoryLabel(item.category)}</td>
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
                            disabled={busy || isViewerOnly || Number(item.stock) <= 0}
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
                            disabled={busy || isViewerOnly}
                            className={`${actionButtonClassName} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
                            style={{ minWidth: "32px", padding: "0 8px" }}
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td style={{ ...columnStyles.updatedAt, padding: "12px 10px", fontSize: "12px" }} className="border-b border-slate-100 text-slate-600">
                        {formatDateTime(item.updatedAt ?? item.createdAt)}
                      </td>
                      <td style={{ ...columnStyles.status, padding: "12px 10px" }} className="border-b border-slate-100">
                        <span className={`inline-flex min-h-8 items-center justify-center rounded-full px-3 text-xs font-bold ${badgeClassName(item.status)}`} style={{ minWidth: "96px", whiteSpace: "nowrap" }}>
                          {statusLabel(item.status)}
                        </span>
                      </td>
                      {selectedSaleCampaign ? <td style={{ ...columnStyles.actions, padding: "12px 10px" }} className="border-b border-slate-100">
                        <button type="button" onClick={() => void removeProductFromSaleCampaign(item)} disabled={removingSaleProductId === item.id} className={`${actionButtonClassName} bg-rose-50 text-rose-700 hover:bg-rose-100`} style={{ minWidth: "92px", padding: "0 10px" }}>{removingSaleProductId === item.id ? "Removing..." : "Remove"}</button>
                      </td> : panelMode === "product" ? <td style={{ ...columnStyles.actions, padding: "12px 10px" }} className="border-b border-slate-100">
                        {isViewerOnly ? (
                          <span className="inline-flex h-9 items-center rounded-lg bg-slate-100 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                            View only
                          </span>
                        ) : (
                          <div style={{ display: "flex", flexWrap: "nowrap", gap: "6px", width: "100%" }}>
                            <button type="button" onClick={() => startEdit(item)} disabled={busy} className={`${actionButtonClassName} bg-blue-50 text-blue-700 hover:bg-blue-100`} style={{ flex: "1 1 0", minWidth: "48px", padding: "0 8px" }}>Edit</button>
                          </div>
                        )}
                      </td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!selectedSaleCampaign ? <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "flex-end", padding: "10px 16px", borderTop: "1px solid #e2e8f0" }}>
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
          </div> : null}
        </div>

        {isViewerOnly ? (
          <section className="product-manager-panel grid h-full content-start gap-4 rounded-3xl border border-white/70 bg-white/90 p-5" style={formPanelStyle}>
            <div style={{ borderBottom: "1px solid #e2e8f0", paddingBottom: "16px" }}>
              <h2 className="text-xl font-semibold text-slate-900" style={{ margin: 0, fontSize: "20px", fontWeight: 600 }}>
                Viewer Mode
              </h2>
              <p className="mt-1 text-sm text-slate-500" style={{ margin: "4px 0 0", fontSize: "14px", color: "#64748b" }}>
                This account does not have permission to create or edit products. You can view the product list, but you cannot make any changes.
              </p>
            </div>
          </section>
        ) : (
        <form onSubmit={panelMode === "product" ? submitForm : submitSale} className="product-manager-panel grid h-full gap-4 rounded-3xl border border-white/70 bg-white/90 p-5" style={formPanelStyle}>
          <div style={{ borderBottom: "1px solid #e2e8f0", paddingBottom: "16px" }}>
            <div className="mb-4 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
              <button type="button" onClick={() => { clearSaleCampaignProducts(); setPanelMode("product"); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${panelMode === "product" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>Add Product</button>
              <button type="button" onClick={() => { resetForm(); clearSaleCampaignProducts(); setPanelMode("sale"); void loadSaleCampaigns(); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${panelMode === "sale" ? "bg-orange-600 text-white shadow-sm" : "text-slate-500"}`}>Schedule Sale</button>
            </div>
            <h2 className="text-xl font-semibold text-slate-900" style={{ margin: 0, fontSize: "20px", fontWeight: 600 }}>
              {panelMode === "sale" ? "Schedule Sale Campaign" : editingId ? "Edit Product" : "Add Product"}
            </h2>
            <p className="mt-1 text-sm text-slate-500" style={{ margin: "4px 0 0", fontSize: "14px", color: "#64748b" }}>
              {panelMode === "sale" ? `Choose products from the left table, then set the sale timeline here.` : "Only keep the fields admins actually need to edit often."}
            </p>
          </div>

          {panelMode === "product" ? <>
          <Field>
            <span>Product Name</span>
            <input className={inputClassName} style={inputStyle} value={form.name} onChange={(event) => updateField("name", event.target.value)} required />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <span>Brand</span>
              <input
                className={inputClassName}
                style={inputStyle}
                value={form.brand}
                onChange={(event) => updateField("brand", event.target.value)}
                placeholder="Apple, Nike, Samsung..."
              />
            </Field>

            <Field>
              <span>Category</span>
              <select className={inputClassName} style={inputStyle} value={form.category} onChange={(event) => updateField("category", event.target.value)}>
                {categories.map((category) => (
                  <option key={category} value={category}>{categoryLabel(category)}</option>
                ))}
              </select>
            </Field>
          </div>

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

          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Product Image</div>
                <p className="mt-1 text-sm text-slate-500">
                  {editingId ? "You can upload a new image while editing the product." : "Upload an image to make the product display better on the storefront."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={busy || imageBusy}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {imageBusy ? "Uploading..." : editingId ? "Replace Image" : "Add Image"}
              </button>
            </div>

            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleImagePickerChange}
              style={{ display: "none" }}
            />

            <div className="overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-white">
              {form.imageUrl ? (
                <img
                  src={form.imageUrl}
                  alt={form.name || "Ảnh sản phẩm"}
                  style={{ width: "100%", height: "180px", objectFit: "cover", display: "block" }}
                />
              ) : (
                <div className="flex h-[180px] items-center justify-center px-4 text-center text-sm text-slate-500">
                  No image selected. Click {editingId ? "\"Replace Image\"" : "\"Add Image\""} to upload an image to S3.
                </div>
              )}
            </div>

            {form.imageUrl ? (
              <div className="rounded-xl bg-white px-3 py-2 text-xs text-slate-500" style={{ wordBreak: "break-all" }}>
                {form.imageUrl}
              </div>
            ) : null}
          </div>

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
          </> : <>
            <Field><span>Campaign Name</span><input className={inputClassName} style={inputStyle} value={saleName} onChange={(event) => setSaleName(event.target.value)} placeholder="Weekend Sale" required /></Field>
            <Field><span>Discount (%)</span><input className={inputClassName} style={inputStyle} type="number" min="1" max="95" value={saleDiscountPercent} onChange={(event) => setSaleDiscountPercent(event.target.value)} required /></Field>
            <Field><span>Start Time</span><input className={inputClassName} style={inputStyle} type="datetime-local" value={saleStartAt} onChange={(event) => setSaleStartAt(event.target.value)} required /></Field>
            <Field><span>End Time</span><input className={inputClassName} style={inputStyle} type="datetime-local" value={saleEndAt} onChange={(event) => setSaleEndAt(event.target.value)} required /></Field>
            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4"><div className="flex items-center justify-between"><span className="text-sm font-semibold text-orange-900">Selected products</span><strong className="text-lg text-orange-700">{saleProductIds.length}</strong></div><p className="mt-2 text-xs leading-5 text-orange-800">Tick products from the table on the left. The highest active campaign percentage is applied automatically.</p></div>
            <button type="submit" disabled={busy || saleProductIds.length === 0} className="mt-auto inline-flex h-11 items-center justify-center rounded-xl bg-orange-600 px-5 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Scheduling..." : "Schedule Sale"}</button>
            <section className="rounded-2xl border border-orange-200 bg-[linear-gradient(135deg,#fff7ed_0%,#fff_58%,#fef3c7_100%)] p-3 shadow-[0_12px_28px_rgba(234,88,12,0.08)]">
              <div className="flex items-center justify-between gap-3 border-b border-orange-200/80 pb-3">
                <div>
                  <p className="m-0 text-[10px] font-bold uppercase tracking-[0.2em] text-orange-700">Sale Board</p>
                  <h3 className="mt-1 text-sm font-semibold text-slate-900">Live & Upcoming</h3>
                </div>
                <button type="button" onClick={() => void loadSaleCampaigns()} disabled={saleCampaignsLoading} className="text-xs font-semibold text-orange-700 hover:text-orange-800 disabled:opacity-50">Refresh</button>
              </div>
              <div className="mt-3 grid gap-2">
                {saleCampaignsLoading ? <p className="m-0 text-xs text-slate-500">Loading campaigns...</p> : null}
                {!saleCampaignsLoading && liveOrUpcomingSaleCampaigns.length === 0 ? <p className="m-0 rounded-xl border border-dashed border-orange-200 bg-white/70 px-3 py-3 text-xs text-slate-500">No active or scheduled sale campaigns.</p> : null}
                {liveOrUpcomingSaleCampaigns.map((campaign) => (
                  <article key={campaign.id} className={`rounded-xl border px-3 py-3 ${selectedSaleCampaign?.id === campaign.id ? "ring-2 ring-orange-400" : ""} ${campaign.campaignStatus === "active" ? "border-rose-300 bg-rose-50 shadow-[0_8px_18px_rgba(225,29,72,0.1)]" : "border-amber-200 bg-white/85"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" onClick={() => void viewSaleCampaignProducts(campaign)} className="min-w-0 text-left">
                        <p className="truncate text-sm font-semibold text-slate-900">{campaign.name}</p>
                        <p className="mt-1 text-xs font-medium text-slate-600">{campaign.discountPercent}% off <span className="px-1 text-orange-300">|</span> {campaign.productIds.length} products</p>
                        <span className="mt-2 inline-block text-xs font-semibold text-orange-700 hover:text-orange-800">View products</span>
                      </button>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${campaign.campaignStatus === "active" ? "bg-rose-600 text-white" : "bg-amber-100 text-amber-800"}`}>{campaign.campaignStatus === "active" ? "Live now" : "Up next"}</span>
                    </div>
                    <div className={`mt-3 h-1.5 overflow-hidden rounded-full ${campaign.campaignStatus === "active" ? "bg-rose-100" : "bg-amber-100"}`}>
                      <div className={`h-full rounded-full ${campaign.campaignStatus === "active" ? "w-2/3 bg-rose-500" : "w-1/4 bg-amber-400"}`} />
                    </div>
                    <p className="mt-2 text-[11px] leading-4 text-slate-500">{formatDateTime(campaign.startAt)} - {formatDateTime(campaign.endAt)}</p>
                    {campaign.campaignStatus === "scheduled" ? <button type="button" onClick={() => void cancelSaleCampaign(campaign)} disabled={cancellingSaleId === campaign.id} className="mt-2 text-xs font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-50">{cancellingSaleId === campaign.id ? "Cancelling..." : "Cancel schedule"}</button> : null}
                  </article>
                ))}
              </div>
            </section>
          </>}
        </form>
        )}
      </section>
      <style jsx>{`
        @media (max-width: 1279px) {
          .product-manager-panel {
            height: auto !important;
            min-height: 0 !important;
          }
        }
      `}</style>
    </div>
  );
}
