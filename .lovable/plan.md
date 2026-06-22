
# Shopify Sync — Audit & Plan (no code changes yet)

## PART 1 — Audit of what exists today

### Files involved
- `src/routes/_authenticated/shopify.tsx` — admin UI: shows last sync state + one "Sync orders now" button.
- `src/routes/api/shopify/sync-orders.ts` — auth-gated REST pull of `/admin/api/{version}/orders.json?status=any&limit=N`.
- `src/routes/api/shopify/sync-status.ts` — stub, returns `{status:"idle"}`. Unused.
- `src/routes/api/public/shopify/webhooks/orders-create.ts` — HMAC-verified, calls `processShopifyOrder`.
- `src/routes/api/public/shopify/webhooks/orders-updated.ts` — same, no log row.
- `src/lib/shopify-webhook.server.ts` — `verifyShopifyHmac` + `processShopifyOrder` (orders + line items + customer upsert).

### DB tables touched
- `orders` (has `shopify_order_id` UNIQUE, `shopify_created_at`, generated `profit` / `net_profit`)
- `order_items` (deleted + re-inserted per sync; `unit_cost` hardcoded to 0)
- `customers` (deduped by phone)
- `shopify_sync_settings` (single row id=1: store_url, last_sync_at, status, counts, last_error)
- `migration_logs` (per-sync summary + webhook log for orders/create only)
- `inventory` (NOT touched by Shopify code at all)

### How sync works today
- REST Admin API, version from `SHOPIFY_API_VERSION` env or `"2025-07"` default.
- Single endpoint: `GET /orders.json?status=any&limit=≤250`. No cursor / pagination, no `updated_at_min` unless caller passes `since`.
- Trigger: manual button → POST `/api/shopify/sync-orders` (admin/operations only). No cron, no scheduled job.
- Webhooks: `orders/create` + `orders/updated` only. HMAC verified. No raw-payload archive, no idempotency table, no dedupe beyond the `shopify_order_id` UNIQUE constraint.
- Duplicate prevention: yes, via `orders.shopify_order_id` UNIQUE + upsert. `order_items` is wiped + reinserted (lossy if a user added local edits).
- Cancelled orders: mapped to `order_status='Cancelled'` when `cancelled_at` is set. Refunds: NOT handled at all.

### What is missing / broken
1. **Auth is broken right now.** `shopify_sync_settings.last_error` = `Shopify 401: Invalid API key or access token`. Stored `SHOPIFY_ACCESS_TOKEN` is rejected.
2. **No product / variant / inventory / cost / location sync.** `inventory.cost_price` and `order_items.unit_cost` are never populated from Shopify, so every order shows `items_cost = 0` → profit = revenue (wrong).
3. **No refunds, no fulfillment events, no discount / tax / shipping line breakdown** — only `total_price` and shipping aggregate are read; `total_discounts`, `total_tax`, `current_total_refunded` ignored.
4. **No pagination.** Anything beyond 250 orders is silently dropped.
5. **No incremental cursor.** Every manual sync re-pulls the same N most recent orders.
6. **REST only.** Cost (`InventoryItem.unitCost`) is GraphQL-only (Admin GraphQL `inventoryItem.unitCost.amount`); REST does not expose it. Current architecture cannot import cost even if scopes were correct.
7. **No webhook event archive / idempotency table** → a Shopify retry re-runs the full processor (currently safe due to upsert, but `order_items` delete+insert means a race can briefly empty the items).
8. **No `refunds/create`, `products/*`, `inventory_levels/update`, `orders/cancelled` webhook handlers.**
9. **`sync-status` route is a stub.** UI re-queries `shopify_sync_settings` directly instead.
10. **No retry / backoff** on 429 or 5xx from Shopify.
11. **No per-entity sync logs** — only `migration_logs` text blob.
12. **Webhook routes log to console** (`console.error`) → token-free, but no structured DB log.

### Security check
- Token only read from `process.env` server-side. Not exposed in client bundle. ✓
- Webhook HMAC verified with `timingSafeEqual`. ✓
- Manual sync requires admin/operations role. ✓
- `/api/public/shopify/webhooks/*` correctly under the public-bypass prefix and re-secured via HMAC. ✓
- `CORS: *` on webhook routes is harmless (Shopify is server-to-server), but unnecessary. Minor.
- No token leaks in errors (only HTTP status + first 300 chars of body forwarded). ✓
- No write scopes are actually used by the code → write scopes in the connected app can be revoked safely.

