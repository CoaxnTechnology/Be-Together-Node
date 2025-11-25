// utils/performanceProfile.js

/**
 * Returns performance summary of provider
 * @param {Object} provider - User model instance
 */
function getProviderPerformance(provider) {
  const total = provider.totalBookings || 0;
  const success = provider.successfulBookings || 0;
  const points = provider.performancePoints || 0;
  const restricted = provider.restrictedUntil && provider.restrictedUntil > new Date();

  const successRate = total === 0 ? 0 : Math.round((success / total) * 100);

  return {
    points,
    totalBookings: total,
    successfulBookings: success,
    successRate, // %
    restricted,  // true/false
  };
}

module.exports = { getProviderPerformance };
