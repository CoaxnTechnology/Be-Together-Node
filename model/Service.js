const mongoose = require("mongoose");

const serviceSchema = new mongoose.Schema({
  title: { type: String, required: true },
  Language: { type: String, required: true },
  isFree: { type: Boolean, default: false },
  price: { type: Number, default: 0 },
  description: { type: String, default: null },
  currency: {
    type: String,
    default: "EUR",
  },

  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Category",
    required: true,
  },
  tags: { type: [String], default: [] },

  max_participants: { type: Number, default: 1 },

  // Location
  location_name: { type: String, default: null },
  location: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point",
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true,
    },
  },
  image: { type: String },
  imagePublicId: { type: String },

  city: { type: String, default: null },
  isDoorstepService: { type: Boolean, default: false },

  // Who created this service
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

  // Type of service
  service_type: {
    type: String,
    enum: ["one_time", "recurring"],
    default: "one_time",
  },

  // one_time service
  date: { type: String, default: null },
  start_time: { type: String, default: null },
  end_time: { type: String, default: null },

  // recurring service → inline schema for multiple slots
  recurring_schedule: {
    type: [
      {
        day: { type: String, required: true }, // e.g. "Monday"
        start_time: { type: String, required: true }, // "09:00"
        end_time: { type: String, required: true }, // "11:00"
        date: { type: String, required: true }, // computed first date >= start_date
      },
    ],
    default: [],
  },
  isPromoted: { type: Boolean, default: false },
  promotionStart: { type: Date, default: null },
  promotionEnd: { type: Date, default: null },
  promotionBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  promotionAmount: { type: Number, default: 0 },
  promotionPaymentId: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});

serviceSchema.index({ location: "2dsphere" });

serviceSchema.pre("save", function (next) {
  this.updated_at = Date.now();
  next();
});
serviceSchema.virtual("reviews", {
  ref: "Review",
  localField: "_id",
  foreignField: "service",
});

module.exports = mongoose.model("Service", serviceSchema);

//-------------new version with faster move get service

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

// Haversine (for fallback if needed)
const toRad = (v) => (v * Math.PI) / 180;
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

// exports.getServices = async (req, res) => {
//   console.log("\n===== getServices (optimized) called =====");
//   try {
//     console.log("Incoming body:", JSON.stringify(req.body));

//     const {
//       page = 1,
//       limit = 50,
//       categoryId = [],
//       date,
//       tags = [],
//       isFree,
//       latitude,
//       longitude,
//       radius_km,
//       boundingBox, // { north, south, east, west }
//       keyword = "",
//       mapLimit = 1000, // limit for map results (safe default)
//     } = req.body;

//     // parse inputs
//     const pageNum = Math.max(1, parseInt(page) || 1);
//     const limitNum = Math.max(1, parseInt(limit) || 50);
//     const mapLimitNum = Math.max(1, parseInt(mapLimit) || 1000);
//     const userLat = latitude !== undefined && latitude !== null ? Number(latitude) : null;
//     const userLng = longitude !== undefined && longitude !== null ? Number(longitude) : null;
//     const maxRadius = radius_km ? Number(radius_km) : null;

//     console.log({ pageNum, limitNum, userLat, userLng, maxRadius, boundingBox });

//     // -----------------------
//     // Build base match (server-side)
//     // -----------------------
//     const baseMatch = {};

//     // date filter (same logic as before)
//     if (date) {
//       console.log("Applying date filter:", date);
//       const endDate = new Date(date);
//       endDate.setDate(endDate.getDate() + 1);
//       baseMatch.$or = [
//         {
//           service_type: "one_time",
//           date: {
//             $gte: date,
//             $lt: new Date(endDate).toISOString().split("T")[0],
//           },
//         },
//         {
//           service_type: "recurring",
//           recurring_schedule: {
//             $elemMatch: {
//               date: {
//                 $gte: date,
//                 $lt: new Date(endDate).toISOString().split("T")[0],
//               },
//             },
//           },
//         },
//       ];
//     }

