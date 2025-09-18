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
const cloudinary = require("cloudinary").v2;

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

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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

async function uploadIconIfLocal(imageValue, publicIdBase) {
  // If imageValue already looks like an http/https URL — return as-is
  if (!imageValue) return null;
  if (
    typeof imageValue === "string" &&
    (imageValue.startsWith("http://") || imageValue.startsWith("https://"))
  ) {
    return imageValue;
  }

  // If imageValue is a filename (e.g., "pet.png"), try to upload local file
  const localPath = path.join(ICON_SOURCE_DIR, imageValue);
  if (!fs.existsSync(localPath)) {
    console.warn(
      `⚠️ Local icon file not found: ${localPath} — skipping upload, keeping original value if any.`
    );
    return null;
  }

  const pubId = `${publicIdBase}`; // e.g., categories/pet-care
  try {
    console.log(`⬆️ Uploading ${localPath} to Cloudinary as ${pubId} ...`);
    const res = await cloudinary.uploader.upload(localPath, {
      folder: "categories",
      public_id: pubId.replace(/^categories\/?/, ""), // cloudinary will place into folder
      overwrite: true,
      resource_type: "image",
    });
    if (res && res.secure_url) {
      console.log(`  -> uploaded: ${res.secure_url}`);
      return res.secure_url;
    }
    console.warn("  -> upload returned no secure_url, result:", res);
    return null;
  } catch (err) {
    console.error("  -> Cloudinary upload error:", err);
    return null;
  }
}

async function seed() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("ERROR: set MONGO_URI env var before running.");
    process.exit(1);
  }
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    console.error(
      "ERROR: set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET env vars."
    );
    process.exit(1);
  }

  await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log("✅ Connected to MongoDB");

  for (const cat of default_categories) {
    try {
      const slug = slugify(cat.name);
      const publicIdBase = `categories/${slug}`;

      const existing = await Category.findOne({ name: cat.name });

      if (existing && !FORCE_UPDATE) {
        console.log(`⏭️ Category exists: ${cat.name} (skipping)`);
        continue;
      }

      // upload local icon if provided as filename; otherwise if cat.image is already URL, keep it
      let imageUrl = cat.image;
      // If cat.image looks like a filename (no http) try local upload
      if (
        imageUrl &&
        !imageUrl.startsWith("http://") &&
        !imageUrl.startsWith("https://")
      ) {
        const uploaded = await uploadIconIfLocal(imageUrl, publicIdBase);
        if (uploaded) imageUrl = uploaded;
        else {
          // fallback: if upload failed and the original value was a filename, set imageUrl null so DB stores null
          imageUrl = null;
        }
      }

      const payload = {
        name: cat.name,
        image: imageUrl,
        tags: Array.isArray(cat.tags) ? cat.tags : [],
      };

      if (DRY_RUN) {
        console.log("DRY RUN -> would create/update category:", payload);
        continue;
      }

      if (existing) {
        // update existing
        existing.image = payload.image;
        existing.tags = payload.tags;
        await existing.save();
        console.log(`🔁 Updated category: ${cat.name}`);
      } else {
        const created = new Category(payload);
        await created.save();
        console.log(`✅ Created category: ${cat.name}`);
      }
    } catch (errCat) {
      console.error(`❌ Error handling category ${cat.name}:`, errCat);
    }
  }

  console.log("🎉 Seeding complete.");
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
