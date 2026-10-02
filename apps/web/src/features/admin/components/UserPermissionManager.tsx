"use client";
import { getIntlLocale, t, translateLabel } from "../../../i18n/language";

import { useLanguage } from "../../../i18n/LanguageProvider";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { apiUrl, authenticatedFetch, type ProductPermission } from "../../auth/lib/cognito-auth";

type AccountStatus = "ACTIVE" | "SUSPENDED" | "DISABLED" | "BLOCKED";

type UserAddress = {
  ward: string;
  city: string;
  province: string;
};

type ManagedUser = {
  subject: string;
  username: string;
  email: string;
  displayName: string;
  accountStatus: AccountStatus;
  lastLoginAt: string;
  addresses: UserAddress[];
  permissions: ProductPermission[];
};

type DialogState =
  | { type: "status"; user: ManagedUser }
  | { type: "permissions"; user: ManagedUser }
  | { type: "addresses"; user: ManagedUser }
  | null;

const permissionOptions: Array<{ code: ProductPermission; label: string; description: string }> = [
  { code: "products:create", label: "Create products", description: "Can create new products and become the owner of those products." },
  { code: "products:update-own", label: "Update own products", description: "Can update products created by this account." },
  { code: "products:delete-own", label: "Delete own products", description: "Can only delete products created by this account." }
];

const statusOptions: Array<{ value: AccountStatus; label: string; description: string }> = [
  { value: "ACTIVE", label: "Active", description: "User can sign in normally." },
  { value: "SUSPENDED", label: "Suspended", description: "Temporarily blocked from sign-in." },
  { value: "DISABLED", label: "Disabled", description: "Blocked until an admin reactivates the account." },
  { value: "BLOCKED", label: "Blocked", description: "Blocked for security or abuse reasons." }
];

