# Shopify Admin Token Setup

This integration uses a legacy Shopify custom app Admin API token. It does not use Shopify OAuth install flow.

## Lovable Secrets

Set these in Lovable Secrets:

- `SHOPIFY_SHOP_DOMAIN`
- `SHOPIFY_ADMIN_ACCESS_TOKEN`
- `SHOPIFY_API_VERSION`
- `SHOPIFY_WEBHOOK_SECRET`
- `SHOPIFY_SCOPES`

`SHOPIFY_ACCESS_TOKEN` is supported only as a fallback. `SHOPIFY_ADMIN_ACCESS_TOKEN` is always preferred.

Recommended values:

```text
SHOPIFY_SHOP_DOMAIN=mansoujj.myshopify.com
SHOPIFY_API_VERSION=2025-10
SHOPIFY_SCOPES=read_orders,read_all_orders,read_products,read_inventory,read_locations,read_customers
```

## Shopify Admin Domains

Only these `myshopify.com` domains are valid for Admin API calls, webhooks, and sync:

```text
mansouj.myshopify.com
mansoujj.myshopify.com
```

The customer storefront domain is:

```text
mansouj.shop
```

Do not use `mansouj.shop` for Admin API calls, webhooks, or sync.

## Required Admin API Scopes

The legacy custom app token must have these read-only scopes:

```text
read_orders,read_all_orders,read_products,read_inventory,read_locations,read_customers
```

## Test Connection

The Shopify Sync page is read-only. The connection test is available as an authenticated admin/operations endpoint:

```text
/api/shopify/test-connection
```

The endpoint verifies:

- `SHOPIFY_SHOP_DOMAIN` is a valid allowed Shopify Admin domain
- `SHOPIFY_ADMIN_ACCESS_TOKEN` is accepted by Shopify
- `SHOPIFY_API_VERSION` works
- required scopes are present

It never returns or displays the token.

## Do Not Expose

Never expose these values in frontend code, screenshots, chat, browser console logs, or public files:

- `SHOPIFY_ADMIN_ACCESS_TOKEN`
- `SHOPIFY_ACCESS_TOKEN`
- `SHOPIFY_WEBHOOK_SECRET`