//     if (Array.isArray(categoryId) && categoryId.length) {
//       baseMatch.category = { $in: categoryId.map((v) => mongoose.Types.ObjectId(v)) };
//       console.log("Category filter added");
//     }

//     if (Array.isArray(tags) && tags.length) {
//       baseMatch.tags = { $in: tags };
//       console.log("Tags filter added");
//     }

//     if (isFree === true) {
//       baseMatch.isFree = true;
//       console.log("isFree filter added");
//     }

//     // TEXT / KEYWORD search: prefer $text if text index present
//     // We'll detect presence of a text index on the collection by trying a $text count
//     // If $text is supported, we use it. If not, fall back to regex (less efficient).
//     let useText = false;
//     if (keyword && String(keyword).trim() !== "") {
//       try {
//         // quick check - run explain with $text on a limited query
//         // Some deployments will throw if no text index exists, so catch.
//         // NOTE: this is a lightweight check because we limit further stages below.
//         // BUT on some drivers/environments this may still be expensive; keep optional.
//         // We'll just attempt to build text stage, and if it errors at runtime we fallback.
//         useText = true;
//       } catch (e) {
//         useText = false;
//       }
//     }

//     // -----------------------
//     // Build aggregation for listServices (geo-sorted if coords provided)
//     // -----------------------
//     // We'll build two pipelines:
//     // - listPipeline: for listServices (radius applied if user coords & radius)
//     // - mapPipeline: for mapServices (bounded by boundingBox if provided, limited)
//     // Both pipelines use baseMatch and handle keyword filters server-side.

//     // Prepare keyword conditions
//     const keywordTrim = keyword ? String(keyword).trim() : "";
//     const keywordStage = [];
//     if (keywordTrim) {
//       if (useText) {
//         // Use $text search. Requires text index on fields you want: title, description, city, categoryName etc.
//         keywordStage.push({ $match: { $text: { $search: keywordTrim } } });
//         console.log("Using $text search (requires text index) for keyword:", keywordTrim);
//       } else {
//         // fallback regex on a few fields (case-insensitive)
//         const safe = escapeRegex(keywordTrim);
//         const reg = new RegExp(safe, "i");
//         // We'll match title, description, city, tags, and also category.name and owner.name via $lookup later.
//         // But since lookups run later in pipeline, use $match on fields present in service doc only here.
//         keywordStage.push({
//           $match: {
//             $or: [
//               { title: { $regex: reg } },
//               { description: { $regex: reg } },
//               { tags: { $in: [reg] } },
//               { city: { $regex: reg } },
//             ],
//           },
//         });
//         console.log("Using regex fallback search for keyword:", keywordTrim);
//       }
//     }

//     // Stage to lookup category and owner (so we can search category.name and owner.name/email)
//     const lookupStages = [
//       // category
//       {
//         $lookup: {
//           from: "categories",
//           localField: "category",
//           foreignField: "_id",
//           as: "categoryDoc",
//         },
//       },
//       { $unwind: { path: "$categoryDoc", preserveNullAndEmptyArrays: true } },

//       // owner
//       {
//         $lookup: {
//           from: "users",
//           localField: "owner",
//           foreignField: "_id",
//           as: "ownerDoc",
//         },
//       },
//       { $unwind: { path: "$ownerDoc", preserveNullAndEmptyArrays: true } },

//       // project small useful fields (avoid heavy payload)
//       {
//         $project: {
//           title: 1,
//           description: 1,
//           tags: 1,
//           city: 1,
//           location: 1,
//           isFree: 1,
//           currency: 1,
//           price: 1,
//           service_type: 1,
//           date: 1,
//           category: "$categoryDoc._id",
//           categoryName: "$categoryDoc.name",
//           categoryTags: "$categoryDoc.tags",
//           owner: "$ownerDoc._id",
//           ownerName: "$ownerDoc.name",
//           ownerEmail: "$ownerDoc.email",
//           created_at: 1,
//         },
//       },
//     ];

