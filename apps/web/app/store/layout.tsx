"use client";
import { t } from "../../src/i18n/language";
import { useLanguage } from "../../src/i18n/LanguageProvider";

import { Suspense, type ReactNode } from "react";
import { StorefrontProvider, StorefrontShell } from "./store-client";

export default function StoreLayout({ children }: { children: ReactNode }) {
  useLanguage();
  return (
    <StorefrontProvider>
      <Suspense fallback={<p role="status" className="p-6">{t("Loading store...")}</p>}>
        <StorefrontShell>{children}</StorefrontShell>
      </Suspense>
    </StorefrontProvider>
  );
}
