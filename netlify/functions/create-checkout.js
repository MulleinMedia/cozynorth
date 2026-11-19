// Netlify Function: create-checkout.js
// POST /.netlify/functions/create-checkout
// Body: { items: [{ scent: "northpine", qty: 2 }, ... ] }
// Creates a Stripe Checkout Session with scent-named line items + a plain
// order summary above the Pay button, so the customer can SEE which scent(s)
// they're buying on the Stripe page (the old version used one generic price,
// so the scent was invisible at checkout). Prices are fixed server-side so
// customers cannot change them in the browser. $8 flat shipping per order.
// Requires env var STRIPE_SECRET_KEY in Netlify (Production, Functions scope).
// Shipping $8 flat: price_1Uajbs0UhQlReEhQCgxtNbPq
// Duo / Set bundles are NOT sold through this function — they use their own
// Payment Links. Only single candles, mixed scents, any quantity.

const SCENTS = {
  northpine: "North Pine",
  vanillabirch: "Vanilla Birch",
  cozycabin: "Cozy Cabin",
  cinnamonspruce: "Cinnamon Spruce",
  lakehouse: "Lake House",
};
const SINGLE_PRICE_CENTS = 1599;
const SHIPPING_PRICE = "price_1Uajbs0UhQlReEhQCgxtNbPq";
const FLAT_SHIPPING = 8;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  try {
    const { items } = JSON.parse(event.body || "{}");
    if (!Array.isArray(items) || items.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "Bag is empty" }) };
    }
    // Validate and count scents from the server-side list only.
    const scentCounts = {};
    for (const item of items) {
      const qty = Math.floor(Number(item.qty));
      if (!SCENTS[item.scent] || !qty || qty < 1 || qty > 10) {
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid bag item" }) };
      }
      scentCounts[item.scent] = (scentCounts[item.scent] || 0) + qty;
    }
    // One line item per scent, named with the scent so it shows under
    // "View details" on the Stripe page.
    const line_items = [];
    for (const [scent, qty] of Object.entries(scentCounts)) {
      line_items.push({
        price_data: {
          currency: "usd",
          unit_amount: SINGLE_PRICE_CENTS,
          product_data: { name: "Cozy North " + SCENTS[scent] + " — 9oz Soy Candle" },
        },
        quantity: qty,
      });
    }
    line_items.push({ price: SHIPPING_PRICE, quantity: 1 });

    // Plain-English order summary shown above the Pay button on Stripe, so
    // the customer sees exactly which scent(s) they're buying before paying.
    const totalCount = Object.values(scentCounts).reduce(function(a, b){ return a + b; }, 0);
    const parts = Object.entries(scentCounts).map(function(entry){
      return entry[1] + " × " + SCENTS[entry[0]];
    });
    const total = (totalCount * SINGLE_PRICE_CENTS) / 100 + FLAT_SHIPPING;
    const summary = "Your order: " + parts.join(", ") + " — $" + total.toFixed(2) + " total.";

    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      billing_address_collection: "required",
      shipping_address_collection: { allowed_countries: ["US"] },
      phone_number_collection: { enabled: true },
      customer_creation: "always",
      submit_type: "pay",
      custom_text: { submit: { message: summary } },
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
