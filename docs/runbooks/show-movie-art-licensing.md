# Show & movie art on tiles — legal posture + TMDB evaluation

Written 2026-07 for the attorney conversation. Context: parents want their
child's favorite TV shows and movies on the board. Engineering read follows —
**this is not legal advice; validate the whole page with an IP attorney.**

## What we ship today (deliberately)

The onboarding "favorite shows & movies" step and the TV & Movies plus tile
are a **neutral, general-purpose photo upload**: the parent supplies an image
from their own camera/library; we store it privately for that one child's
board and never modify it (raw-only — no AI restyle of show art, which would
create a derivative work). The app **never searches, fetches, frames, or
suggests** any third-party artwork.

Why that's the strong position:

1. **The user acts, we host.** A parent photographing the DVD case on their
   own shelf for their disabled child's private communication device is about
   as sympathetic a personal-use posture as exists. The service is a neutral
   tool (a photo album), not a facilitator.
2. **Inducement is the trap** (MGM v. Grokster): a feature *purpose-built* to
   find and download copyrighted posters — even with "personal use only"
   language — exposes the BUSINESS to contributory/inducement claims. The
   disclaimer protects nobody who matters here. This is why the
   mini-embedded-IMDb idea was rejected: IMDb's terms also prohibit scraping
   and framing, and the posters aren't IMDb's to license anyway.
3. **DMCA §512(c) safe harbor** covers material stored at a user's direction
   — it can cover parent uploads, NOT app-fetched art. **Action item: register
   a DMCA agent with the Copyright Office before launch** (cheap, online,
   renewable every 3 years) and add repeat-infringer language to the ToS.
4. **App Store review**: guideline 5.2 (IP) rejections are common for apps
   that serve studio art; a neutral camera-roll upload does not trip it.

Guardrails that keep the posture clean:
- No copy anywhere that instructs users to go find poster art online, and
  **never name/link a specific download source** — "go to X and download the
  poster" is the inducement act itself, regardless of the site. (Asked and
  answered 2026-07: the decision is deliberate, not an oversight.)
- What the copy DOES suggest instead: photograph the show as it exists in
  the family's own home (case on the shelf, character plush/backpack, book
  cover) or reuse photos they already have; a generic note that many shows'
  official sites offer free downloadable art (licensed giveaways) is fine.
- Shows/movies tiles are raw-only (never restyled) — no derivative works.
- Uploaded art stays inside the family's private board (media isolation,
  invariant A1); it never enters shared defaults, demos, or marketing.

## The licensed path, if we want in-app search later: TMDB

IMDb has no viable option (no free API; enterprise data licensing only; ToS
forbid scraping). TMDB is the industry-standard alternative:

- **Free tier is non-commercial only.** Charging users (our memberships)
  makes us commercial — the free key is not an option for us.
- **Commercial license: ~$149/month** for companies under $1M annual revenue
  (custom pricing above that). Includes the API and TMDB Content — posters,
  cast, metadata — "ideal for apps." Apply via api-for-business /
  sales@themoviedb.org.
- **The nuance for the attorney**: TMDB licenses *its* API and content
  compilation. Poster copyrights remain with the studios. Displaying posters
  for identification/discovery inside a licensed app is widespread industry
  practice under this license; **persisting a poster into a stored tile that
  our product then serves long-term** is a heavier use than discovery
  display. Questions to ask:
  1. Does TMDB's commercial agreement language cover caching/persistent
     storage of images inside user content, or display-only?
  2. Is the identification-use theory (thumbnail/discovery, cf. Perfect 10 v.
     Amazon) strong enough for a stored 512px tile in a private, single-family
     AAC board?
  3. Does the AAC/accessibility purpose strengthen a fair-use fallback
     (transformative purpose: communication aid, not entertainment)?
  4. DMCA agent registration + ToS repeat-infringer policy review.

## Recommendation

Ship the neutral upload (done). Revisit TMDB only if parents actually ask
for in-app search — at $149/month it's affordable the moment it matters, but
sign nothing until the attorney answers question 1 and 2 above.

Sources:
- [TMDB API Terms of Use](https://www.themoviedb.org/api-terms-of-use)
- [TMDB API for Business](https://www.themoviedb.org/api-for-business)
- [TMDB FAQ (commercial use)](https://developer.themoviedb.org/docs/faq)
- [TMDB forum: commercial usage pricing](https://www.themoviedb.org/talk/622b91d0d236e60045f62782)
