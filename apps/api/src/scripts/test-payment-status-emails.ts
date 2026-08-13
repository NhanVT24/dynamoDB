import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { sendOrderConfirmationEmail, sendPaymentFailureEmail } from "../integrations/ses/order-mailer.js";

async function main() {
  const readline = createInterface({ input, output });

  try {
    const toEmail = (await readline.question("Nhap email nhan mail test: ")).trim();
    if (!toEmail) {
      throw new Error("Ban chua nhap email nhan.");
    }

    const now = new Date();
    const successOrderId = `TEST-SUCCESS-${now.getTime()}`;
    const failedTxnRef = `TEST-FAILED-${now.getTime() + 1}`;

    console.log("Dang gui mail 1/2: giao dich thanh cong...");
    await sendOrderConfirmationEmail({
      toEmail,
      orderId: successOrderId,
      totalAmount: 1036500,
      createdAt: now.toISOString(),
      items: [
        {
          productName: "Dong ho thong minh NovaX Fit",
          quantity: 1,
          lineTotal: 799000
        },
        {
          productName: "Day sac nhanh USB-C 65W",
          quantity: 1,
          lineTotal: 237500
        }
      ]
    });

    console.log("Dang gui mail 2/2: giao dich that bai...");
    await sendPaymentFailureEmail({
      toEmail,
      txnRef: failedTxnRef,
      totalAmount: 348500,
      orderInfo: "Thanh toan 1 san pham tai NovaX Market",
      failureReason: "Phien thanh toan da het han sau 5 phut.",
      responseCode: "TIMEOUT",
      bankCode: "VNPAY",
      payDate: now.toISOString()
    });

    console.log(`Da gui xong 2 mail test toi ${toEmail}.`);
    console.log(`- Mail thanh cong: orderId=${successOrderId}`);
    console.log(`- Mail that bai: txnRef=${failedTxnRef}`);
  } finally {
    readline.close();
  }
}

void main().catch((error) => {
  console.error("Gui mail test that bai.", error);
  process.exitCode = 1;
});