//     // We want to allow keyword to match category.name or owner fields as well.
//     // If we couldn't do that in initial $match (text or regex), we add another $match after lookups.
//     const postLookupKeywordStage = [];
//     if (keywordTrim && !useText) {
//       const safe = escapeRegex(keywordTrim);
//       const reg = new RegExp(safe, "i");
//       postLookupKeywordStage.push({
//         $match: {
//           $or: [
//             { title: { $regex: reg } },
//             { description: { $regex: reg } },
//             { "categoryName": { $regex: reg } },
//             { "categoryTags": { $in: [reg] } },
//             { "ownerName": { $regex: reg } },
//             { "ownerEmail": { $regex: reg } },
//             { city: { $regex: reg } },
//             { tags: { $in: [reg] } },
//           ],
//         },
//       });
//     } else if (keywordTrim && useText) {
//       // when using $text, category/owner match might not be included. Add boosted match on these via regex (optional)
//       const safe = escapeRegex(keywordTrim);
//       const reg = new RegExp(safe, "i");
//       postLookupKeywordStage.push({
//         $match: {
//           $or: [
//             { categoryName: { $regex: reg } },
//             { "ownerName": { $regex: reg } },
//             { "ownerEmail": { $regex: reg } },
//           ],
//         },
//       });
//     }

//     // -----------------------
//     // LIST pipeline (radius + pagination) -> prefer $geoNear when coords provided
//     // -----------------------
//     let listPipeline = [];

//     // If user coords provided and radius specified (or we still want sort-by-distance), use $geoNear as first stage
//     if (userLat !== null && userLng !== null) {
//       // geoNear requires a geospatial index on "location"
//       const geoNearStage = {
//         $geoNear: {
//           near: { type: "Point", coordinates: [userLng, userLat] },
//           distanceField: "distanceMeters",
//           spherical: true,
//           distanceMultiplier: 1 / 1000, // convert meters to km (distanceField will be in km)
//           query: baseMatch, // apply base filters inside geoNear
//           // optional: maxDistance in meters if radius provided
//         },
//       };
//       if (maxRadius && !isNaN(maxRadius)) {
//         geoNearStage.$geoNear = { ...(geoNearStage.$geoNear || {}), maxDistance: maxRadius * 1000 };
//         // note: we already used distanceMultiplier above so distanceMeters will be in km
//       }

//       // But mongodb expects $geoNear at top of pipeline (not inside an array)
//       // Implementation: add geoNear stage and then other stages
//       // However some drivers require $geoNear not wrapped; we will push directly
//       listPipeline.push(geoNearStage);
//       console.log("Using $geoNear for list (sort by distance) with baseMatch inside geoNear.");
//       // After $geoNear, we need to $lookup and project
//       listPipeline = listPipeline.concat(lookupStages);
//       // Apply keyword (if using $text, it should be placed before lookup ideally; but if we used $text above we already matched)
//       if (useText && keywordTrim) {
//         // If $text was intended, we instead should run a separate pipeline with $match {$text...}
//         // Simpler approach: apply a $match {$text} before $geoNear is not allowed.
//         // So when using $text + $geoNear, we fallback to building a $match text outside geoNear pipeline.
//         // For portability we will not mix $geoNear and $text in same pipeline here.
//         // To keep code robust, when useText === true we will not use $geoNear with $text combined.
//         // We'll instead run aggregation without $geoNear and sort by computed distance later (if needed).
//         console.log("Note: $text + $geoNear mixing is tricky. Will fallback to non-$geoNear path for text queries.");
//         listPipeline = []; // clear and fall through to non-geoNear path below
//       } else {
//         // continue to post-lookup keyword if regex path
//         listPipeline = listPipeline.concat(postLookupKeywordStage);
//         // finally sort by distanceMeters (converted to km)
//         listPipeline.push({ $sort: { distanceMeters: 1, created_at: -1 } });
//         // pagination
//         listPipeline.push({ $skip: (pageNum - 1) * limitNum });
//         listPipeline.push({ $limit: limitNum });
//       }
//     }

