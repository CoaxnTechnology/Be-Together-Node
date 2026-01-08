function getFullImageUrl(profile_image) {
  if (!profile_image) return null;

  // already full URL (CSV / external / future CDN)
  if (profile_image.startsWith("http")) {
    return profile_image;
  }

  // local uploaded image
  return `${process.env.BASE_URL}${profile_image}`;
}

module.exports = { getFullImageUrl };
