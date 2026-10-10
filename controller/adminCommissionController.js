const CommissionSetting = require("../model/CommissionSetting");

exports.getCommission = async (req, res) => {
  try {
    let setting = await CommissionSetting.findOne();

    if (!setting) {
      setting = await CommissionSetting.create({
        providerCommissionPercentage: 8,
        customerCommissionPercentage: 4,
      });
    }

    res.status(200).json({
      providerCommissionPercentage: setting.providerCommissionPercentage || 8,

      customerCommissionPercentage: setting.customerCommissionPercentage || 4,

      requestLateCancellationPercentage:
        setting.requestLateCancellationPercentage || 0,

      requestLateCancellationAdminSharePercentage:
        setting.requestLateCancellationAdminSharePercentage || 0,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};

exports.updateCommission = async (req, res) => {
  try {
    const {
      providerCommissionPercentage,
      customerCommissionPercentage,
      requestLateCancellationPercentage,
      requestLateCancellationAdminSharePercentage,
      adminId,
    } = req.body;

    const invalidPercent = (value) =>
      value !== undefined &&
      (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100);

    if (invalidPercent(requestLateCancellationPercentage)) {
      return res.status(400).json({
        message: "Invalid request late cancellation value",
      });
    }
    if (invalidPercent(requestLateCancellationAdminSharePercentage)) {
      return res.status(400).json({
        message: "Invalid request late cancellation admin share value",
      });
    }

    if (
      providerCommissionPercentage < 0 ||
      providerCommissionPercentage > 100
    ) {
      return res.status(400).json({
        message: "Invalid provider commission value",
      });
    }

    if (
      customerCommissionPercentage < 0 ||
      customerCommissionPercentage > 100
    ) {
      return res.status(400).json({
        message: "Invalid customer commission value",
      });
    }

    const totalCommission =
      Number(providerCommissionPercentage) +
      Number(customerCommissionPercentage);

    if (totalCommission > 100) {
      return res.status(400).json({
        message: "Total commission cannot exceed 100%",
      });
    }

    const updated = await CommissionSetting.findOneAndUpdate(
      {},
      {
        providerCommissionPercentage,
        customerCommissionPercentage,
        // Only touched when the admin page sends it.
        ...(requestLateCancellationPercentage !== undefined && {
          requestLateCancellationPercentage: Number(requestLateCancellationPercentage),
        }),
        ...(requestLateCancellationAdminSharePercentage !== undefined && {
          requestLateCancellationAdminSharePercentage: Number(
            requestLateCancellationAdminSharePercentage,
          ),
        }),
        updatedBy: adminId,
        updatedAt: new Date(),
      },
      {
        upsert: true,
        new: true,
      },
    );

    res.status(200).json({
      isSuccess: true,
      message: "Commission updated successfully",
      data: updated,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};

// =====================================================================
// SERVICE REQUEST LATE CANCELLATION (admin Settings page)
// Used when a provider's offer has the "late_fee" policy and the customer
// cancels less than 1 hour before the start:
//   requestLateCancellationPercentage          → % of the amount kept
//                                                 (0 = nothing is charged)
//   requestLateCancellationAdminSharePercentage → BeTogether's % of what's
//                                                 kept; the rest goes to the
//                                                 provider
// Stored on the same CommissionSetting document.
// =====================================================================
const requestCancellationResponse = (setting) => ({
  requestLateCancellationPercentage: setting?.requestLateCancellationPercentage || 0,
  requestLateCancellationAdminSharePercentage:
    setting?.requestLateCancellationAdminSharePercentage || 0,
});

exports.getRequestCancellation = async (req, res) => {
  try {
    const setting = await CommissionSetting.findOne();
    res.status(200).json({ isSuccess: true, data: requestCancellationResponse(setting) });
  } catch (err) {
    res.status(500).json({ isSuccess: false, message: err.message });
  }
};

// POST (create) and PUT (update) — either field can be sent alone; 0 is valid.
exports.saveRequestCancellation = async (req, res) => {
  try {
    const {
      requestLateCancellationPercentage,
      requestLateCancellationAdminSharePercentage,
      adminId,
    } = req.body;

    const fields = {
      requestLateCancellationPercentage,
      requestLateCancellationAdminSharePercentage,
    };
    const update = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null || value === "") continue;
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return res.status(400).json({
          isSuccess: false,
          message: `${key} must be a number between 0 and 100`,
        });
      }
      update[key] = n;
    }
    if (!Object.keys(update).length) {
      return res.status(400).json({
        isSuccess: false,
        message:
          "Send requestLateCancellationPercentage and/or requestLateCancellationAdminSharePercentage",
      });
    }

    const updated = await CommissionSetting.findOneAndUpdate(
      {},
      { $set: { ...update, updatedBy: adminId, updatedAt: new Date() } },
      { upsert: true, new: true },
    );

    res.status(200).json({
      isSuccess: true,
      message: "Request cancellation charges saved",
      data: requestCancellationResponse(updated),
    });
  } catch (err) {
    res.status(500).json({ isSuccess: false, message: err.message });
  }
};

// DELETE — switches the charge off (both back to 0). Normal commission
// settings on the same document are not touched.
exports.deleteRequestCancellation = async (req, res) => {
  try {
    const updated = await CommissionSetting.findOneAndUpdate(
      {},
      {
        $set: {
          requestLateCancellationPercentage: 0,
          requestLateCancellationAdminSharePercentage: 0,
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );
    res.status(200).json({
      isSuccess: true,
      message: "Request cancellation charges removed",
      data: requestCancellationResponse(updated),
    });
  } catch (err) {
    res.status(500).json({ isSuccess: false, message: err.message });
  }
};
