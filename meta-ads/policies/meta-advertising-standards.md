# Meta Advertising Standards: what gets small-business ads rejected

checkedOn: 2026-10-03
Checked on: 2026-10-03

This is a plain-words guide to Meta's Advertising Standards, written for a small business owner.
It is a summary in our own words, not Meta's text. Meta changes its rules often. When in doubt, the pages below win.

How it was made: the section index and the pages for Personal Attributes, Prohibited Commercial Practices,
Health and Wellness, Financial Services and Social Issue/Political ads were read on 2026-10-03.
The Special Ad Categories, landing page and the remaining restricted-goods notes are written from working
knowledge of Meta's rules and the help-center pages listed below; check them before relying on them.

Sources:
- Advertising Standards home: https://transparency.meta.com/policies/ad-standards/
- Personal attributes: https://transparency.meta.com/policies/ad-standards/objectionable-content/privacy-violations-personal-attributes/
- Prohibited commercial practices: https://transparency.meta.com/policies/ad-standards/deceptive-content/prohibited-commercial-practices/
- Health and wellness: https://transparency.meta.com/policies/ad-standards/restricted-goods-services/health-wellness/
- Financial and insurance products: https://transparency.meta.com/policies/ad-standards/restricted-goods-services/financial-services/
- Social issues, elections or politics: https://transparency.meta.com/policies/ad-standards/SIEP-advertising/SIEP/
- Discriminatory practices: https://transparency.meta.com/policies/ad-standards/unacceptable-content/discriminatory-practices/
- Special Ad Categories (help center): https://www.facebook.com/business/help/298000447747885
- Restricted goods index: https://transparency.meta.com/policies/ad-standards/ (Restricted Goods and Services section)

The agent checks your ad text against `policies/rules.json`. Every rule there points back to a section of this file.
The doctor command warns when the "checkedOn" date above is more than 90 days old. When you re-check this file
against Meta's pages, update both date lines.

---

## 1. Personal attributes (the most common rejection)

An ad must not say or hint that the person reading it has a personal trait. Meta reads "you", "your" and
"are you" next to a trait as you claiming to know something private about them.

Traits Meta protects:
- Health, physical or mental (anxiety, depression, diabetes, weight, acne, addiction, disability and so on)
- Money situation (debt, bad credit, low income, bankruptcy)
- Age
- Religion or belief
- Sexual orientation and gender identity
- Race and ethnicity
- Criminal record
- Voting status and union membership
- Names or other details that suggest you know who they are

Rejected: "Are you struggling with anxiety?", "Is your credit score holding you back?", "Christian singles, are you lonely?"
Fine: "Anxiety support classes, Tuesday evenings", "Credit repair help for small businesses", "Meet Christian singles"

The fix is almost always the same: talk about the service, not about the reader. Drop "you" from the sentence that names the trait.

## 2. Health and wellness claims, before/after images, body image

- No promises to cure a disease, especially ones with no cure (diabetes, cancer, autism, HIV).
- No shaming. Lines like "tired of your belly fat?" or "hate how you look?" are rejected.
- No close-ups that pinch fat or zoom in on a body part to make it look bad.
- Weight loss, cosmetic procedures and supplements must be shown only to people 18 and over.
- Results claims need a realistic time frame stated clearly. "Lose 10 kg in a week" fails.
- Before/after pictures: allowed for some cosmetic procedures when the ad is 18+ only, risky everywhere else.
  For weight loss, fitness and skincare they are a common reason for rejection. Prefer one "after" photo of real use, or a testimonial in words.

## 3. Guaranteed or unrealistic results, income claims

Meta treats promises nobody can keep as deceptive.
- "Guaranteed results", "100% success", "works every time", "feel better in 7 days, guaranteed"
- Income claims: "make $10,000 a month from home", "six figures in 90 days", "quit your job", "passive income on autopilot"
- Investment claims: "guaranteed returns", "risk-free investment", "20% monthly returns"

A money-back guarantee is a refund policy, not a results promise, and is usually fine if the landing page explains it.
Fix: describe what the person gets (the class, the course, the method) and, if you have proof, a real typical result with context.

## 4. Time pressure and false urgency

Real deadlines are fine. Fake ones are deceptive: a countdown that resets, "only 3 spots left" when that is not true,
"offer ends tonight" every night. Urgency words also make ads look low quality and can lower delivery.
Fix: state the real date ("Enrolment closes 15 October") or remove the pressure.

## 5. Special Ad Categories (declare them or the ad is rejected)

If the ad offers any of these, you must tick the matching Special Ad Category when you create the campaign.
Targeting then gets limited (no detailed age, gender or postcode targeting) to prevent discrimination.
- Housing: homes or rooms for sale or rent, real estate listings, mortgages, home insurance, housing services.
- Employment: job openings, hiring, recruitment, internships, job fairs.
- Credit / financial products: credit cards, loans, financing offers, buy now pay later, lines of credit.
- Social issues, elections or politics: candidates, elections, ballot questions, laws, and hot social topics
  (climate, immigration, guns, abortion and similar). These also need ad account authorization and a "Paid for by" label.
  If photo-real images or audio were made or edited with AI, that must be disclosed.

The agent cannot tick the box for you. It warns you so you can choose the category in campaign setup.

## 6. Restricted goods and services

Allowed only with limits (age, country, licence or Meta's written permission):
- Dietary supplements, weight loss products, cosmetic procedures: 18+, no miracle claims.
- Alcohol: 18+ (or local legal age), follow local law.
- Dating: needs Meta's written permission.
- Gambling and real-money games: needs written permission, 18+.
- Crypto trading and exchanges: needs written permission.
- Prescription drugs, pharmacies, addiction treatment: need certification (for example LegitScript in the US).
- Financial and insurance products: 18+, follow local licensing and disclosure rules.

Not allowed at all: tobacco, vapes and nicotine products; weapons, ammunition and explosives; illegal drugs;
payday loans and short-term loans of 90 days or less; binary options; fake documents; body parts.

## 7. Misleading claims

- "#1", "best in the world", "clinically proven", "doctor recommended", "FDA approved", "no side effects":
  keep only what you can prove, and make the proof visible on the landing page.
- No fake endorsements or celebrity faces without permission.
- Prices and discounts must match what the person sees on the landing page.

## 8. Sensational and low-quality content

- Clickbait such as "you won't believe", "doctors hate this", "one weird trick", "shocking".
- Text in ALL CAPS, piles of exclamation marks, fake buttons or fake "play" icons, fake "you won" messages.
- Withholding information to force a click ("click to see what happened").
These get rejected or quietly shown to fewer people.

## 9. Prohibited content (always rejected)

Profanity, adult nudity or sexual content, violence or shocking images, hate or attacks on groups, misinformation,
exploiting a crisis or tragedy to sell, spyware or phishing, copyright or trademark you do not own.

## 10. Landing page requirements

- The link must work, load fast and work on a phone. No broken pages, no "under construction".
- The page must match the ad: same offer, same price, same product.
- Use https.
- Lead forms (on Meta or on your site) need a privacy policy link. Lead forms must not ask for things like
  bank or card numbers, government ID numbers, passwords, health details or criminal history without Meta's permission.
- No pop-ups that stop people leaving, no automatic downloads.

---

What the agent does with this: `node src/index.js policy check <file|text|creative-id>` reads your ad text and flags
each problem as BLOCK (fix before running), WARN (check it) or PASS, with a suggested rewrite. Every create command
runs the same check first. See `policies/README.md`.
