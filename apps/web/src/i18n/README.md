UI language defaults to English. The Store and Admin headers offer English and Vietnamese. Selection is stored under `novax-language`, synchronized across tabs, and applied to the HTML `lang` attribute. If storage is unavailable, selection still works for the current session. Static export and the initial hydration snapshot use English.

Add English copy as a key in `messages.ts`, with its Vietnamese translation as the value. In a client component, call `useLanguage()` to subscribe to changes and render `t("Save changes")`. Use named placeholders for dynamic values: `t("Editing \"{value1}\"", { value1: product.name })`. Both languages must contain the same placeholders.

Use `translateLabel()` for known UI labels, API status codes and stored messages that need to change language after they were created. Its aliases keep backend category/filter values unchanged; unknown messages remain intact. `source-aliases.ts` normalizes legacy Vietnamese messages and configuration failures into English UI copy.

Render user-entered content, product names/descriptions, identifiers and audit before/after values directly. Localize their surrounding labels only. Use `getIntlLocale()` for numbers and dates; currency stays VND. VNPay checkout maps the selected language to its existing `en`/`vn` locale values.

Run `npm run test:i18n --workspace @supermarket/web` for catalog, interpolation, persistence and audit-value checks. Run the web production build to validate the static export.
