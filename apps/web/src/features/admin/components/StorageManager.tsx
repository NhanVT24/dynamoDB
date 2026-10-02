"use client";
import { getIntlLocale, t, translateLabel } from "../../../i18n/language";

import { useLanguage } from "../../../i18n/LanguageProvider";

import type { ChangeEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { apiUrl, authenticatedFetch } from "../../auth/lib/cognito-auth";

type PublicAvatarItem = {
  key: string;
  fileName: string;
  fileUrl: string;
  size: number;
  updatedAt: string;
};

type PrivateReportItem = {
  key: string;
  fileName: string;
  size: number;
  updatedAt: string;
};

type PresignedUploadResponse = {
  uploadUrl: string;
  fileUrl?: string;
  key: string;
  message?: string;
};

type PresignedDownloadResponse = {
  downloadUrl: string;
  message?: string;
};

const defaultAvatarEndpoint = apiUrl("/api/uploads/default-avatars");
const defaultAvatarPresignEndpoint = apiUrl("/api/uploads/default-avatars/presign");
const reportEndpoint = apiUrl("/api/uploads/reports");
const reportPresignEndpoint = apiUrl("/api/uploads/reports/presign");
const reportOpenEndpoint = apiUrl("/api/uploads/reports/open");

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat(getIntlLocale(), {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

export default function StorageManager() {
  useLanguage();
  const [avatars, setAvatars] = useState<PublicAvatarItem[]>([]);
  const [reports, setReports] = useState<PrivateReportItem[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isUploadingReport, setIsUploadingReport] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const reportInputRef = useRef<HTMLInputElement>(null);

  async function loadStorageItems() {
    setError("");
    const [avatarResponse, reportResponse] = await Promise.all([
      fetch(defaultAvatarEndpoint),
      authenticatedFetch(reportEndpoint)
    ]);

    const avatarPayload = await avatarResponse.json().catch(() => null) as { items?: PublicAvatarItem[]; message?: string } | null;
    const reportPayload = await reportResponse.json().catch(() => null) as { items?: PrivateReportItem[]; message?: string } | null;

    if (!avatarResponse.ok) throw new Error(avatarPayload?.message || "Could not load default avatars.");
    if (!reportResponse.ok) throw new Error(reportPayload?.message || "Could not load private reports.");

    setAvatars(avatarPayload?.items ?? []);
    setReports(reportPayload?.items ?? []);
  }

  useEffect(() => {
    void loadStorageItems().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Could not load storage.");
    });
  }, []);

  async function uploadWithPresignedUrl(file: File, presignEndpoint: string, body: Record<string, unknown>) {
    const presignResponse = await authenticatedFetch(presignEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const presign = await presignResponse.json().catch(() => null) as PresignedUploadResponse | null;
    if (!presignResponse.ok || !presign?.uploadUrl) {
      throw new Error(presign?.message || "Could not prepare the upload.");
    }

    const uploadResponse = await fetch(presign.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file
    });
    if (!uploadResponse.ok) throw new Error("File upload failed.");
    return presign;
  }

  async function handleAvatarFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      setError("Default avatars must be JPG, PNG, WebP, or GIF files.");
      return;
    }

    setIsUploadingAvatar(true);
    setError("");
    setMessage("");
    try {
      await uploadWithPresignedUrl(file, defaultAvatarPresignEndpoint, {
        fileName: file.name,
        contentType: file.type
      });
      setMessage("Default avatar uploaded successfully.");
      await loadStorageItems();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Avatar upload failed.");
    } finally {
      setIsUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }

  async function handleReportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const allowedReportTypes = new Set([
      "application/pdf",
      "text/csv",
      "text/plain",
      "application/json",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ]);
    if (!allowedReportTypes.has(file.type)) {
      setError("Reports must be PDF, CSV, TXT, JSON, XLS, or XLSX files.");
      return;
    }

    setIsUploadingReport(true);
    setError("");
    setMessage("");
    try {
      await uploadWithPresignedUrl(file, reportPresignEndpoint, {
        fileName: file.name,
        contentType: file.type
      });
      setMessage("Private report uploaded successfully.");
      await loadStorageItems();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Report upload failed.");
    } finally {
      setIsUploadingReport(false);
      if (reportInputRef.current) reportInputRef.current.value = "";
    }
  }

  async function openPrivateReport(report: PrivateReportItem) {
    setError("");
    const response = await authenticatedFetch(reportOpenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: report.key })
    });
    const payload = await response.json().catch(() => null) as PresignedDownloadResponse | null;
    if (!response.ok || !payload?.downloadUrl) {
      setError(payload?.message || "Could not create the report download link.");
      return;
    }

    window.open(payload.downloadUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="grid gap-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-950">{t("Storage")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("Manage default avatars and private reports.")}</p>
          </div>
          <button type="button" onClick={() => void loadStorageItems()} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">{t("Refresh")}</button>
        </div>
        {message ? <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{translateLabel(message)}</p> : null}
        {error ? <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{translateLabel(error)}</p> : null}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-950">{t("Default Avatars")}</h3>
              <p className="mt-1 text-sm text-slate-500">{t("Customers can choose these avatars for their profiles.")}</p>
            </div>
            <button type="button" disabled={isUploadingAvatar} onClick={() => avatarInputRef.current?.click()} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {isUploadingAvatar ? t("Uploading...") : t("Add Avatar")}
            </button>
            <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(event) => void handleAvatarFile(event)} />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {avatars.map((avatar) => (
              <div key={avatar.key} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                <div className="aspect-square bg-white">
                  <img src={avatar.fileUrl} alt={avatar.fileName} className="h-full w-full object-cover" />
                </div>
                <div className="grid gap-1 p-3">
                  <p className="truncate text-xs font-semibold text-slate-700">{avatar.fileName}</p>
                  <p className="text-[11px] text-slate-500">{formatBytes(avatar.size)}</p>
                </div>
              </div>
            ))}
            {avatars.length === 0 ? <p className="col-span-full rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{t("No default avatars yet.")}</p> : null}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-950">{t("Private Reports")}</h3>
              <p className="mt-1 text-sm text-slate-500">{t("Private reports are available to administrators only.")}</p>
            </div>
            <button type="button" disabled={isUploadingReport} onClick={() => reportInputRef.current?.click()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {isUploadingReport ? t("Uploading...") : t("Upload Report")}
            </button>
            <input ref={reportInputRef} type="file" accept=".pdf,.csv,.txt,.json,.xls,.xlsx" className="hidden" onChange={(event) => void handleReportFile(event)} />
          </div>

          <div className="mt-5 grid gap-3">
            {reports.map((report) => (
              <div key={report.key} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{report.fileName}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatBytes(report.size)}{report.updatedAt ? ` · ${formatDate(report.updatedAt)}` : ""}</p>
                </div>
                <button type="button" onClick={() => void openPrivateReport(report)} className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">{t("Open")}</button>
              </div>
            ))}
            {reports.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{t("No private reports yet.")}</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
