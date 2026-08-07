import { Link } from "react-router-dom";
import { useTheme } from "../../stores/theme-store";

type PageHeroProps = {
  eyebrow: string;
  title: string;
  description: string;
  crumbs?: Array<{ label: string; to?: string }>;
};

export function PageHero({ eyebrow, title, description, crumbs = [] }: PageHeroProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <section className="mb-8">
      <div className="overflow-hidden rounded-[2rem] bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 p-[1px]">
        <div className={`rounded-[calc(2rem-1px)] px-6 py-8 sm:px-8 ${isDark ? "bg-[#101826]" : "bg-white"}`}>
          {crumbs.length > 0 ? (
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-orange-500">
              {crumbs.map((crumb, index) => (
                <span key={`${crumb.label}-${index}`} className="inline-flex items-center gap-2">
                  {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span>{crumb.label}</span>}
                  {index < crumbs.length - 1 ? <span className={isDark ? "text-slate-500" : "text-slate-300"}>/</span> : null}
                </span>
              ))}
            </div>
          ) : null}
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-orange-500">{eyebrow}</p>
          <h1 className={`mt-3 text-3xl font-bold tracking-tight sm:text-4xl ${isDark ? "text-white" : "text-slate-950"}`}>{title}</h1>
          <p className={`mt-4 max-w-3xl text-sm leading-7 sm:text-base ${isDark ? "text-slate-300" : "text-slate-600"}`}>{description}</p>
        </div>
      </div>
    </section>
  );
}
