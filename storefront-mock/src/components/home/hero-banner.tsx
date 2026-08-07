import { ArrowRight, BadgePercent, ShieldCheck, Truck } from "lucide-react";
import { Link } from "react-router-dom";
import { useTheme } from "../../stores/theme-store";

export function HeroBanner() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <section className="px-4 pb-8 pt-6 sm:px-6 lg:px-8 lg:pt-8">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="overflow-hidden rounded-[2rem] bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 p-[1px] shadow-[0_24px_80px_-40px_rgba(249,115,22,0.55)]">
          <div
            className={`relative h-full rounded-[calc(2rem-1px)] px-6 py-7 sm:px-8 sm:py-8 lg:px-10 lg:py-10 ${
              isDark ? "bg-[#101826]" : "bg-white"
            }`}
          >
            <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-orange-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-orange-600">
                  <BadgePercent size={14} />
                  Deal công nghệ hôm nay
                </div>
                <h1 className={`mt-5 text-4xl font-bold leading-tight tracking-tight sm:text-5xl ${isDark ? "text-white" : "text-slate-950"}`}>
                  Giao diện shop theo hướng
                  <span className="bg-gradient-to-r from-orange-500 to-pink-500 bg-clip-text text-transparent"> thương mại điện tử </span>
                  dễ mua, dễ quét và dễ test flow.
                </h1>
                <p className={`mt-5 max-w-2xl text-sm leading-7 sm:text-base ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                  Mình đã bỏ kiểu landing quá trừu tượng và chuyển sang bố cục gần Shopee, Lazada, Tiki hơn:
                  có banner campaign, khối deal, listing rõ ràng, giỏ hàng nhanh và hỗ trợ dark mode.
                </p>

                <div className="mt-7 flex flex-wrap gap-3">
                  <Link
                    to="/products"
                    className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110"
                  >
                    Mua ngay
                    <ArrowRight size={16} />
                  </Link>
                  <a
                    href="#featured"
                    className={`inline-flex items-center gap-2 rounded-full border px-5 py-3 text-sm font-semibold transition ${
                      isDark
                        ? "border-white/10 text-white hover:bg-white/10"
                        : "border-slate-200 text-slate-800 hover:bg-slate-50"
                    }`}
                  >
                    Xem deal nổi bật
                  </a>
                </div>

                <div className="mt-8 grid gap-4 sm:grid-cols-3">
                  {[
                    ["24+", "Sản phẩm mock"],
                    ["6", "Danh mục chính"],
                    ["3M+", "Mốc freeship demo"]
                  ].map(([value, label]) => (
                    <div
                      key={label}
                      className={`rounded-[1.5rem] border p-4 ${
                        isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <p className={`text-2xl font-bold ${isDark ? "text-white" : "text-slate-950"}`}>{value}</p>
                      <p className={`mt-1 text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>{label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4">
                <div className="rounded-[1.75rem] bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 p-6 text-white">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-100">Flash sale mock</p>
                  <h3 className="mt-4 text-2xl font-semibold">Giảm sâu cho nhóm điện tử và phụ kiện hot</h3>
                  <p className="mt-3 text-sm leading-6 text-orange-50">Dùng như khối campaign đầu trang, nhìn gần sàn TMĐT hơn và tạo điểm rơi thị giác tốt hơn.</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    { icon: <Truck size={18} />, title: "Giao nhanh", text: "Mô phỏng luồng giao nhanh nội thành." },
                    { icon: <ShieldCheck size={18} />, title: "Yên tâm mua", text: "Có thể nối tiếp chính sách bảo hành sau." }
                  ].map((item) => (
                    <div
                      key={item.title}
                      className={`rounded-[1.75rem] border p-5 ${
                        isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className={`inline-flex rounded-2xl p-3 ${isDark ? "bg-orange-500/15 text-orange-300" : "bg-orange-50 text-orange-600"}`}>
                        {item.icon}
                      </div>
                      <h4 className={`mt-4 text-lg font-semibold ${isDark ? "text-white" : "text-slate-950"}`}>{item.title}</h4>
                      <p className={`mt-2 text-sm leading-6 ${isDark ? "text-slate-300" : "text-slate-600"}`}>{item.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <PromoTile
            isDark={isDark}
            title="Bố cục mới"
            value="Banner sale + danh mục + listing dễ mua"
            description="Tập trung vào pattern quen thuộc của sàn TMĐT để test UI thực tế hơn."
          />
          <PromoTile
            isDark={isDark}
            title="Đã sửa"
            value="Lỗi contrast, lỗi hiển thị chữ và thêm dark mode"
            description="Mục tiêu là nhìn gọn, sáng rõ và usable hơn trên cả light lẫn dark."
          />
        </div>
      </div>
    </section>
  );
}

function PromoTile({
  isDark,
  title,
  value,
  description
}: {
  isDark: boolean;
  title: string;
  value: string;
  description: string;
}) {
  return (
    <div className={`rounded-[2rem] border p-6 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-orange-500">{title}</p>
      <h3 className={`mt-4 text-2xl font-semibold tracking-tight ${isDark ? "text-white" : "text-slate-950"}`}>{value}</h3>
      <p className={`mt-3 text-sm leading-7 ${isDark ? "text-slate-300" : "text-slate-600"}`}>{description}</p>
    </div>
  );
}