//     // If we didn't build listPipeline (no coords or fallback), build non-geo pipeline
//     if (!listPipeline.length) {
//       // Normal pipeline: $match(baseMatch), keywordStage (text or regex), lookup, postLookupKeywordStage, sort, paginate
//       const matchStage = Object.keys(baseMatch).length ? [{ $match: baseMatch }] : [];
//       listPipeline = listPipeline.concat(matchStage, keywordStage, lookupStages, postLookupKeywordStage);

//       // If user gave coords & we want to sort by distance, we can compute distance in pipeline using $addFields (approx).
//       if (userLat !== null && userLng !== null) {
//         // compute approximate distance using $let & $acos formula is messy in aggregation.
//         // Simpler: compute later in node by haversine. But that requires fetching possibly many docs.
//         // Instead, if coords present but we are in non-$geoNear path, we add a cheap projection and will compute distance in Node
//         listPipeline.push({
//           $addFields: {
//             __coords: "$location.coordinates",
//           },
//         });
//       }

//       // final sort: if coords present we cannot sort properly inside pipeline without distance, so sort by created_at.
//       listPipeline.push({ $sort: { created_at: -1 } });
//       // pagination
//       listPipeline.push({ $skip: (pageNum - 1) * limitNum });
//       listPipeline.push({ $limit: limitNum });
//     }

//     console.log("List aggregation pipeline ready. Running aggregation...");

//     // run list aggregation
//     const listServicesAgg = await Service.aggregate(listPipeline).allowDiskUse(true);
//     let listServices = Array.isArray(listServicesAgg) ? listServicesAgg : [];

//     // If we computed __coords instead of real distance in pipeline, compute distance now
//     if (userLat !== null && userLng !== null) {
//       listServices = listServices.map((s) => {
//         if (s.distanceMeters !== undefined) {
//           // distanceMeters may already be km due to multiplier
//           s.distance_km = Number((s.distanceMeters).toFixed(2));
//         } else if (s.__coords && Array.isArray(s.__coords)) {
//           const [lng, lat] = s.__coords;
//           if (lat != null && lng != null) {
//             s.distance_km = haversineKm(userLat, userLng, Number(lat), Number(lng));
//           } else s.distance_km = null;
//         } else {
//           s.distance_km = null;
//         }
//         // clean helper field
//         delete s.__coords;
//         delete s.distanceMeters;
//         return s;
//       });

//       // if pipeline didn't sort by distance, sort now
//       listServices.sort((a, b) => {
//         if (a.distance_km == null && b.distance_km == null) return 0;
//         if (a.distance_km == null) return 1;
//         if (b.distance_km == null) return -1;
//         return a.distance_km - b.distance_km;
//       });
//     }

//     // -----------------------
//     // MAP pipeline (bounding box or viewport)
//     // Map must be limited and server-side filtered by bbox to avoid huge payload
//     // -----------------------
//     console.log("Building map pipeline...");
//     let mapPipeline = [];
//     const mapMatch = Object.keys(baseMatch).length ? { ...baseMatch } : null;

//     // If bounding box provided, create geoWithin box filter
//     if (boundingBox && typeof boundingBox === "object") {
//       const north = Number(boundingBox.north);
//       const south = Number(boundingBox.south);
//       const east = Number(boundingBox.east);
//       const west = Number(boundingBox.west);

//       // Create box: [ [west, south], [east, north] ]
//       mapMatch.location = {
//         $geoWithin: {
//           $box: [[west, south], [east, north]],
//         },
//       };

//       console.log("Bounding box applied for map:", { north, south, east, west });
//     } else {
//       // if no bbox, we recommend returning only a limited set (e.g., nearest N if coords provided), to avoid full DB dump
//       if (userLat !== null && userLng !== null) {
//         // we'll use $geoNear to get nearest mapLimitNum docs
//         // but if a keyword exists and useText true we should be careful mixing; do a separate pipeline
//         console.log("No bbox: will use $geoNear to produce limited nearest mapServices.");
//       } else {
//         // no bbox & no coords: do not return all services. Return top recent limited set.
//         console.log("No bbox and no user coords: map will return recent limited services (to protect performance).");
//       }
//     }