function statusTone(status: AccountStatus) {
  if (status === "ACTIVE") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "SUSPENDED") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function formatLastLogin(value: string) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(getIntlLocale(), {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function addressLabel(address: UserAddress) {
  return [address.ward, address.city, address.province].filter(Boolean).join(", ");
}

function normalizeAddressDraft(addresses: UserAddress[]) {
  return addresses.map((address) => ({
    ward: address.ward.trim(),
    city: address.city.trim(),
    province: address.province.trim()
  })).filter((address) => address.ward || address.city || address.province);
}

export default function UserPermissionManager() {
  useLanguage();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState("");
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [statusDraft, setStatusDraft] = useState<AccountStatus>("ACTIVE");
  const [permissionDraft, setPermissionDraft] = useState<ProductPermission[]>([]);
  const [addressDraft, setAddressDraft] = useState<UserAddress[]>([]);

  async function loadUsers() {
    setLoading(true);
    setMessage("");
    setMessageIsError(false);
    try {
      const response = await authenticatedFetch(apiUrl("/api/admin/authorizations/users"), { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load user permissions.");
      const payload = await response.json() as ManagedUser[];
      setUsers(payload.map((user) => ({ ...user, addresses: Array.isArray(user.addresses) ? user.addresses : [] })));
    } catch (error) {
      setMessageIsError(true);
      setMessage(error instanceof Error ? error.message : "Could not load data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadUsers(); }, []);

  function openStatusDialog(user: ManagedUser) {
    setStatusDraft(user.accountStatus);
    setDialog({ type: "status", user });
  }

  function openPermissionsDialog(user: ManagedUser) {
    setPermissionDraft(user.permissions);
    setDialog({ type: "permissions", user });
  }

  function openAddressesDialog(user: ManagedUser) {
    setAddressDraft([user.addresses[0] ?? { ward: "", city: "", province: "" }]);
    setDialog({ type: "addresses", user });
  }

  function closeDialog() {
    if (updating) return;
    setDialog(null);
  }

  async function updateStatus(user: ManagedUser, status: AccountStatus) {
    setUpdating(`${user.subject}:status`);
    setMessage("");
    setMessageIsError(false);
    try {
      const response = await authenticatedFetch(
        apiUrl(`/api/admin/authorizations/users/${encodeURIComponent(user.subject)}/status`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status })
        }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message || "Could not update account status.");
      }
      const payload = await response.json() as { accountStatus: AccountStatus };
      setUsers((current) => current.map((item) => item.subject === user.subject ? { ...item, accountStatus: payload.accountStatus } : item));
      setMessage(`Updated account status for ${user.email} to ${payload.accountStatus}.`);
      setDialog(null);
    } catch (error) {
      setMessageIsError(true);
      setMessage(error instanceof Error ? error.message : "Could not update account status.");
    } finally {
      setUpdating("");
    }
  }

  async function requestPermissionChange(user: ManagedUser, permission: ProductPermission, enabled: boolean) {
    const response = await authenticatedFetch(
      apiUrl(`/api/admin/authorizations/users/${encodeURIComponent(user.subject)}/permissions/${encodeURIComponent(permission)}`),
      { method: enabled ? "PUT" : "DELETE" }
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(payload?.message || "Could not update permissions.");
    }
    return await response.json() as { permissions: ProductPermission[] };
  }

  async function updatePermissions(user: ManagedUser, permissions: ProductPermission[]) {
    const additions = permissions.filter((permission) => !user.permissions.includes(permission));
    const removals = user.permissions.filter((permission) => !permissions.includes(permission));
    if (additions.length === 0 && removals.length === 0) {
      setDialog(null);
      return;
    }
    setUpdating(`${user.subject}:permissions`);
    setMessage("");
    setMessageIsError(false);
    try {
      let latest = user.permissions;
      for (const permission of additions) latest = (await requestPermissionChange(user, permission, true)).permissions;
      for (const permission of removals) latest = (await requestPermissionChange(user, permission, false)).permissions;
      setUsers((current) => current.map((item) => item.subject === user.subject ? { ...item, permissions: latest } : item));
      setMessage(`Updated permissions for ${user.email}. The next refreshed access token will include the new permissions.`);
      setDialog(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Could not update permissions.";
      await loadUsers();
      setMessageIsError(true);
      setMessage(errorMessage);
    } finally {
      setUpdating("");
    }
  }

  async function updateAddresses(user: ManagedUser, addresses: UserAddress[]) {
    const normalized = normalizeAddressDraft(addresses).slice(0, 1);
    if (normalized.some((address) => !address.ward || !address.city || !address.province)) {
      setMessageIsError(true);
      setMessage("Location must include ward, city, and province.");
      return;
    }
    setUpdating(`${user.subject}:addresses`);
    setMessage("");
    setMessageIsError(false);
    try {
      const response = await authenticatedFetch(
        apiUrl(`/api/admin/authorizations/users/${encodeURIComponent(user.subject)}/addresses`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addresses: normalized })
        }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message || "Could not update addresses.");
      }
      const payload = await response.json() as { addresses: UserAddress[] };
      setUsers((current) => current.map((item) => item.subject === user.subject ? { ...item, addresses: payload.addresses } : item));
      setMessage(`Updated location information for ${user.email}.`);
      setDialog(null);
    } catch (error) {
      setMessageIsError(true);
      setMessage(error instanceof Error ? error.message : "Could not update addresses.");
    } finally {
      setUpdating("");
    }
  }

  function submitDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;
    if (dialog.type === "status") void updateStatus(dialog.user, statusDraft);
    if (dialog.type === "permissions") void updatePermissions(dialog.user, permissionDraft);
    if (dialog.type === "addresses") void updateAddresses(dialog.user, addressDraft);
  }

  function togglePermissionDraft(permission: ProductPermission, enabled: boolean) {
    setPermissionDraft((current) => enabled
      ? [...new Set([...current, permission])]
      : current.filter((item) => item !== permission));
  }

  function updateAddressDraft(index: number, field: keyof UserAddress, value: string) {
    setAddressDraft((current) => current.map((address, itemIndex) => itemIndex === index ? { ...address, [field]: value } : address));
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">{t("Authorization")}</p>
          <h2 className="mt-1 text-2xl font-bold text-slate-950">{t("User Access")}</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">{t("Review account status, product permissions, and saved location information before opening a focused change form.")}</p>
        </div>
        <button type="button" onClick={() => void loadUsers()} disabled={loading} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">{t("Refresh")}</button>
      </div>

      {message ? <p role={messageIsError ? "alert" : "status"} className={`mt-4 rounded-xl px-4 py-3 text-sm ${messageIsError ? "bg-rose-50 text-rose-900" : "bg-cyan-50 text-cyan-900"}`}>{translateLabel(message)}</p> : null}
      {loading ? <p className="mt-6 text-sm text-slate-500">{t("Loading accounts...")}</p> : null}

      <div className="mt-6 grid gap-4">
        {users.map((user) => (
          <article key={user.subject} className="rounded-lg border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="break-all font-bold text-slate-900">{user.displayName || user.email}</h3>
                <p className="break-all text-sm text-slate-500">{user.email}</p>
                <p className="mt-2 text-xs font-semibold text-slate-500">{t("Last login:")} <span className="text-slate-800">{formatLastLogin(user.lastLoginAt)}</span></p>
              </div>
              <span className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-bold ${statusTone(user.accountStatus)}`}>{translateLabel(user.accountStatus)}</span>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <section className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-bold text-slate-900">{t("Account")}</h4>
                  <button type="button" onClick={() => openStatusDialog(user)} disabled={Boolean(updating)} className="text-sm font-bold text-cyan-700 disabled:opacity-50">{t("Change")}</button>
                </div>
                <p className="mt-2 text-sm text-slate-600">{translateLabel(statusOptions.find((option) => option.value === user.accountStatus)?.description)}</p>
              </section>

              <section className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-bold text-slate-900">{t("Permissions")}</h4>
                  <button type="button" onClick={() => openPermissionsDialog(user)} disabled={Boolean(updating)} className="text-sm font-bold text-cyan-700 disabled:opacity-50">{t("Change")}</button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {user.permissions.length ? user.permissions.map((permission) => <span key={permission} className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-700">{permission}</span>) : <span className="text-sm text-slate-500">{t("No product permissions")}</span>}
                </div>
              </section>

              <section className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-bold text-slate-900">{t("Location")}</h4>
                  <button type="button" onClick={() => openAddressesDialog(user)} disabled={Boolean(updating)} className="text-sm font-bold text-cyan-700 disabled:opacity-50">{t("Change")}</button>
                </div>
                <div className="mt-2 space-y-1 text-sm text-slate-600">
                  {user.addresses.length ? user.addresses.map((address, index) => <p key={`${address.ward}:${address.city}:${address.province}:${index}`} className="break-words">{index + 1}. {addressLabel(address)}</p>) : <p>{t("No saved location")}</p>}
                </div>
              </section>
            </div>
          </article>
        ))}
      </div>

      {dialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <form onSubmit={submitDialog} className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">{t("Change")} {translateLabel(dialog.type)}</p>
                <h3 className="mt-1 break-all text-xl font-bold text-slate-950">{dialog.user.displayName || dialog.user.email}</h3>
                <p className="break-all text-sm text-slate-500">{dialog.user.email}</p>
              </div>
              <button type="button" onClick={closeDialog} disabled={Boolean(updating)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-50">{t("Close")}</button>
            </div>

            {dialog.type === "status" ? (
              <div className="mt-5 grid gap-3">
                {statusOptions.map((option) => (
                  <label key={option.value} className="flex gap-3 rounded-lg border border-slate-200 p-3">
                    <input type="radio" name="status" checked={statusDraft === option.value} onChange={() => setStatusDraft(option.value)} className="mt-1 h-4 w-4" />
                    <span>
                      <span className="block text-sm font-bold text-slate-900">{translateLabel(option.label)}</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">{translateLabel(option.description)}</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : null}

            {dialog.type === "permissions" ? (
              <div className="mt-5 grid gap-3">
                {permissionOptions.map((option) => {
                  const enabled = permissionDraft.includes(option.code);
                  return (
                    <label key={option.code} className="flex gap-3 rounded-lg border border-slate-200 p-3">
                      <input type="checkbox" checked={enabled} onChange={(event) => togglePermissionDraft(option.code, event.target.checked)} className="mt-1 h-4 w-4" />
                      <span>
                        <span className="block text-sm font-bold text-slate-900">{translateLabel(option.label)}</span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">{translateLabel(option.description)}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : null}

            {dialog.type === "addresses" ? (
              <div className="mt-5 grid gap-4">
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="mb-3 text-sm font-bold text-slate-900">{t("Location")}</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="grid gap-1 text-xs font-bold text-slate-700">{t("Ward")}<input value={addressDraft[0]?.ward ?? ""} onChange={(event) => updateAddressDraft(0, "ward", event.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-normal text-slate-900 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" /></label>
                    <label className="grid gap-1 text-xs font-bold text-slate-700">{t("City")}<input value={addressDraft[0]?.city ?? ""} onChange={(event) => updateAddressDraft(0, "city", event.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-normal text-slate-900 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" /></label>
                    <label className="grid gap-1 text-xs font-bold text-slate-700">{t("Province")}<input value={addressDraft[0]?.province ?? ""} onChange={(event) => updateAddressDraft(0, "province", event.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-normal text-slate-900 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" /></label>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4">
              <button type="button" onClick={closeDialog} disabled={Boolean(updating)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50">{t("Cancel")}</button>
              <button type="submit" disabled={Boolean(updating)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{updating ? t("Saving...") : t("Save change")}</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
