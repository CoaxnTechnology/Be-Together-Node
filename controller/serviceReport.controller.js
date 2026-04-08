const ServiceReport = require("../model/serviceReport");
const Service = require("../model/Service");

// ==========================
// REPORT SERVICE
// ==========================
exports.reportService = async (req, res) => {
  try {
    const { serviceId, reason, message } = req.body;

    const userId = req.user._id; // ✅ FIX

    if (!serviceId || !reason) {
      return res.status(400).json({
        isSuccess: false,
        message: "serviceId and reason required",
      });
    }

    const existing = await ServiceReport.findOne({
      service: serviceId,
      reportedBy: userId,
    });

    if (existing) {
      return res.json({
        isSuccess: false,
        message: "You already reported this service",
      });
    }

    await ServiceReport.create({
      service: serviceId,
      reportedBy: userId,
      reason,
      message,
    });

    return res.json({
      isSuccess: true,
      message: "Service reported successfully",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      isSuccess: false,
      message: "Server error",
    });
  }
};
exports.getReportedServices = async (req, res) => {
  try {
    const reports = await ServiceReport.find({ status: "pending" })
      .populate({
        path: "service",
        populate: [
          { path: "owner", select: "name email profile_image" },
          { path: "category", select: "name" },
        ],
      })
      .populate("reportedBy", "name email profile_image");

    // group by service
    const grouped = {};

    reports.forEach((r) => {
      const id = r.service._id.toString();

      if (!grouped[id]) {
        grouped[id] = {
          service: r.service,
          reports: [],
        };
      }

      grouped[id].reports.push({
        user: r.reportedBy,
        reason: r.reason,
        message: r.message,
      });
    });

    const result = Object.values(grouped).map((item) => ({
      ...item,
      totalReports: item.reports.length,
    }));

    return res.json({
      isSuccess: true,
      data: result,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ isSuccess: false });
  }
};

exports.approveReport = async (req, res) => {
  try {
    const { serviceId } = req.body;

    // delete service
    await Service.findByIdAndDelete(serviceId);

    // update reports
    await ServiceReport.updateMany(
      { service: serviceId },
      { status: "approved" },
    );

    return res.json({
      isSuccess: true,
      message: "Service deleted by admin",
    });
  } catch (err) {
    res.status(500).json({ isSuccess: false });
  }
};
exports.rejectReport = async (req, res) => {
  try {
    const { serviceId } = req.body;

    await ServiceReport.updateMany(
      { service: serviceId },
      { status: "rejected" },
    );

    return res.json({
      isSuccess: true,
      message: "Reports rejected",
    });
  } catch (err) {
    res.status(500).json({ isSuccess: false });
  }
};
