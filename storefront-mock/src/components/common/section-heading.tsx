import type { ReactNode } from "react";
import { useTheme } from "../../stores/theme-store";

type SectionHeadingProps = {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
};

export function SectionHeading({ eyebrow, title, description, action }: SectionHeadingProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-orange-500">{eyebrow}</p>
        <h2 className={`mt-3 text-3xl font-semibold tracking-tight sm:text-4xl ${isDark ? "text-white" : "text-slate-950"}`}>{title}</h2>
        <p className={`mt-4 text-sm leading-7 sm:text-base ${isDark ? "text-slate-300" : "text-slate-600"}`}>{description}</p>
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
