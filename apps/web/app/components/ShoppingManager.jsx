"use client";

import { useEffect, useMemo, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const pageSize = 5;
const emptyForm = {
  name: "",
  category: "Thực phẩm",
  quantity: 1,
  unitPrice: 0,
  priceLabel: "",
  purchased: false
};

const commandNotes = [
  ["Thêm", "POST /api/shopping-items", "PutCommand"],
  ["Đọc một dòng", "GET /api/shopping-items/:id", "GetCommand"],
  ["Tải theo trang", "GET /api/shopping-items?page=2&limit=5", "ScanCommand + cursor nội bộ"],
  ["Tăng/giảm", "PATCH /api/shopping-items/:id/increment", "UpdateCommand ADD-like expression"],
  ["Sửa", "PATCH /api/shopping-items/:id", "UpdateCommand"],
  ["Xóa", "DELETE /api/shopping-items/:id", "DeleteCommand"]
];

function currency(value) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function defaultPriceLabel(unitPrice) {
  return `${currency(unitPrice)} / món`;
}

export default function ShoppingManager() {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [hasNextPage, setHasNextPage] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [editingVersion, setEditingVersion] = useState(0);
  const [status, setStatus] = useState("Đang tải dữ liệu...");
  const [busy, setBusy] = useState(false);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0),
    [items]
  );
  const purchasedCount = items.filter((item) => item.purchased).length;

  async function loadItems(targetPage = page) {
    setBusy(true);
    try {
      const normalizedPage = Math.max(1, Number(targetPage) || 1);
      const params = new URLSearchParams({
        limit: String(pageSize),
        page: String(normalizedPage)
      });

      const response = await fetch(`${apiUrl}/api/shopping-items?${params.toString()}`);
      if (!response.ok) throw new Error("Không tải được danh sách");

      const data = await response.json();
      setItems(data.items ?? []);
      setPage(data.page ?? normalizedPage);
      setPageInput(String(data.page ?? normalizedPage));
      setHasNextPage(Boolean(data.hasNextPage));
      setStatus(`Đã tải trang ${data.page ?? normalizedPage} bằng ScanCommand + cursor nội bộ.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadItems();
  }, []);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditingVersion(item.version);
    setForm({
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      priceLabel: item.priceLabel ?? defaultPriceLabel(item.unitPrice),
      purchased: item.purchased
    });
    setStatus(`Đang sửa "${item.name}" bằng UpdateCommand.`);
  }

  async function readItem(item) {
    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/shopping-items/${item.id}`);
      if (!response.ok) throw new Error("Đọc mặt hàng thất bại");
      const freshItem = await response.json();
      setStatus(`Đã đọc "${freshItem.name}" bằng GetCommand. PK=${freshItem.PK}, SK=${freshItem.SK}.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function incrementQuantity(item, incrementBy) {
    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/shopping-items/${item.id}/increment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "quantity", incrementBy })
      });
      if (!response.ok) throw new Error(incrementBy > 0 ? "Tăng số lượng thất bại" : "Giảm số lượng thất bại");
      const updated = await response.json();
      setItems((current) => current.map((row) => row.id === updated.id ? updated : row));
      setStatus(`${incrementBy > 0 ? "Tăng" : "Giảm"} số lượng "${updated.name}" bằng incrementItemValue.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  function resetForm() {
    setEditingId("");
    setEditingVersion(0);
    setForm(emptyForm);
  }

  async function submitForm(event) {
    event.preventDefault();
    setBusy(true);
    const unitPrice = Number(form.unitPrice);
    const payload = {
      ...form,
      quantity: Number(form.quantity),
      unitPrice,
      priceLabel: form.priceLabel.trim() || defaultPriceLabel(unitPrice),
      purchased: Boolean(form.purchased)
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
      if (!response.ok) throw new Error(editingId ? "Sửa thất bại" : "Thêm thất bại");
      setStatus(editingId ? "Đã sửa mặt hàng bằng UpdateCommand." : "Đã thêm mặt hàng bằng PutCommand.");
      resetForm();
      await loadItems(1);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function togglePurchased(item) {
    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/shopping-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchased: !item.purchased, version: item.version })
      });
      if (!response.ok) throw new Error("Cập nhật trạng thái thất bại");
      setStatus("Đã cập nhật trạng thái bằng UpdateCommand.");
      await loadItems(page);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(item) {
    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/shopping-items/${item.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Xóa thất bại");
      setStatus(`Đã xóa "${item.name}" bằng DeleteCommand.`);
      if (editingId === item.id) resetForm();
      await loadItems(1);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="hero">
        <p className="eyebrow">DYNAMODB SUPERMARKET LAB</p>
        <h1>Quản lý mua sắm siêu thị</h1>
        <p>
          Danh sách được tải theo số trang. Nút tăng/giảm số lượng dùng hàm incrementItemValue
          để cập nhật quantity trực tiếp bằng UpdateCommand.
        </p>
      </section>

      <section className="metrics">
        <div><strong>{items.length}</strong><span>đang hiển thị</span></div>
        <div><strong>{purchasedCount}</strong><span>đã mua trong trang</span></div>
        <div><strong>{currency(total)}</strong><span>tạm tính phần đã tải</span></div>
      </section>

      <section className="workbench">
        <form className="editor" onSubmit={submitForm}>
          <div className="panelTitle compact">
            <h2>{editingId ? "Sửa mặt hàng" : "Thêm mặt hàng"}</h2>
            <span>{editingId ? "UpdateCommand" : "PutCommand"}</span>
          </div>
          <label>
            Tên hàng
            <input value={form.name} onChange={(event) => updateField("name", event.target.value)} required />
          </label>
          <label>
            Nhóm hàng
            <select value={form.category} onChange={(event) => updateField("category", event.target.value)}>
              <option>Thực phẩm</option>
              <option>Đồ gia dụng</option>
              <option>Chăm sóc cá nhân</option>
              <option>Đồ uống</option>
              <option>Khác</option>
            </select>
          </label>
          <div className="formGrid">
            <label>
              Số lượng
              <input type="number" min="1" value={form.quantity} onChange={(event) => updateField("quantity", event.target.value)} required />
            </label>
            <label>
              Đơn giá số
              <input type="number" min="0" value={form.unitPrice} onChange={(event) => updateField("unitPrice", event.target.value)} required />
            </label>
          </div>
          <label>
            Đơn giá hiển thị
            <input placeholder="Ví dụ: 185.000đ / túi" value={form.priceLabel} onChange={(event) => updateField("priceLabel", event.target.value)} />
          </label>
          <label className="checkLine">
            <input type="checkbox" checked={form.purchased} onChange={(event) => updateField("purchased", event.target.checked)} />
            Đã mua
          </label>
          <div className="actions">
            <button disabled={busy} type="submit">{editingId ? "Lưu sửa" : "Thêm vào giỏ"}</button>
            {editingId ? <button disabled={busy} type="button" className="secondary" onClick={resetForm}>Hủy</button> : null}
          </div>
        </form>

        <section className="panel listPanel">
          <div className="panelTitle">
            <h2>Danh sách mua sắm</h2>
            <span>{status}</span>
          </div>
          {items.length === 0 ? (
            <div className="empty">Chưa có mặt hàng nào. Hãy thêm món đầu tiên.</div>
          ) : (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Trạng thái</th>
                    <th>Mặt hàng</th>
                    <th>Nhóm</th>
                    <th>Số lượng</th>
                    <th>Đơn giá chuỗi</th>
                    <th>Thành tiền</th>
                    <th>Version</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <button className={item.purchased ? "pill done" : "pill"} onClick={() => togglePurchased(item)} disabled={busy}>
                          {item.purchased ? "Đã mua" : "Cần mua"}
                        </button>
                      </td>
                      <td className="productName">{item.name}</td>
                      <td>{item.category}</td>
                      <td>
                        <div className="quantityControl">
                          <button type="button" className="iconButton" onClick={() => incrementQuantity(item, -1)} disabled={busy || item.quantity <= 1}>-</button>
                          <strong>{item.quantity}</strong>
                          <button type="button" className="iconButton" onClick={() => incrementQuantity(item, 1)} disabled={busy}>+</button>
                        </div>
                      </td>
                      <td>{item.priceLabel ?? defaultPriceLabel(item.unitPrice)}</td>
                      <td className="price">{currency(item.quantity * item.unitPrice)}</td>
                      <td>v{item.version}</td>
                      <td className="rowActions">
                        <button className="secondary" onClick={() => readItem(item)} disabled={busy}>Đọc</button>
                        <button className="secondary" onClick={() => startEdit(item)} disabled={busy}>Sửa</button>
                        <button className="danger" onClick={() => removeItem(item)} disabled={busy}>Xóa</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="pager">
            <button type="button" className="secondary" onClick={() => loadItems(1)} disabled={busy || page === 1}>Trang đầu</button>
            <button type="button" className="secondary" onClick={() => loadItems(page - 1)} disabled={busy || page === 1}>Trước</button>
            <form className="pageJump" onSubmit={(event) => { event.preventDefault(); loadItems(pageInput); }}>
              <span>Trang</span>
              <input value={pageInput} onChange={(event) => setPageInput(event.target.value)} type="number" min="1" />
              <button type="submit" disabled={busy}>Đi tới</button>
            </form>
            <button type="button" onClick={() => loadItems(page + 1)} disabled={busy || !hasNextPage}>
              {hasNextPage ? "Sau" : "Hết trang"}
            </button>
          </div>
        </section>
      </section>

      <section className="roadmap">
        <h2>Các câu lệnh DynamoDB đang dùng</h2>
        <div className="commands">
          {commandNotes.map(([label, endpoint, command]) => (
            <div key={`${label}-${command}`} className="commandRow">
              <strong>{label}</strong>
              <code>{endpoint}</code>
              <span>{command}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