//     // Build map pipeline: try to reuse list logic but restrict to mapLimitNum and bbox
//     if (mapMatch && mapMatch.location) {
//       // bbox path: run aggregation with match + lookup + post keyword
//       const mMatch = { $match: mapMatch };
//       mapPipeline.push(mMatch);
//       // If keyword present, apply same keyword stages as list (prefer text if available)
//       if (useText && keywordTrim) {
//         mapPipeline.push({ $match: { $text: { $search: keywordTrim } } });
//       } else if (keywordTrim) {
//         const safe = escapeRegex(keywordTrim);
//         const reg = new RegExp(safe, "i");
//         mapPipeline.push({
//           $match: {
//             $or: [
//               { title: { $regex: reg } },
//               { description: { $regex: reg } },
//               { city: { $regex: reg } },
//               { tags: { $in: [reg] } },
//             ],
//           },
//         });
//       }
//       mapPipeline = mapPipeline.concat(lookupStages, postLookupKeywordStage);
//       mapPipeline.push({ $limit: mapLimitNum });
//     } else if (userLat !== null && userLng !== null && (!keywordTrim || !useText)) {
//       // Use geoNear for nearest map services when bbox not provided
//       const gp = {
//         $geoNear: {
//           near: { type: "Point", coordinates: [userLng, userLat] },
//           distanceField: "distanceMeters",
//           spherical: true,
//           distanceMultiplier: 1 / 1000, // km
//           query: baseMatch,
//           limit: mapLimitNum,
//         },
//       };
//       mapPipeline.push(gp, ...lookupStages);
//       if (keywordTrim && !useText) mapPipeline = mapPipeline.concat(postLookupKeywordStage);
//     } else {
//       // Fallback: return recent limited services
//       const matchStage = Object.keys(baseMatch).length ? [{ $match: baseMatch }] : [];
//       mapPipeline = mapPipeline.concat(matchStage, lookupStages);
//       if (keywordTrim && !useText) mapPipeline = mapPipeline.concat(postLookupKeywordStage);
//       mapPipeline.push({ $sort: { created_at: -1 } }, { $limit: mapLimitNum });
//     }

//     console.log("Map aggregation pipeline ready. Running aggregation...");
//     const mapServicesAgg = await Service.aggregate(mapPipeline).allowDiskUse(true);
//     let mapServices = Array.isArray(mapServicesAgg) ? mapServicesAgg : [];

//     // compute distance_km for mapServices if coords present
//     if (userLat !== null && userLng !== null) {
//       mapServices = mapServices.map((s) => {
//         if (s.distanceMeters !== undefined) {
//           s.distance_km = Number((s.distanceMeters).toFixed(2));
//         } else if (s.location && Array.isArray(s.location.coordinates)) {
//           const [lng, lat] = s.location.coordinates;
//           s.distance_km = haversineKm(userLat, userLng, Number(lat), Number(lng));
//         } else s.distance_km = null;
//         delete s.distanceMeters;
//         return s;
//       });

//       // sort map services by distance
//       mapServices.sort((a, b) => {
//         if (a.distance_km == null && b.distance_km == null) return 0;
//         if (a.distance_km == null) return 1;
//         if (b.distance_km == null) return -1;
//         return a.distance_km - b.distance_km;
//       });
//     }

