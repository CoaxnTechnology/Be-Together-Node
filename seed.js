const mongoose = require("mongoose");
const Category = require("./model/Category"); // 👈 aapka schema import karo

const BASE_URL = "http://localhost:3000";

const default_categories = [
  { name: "Pet Care", image: `${BASE_URL}/uploads/icons/pet.png`, tags: ["dog sitter", "pet care", "dog walking", "pet sitting"] },
  { name: "Childcare", image: `${BASE_URL}/uploads/icons/childcare.png`, tags: ["baby sitter", "childcare", "babysitting", "child supervision"] },
  { name: "Household Maintenance", image: `${BASE_URL}/uploads/icons/house.png`, tags: ["house chores", "cleaning", "ironing", "household fixes", "home maintenance"] },
  { name: "Academic Support", image: `${BASE_URL}/uploads/icons/academic.png`, tags: ["school tutoring", "academic support", "math tutoring", "English tutoring", "education"] },
  { name: "Home Repairs and Assembly", image: `${BASE_URL}/uploads/icons/repairs.png`, tags: ["small jobs", "plumbing", "electrician", "furniture assembly", "home repairs"] },
  { name: "Elderly Care", image: `${BASE_URL}/uploads/icons/elderly.png`, tags: ["elderly assistance", "senior care", "companionship", "errands", "medication help"] },
  { name: "Moving Services", image: `${BASE_URL}/uploads/icons/moving.png`, tags: ["moving help", "furniture moving", "box moving", "relocation assistance"] },
  { name: "Language Services", image: `${BASE_URL}/uploads/icons/language.png`, tags: ["translations", "document translation", "CV translation", "language services"] },
  { name: "Garden and Plant Maintenance", image: `${BASE_URL}/uploads/icons/garden.png`, tags: ["garden care", "plant care", "watering plants", "green space maintenance", "gardening"] },
  { name: "Translator", image: `${BASE_URL}/uploads/icons/translator.png`, tags: ["translation services", "language translation", "document translation", "interpreter", "multilingual"] },
  { name: "Plumber", image: `${BASE_URL}/uploads/icons/plumber.png`, tags: ["plumbing", "pipe repair", "leak fixing", "drainage", "water heater repair"] },
  { name: "Cooking", image: `${BASE_URL}/uploads/icons/cooking.png`, tags: ["cooking services", "meal preparation", "catering", "home chef", "culinary"] },
  { name: "Join an Event", image: `${BASE_URL}/uploads/icons/event.png`, tags: ["event participation", "event registration", "community events", "social gatherings", "event planning"] },
  { name: "Explore Area", image: `${BASE_URL}/uploads/icons/explore.png`, tags: ["local exploration", "sightseeing", "travel guide", "area tours", "local attractions"] },
  { name: "Attend Show", image: `${BASE_URL}/uploads/icons/show.png`, tags: ["theater tickets", "live performances", "concerts", "show bookings", "entertainment"] },
  { name: "Transport", image: `${BASE_URL}/uploads/icons/transport.png`, tags: ["transportation", "delivery services", "logistics", "shipping", "cargo"] },
  { name: "Sports", image: `${BASE_URL}/uploads/icons/sports.png`, tags: ["sports activities", "fitness", "team sports", "sports events", "training"] },
  { name: "Keep Company", image: `${BASE_URL}/uploads/icons/company.png`, tags: ["companionship", "social support", "elderly companionship", "friend services", "conversation"] },
  { name: "Find a Ride", image: `${BASE_URL}/uploads/icons/ride.png`, tags: ["ride sharing", "carpool", "taxi services", "transportation booking", "travel assistance"] },
  { name: "Fashion & Beauty", image: `${BASE_URL}/uploads/icons/fashion.png`, tags: ["makeup", "stylist", "salon", "skincare", "cosmetics"] },
  { name: "Party", image: `${BASE_URL}/uploads/icons/party.png`, tags: ["DJ", "makeup artist", "musicians", "entertainers", "party planning"] }
];

async function seedCategories() {
  try {
    for (let cat of default_categories) {
      // Check if category already exists
      let existing = await Category.findOne({ name: cat.name });
      if (existing) {
        console.log(`⚠️ Category already exists: ${cat.name}`);
        continue;
      }

      // Convert tags to {tagId, name} format
      const tags = cat.tags.map((t, idx) => ({ tagId: idx + 1, name: t }));

      // Create new category
      const newCategory = new Category({
        name: cat.name,
        image: cat.image,
        tags
      });

      await newCategory.save();
      console.log(`✅ Category created: ${cat.name}`);
    }
    console.log("🎉 Default categories seeding done!");
  } catch (err) {
    console.error("❌ Error seeding categories:", err);
  } finally {
    mongoose.disconnect();
  }
}

mongoose.connect("mongodb://localhost:27017/BeTogether")
  .then(() => {
    console.log("🚀 MongoDB connected");
    seedCategories();
  })
  .catch((err) => console.error("❌ DB connection error:", err));
