"use client";
import { t } from "../src/i18n/language";
import { useLanguage } from "../src/i18n/LanguageProvider";

export default function NotFound() {
  useLanguage();
  return (
    <section className="emptyPage">
      <h1>{t("Not Found")}</h1>
    </section>
  );
}
