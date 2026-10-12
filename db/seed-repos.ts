/**
 * Initial repo list for a fintech team. Every entry was verified to exist on
 * GitHub on 2026-10-12, and db/seed.ts re-verifies each one before inserting.
 * After seeding, the list is managed from /admin, never from code.
 */
export const SEED_REPOS: { fullName: string; category: string; priority: "critical" | "normal" | "low"; notes: string }[] = [
  // Payments
  { fullName: "stripe/stripe-node", category: "payments", priority: "critical", notes: "Primary card processor SDK." },
  { fullName: "Adyen/adyen-node-api-library", category: "payments", priority: "normal", notes: "Secondary acquirer for EU cards." },
  { fullName: "razorpay/razorpay-node", category: "payments", priority: "critical", notes: "India payments (UPI, cards)." },
  { fullName: "checkout/checkout-sdk-node", category: "payments", priority: "normal", notes: "Checkout.com integration under evaluation for fallback routing." },
  { fullName: "braintree/braintree_node", category: "payments", priority: "low", notes: "Legacy PayPal/Braintree flows. Publishes tags, not GitHub Releases." },
  // Banking
  { fullName: "plaid/plaid-node", category: "banking", priority: "critical", notes: "Bank account linking. Releases moved to tags; tag fallback applies." },
  { fullName: "moov-io/ach", category: "banking", priority: "normal", notes: "NACHA file generation and parsing." },
  { fullName: "dinerojs/dinero.js", category: "banking", priority: "normal", notes: "Money arithmetic in ledgers." },
  { fullName: "MikeMcl/decimal.js", category: "banking", priority: "normal", notes: "Arbitrary-precision decimals for interest calculations." },
  // Authentication
  { fullName: "panva/jose", category: "auth", priority: "critical", notes: "JWT/JWE verification for API tokens." },
  { fullName: "auth0/node-jsonwebtoken", category: "auth", priority: "critical", notes: "Legacy service tokens. Tags only." },
  { fullName: "panva/openid-client", category: "auth", priority: "critical", notes: "OIDC login with the identity provider." },
  { fullName: "nextauthjs/next-auth", category: "auth", priority: "normal", notes: "Dashboard sign-in." },
  { fullName: "jaredhanson/passport", category: "auth", priority: "low", notes: "Internal admin tools." },
  // Platform and data
  { fullName: "vercel/next.js", category: "platform", priority: "critical", notes: "Customer dashboard framework. Many canary pre-releases." },
  { fullName: "nodejs/node", category: "platform", priority: "critical", notes: "Runtime. Watch security releases." },
  { fullName: "expressjs/express", category: "platform", priority: "normal", notes: "Webhook receiver service." },
  { fullName: "helmetjs/helmet", category: "platform", priority: "normal", notes: "HTTP security headers for Express services." },
  { fullName: "prisma/prisma", category: "data", priority: "normal", notes: "Ledger service ORM (repository is now prisma/orm)." },
  { fullName: "drizzle-team/drizzle-orm", category: "data", priority: "normal", notes: "ORM for new services." },
  { fullName: "brianc/node-postgres", category: "data", priority: "normal", notes: "Postgres driver. Tags only." },
  { fullName: "colinhacks/zod", category: "data", priority: "normal", notes: "Request validation at API boundaries." },
  // Tooling
  { fullName: "vitest-dev/vitest", category: "tooling", priority: "low", notes: "Test runner." },
  { fullName: "microsoft/TypeScript", category: "tooling", priority: "low", notes: "Compiler." },
  // Evaluation
  { fullName: "better-auth/better-auth", category: "evaluation", priority: "low", notes: "Evaluating as a NextAuth replacement." },
  { fullName: "honojs/hono", category: "evaluation", priority: "low", notes: "Evaluating for edge webhook handlers." },
  { fullName: "temporalio/sdk-typescript", category: "evaluation", priority: "low", notes: "Evaluating for payout workflows." },
];
