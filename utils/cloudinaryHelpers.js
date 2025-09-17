// utils/cloudinaryHelpers.js
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");

// Configure Cloudinary once using environment variables
// Add these in your .env file:
// CLOUDINARY_CLOUD_NAME=your-cloud-name
// CLOUDINARY_API_KEY=your-api-key
// CLOUDINARY_API_SECRET=your-api-secret
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Upload a buffer (from multer.memoryStorage) to Cloudinary
 * @param {Buffer} buffer - file buffer
 * @param {string} folder - target folder in Cloudinary
 * @param {string} publicId - optional public_id
 */
function uploadBufferToCloudinary(buffer, folder = "profile_images", publicId = null) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        overwrite: true,
        resource_type: "image",
        transformation: [{ width: 800, height: 800, crop: "limit" }], // optional resize
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

/**
 * Extract Cloudinary public_id from URL
 * @param {string} url - secure_url from Cloudinary
 * @returns {string|null}
 */
function extractPublicIdFromCloudinaryUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    // Example: https://res.cloudinary.com/demo/image/upload/v1697654321/profile_images/user_abc123.jpg
    const parts = url.split("/");
    const uploadIndex = parts.indexOf("upload");
    if (uploadIndex === -1) return null;

    // Get everything after /upload/
    const afterUpload = parts.slice(uploadIndex + 1).join("/");

    // Remove version if starts with v12345
    const segments = afterUpload.split("/");
    if (segments[0].startsWith("v") && /^\d+$/.test(segments[0].slice(1))) {
      segments.shift();
    }

    // Remove file extension
    const filename = segments.pop();
    const nameWithoutExt = filename.split(".").slice(0, -1).join(".");

    return [...segments, nameWithoutExt].join("/");
  } catch (e) {
    return null;
  }
}

/**
 * Delete Cloudinary image by public_id
 * @param {string} publicId
 */
function deleteCloudinaryImage(publicId) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.destroy(publicId, { resource_type: "image" }, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

/**
 * Normalize profile_image object/string to secure_url
 * @param {string|object} profileImage
 * @returns {string|null}
 */
function getFullImageUrl(profileImage) {
  if (!profileImage) return null;
  if (typeof profileImage === "string") return profileImage;
  if (profileImage.secure_url) return profileImage.secure_url;
  return null;
}

module.exports = {
  uploadBufferToCloudinary,
  extractPublicIdFromCloudinaryUrl,
  deleteCloudinaryImage,
  getFullImageUrl,
};
