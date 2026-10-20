# 33 · Payment providers, compared

**Status: research for a decision. Nothing is built, and nothing will be until the alpha test is complete (Kushal, 2026-10-20).**
Companion to [`32 · Setup, signup, teams and billing`](32-onboarding-and-billing.md). The question: once organisations pay, how do we
collect the money and manage subscriptions, judged on ease of use, developer experience, the experience of a **non-developer org admin**
(who must be able to see their plan, change seats, cancel, and be restricted when they do not pay), cost, and how hard it is to build.

**Read this first.** Every number below comes from third-party blog and comparison pages found by web search in October 2026. Several
are written by competing vendors (Dodo Payments publishes some of the merchant-of-record comparisons) and some disagree with each other.
They are marked **verify** and must be checked on the provider's own pricing page, and for Indian sellers by talking to the provider,
before any decision. Fees in India also carry 18% GST on the provider's fee.

---

## 1 · The kinds of option

| Kind | What it is | Examples | You handle |
|---|---|---|---|
| **Payment gateway** | Takes the payment (cards, UPI) and can run recurring billing | Razorpay, Cashfree, PayU, Stripe | Your own invoices, GST, tax abroad, refunds, disputes |
| **Merchant of record (MoR)** | Sells to the customer on your behalf, so **they** handle tax and invoices, then pay you out | Paddle, Lemon Squeezy, Polar, Dodo Payments | Less compliance; a higher cut; less control |
| **Manual invoicing** | You send a bill, they pay by UPI or bank transfer, you mark them paid | (no tool needed) | Everything, by hand |

---

## 2 · The comparison

| | Razorpay | Cashfree / PayU | Stripe | Paddle | Lemon Squeezy / Polar | Dodo Payments | Manual |
|---|---|---|---|---|---|---|---|
| **Open one as an Indian seller** | Yes | Yes (not verified in detail) | Reported **invite-only** in India since 2024; you ask their sales team | Reported hard and slow for Indian SaaS | Possible; payout details unclear | Yes; **INR payouts** | Nothing to open |
| **Fees** (verify) | About 2% on domestic cards, **0% on UPI**, plus 18% GST on the fee; reported extra about 0.99% on subscription charges | About 2% + GST, no detail found on subscriptions | Reported 2% domestic, 3% to 4.3% international, plus a 2% to 3% currency fee; effective cost reported around 6% | About 5% + 50 cents | About 5% + 50 cents with +1.5% international cards and +0.5% subscriptions (Polar: lower cut but a monthly fee) | About 4% + 40 cents, plus the same style of add-ons | Zero, plus your time |
| **UPI and AutoPay** | **Yes**: UPI AutoPay and e-NACH mandates (Razorpay must switch UPI auto-charge on for your account); reported mandate limit about ₹15,000 | Not verified | **No UPI** in the standard checkout, per sources; cards only | No | No UPI | Not verified | UPI QR or bank transfer, manually |
| **Recurring billing** | Subscriptions: plans, trials, upfront charge, quantity (seats) and add-ons, upgrade, downgrade, pause, cancel, automatic retries, invoices | Not verified | **Best in class**: trials without a card, seat changes, proration, Smart Retries, a customer portal | Yes | Yes | Yes | You remember to send the bill |
| **Customer self-serve portal** (the org admin changes card, seats, cancels, downloads invoices) | **No ready-made one**: the API can pause and cancel but **we build the screen** | Not verified | **Yes**, a hosted portal (cannot be embedded in an iframe) | Yes | Yes | Yes | No: they email you |
| **Can we restrict an org that does not pay** | Yes: webhooks tell us; our code applies the limit | Same | Same | Same | Same | Same | Yes: we mark them unpaid |
| **Developer experience** | Good docs, SDKs, test mode, webhooks signed with HMAC-SHA256 | Not verified | Excellent docs and tooling, the industry reference | Good | Good | Newer, smaller community | None needed |
| **Tax, GST invoices, abroad** | **You** issue GST invoices and handle foreign tax | You | You; no automatic FIRC or FIRA reported for foreign receipts | **They** handle global tax and invoices | They do | They do | You |
| **Payout speed** (verify) | T+2 by default; T+1 common; instant for a fee | Not verified | T+3 to T+7 reported | Varies | Varies | INR payout | Immediate, to your own account |
| **Ease for us to build** | Medium: plans, subscription creation, webhooks, and our own billing screen | Medium | Easiest of the gateways, but you may not be able to open it | Easy; embeds a checkout | Easy | Easy | **Trivial** |
| **Fit for this product now** | **Strong**: UPI AutoPay matches your bank constraints and Indian customers | Possible alternative to Razorpay | Poor fit while invite-only and card-centric | Poor: onboarding | Weak: no UPI | Worth watching if customers abroad appear | **Best for the first few customers** |