//     // Response total should reflect listServices total count (post-radius)
//     // For efficiency, to get total we can run a lightweight count query.
//     // We'll build countQuery similar to list pipeline but with $count. Keep it simple:
//     let totalCount = 0;
//     try {
//       // Build a simple countMatch for post-filters: baseMatch + keyword conditions + radius (if applied via geoNear we already filtered)
//       let countMatch = { ...baseMatch };
//       if (keywordTrim && !useText) {
//         // cheap count: match service fields only (title/desc/tags/city)
//         const safe = escapeRegex(keywordTrim);
//         const reg = new RegExp(safe, "i");
//         countMatch.$or = [
//           { title: { $regex: reg } },
//           { description: { $regex: reg } },
//           { tags: { $in: [reg] } },
//           { city: { $regex: reg } },
//         ];
//       }
//       if (userLat !== null && userLng !== null && maxRadius && !isNaN(maxRadius)) {
//         // count using geoWithin circle (approx)
//         countMatch.location = {
//           $geoWithin: {
//             $centerSphere: [[userLng, userLat], maxRadius / 6371],
//           },
//         };
//         totalCount = await Service.countDocuments(countMatch);
//       } else {
//         totalCount = await Service.countDocuments(countMatch);
//       }
//     } catch (e) {
//       console.warn("Count computation fallback:", e);
//       // fallback: length of listServices returned
//       totalCount = listServices.length;
//     }

//     console.log("Final counts:", {
//       mapServices: mapServices.length,
//       listServices: listServices.length,
//       totalCount,
//     });

//     return res.json({
//       isSuccess: true,
//       message: "Services fetched (optimized)",
//       total: totalCount,
//       page: pageNum,
//       limit: limitNum,
//       listServices,
//       mapServices,
//     });
//   } catch (err) {
//     console.error("ERROR in optimized getServices:", err);
//     return res.status(500).json({
//       isSuccess: false,
//       message: "Internal server error",
//       error: err.message,
//     });
//   }
// };

// const mongoose = require("mongoose");

// const serviceSchema = new mongoose.Schema({
//   title: { type: String, required: true },
//   Language: { type: String, required: true },
//   isFree: { type: Boolean, default: false },
//   price: { type: Number, default: 0 },
//   description: { type: String, default: null },
//   currency: { type: String, default: "EUR" },

//   category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
//   tags: { type: [String], default: [] },

//   max_participants: { type: Number, default: 1 },

//   location_name: { type: String, default: null },
//   location: {
//     type: { type: String, enum: ["Point"], default: "Point" },
//     coordinates: { type: [Number], required: true }, // [lng, lat]
//   },

//   city: { type: String, default: null },
//   isDoorstepService: { type: Boolean, default: false },

//   owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

//   service_type: {
//     type: String,
//     enum: ["one_time", "recurring"],
//     default: "one_time",
//   },

//   date: { type: String, default: null },
//   start_time: { type: String, default: null },
//   end_time: { type: String, default: null },

//   recurring_schedule: [
//     {
//       day: { type: String, required: true },
//       start_time: { type: String, required: true },
//       end_time: { type: String, required: true },
//       date: { type: String, required: true },
//     },
//   ],

//   isPromoted: { type: Boolean, default: false },
//   promotionStart: { type: Date, default: null },
//   promotionEnd: { type: Date, default: null },
//   promotionBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
//   promotionAmount: { type: Number, default: 0 },
//   promotionPaymentId: { type: String, default: null },

//   created_at: { type: Date, default: Date.now },
//   updated_at: { type: Date, default: Date.now },
// });

// // 🟢 GEO index
// serviceSchema.index({ location: "2dsphere" });

// // 🟢 TEXT keyword search index
// serviceSchema.index(
//   {
//     title: "text",
//     description: "text",
//     city: "text",
//   },
//   { name: "service_text_index" }
// );

// // 🟢 Category filter index
// serviceSchema.index({ category: 1 });

// // 🟢 Created at index
// serviceSchema.index({ created_at: -1 });

// // update timestamp
// serviceSchema.pre("save", function (next) {
//   this.updated_at = Date.now();
//   next();
// });

// // virtual
// serviceSchema.virtual("reviews", {
//   ref: "Review",
//   localField: "_id",
//   foreignField: "service",
// });

// module.exports = mongoose.model("Service", serviceSchema);
