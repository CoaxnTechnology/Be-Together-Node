require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

(async () => {
  try {
    const product = await stripe.products.create({
      name: "Service Promotion",
    });

    console.log("✅ Product Created");
    console.log("Product ID:", product.id);

  } catch (error) {
    console.error("❌ Error:", error.message);
  }
})();
