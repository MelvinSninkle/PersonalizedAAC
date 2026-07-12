# Stripe: test → live

Current state: SEPARATE Stripe account for the LLC (deliberately not the
Substack one), products configured in TEST mode, webhook + keys wired to
Vercel test env. Go live once the LLC's bank account is verified.

## Checklist

1. Stripe dashboard → toggle out of test mode. Recreate the SAME products/
   prices in live mode (test products don't carry over):
   - Membership (monthly) — the STT/styling entitlement.
   - Credit packs — image-generation credits (match the store.html tiers).
   Copy each live price id.
2. If price ids are referenced in code/config, update them (grep for the
   test `price_` ids); if the store reads products dynamically, skip.
3. Live keys → Vercel PRODUCTION env only:
   - `STRIPE_SECRET_KEY` = sk_live_…
   - Webhook: Developers → Webhooks → add endpoint
     `https://<domain>/api/store?action=stripe-webhook` with EXACTLY these
     events: `checkout.session.completed`, `invoice.paid`,
     `invoice.payment_failed` (parent gets a friendly update-your-card
     email), `customer.subscription.deleted` (recorded as
     `users.sub_canceled_at`). Copy the signing secret →
     `STRIPE_WEBHOOK_SECRET`.
4. Redeploy. Buy the cheapest credit pack YOURSELF with a real card; watch
   admin/reports.html purchases-vs-fulfillment turn OK; refund yourself in
   the Stripe dashboard.
5. Keep the test-mode keys in Preview/Development envs so branch deploys
   never charge real cards.

## Gotchas learned during setup

- The webhook signing secret is per-endpoint — a new endpoint URL (e.g.
  after the domain flip) means a NEW secret.
- Destination/endpoint "name" fields in the wizard are cosmetic.
- Payouts require the bank account fully verified; charges can succeed
  while payouts queue.
