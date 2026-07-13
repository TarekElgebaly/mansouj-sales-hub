# Investigation Report: Event Sources for Auto Inventory Refresh

Read-only findings. No files edited.

## 1. Existing Shopify webhook receivers

Yes — two webhook routes already exist under `src/routes/api/public/shopify/webhooks/`:

- `orders-create.ts` → URL path `/api/public/shopify/webhooks/orders-create` (topic: `orders/create`)
- `orders-updated.ts` → URL path `/api/public/shopify/webhooks/orders-updated` (topic: `orders/updated`)

Both use the `/api/public/*` prefix (auth-bypass on published sites) and verify HMAC before processing.

**No handlers exist yet for:** `orders/cancelled`, `orders/fulfilled`, `fulfillments/create`, `fulfillments/update`, `refunds/create`, `inventory_levels/update`.

**No topic subscription/registration code found in the repo** — no Shopify Admin API `webhooks.json` POST calls, no config file listing topics. Subscriptions must currently be configured manually in the Shopify Partner/Admin UI (or via a script that isn't checked in). Only `SHOPIFY_WEBHOOK_SECRET` is referenced (in `shopify-webhook.server.ts:11`).

## 2. Do webhook routes call `processShopifyOrder()`?

Yes, both do. From `orders-create.ts`:

```ts
import { processShopifyOrder, verifyShopifyHmac, type ShopifyOrderPayload } from "@/lib/shopify-webhook.server";
...
const payload = JSON.parse(raw) as ShopifyOrderPayload;
const result = await processShopifyOrder(payload);
```

`orders-updated.ts` has the identical call site. Both are already the canonical entry point for order lifecycle events.

## 3. What is MESA?

MESA is **not** a first-class concept in this codebase — it appears exactly once, in a code comment at `src/lib/shopify-webhook.server.ts:716` (`// ... which used to overwrite MESA-repaired values.`).

The pattern the user calls "MESA" corresponds to the **External Order Intake** system: `POST /api/orders/external-order-intake` → `src/lib/order-intake.server.ts`. That endpoint accepts a `source` field (`order-intake.server.ts:21,83,95`) and is scoped to **customer/contact repair only** (address, phone, name — the "fill only if empty/unknown" precedence). It does **not** carry line items, fulfillment status, cancellation, or stock deltas.

**Conclusion:** MESA/external-order-intake is **not** a viable event source for inventory refresh. It fires on contact-data enrichment, not on order lifecycle. Use Shopify webhooks instead.

## 4. Do we store `shopify_variant_id` / `shopify_inventory_item_id` per line item?

- `order_items.shopify_variant_id` — **yes**, populated by `processShopifyOrder` (`shopify-webhook.server.ts:607`) and by the repair path (`repair-missing-order-line-items.server.ts`). Also referenced in `api/orders/items.ts:21`.
- `order_items.shopify_inventory_item_id` — **no**, not stored on `order_items`.
- Resolution path: `shopify_variant_id` → `shopify_variants` table (columns `shopify_variant_id`, `inventory_item_id`) → `inventory_item_id`. This exact lookup already exists in `shopify-webhook.server.ts:458-469` and in `repair-missing-order-line-items.server.ts` (`resolveRepairLineCosts`).

So per line item, we can cheaply derive the affected `inventory_item_id`s via one `shopify_variants` lookup.

## 5. Can `refresh-inventory-source-of-truth` do targeted refresh?

**No — it is currently full-scan only.** The `POST` handler (`refresh-inventory-source-of-truth.ts:249`) reads no request body/params and pulls **all** synced variants (`variants.map((variant) => variant.inventory_item_id)` at line 367). Its matching-priority chain (`shopify_inventory_item_id` → `shopify_variant_id` → `shopify_product_id`+variant → SKU fallback) is embedded in one long handler, not a reusable function.

**Options for the feature:**
- Refactor to accept an optional `{ variant_ids?: string[]; inventory_item_ids?: string[] }` body and short-circuit the initial variant/inventory query when provided (least code, reuses all matching logic).
- Or extract the matching core into a shared helper and add a new lightweight `refresh-inventory-for-variants.ts` endpoint that skips the sync-run bookkeeping.

The full pipeline `sync-products → sync-inventory-cost → refresh-source-of-truth` currently required by "Sync Inventory from Shopify" would **not** be needed for a targeted per-order refresh if we accept slightly stale product/cost data — only `sync-inventory-cost` (levels) + targeted `refresh` are strictly necessary to update on-hand/available/committed. This is a design decision to confirm in the spec.

## 6. Existing queue / batch / debounce infrastructure?

**No generic job/queue table exists.** The closest analog is the `order_intake_logs` "pending" pattern:

- `order_intake_logs` rows with `status = 'pending_not_found'` are re-scanned by `applyPendingIntake` in `src/lib/order-intake.server.ts:185-232` and re-applied when the underlying order finally arrives.
- Trigger point: `POST /api/orders/apply-pending-intake` (called from `orders.tsx` after Sync Recent Orders — see `orders.tsx:43,85,328`).

There is **no cron, no pg_cron reference, no scheduled function, no debounce util** anywhere in `src/`. A new "collect affected inventory_item_ids → dedupe → flush" queue would be entirely new infrastructure. The `order_intake_logs` model (dedicated log table + retry-on-trigger endpoint) is the closest pattern to mirror.

Options if you want to avoid a new table:
- Fire-and-forget: each webhook resolves affected `inventory_item_id`s inline and calls the targeted refresh synchronously before returning 200. Simple, but pays Shopify API latency per webhook.
- New `inventory_refresh_queue` table (columns: `inventory_item_id`, `enqueued_at`, `processed_at`) + a flush endpoint invoked by pg_cron on `project--{id}.lovable.app/api/public/...` (pattern documented in `public-api-endpoints`).

## 7. Webhook security pattern

Reusable and already correct. From `shopify-webhook.server.ts:10-22`:

```ts
export function verifyShopifyHmac(rawBody: string, hmacHeader: string | null): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret || !hmacHeader) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}
```

Uses `SHOPIFY_WEBHOOK_SECRET` (already in Lovable Secrets), timing-safe compare, raw-body HMAC-SHA256 base64 — the Shopify-canonical scheme. Reuse verbatim for any new webhook endpoint (`orders/cancelled`, `fulfillments/*`, `refunds/create`, `inventory_levels/update`).

---

## Summary / Recommendation Preview (not a decision — for your spec)

- **Best event source:** extend the existing Shopify webhook receivers. Add `orders-cancelled.ts`, `fulfillments-create.ts`, `fulfillments-update.ts`, `refunds-create.ts` (all under `src/routes/api/public/shopify/webhooks/`), each reusing `verifyShopifyHmac`. `processShopifyOrder` already handles the order-side upsert; the new work is the inventory side.
- **MESA (external-order-intake) is unsuitable** — contact-data only.
- **Targeted refresh** needs either a body param added to `refresh-inventory-source-of-truth.ts` or a new sibling endpoint that reuses the matching helper.
- **Batching** does not exist; simplest path is inline synchronous targeted refresh from each webhook. Add a queue table only if webhook latency or Shopify rate limits become an issue.
- **Per-line-item resolution** is already possible via `order_items.shopify_variant_id` → `shopify_variants.inventory_item_id`; no schema change needed for the naive path.

Ready to draft the implementation spec whenever you are.