### Required Shopify scopes (read-only)
- `read_orders` + `read_all_orders` (the latter required to fetch orders >60 days old)
- `read_products`
- `read_inventory`
- `read_locations`
- `read_customers`
- Drop: `write_orders`, `write_products`, `write_inventory`, `write_customers`, `write_locations`, `unauthenticated_*` (no storefront customer feature lives in this app).

---

## PART 2 — Architecture document to add

Create `docs/shopify-sync-audit.md` containing everything in Part 1 plus the target architecture in Part 3 (sections 1–17 from the brief: current summary, files, tables, flow, weaknesses, missing data, security, target arch, scopes, env vars, webhook topics, manual/incremental/full-backfill strategies, error/retry/reconciliation strategy).

---

## PART 3 — Target architecture (to build in a later turn)

### Env vars (all server-only)
- `SHOPIFY_SHOP_DOMAIN` (e.g. `mansouj.myshopify.com`) — fallback to `shopify_sync_settings.store_url`.
- `SHOPIFY_ADMIN_ACCESS_TOKEN` — **new secret to add** (current `SHOPIFY_ACCESS_TOKEN` is invalid).
- `SHOPIFY_API_VERSION` (default `2025-07`).
- `SHOPIFY_WEBHOOK_SECRET`.

### New module layout
```
src/lib/shopify/
  client.server.ts          # fetch wrapper: REST + GraphQL, 429/5xx retry+backoff, version pinning
  graphql.ts                # queries: orders, products+variants+inventoryItem.unitCost, inventoryLevels, locations
  sync-orders.server.ts     # pulls orders w/ pagination + updated_at_min cursor
  sync-products.server.ts   # products + variants → inventory upsert
  sync-inventory.server.ts  # inventoryItem.unitCost → inventory.cost_price; inventoryLevels by location
  sync-locations.server.ts
  sync-refunds.server.ts    # via order.refunds[]
  mapper.ts                 # Shopify payload → orders/order_items rows (extract processShopifyOrder here)
  cost-backfill.server.ts   # for each existing order_item, fill unit_cost from inventory.cost_price by SKU
```

Server routes (all admin/operations gated):
```
src/routes/api/shopify/sync-orders.ts        (exists; refactor)
src/routes/api/shopify/sync-products.ts      (new)
src/routes/api/shopify/sync-inventory.ts     (new)
src/routes/api/shopify/sync-locations.ts     (new)
src/routes/api/shopify/sync-all.ts           (new — runs locations → products → inventory → orders → cost backfill)
src/routes/api/shopify/sync-status.ts        (rewrite — returns counts from shopify_sync_logs)
src/routes/api/shopify/debug/order/$id.ts    (new — single-order test)
src/routes/api/shopify/debug/sku/$sku.ts     (new — single-SKU cost test)
```

Webhook routes (HMAC-verified, all under `/api/public/shopify/webhooks/`):
- `orders-create` (exists)
- `orders-updated` (exists)
- `orders-cancelled` (new)
- `refunds-create` (new)
- `products-create`, `products-update` (new)
- `inventory-levels-update` (new)

Every webhook handler will: verify HMAC → insert raw payload into `shopify_webhook_events` with `shopify_event_id` (header `X-Shopify-Webhook-Id`) UNIQUE for idempotency → enqueue/process synchronously → return 200 fast.

### DB changes (incremental, no rewrite of `orders`/`inventory`)
Add tables (each follows CREATE TABLE → GRANT → ENABLE RLS → POLICY rule):
- `shopify_sync_logs` — `id, sync_type, status (running/success/partial/failed), started_at, finished_at, records_processed, error_message, metadata jsonb`
- `shopify_webhook_events` — `id, shopify_event_id UNIQUE, topic, shop_domain, received_at, processed_at, status, error, raw jsonb`
- `shopify_locations` — `id, shopify_location_id UNIQUE, name, active`
- `shopify_inventory_levels` — `inventory_item_id, location_id, available` (composite PK)

Extend `inventory` with:
- `shopify_product_id text`, `shopify_variant_id text UNIQUE`, `shopify_inventory_item_id text UNIQUE`, `inventory_tracked bool`, `cost_synced_at timestamptz`

