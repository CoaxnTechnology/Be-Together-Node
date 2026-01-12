// scripts/seed-categories-cloudinary.js
// Usage:
//   DRY RUN (no writes):    node scripts/seed-categories-cloudinary.js --dry
//   Normal run:             node scripts/seed-categories-cloudinary.js
//   Force update existing:  node scripts/seed-categories-cloudinary.js --force
//
// Required env:
//   MONGO_URI, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
//
// Place local icon files in ./uploads/icons/ (names like pet.png, show.png, etc.)
require("dotenv").config();
const mongoose = require("mongoose");
const minimist = require("minimist");
const path = require("path");
const fs = require("fs");


const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const argv = minimist(process.argv.slice(2));
const DRY_RUN = argv.dry || argv.d === true;
const FORCE_UPDATE = argv.force || argv.f === true;

const ICON_SOURCE_DIR = path.join(__dirname, "uploads", "icons");

const Category = require("./model/Category");
async function buildLocalUrl(fileName) {
  if (!fileName) return null;

  // already URL — keep as is
  if (
    typeof fileName === "string" &&
    (fileName.startsWith("http://") || fileName.startsWith("https://"))
  ) {
    return fileName;
  }

  const localPath = path.join(ICON_SOURCE_DIR, fileName);

  if (!fs.existsSync(localPath)) {
    console.warn(`⚠️ Local icon file not found: ${localPath}`);
    return null;
  }

  return `${process.env.BASE_URL || process.env.MY_URL}/uploads/icons/${fileName}`;
}


const default_categories = [
  {
    name: "Pet Care",
    image: `pet.png`,
    tags: ["dog sitter", "pet care", "dog walking", "pet sitting"],
  },
  {
    name: "Childcare",
    image: `childcare.png`,
    tags: ["baby sitter", "childcare", "babysitting", "child supervision"],
  },
  {
    name: "Household Maintenance",
    image: `house.png`,
    tags: [
      "house chores",
      "cleaning",
      "ironing",
      "household fixes",
      "home maintenance",
    ],
  },
  {
    name: "Academic Support",
    image: `academic.png`,
    tags: [
      "school tutoring",
      "academic support",
      "math tutoring",
      "English tutoring",
      "education",
    ],
  },
  {
    name: "Home Repairs and Assembly",
    image: `repairs.png`,
    tags: [
      "small jobs",
      "plumbing",
      "electrician",
      "furniture assembly",
      "home repairs",
    ],
  },
  {
    name: "Elderly Care",
    image: `elderly.png`,
    tags: [
      "elderly assistance",
      "senior care",
      "companionship",
      "errands",
      "medication help",
    ],
  },
  {
    name: "Moving Services",
    image: `moving.png`,
    tags: [
      "moving help",
      "furniture moving",
      "box moving",
      "relocation assistance",
    ],
  },
  {
    name: "Language Services",
    image: `language.png`,
    tags: [
      "translations",
      "document translation",
      "CV translation",
      "language services",
      "interpreter"
    ],
  },
  {
    name: "Garden and Plant Maintenance",
    image: `garden.png`,
    tags: [
      "garden care",
      "plant care",
      "watering plants",
      "green space maintenance",
      "gardening",
    ],
  },
  // {
  //   name: "Translator",
  //   image: `translator.png`,
  //   tags: [
  //     "translation services",
  //     "language translation",
  //     "document translation",
  //     "interpreter",
  //     "multilingual",
  //   ],
  // },
  {
    name: "Plumber",
    image: `plumber.png`,
    tags: [
      "plumbing",
      "pipe repair",
      "leak fixing",
      "drainage",
      "water heater repair",
    ],
  },
  {
    name: "Cooking",
    image: `cooking.png`,
    tags: [
      "cooking services",
      "meal preparation",
      "catering",
      "home chef",
      "culinary",
    ],
  },
  {
    name: "Join an Event",
    image: `party.png`,
    tags: [
      "event participation",
      "event registration",
      "community events",
      "social gatherings",
      "event planning",
    ],
  },
  {
    name: "Explore Area",
    image: `explore.png`,
    tags: [
      "local exploration",
      "sightseeing",
      "travel guide",
      "area tours",
      "local attractions",
    ],
  },
  {
    name: "Attend Show",
    image: `show.png`,
    tags: [
      "theater tickets",
      "live performances",
      "concerts",
      "show bookings",
      "entertainment",
    ],
  },
  {
    name: "Transport",
    image: `transport.png`,
    tags: [
      "transportation",
      "delivery services",
      "logistics",
      "shipping",
      "cargo",
    ],
  },
  {
    name: "Sports",
    image: `sports.png`,
    tags: [
      "sports activities",
      "fitness",
      "team sports",
      "sports events",
      "training",
    ],
  },
  {
    name: "Keep Company",
    image: `company.png`,
    tags: [
      "companionship",
      "social support",
      "elderly companionship",
      "friend services",
      "conversation",
    ],
  },
  {
    name: "Find a Ride",
    image: `ride.png`,
    tags: [
      "ride sharing",
      "carpool",
      "taxi services",
      "transportation booking",
      "travel assistance",
    ],
  },
  {
    name: "Fashion & Beauty",
    image: `fashion.png`,
    tags: ["makeup", "stylist", "salon", "skincare", "cosmetics"],
  },
  {
    name: "Party",
    image: `party.png`,
    tags: [
      "DJ",
      "makeup artist",
      "musicians",
      "entertainers",
      "party planning",
    ],
  },
];


async function seed() {
  const mongoUri = process.env.MONGO_URI;
  const baseUrl = process.env.BASE_URL;

  if (!mongoUri || !baseUrl) {
    console.error("ERROR: set MONGO_URI and BASE_URL");
    process.exit(1);
  }

  await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  console.log("✅ Connected to MongoDB");

  let index = 1;   // 🔴 ORDER INDEX

  for (const cat of default_categories) {
    try {
      const imageUrl = await buildLocalUrl(cat.image);

      const existing = await Category.findOne({ name: cat.name });

      const payload = {
        name: cat.name,
        image: imageUrl,
        tags: Array.isArray(cat.tags) ? cat.tags : [],
        order: index,               // ✅ NEW FIELD
        slug: slugify(cat.name),    // optional
      };

      index++;   // increment

      if (DRY_RUN) {
        console.log("DRY RUN ->", payload);
        continue;
      }

      if (existing && FORCE_UPDATE) {
        existing.image = payload.image;
        existing.tags = payload.tags;
        existing.order = payload.order;
        await existing.save();

        console.log(`🔁 Updated category: ${cat.name}`);
      } 
      else if (!existing) {
        await Category.create(payload);
        console.log(`✅ Created category: ${cat.name}`);
      }
      else {
        console.log(`⏭️ Category exists: ${cat.name}`);
      }

    } catch (e) {
      console.error(`❌ Error ${cat.name}:`, e.message);
    }
  }

  await mongoose.disconnect();
  console.log("🎉 Seeding complete");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
