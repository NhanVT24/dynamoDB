import { listAllShoppingItems, updateShoppingItem } from "../modules/shopping/shopping.repository.js";

const DEFAULT_IMAGE_URL = "https://placehold.co/1200x1200/png?text=Store+Item";
const categoryImageUrls: Record<string, string> = {
  "Thoi trang": "https://placehold.co/1200x1200/png?text=Fashion+Item",
  "Dien tu": "https://placehold.co/1200x1200/png?text=Tech+Item",
  "Gia dung": "https://placehold.co/1200x1200/png?text=Home+Item",
  "Me va be": "https://placehold.co/1200x1200/png?text=Baby+Item",
  "Lam dep": "https://placehold.co/1200x1200/png?text=Beauty+Item",
  "Bach hoa": "https://placehold.co/1200x1200/png?text=Grocery+Item"
};

type Options = {
  imageUrl: string;
  dryRun: boolean;
  pageLimit: number;
  maxPages: number;
  byCategory: boolean;
};

function parseOptions(argv: string[]): Options {
  const imageUrlArg = argv.find((arg) => arg.startsWith("--image-url="));
  const pageLimitArg = argv.find((arg) => arg.startsWith("--page-limit="));
  const maxPagesArg = argv.find((arg) => arg.startsWith("--max-pages="));

  return {
    imageUrl: String(imageUrlArg?.split("=").slice(1).join("=") || DEFAULT_IMAGE_URL).trim(),
    dryRun: argv.includes("--dry-run"),
    pageLimit: Math.max(1, Math.trunc(Number(pageLimitArg?.split("=")[1] ?? 100))),
    maxPages: Math.max(1, Math.trunc(Number(maxPagesArg?.split("=")[1] ?? 100))),
    byCategory: argv.includes("--by-category")
  };
}

const options = parseOptions(process.argv.slice(2));

if (!options.imageUrl) {
  throw new Error("Missing image URL. Pass --image-url=https://...");
}

const { items, stoppedByMaxPages } = await listAllShoppingItems(options.pageLimit, options.maxPages);

console.log("[product-images] loaded", {
  count: items.length,
  stoppedByMaxPages,
  dryRun: options.dryRun,
  imageUrl: options.imageUrl,
  byCategory: options.byCategory
});

let updatedCount = 0;
let skippedCount = 0;

for (const item of items) {
  const nextImageUrl = options.byCategory
    ? categoryImageUrls[String(item.category ?? "").trim()] ?? DEFAULT_IMAGE_URL
    : options.imageUrl;

  if (String(item.imageUrl ?? "") === nextImageUrl) {
    skippedCount += 1;
    continue;
  }

  if (options.dryRun) {
    console.log("[product-images] would_update", {
      id: item.id,
      name: item.name,
      previousImageUrl: item.imageUrl ?? "",
      nextImageUrl
    });
    updatedCount += 1;
    continue;
  }

  await updateShoppingItem(item.id, {
    imageUrl: nextImageUrl
  }, Number(item.version ?? 0));
  updatedCount += 1;

  if (updatedCount % 25 === 0) {
    console.log("[product-images] progress", {
      updatedCount,
      remainingApprox: Math.max(0, items.length - updatedCount - skippedCount)
    });
  }
}

console.log("[product-images] done", {
  updatedCount,
  skippedCount,
  totalSeen: items.length,
  dryRun: options.dryRun,
  imageUrl: options.imageUrl,
  byCategory: options.byCategory
});
