# Shopify Auth Setup

This app uses Shopify Dev Dashboard OAuth. Do not paste an Admin API token into the frontend.

## Lovable Secrets

Set these in Lovable Secrets:

- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`
- `SHOPIFY_WEBHOOK_SECRET`
- `SHOPIFY_SCOPES`
- `SHOPIFY_API_VERSION`
- `SHOPIFY_SHOP_DOMAIN`

Recommended values:

```text
SHOPIFY_SHOP_DOMAIN=mansoujj.myshopify.com
SHOPIFY_API_VERSION=2025-10
SHOPIFY_SCOPES=read_orders,read_all_orders,read_products,read_inventory,read_locations,read_customers
```

## Shopify Admin Domains

Only these `myshopify.com` domains are valid for OAuth, Admin API, webhooks, and sync:

```text
mansouj.myshopify.com
mansoujj.myshopify.com
```

The customer storefront domain is:

```text
mansouj.shop
```

Do not use `mansouj.shop` for OAuth, token exchange, Admin API calls, webhooks, or sync. The OAuth callback stores the exact `shop` domain Shopify returns, then future Admin API calls use that stored domain.

## Shopify Dev Dashboard Settings

Use these exact URLs:

```text
App URL:
https://mansouj-sales-hub.lovable.app/api/shopify/auth/start
```

```text
Allowed redirection URL:
https://mansouj-sales-hub.lovable.app/api/shopify/auth/callback
```

Required scopes:

```text
read_orders,read_all_orders,read_products,read_inventory,read_locations,read_customers
```

## Test Install

1. Update the App URL and allowed redirection URL in Shopify Dev Dashboard.
2. Save the app configuration.
3. Create/release a new app version if Shopify asks for it.
4. Click Install app.
5. Shopify should redirect to:

```text
https://mansouj-sales-hub.lovable.app/api/shopify/auth/callback
```

6. The callback should redirect back to:

```text
https://mansouj-sales-hub.lovable.app/shopify
```

The Admin API access token is stored server-side only.

## Test Connection

In the Mansouj app:

1. Open Shopify Sync.
2. Confirm install status is `connected`.
3. Click `Test Shopify Connection`.

The test verifies:

- shop domain
- Admin API token
- API version
- required scopes

It never returns or displays the token.

## Do Not Expose

Never expose these values in frontend code, screenshots, chat, browser console logs, or public files:

- `SHOPIFY_CLIENT_SECRET`
- Shopify Admin API access token
- `SHOPIFY_WEBHOOK_SECRET`
