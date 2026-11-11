// Netlify Function: create-checkout.js
// POST /.netlify/functions/create-checkout
// Body: { items: [{ scent: "northpine", qty: 2 }, ... ] }
// Creates a Stripe Checkout Session with fixed prices (server-side, so
// customers cannot change prices in the browser) + $8 flat shipping per order.
// Requires env var STRIPE_SECRET_KEY in Netlify (Production, Functions scope).
// Stripe price IDs (live, Cozy North):
//   Single candle $15.99: price_1Uak7V0UhQlReEhQ8loWbU6l
//   Shipping $8 flat:     price_1Uajbs0UhQlReEhQCgxtNbPq
// Duo / Set bundles are NOT sold through this function — they use their own
// Payment Links. Only single candles, mixed scents, any quantity.

const PRICE_BY_SCENT = {
  northpine: "price_1Uak7V0UhQlReEhQ8loWbU6l",
  vanillabirch: "price_1Uak7V0UhQlReEhQ8loWbU6l",
  cozycabin: "price_1Uak7V0UhQlReEhQ8loWbU6l",
  cinnamonspruce: "price_1Uak7V0UhQlReEhQ8loWbU6l",
  lakehouse: "price_1Uak7V0UhQlReEhQ8loWbU6l",
};
const SHIPPING_PRICE = "price_1Uajbs0UhQlReEhQCgxtNbPq";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  try {
    const { items } = JSON.parse(event.body || "{}");
    if (!Array.isArray(items) || items.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "Bag is empty" }) };
    }
    // Validate and build line items from the server-side price list only.
    const line_items = [];
    const scentCounts = {};
    for (const item of items) {
      const qty = Math.floor(Number(item.qty));
      if (!PRICE_BY_SCENT[item.scent] || !qty || qty < 1 || qty > 10) {
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid bag item" }) };
      }
      scentCounts[item.scent] = (scentCounts[item.scent] || 0) + qty;
    }
    for (const [scent, qty] of Object.entries(scentCounts)) {
      line_items.push({ price: PRICE_BY_SCENT[scent], quantity: qty });
    }
    line_items.push({ price: SHIPPING_PRICE, quantity: 1 });

    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      billing_address_collection: "required",
      shipping_address_collection: { allowed_countries: ["US"] },
      phone_number_collection: { enabled: true },
      customer_creation: "always",
      submit_type: "pay",
      metadata: { store: "cozy-north", bundle: "cart", scents: JSON.stringify(scentCounts) },
      success_url: "https://cozynorth.netlify.app/?checkout=success",
      cancel_url: "https://cozynorth.netlify.app/?checkout=cancelled",
    });
    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error("create-checkout error", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Checkout failed" }) };
  }
};
