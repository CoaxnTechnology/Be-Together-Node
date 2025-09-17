function getFullImageUrl(profile_image) {
  if (!profile_image) return null;
  if (typeof profile_image === 'string') return profile_image;
  return profile_image.secure_url || null;
}

module.exports = { getFullImageUrl };