# Storefront Mock

Storefront mock tách biệt khỏi dự án chính, dùng mock data để thử nghiệm landing page, giỏ hàng, checkout và mock payment result.

## Chạy local

```bash
cd storefront-mock
npm install
npm run dev
```

App chạy tại `http://localhost:4174`.

## Ghi chú

- Không dùng dữ liệu từ dự án hiện tại.
- Dùng mock data tách file trong `src/data`.
- Luồng thanh toán là mock flow, nhưng giao diện và state được tổ chức sẵn để tích hợp VNPAY sandbox sau này.
