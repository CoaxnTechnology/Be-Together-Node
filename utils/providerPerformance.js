// utils/providerPerformance.js
const User = require("../model/User");

async function updateProviderPerformance(
  providerId,
  completedCount = 0,
  failedCount = 0
) {
  try {
    const provider = await User.findById(providerId);
    if (!provider) return;

    const totalForThisService = completedCount + failedCount;
    if (totalForThisService === 0) return;

    // ⭐ 1. Calculate service performance %
    const serviceScore = (completedCount / totalForThisService) * 100;

    // Old stats
    const oldScore = provider.performancePoints || 0;
    const oldTotal = provider.totalBookings || 0;

    // ⭐ 2. Weighted Score
    const newWeightedScore =
      (oldScore * oldTotal + serviceScore * totalForThisService) /
      (oldTotal + totalForThisService);

    provider.performancePoints = Math.round(newWeightedScore);

    // ⭐ 3. Update total & successful bookings
    provider.totalBookings = oldTotal + totalForThisService;
    provider.successfulBookings =
      (provider.successfulBookings || 0) + completedCount;

    // ⭐ 4. Restrict provider if score < 70 → block new service creation
    if (provider.performancePoints < 70) {
      provider.restrictionOnNewServiceUntil = new Date(
        Date.now() + 24 * 60 * 60 * 1000
      );
    } else {
      // ⭐ 5. IF score improves → remove previous restriction
      provider.restrictionOnNewServiceUntil = null;
    }

    await provider.save();

    console.log(
      `✅ Provider ${provider.name} updated → Score: ${provider.performancePoints}`
    );
  } catch (err) {
    console.error("❌ updateProviderPerformance ERROR:", err.message);
  }
}

module.exports = updateProviderPerformance;