### Notes that matter for a decision
- **Seats and a pay-per-organisation price.** Stripe and Razorpay both support a quantity on a plan. If pricing is per organisation plus extra
  seats and numbers (doc 32 section 4), both can express it; Razorpay does it with quantity-based plans and add-ons.
- **Seat changes during a Stripe trial** end the trial and bill immediately, which matters if trials let teams add people.
- **A customer portal is the biggest gap for Razorpay.** Plan on building a Billing screen: plan, seats and numbers used, invoices, change
  plan, pause, cancel. That is the same screen needed to show limits and warnings, so the work is not wasted.
- **A merchant of record is the answer to tax, not to UPI.** They remove the need to register for foreign tax and issue invoices, at 4% to 5%
  plus fixed fees. For Indian customers paying in rupees by UPI, a gateway is cheaper and more familiar.
- **Mandate limits.** UPI AutoPay has per-debit limits (about ₹15,000 reported, verify against the RBI notice); this product's plans are well inside that.
- **What about Stripe's invite-only status?** It may have changed, and an existing foreign entity can use Stripe directly. For a solo Indian
  founder in 2026 it is a gamble on getting in; it is not a plan.

---

## 3 · Manual invoicing, honestly

How it would work: the operator sends an invoice (a GST invoice from a template), the customer pays by UPI or bank transfer, the operator marks
the organisation paid using the operator override flag (D-47), and sets a renewal date. Pause or restrict by flipping the status.

| Good | Bad |
|---|---|
| No integration, no fees, no approval needed from a provider, works today | Does not scale past a handful of customers; you chase late payers by hand |
| Customers can pay however they already do | No self-serve: every plan change is an email to you |
| Teaches you what customers actually want before you build billing | Revenue recognition and GST filing are on you |

This is the right start. The signal to move to a gateway: more than about five or ten paying organisations, or a customer asking to pay
by card or to cancel without emailing you.

---

## 4 · Recommendation (to confirm after reading)

1. **Now (the beta and the first paying customers): manual invoicing**, with the operator override flag as the "paid" switch. No code.
2. **When it starts to hurt: Razorpay Subscriptions.** UPI AutoPay and cards in rupees, subscriptions with trials, quantity plans and
   retries. Build the Billing screen ourselves.
3. **Only if customers abroad appear: add a merchant of record** (Dodo Payments has INR payouts; Paddle is reported difficult to join from
   India) so that foreign tax and invoices are theirs.
4. **Skip Stripe** unless a foreign entity or an invite appears; revisit if its India rules change.

### Open questions for Kushal
- Is a GST registration in place, or planned, and who issues invoices?
- Are the first paying customers Indian only, or will some pay in dollars?
- Is a free trial wanted at all, given the invite-only beta is already free, and should a card be required for one?
- Who is the "seller" legally (a company or a person)? Several providers need a registered business for subscriptions.

---

## 5 · Sources (all third-party; verify on each provider's page)
- Razorpay: [Subscriptions documentation](https://razorpay.com/docs/payments/subscriptions/), [UPI AutoPay](https://razorpay.com/docs/payments/payment-gateway/s2s-integration/recurring-payments/upi.md),
  [pricing explained](https://razorpay.com/blog/razorpay-payment-gateway-pricing-explained/), [charges review](https://www.softwaresuggest.com/blog/razorpay-payment-gateway-charges/)
- India gateways compared: [Stripe vs Razorpay 2026](https://mewayz.com/blog/stripe-vs-razorpay-india-2026), [gateway charges comparison](https://www.xflowpay.com/blog/payment-gateway-charges-comparison),
  [Stripe India notes](https://www.skydo.com/compare/stripe-pricing)
- Stripe features: [customer management](https://stripe.com/en-hu/docs/customer-management), [Billing features](https://stripe.com/au/billing/features)
- Merchants of record: [Lemon Squeezy review](https://dodopayments.com/blogs/lemonsqueezy-review), [MoR for SaaS in India](https://dodopayments.com/blogs/top-merchant-of-record-for-saas-india),
  [cheapest MoR 2026](https://dodopayments.com/blogs/cheapest-merchant-of-record), [Dodo review](https://fungies.io/dodo-payments-review-2026.md)
- Meta's own WhatsApp fees (official API only): [pricing page](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
