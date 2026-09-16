"use client";

import { useEffect, useState } from "react";
import { authenticatedFetch, type ProductPermission } from "../../auth/lib/cognito-auth";

type ManagedUser = {
  subject: string;
  username: string;
  email: string;
  displayName: string;
  permissions: ProductPermission[];
};

const permissionOptions: Array<{ code: ProductPermission; label: string; description: string }> = [
  { code: "products:create", label: "Thêm sản phẩm", description: "Được tạo sản phẩm mới và trở thành owner của sản phẩm đó." },
  { code: "products:update-own", label: "Sửa sản phẩm của mình", description: "Chỉ sửa sản phẩm có ownerSub trùng với tài khoản." },
  { code: "products:delete-own", label: "Xóa sản phẩm của mình", description: "Chỉ xóa sản phẩm do chính tài khoản tạo." }
];

export default function UserPermissionManager() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState("");
  const [message, setMessage] = useState("");

  async function loadUsers() {
    setLoading(true);
    try {
      const response = await authenticatedFetch("/api/lambda-proxy/api/admin/authorizations/users", { cache: "no-store" });
      if (!response.ok) throw new Error("Không thể tải danh sách quyền người dùng.");
      setUsers(await response.json() as ManagedUser[]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể tải dữ liệu.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadUsers(); }, []);

  async function togglePermission(user: ManagedUser, permission: ProductPermission, enabled: boolean) {
    const operationKey = `${user.subject}:${permission}`;
    setUpdating(operationKey);
    setMessage("");
    try {
      const response = await authenticatedFetch(
        `/api/lambda-proxy/api/admin/authorizations/users/${encodeURIComponent(user.subject)}/permissions/${encodeURIComponent(permission)}`,
        { method: enabled ? "PUT" : "DELETE" }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message || "Không thể cập nhật quyền.");
      }
      const payload = await response.json() as { permissions: ProductPermission[] };
      setUsers((current) => current.map((item) => item.subject === user.subject
        ? { ...item, permissions: payload.permissions }
        : item));
      setMessage(`Đã cập nhật quyền cho ${user.email}. Access token mới sẽ nhận quyền sau lần refresh tiếp theo.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể cập nhật quyền.");
    } finally {
      setUpdating("");
    }
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">Authorization</p>
          <h2 className="mt-1 text-2xl font-bold text-slate-950">Phân quyền sản phẩm</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">Permission được lưu dạng String Set trong DynamoDB và được đưa vào access token khi Cognito phát token mới.</p>
        </div>
        <button type="button" onClick={() => void loadUsers()} disabled={loading} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Làm mới</button>
      </div>

      {message ? <p className="mt-4 rounded-xl bg-cyan-50 px-4 py-3 text-sm text-cyan-900">{message}</p> : null}
      {loading ? <p className="mt-6 text-sm text-slate-500">Đang tải tài khoản...</p> : null}

      <div className="mt-6 grid gap-4">
        {users.map((user) => (
          <article key={user.subject} className="rounded-2xl border border-slate-200 p-4">
            <div>
              <h3 className="font-bold text-slate-900">{user.displayName || user.email}</h3>
              <p className="text-sm text-slate-500">{user.email}</p>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {permissionOptions.map((option) => {
                const enabled = user.permissions.includes(option.code);
                const key = `${user.subject}:${option.code}`;
                return (
                  <label key={option.code} className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={Boolean(updating)}
                      onChange={(event) => void togglePermission(user, option.code, event.target.checked)}
                      className="mt-1 h-4 w-4"
                    />
                    <span>
                      <span className="block text-sm font-bold text-slate-900">{option.label}</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">{updating === key ? "Đang lưu..." : option.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

