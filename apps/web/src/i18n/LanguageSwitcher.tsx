"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { setLanguage, t, type Language } from "./language";
import { useLanguage } from "./LanguageProvider";

const options: ReadonlyArray<{ value: Language; label: string }> = [
  { value: "en", label: "English" },
  { value: "vi", label: "Tiếng Việt" }
];

function CountryFlag({ language }: { language: Language }) {
  return (
    <svg viewBox="0 0 30 20" aria-hidden="true" className="h-auto w-4 shrink-0 overflow-hidden rounded-[3px] ring-1 ring-black/10 sm:w-5">
      {language === "vi" ? <>
        <path fill="#da251d" d="M0 0h30v20H0z" />
        <path fill="#ffde00" d="m15 4 1.4 4.3H21l-3.7 2.7 1.4 4.3-3.7-2.7-3.7 2.7 1.4-4.3L9 8.3h4.6z" />
      </> : <>
        <path fill="#fff" d="M0 0h30v20H0z" />
        {Array.from({ length: 7 }, (_, index) => <rect key={index} fill="#b22234" y={index * 40 / 13} width="30" height={20 / 13} />)}
        <path fill="#3c3b6e" d="M0 0h12v10.77H0z" />
        {Array.from({ length: 9 }, (_, row) => Array.from({ length: row % 2 === 0 ? 6 : 5 }, (_, column) => (
          <path key={`${row}-${column}`} fill="#fff" d="m0-.55.13.38h.4L.2.07l.13.38L0 .22l-.33.23.13-.38-.33-.24h.4z"
            transform={`translate(${1 + column * 2 + row % 2},${1 + row * 1.1})`} />
        )))}
      </>}
    </svg>
  );
}

export function LanguageSwitcher({ isDark = false }: { isDark?: boolean }) {
  const language = useLanguage();
  const id = useId();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = options.find((option) => option.value === language)!;

  useEffect(() => {
    if (!isOpen) return;
    optionRefs.current[options.findIndex((option) => option.value === language)]?.focus();
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setIsOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [isOpen, language]);

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    }
    const current = optionRefs.current.findIndex((option) => option === document.activeElement);
    const target = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
      : event.key === "ArrowDown" ? (current + 1) % options.length
        : event.key === "ArrowUp" ? (current - 1 + options.length) % options.length : null;
    if (target !== null) {
      event.preventDefault();
      optionRefs.current[target]?.focus();
    }
  }

  return (
    <div ref={containerRef} className="relative min-w-0 shrink-0"
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false); }}>
      <span id={`${id}-label`} className="sr-only">{t("Language")}</span>
      <button ref={triggerRef} type="button" aria-labelledby={`${id}-label ${id}-selection`}
        aria-haspopup="menu" aria-expanded={isOpen} aria-controls={`${id}-menu`}
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setIsOpen(true); }
        }}
        className={`flex h-10 w-10 items-center justify-center rounded-xl border outline-none transition focus-visible:ring-2 focus-visible:ring-orange-500 [&>svg]:w-5 ${isDark ? "border-white/15 bg-slate-900 text-slate-100 hover:bg-slate-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
        <CountryFlag language={language} />
        <span id={`${id}-selection`} className="sr-only">{selected.label}</span>
      </button>
      {isOpen ? <div id={`${id}-menu`} role="menu" aria-labelledby={`${id}-label`} onKeyDown={handleMenuKeyDown}
        className={`absolute left-0 top-full z-50 mt-2 min-w-40 rounded-xl border p-1.5 shadow-lg sm:left-auto sm:right-0 ${isDark ? "border-white/15 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-700"}`}>
        {options.map((option, index) => <button key={option.value} ref={(element) => { optionRefs.current[index] = element; }}
          type="button" role="menuitemradio" aria-checked={language === option.value} tabIndex={-1}
          onClick={() => { setLanguage(option.value); setIsOpen(false); triggerRef.current?.focus(); }}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${language === option.value ? isDark ? "bg-orange-500/15 text-orange-200" : "bg-orange-50 text-orange-700" : isDark ? "hover:bg-slate-800" : "hover:bg-slate-50"}`}>
          <CountryFlag language={option.value} />
          <span className="flex-1">{option.label}</span>
          {language === option.value ? <span aria-hidden="true">✓</span> : null}
        </button>)}
      </div> : null}
    </div>
  );
}
