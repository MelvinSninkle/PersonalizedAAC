# End-to-end launch audit — customer + business-owner walk-through

A step-by-step pass through enrollment and daily use as a new paying family would
experience it, plus the operator's view. ✅ = exists and works · ⚠️ = exists with a gap
· ❌ = missing. Legal drafts live in `docs/legal/`.

## The customer's journey

**Step 0 — Finding it.** welcome/index pages exist. ❌ No pricing shown anywhere before
signup (a parent can't learn "10¢ an image, $9.99/mo" until they're inside). ❌ No
support contact, no FAQ, no medical-disclaimer line, no Terms/Privacy links — the two
documents don't exist at all (the single biggest launch blocker; Apple will also reject
the subscription build without them).

**Step 1 — Creating the account.** ✅ Self-signup and invite paths, password rules,
signed cookies. ⚠️ No email verification — a typo'd email silently orphans password
resets and receipts. ❌ No consent checkbox (terms/privacy/COPPA parental consent/photo
processing) and nothing recorded about consent. Draft copy: disclosure-placements §1.

**Step 2 — Child details.** ✅ Name + birth date collected; used well (age-band
vocabulary). ⚠️ Nothing tells the parent *why* birth date is needed or that they can
decline — one reassurance sentence fixes it.

**Step 3 — Child photo.** ✅ Works; durable pipeline. ❌ No disclosure that the photo of
their child is sent to OpenAI/Google for stylization (drafted, §2). This is the moment
trust is won or lost — say it out loud.

**Step 4 — Parent/family photos.** ✅ Works (flaky-step retry fixed earlier). ❌ No
"only upload people who gave permission" language — the parent is uploading OTHER
adults' faces (grandparents, therapists). Drafted, §3.

**Step 5 — Style + voice.** ✅ Keystone flow, voice samples. ❌ No note that voices are
synthetic / recordings are stored (drafted, §4).

**Step 6 — Board build.** ✅ Instant defaults + honest progress banners; interruption-
proof. ⚠️ No completion email ("your board is ready") — the one moment a transactional
email would really land.

**Step 7 — Buying credits/subscription.** ✅ StoreKit + restore + coupons; packs now
50–1000. ❌ Apple-required auto-renew disclosure text + in-app Terms/Privacy links
missing from the store screens (drafted, §6 — App Review 3.1.2 will flag this). ❌ No
receipts/purchase-history email; ⚠️ web Stripe checkout exists but has no refund policy
language (drafted into Terms §6).

**Step 8 — Daily use / leaving.** ✅ Listening mode, games, auto-teach, progress. ❌
Microphone disclosure on first listening-mode use (drafted, §5). ✅ Web account deletion
is genuinely complete (everything, hard confirm). ❌ **No in-app account deletion on
iOS — Apple Guideline 5.1.1(v) requires it since accounts are created in-app.** ⚠️ No
data export ("give me everything") beyond the board JSON export.

## The owner's checklist

**Must-do before charging strangers**
1. Entity + policies: form/confirm the LLC, fill placeholders in the two legal drafts,
   attorney pass, publish `/terms` + `/privacy`.
2. Consent capture at signup (checkbox + `users.consented_at/consent_version`).
3. Photo/mic/AI disclosures at the drafted touchpoints.
4. Subscription disclosure block + in-app deletion (Apple review blockers).
5. App Store Connect: privacy-policy URL, App Privacy questionnaire (contact info, user
   content, purchases, usage — all "linked to you", none used for tracking), age rating
   4+, do NOT enroll in Kids Category; create the five new credit products + Plus;
   Paid Applications agreement + banking/tax forms.
6. Stripe: activate Stripe Tax (digital-goods sales tax varies by state), set statement
   descriptor, refund policy in Terms.
7. Support channel: a real [SUPPORT EMAIL] inbox, linked from footer, store, App Store.

**Should-do soon**
8. Email verification at signup + transactional emails (welcome, board-ready, receipt,
   deletion confirmation).
9. Subprocessor/API posture: confirm OpenAI + Google API data-use settings (no
   training), ElevenLabs commercial tier; save copies of each provider's terms.
10. Data-retention line item for logs (90 days, matching the privacy draft) and a
    written 72-hour breach-notification playbook (it's two paragraphs; write it once).
11. DMCA agent registration (~$6, copyright.gov) since users upload images.
12. Accessibility statement page — an AAC product will be judged by it.
13. Trademark search on "My World" before spending on branding (it's a crowded name;
    a distinctive mark like "My World AAC" + logo is cheaper to defend).
14. Business insurance quote (general liability + tech E&O; children's-data products
    are exactly what E&O is for).

**Watch-list (not blockers)**
- If per-child voice *cloning* ever ships, that's a new consent event (explicit,
  recorded, revocable) — don't ship it on the current consent language.
- CCPA formally kicks in at $25M revenue / 100k consumers, but the privacy draft
  already grants those rights to everyone, which is both simpler and better marketing.
- Illinois/Texas/Washington biometric statutes: current design is fine (no face
  templates stored) — keep it that way and keep saying so in the policy.
