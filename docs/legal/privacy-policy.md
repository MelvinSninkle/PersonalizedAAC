# My World — Privacy Policy (DRAFT for review)

> **Placeholders to fill before publishing:** Extelligence LLC, [BUSINESS ADDRESS],
> [SUPPORT EMAIL], [EFFECTIVE DATE], [GOVERNING STATE]. Publish at `/privacy` and list
> that URL in App Store Connect. Have an attorney review before launch — this draft is
> a working baseline, not legal advice.

**Effective date:** [EFFECTIVE DATE]

My World ("the Service") is operated by Extelligence LLC ("we", "us"). My World is a
communication-board app that parents and caregivers set up for a child. Because the
Service is built around a child's photos, voice, and communication, we hold ourselves to
a simple rule: **we collect only what the board needs to work, we never sell it, and you
can delete all of it at any time.**

## 1. What we collect

**From the parent/caregiver account holder**
- Email address and a password (stored only as a salted hash).
- Purchase records (credit packs, subscription status). Payment details are handled by
  Apple or Stripe — we never see card numbers.
- Photos you choose to upload of yourself or other family members and caregivers.
- Optional recorded audio (e.g., cheer phrases spoken in your voice).

**About your child (provided by you)**
- First name, birth date (used only to pick age-appropriate vocabulary), and the
  vocabulary/settings you configure.
- Photos of your child that you choose to upload.
- Schedule windows you enter (sleep, school, therapy times) so automatic teaching never
  interrupts them, and your device's timezone.

**Generated and usage data**
- The AI images and audio the Service creates for your board.
- Board usage: which tiles are tapped and when, game/quiz results, learning-session
  history. This exists to power the progress charts and teaching schedule you see —
  nothing else.
- Basic technical logs (IP address, device type) needed to run and secure the Service.

**What we deliberately do not collect:** no advertising identifiers, no third-party
analytics or ad SDKs, no location tracking, no contact scraping, and no data from the
child directly — the child uses the board; the account, and every piece of information
in it, is created and controlled by you.

## 2. How photos and recordings are used

Photos you upload are used for exactly one purpose: **to create the illustrated tiles
and portraits on your child's board.** To do that, the photo is transmitted to our AI
image providers (OpenAI and Google) with an instruction to redraw it in your family's
art style. Per those providers' API terms, API-submitted content is not used to train
their models. We do not run facial recognition, we do not build or store biometric
templates or face geometry, and we never share photos with anyone else.

Recorded audio and the child's chosen synthetic voice are processed by our speech
provider (ElevenLabs) solely to produce the spoken tiles and cheers you hear in the app.

Every image ever generated for your family is stored in your private archive — replaced
images are archived, not shown to anyone else, and deleted when you delete your account.

## 3. Children's privacy (COPPA)

The Service is set up and managed by a parent or legal guardian. By creating an account
and uploading information about your child, **you are providing verifiable parental
consent** to the collection and use described in this policy. We collect no more
information about a child than is reasonably necessary to provide the Service. Parents
may review the child's information in the dashboard at any time, and may delete it —
individually (tiles, photos, people) or entirely (account deletion, Section 7). We never
use a child's information for marketing, never sell it, and never disclose it except to
the service providers in Section 5 acting on our instructions. Questions or requests:
[SUPPORT EMAIL].

## 4. How we use information

- To operate the board: render tiles, speak words, sync across your devices.
- To show you your child's progress (charts, mastery, session history).
- To run features you turn on (auto-teach schedules, listening mode, messages).
- To process purchases and maintain your credit balance.
- To secure the Service and respond to support requests.

We do not sell personal information, we do not share it for advertising, and we do not
use it to train AI models.

## 5. Service providers (subprocessors)

We use a small set of providers, each only for the purpose listed:

| Provider | Purpose |
|---|---|
| Vercel | Application hosting and private file storage (images, audio) |
| Neon | Database hosting |
| OpenAI | AI image generation (photos → illustrated tiles) |
| Google (Gemini) | AI image generation |
| ElevenLabs | Text-to-speech voices |
| Apple | In-app purchases and subscriptions |
| Stripe | Web payments |

## 6. Retention

Your content is kept while your account is active so your family keeps every image
you've made. Technical logs are kept no longer than 90 days. When you delete your
account, all of it goes (Section 7).

## 7. Deleting your data

Account deletion is available in the parent dashboard (and in the iOS app's settings).
Deletion is immediate and permanent: the account, the child's profile, every photo,
every generated image and recording, all usage history, and stored files are removed.
Purchase *records* required for tax and accounting are retained as required by law, with
personal content removed. You may also request deletion or a copy of your data by
emailing [SUPPORT EMAIL]; we respond within 30 days.

## 8. Security

All traffic is encrypted in transit (TLS). Files are stored in private storage
accessible only through your authenticated account. Passwords are stored as salted
hashes. Access to production data is limited to the operator. If a breach affecting
your personal information ever occurs, we will notify you at your account email without
undue delay and as required by law.

## 9. Your rights

Depending on where you live (e.g., California), you may have rights to access, correct,
delete, or receive a copy of your personal information, and to non-discrimination for
exercising them. All of these are available to every user regardless of location: use
the dashboard tools or email [SUPPORT EMAIL]. We honor deletion requests for children's
data from the parent account holder without exception.

## 10. Changes

If we materially change this policy — especially anything touching children's data —
we will notify you by email and in-app before the change takes effect.

## 11. Contact

Extelligence LLC · [BUSINESS ADDRESS] · [SUPPORT EMAIL]