Extend `orders` with:
- `currency text`, `subtotal_price numeric`, `total_discounts numeric`, `total_tax numeric`, `total_refunded numeric`, `financial_status text`, `fulfillment_status text`, `cancelled_at timestamptz`
- Generated `profit` / `net_profit` columns will need to be redefined to subtract refunds; will be done in the same migration.

RLS: read = `can_finance(auth.uid())` or `can_ops`, write = `service_role` only (sync runs as admin).

### Cost flow (the key business requirement)
1. `sync-products` populates `inventory.shopify_variant_id` + `shopify_inventory_item_id` by SKU.
2. `sync-inventory` GraphQL query: `inventoryItems(first:250, query:"id:...")` → `unitCost.amount` → upsert into `inventory.cost_price` (Shopify is source of truth, per your choice).
3. `cost-backfill` updates `order_items.unit_cost` for orders where `unit_cost = 0` by joining on SKU → recompute `orders.items_cost = SUM(qty*unit_cost)`; the generated `profit` / `net_profit` columns auto-update.
4. Going forward, webhook `inventory_levels/update` + `products/update` keep cost fresh; new orders read cost at insert time.

### Sync strategies
- **Manual**: UI buttons (Orders / Products / Inventory+Cost / Locations / Full sync).
- **Incremental**: each entity stores `last_synced_at` in `shopify_sync_settings` (new JSONB column `cursors`). Orders pull uses `updated_at_min = cursors.orders - 5min` (overlap window). Cursor advances only on success.
- **Full backfill**: explicit button; ignores cursor, paginates with `Link: rel="next"` until exhausted.
- **Reconciliation**: nightly pg_cron job calls `sync-all` with a 24h overlap; counts mismatches into `shopify_sync_logs.metadata`.

### Error / retry
- Client wrapper retries 429/5xx with exponential backoff (Shopify returns `Retry-After`).
- Per-record errors collected, sync marked `partial`; one bad order does not abort the batch.
- Hard failures (auth, missing scope) abort and write a clear message naming the missing scope (parsed from Shopify's `{ errors: "...access scope..." }` response).
- All errors → `shopify_sync_logs` row + structured console log (token never logged).

### UI changes to `_authenticated/shopify.tsx`
Tabs: **Overview** | **Orders** | **Products** | **Inventory & Cost** | **Locations** | **Webhooks** | **Logs**.
Each tab shows last_sync_at, counts, errors, and a sync button. Logs tab paginates `shopify_sync_logs`. Overview shows scope check (calls `/admin/api/.../shop.json` and reports missing scopes).

### Testing hooks
- `/api/shopify/debug/order/:shopifyOrderId` — pulls + processes one order, returns the diff.
- `/api/shopify/debug/sku/:sku` — resolves SKU → variant → inventoryItem → unitCost, returns full payload.
- `/api/shopify/debug/inventory/:locationId` — lists levels for a single location.

---

## PART 4 — Immediate prerequisite (blocks everything)

Sync is failing with **401 invalid token**. Before any new code runs:
1. In Shopify Admin → Apps → "Develop apps" → create / edit the custom app.
2. Grant the **read-only** scopes listed above.
3. Install the app, copy the Admin API access token.
4. I'll request it via `add_secret` as `SHOPIFY_ADMIN_ACCESS_TOKEN`.
5. Also set `SHOPIFY_SHOP_DOMAIN` and `SHOPIFY_WEBHOOK_SECRET` if not present.

I will surface the exact missing scope in error messages so any oversight here is immediately visible.

---

## Deliverables when you approve the build phase
1. `docs/shopify-sync-audit.md` (full document).
2. Migration adding `shopify_sync_logs`, `shopify_webhook_events`, `shopify_locations`, `shopify_inventory_levels`, plus columns on `orders` and `inventory`.
3. `src/lib/shopify/` module (client, mappers, per-entity sync).
4. New server routes for products/inventory/locations/full/debug.
5. New webhook handlers (cancelled, refunds, products, inventory_levels).
6. Rewritten `_authenticated/shopify.tsx` with tabs + logs.
7. Optional pg_cron nightly reconciliation.
8. README of how to test (single order / single SKU / single location).

No code is written yet — this is a plan. Approve and I'll execute it step by step, starting with the audit doc + token secret + migration, then the client + orders sync, then products/inventory/cost (the business-critical part), then webhooks + UI.
