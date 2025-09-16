const getFullImageUrl = (filename) => {
  if (!filename) return null;
  const serverUrl = process.env.SERVER_URL || "http://localhost:3000";
  return `${serverUrl}/uploads/profile_images/${filename}`;
};

module.exports = { getFullImageUrl };
