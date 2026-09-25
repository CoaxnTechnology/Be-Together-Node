const ServiceReport = require("../model/serviceReport");
const Service = require("../model/Service");
const User = require("../model/User");
const Booking = require("../model/Booking");
const AdminNotification = require("../model/AdminNotification");
const { banUser } = require("../utils/banUser");
const notificationController = require("./notificationController");

const URGENT_CATEGORIES = ["harassment", "inappropriate_request"];

// ==========================
// REPORT — a Service (existing, unchanged behavior when `type` is omitted)
// OR a User (new — no-show, harassment, fraud, etc.)
// ==========================
exports.reportService = async (req, res) => {
  try {
    const userId = req.user._id; // ✅ FIX
    const { type = "service" } = req.body;

    if (type === "user") {
      const { reportedUserId, bookingId, category, message } = req.body;

      // ⭐ A "user" report must always be tied to a real booking, and only
      // the two parties on that booking may report each other — nobody else
      // can file a user-report, and not against anyone outside that booking.
      if (!reportedUserId || !category || !bookingId) {
        return res.status(400).json({
          isSuccess: false,
          message: "reportedUserId, bookingId and category required",
        });
      }
      if (String(reportedUserId) === String(userId)) {
        return res
          .status(400)
          .json({ isSuccess: false, message: "You cannot report yourself" });
      }

      const reportedUser = await User.findById(reportedUserId).select("_id name");
      if (!reportedUser) {
        return res.status(404).json({ isSuccess: false, message: "User not found" });
      }

      const booking = await Booking.findById(bookingId).select("customer provider");
      if (!booking) {
        return res
          .status(404)
          .json({ isSuccess: false, message: "Booking not found" });
      }

      const isReporterCustomer = String(booking.customer) === String(userId);
      const isReporterProvider = String(booking.provider) === String(userId);
      if (!isReporterCustomer && !isReporterProvider) {
        return res.status(403).json({
          isSuccess: false,
          message: "You can only report a user from your own booking",
        });
      }
      const otherParty = isReporterCustomer ? booking.provider : booking.customer;
      if (String(otherParty) !== String(reportedUserId)) {
        return res.status(400).json({
          isSuccess: false,
          message: "reportedUserId does not match the other party on this booking",
        });
      }

      // ⭐ Only block a duplicate report for the SAME booking/incident —
      // a different booking is a genuinely different incident and must
      // always be allowed through, even against the same person.
      const existing = await ServiceReport.findOne({
        type: "user",
        reportedUser: reportedUserId,
        reportedBy: userId,
        booking: bookingId,
        status: "pending",
      });
      if (existing) {
        return res.json({
          isSuccess: false,
          message: "You already reported this user for this booking",
        });
      }

      // ⭐ No automatic account-side effect on submission — only urgent
      // categories get flagged for priority review; nothing changes for the
      // reported account until an admin explicitly resolves it.
      const severity = URGENT_CATEGORIES.includes(category) ? "urgent" : "standard";

      const report = await ServiceReport.create({
        type: "user",
        reportedUser: reportedUserId,
        booking: bookingId,
        reportedBy: userId,
        reason: category,
        message: message || null,
        severity,
      });

      await AdminNotification.create({
        type: "user_report",
        severity,
        message: `${category} report filed against ${reportedUser.name || "a user"}`,
        report: report._id,
      });

      return res.json({
        isSuccess: true,
        message: "User reported successfully",
      });
    }

    // ---- existing "service" report behavior, byte-for-byte unchanged ----
    const { serviceId, reason, message } = req.body;

    if (!serviceId || !reason) {
      return res.status(400).json({
        isSuccess: false,
        message: "serviceId and reason required",
      });
    }

    const existing = await ServiceReport.findOne({
      type: "service",
      service: serviceId,
      reportedBy: userId,
    });

    if (existing) {
      return res.json({
        isSuccess: false,
        message: "You already reported this service",
      });
    }

    const serviceReport = await ServiceReport.create({
      type: "service",
      service: serviceId,
      reportedBy: userId,
      reason,
      message,
    });

    await AdminNotification.create({
      type: "service_report",
      severity: "standard",
      message: `Service reported: ${reason}`,
      report: serviceReport._id,
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

// ==========================
// LIST (admin) — both types, one endpoint
// ==========================
exports.getReportedServices = async (req, res) => {
  try {
    const serviceReports = await ServiceReport.find({
      type: "service",
      status: "pending",
    })
      .populate({
        path: "service",
        populate: [
          { path: "owner", select: "name email profile_image" },
          { path: "category", select: "name" },
        ],
      })
      .populate("reportedBy", "name email profile_image");

    // group by service (existing logic, unchanged)
    const grouped = {};
    serviceReports.forEach((r) => {
      if (!r.service) return;
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

    const services = Object.values(grouped).map((item) => ({
      ...item,
      totalReports: item.reports.length,
    }));

    // ⭐ NEW: user-type reports, urgent first
    const userReports = await ServiceReport.find({
      type: "user",
      status: "pending",
    })
      .populate("reportedBy", "name email profile_image mobile city")
      // ⭐ Full profile snapshot so the admin can judge track record, not
      // just a name — joined date, mobile/city, completion reliability.
      .populate(
        "reportedUser",
        "name email profile_image mobile city reportCount performancePoints totalBookings successfulBookings created_at status",
      )
      // ⭐ The actual booking this report is about — with the real request
      // that was booked (title/category/budget for a Service-Request-sourced
      // booking, or the Service's own title/price otherwise) and both
      // parties' names, so the admin sees exactly what happened, not just a
      // bare booking id.
      .populate({
        path: "booking",
        populate: [
          { path: "customer", select: "name email profile_image" },
          { path: "provider", select: "name email profile_image" },
          { path: "service", select: "title price currency isFree" },
          {
            path: "serviceRequest",
            select: "title requestMode budget category schedule",
            populate: { path: "category", select: "name" },
          },
        ],
      })
      .sort({ createdAt: -1 })
      .lean();

    const urgent = userReports.filter((r) => r.severity === "urgent");
    const standard = userReports.filter((r) => r.severity !== "urgent");

    return res.json({
      isSuccess: true,
      data: {
        services,
        users: { urgent, standard },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ isSuccess: false });
  }
};

// ==========================
// approveReport / rejectReport — unchanged, "service"-type only
// ==========================
exports.approveReport = async (req, res) => {
  try {
    const { serviceId } = req.body;

    // delete service
    await Service.findByIdAndDelete(serviceId);

    // update reports
    await ServiceReport.updateMany(
      { type: "service", service: serviceId },
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
      { type: "service", service: serviceId },
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

// ==========================
// RESOLVE a "user" report (admin) — dismiss | warn | refund |
// restrict_7days | block. Every action is admin-triggered only — nothing
// automatic happens on submission (confirmed decision).
// ==========================
exports.resolveUserReport = async (req, res) => {
  try {
    const { reportId, action, notes } = req.body;
    const VALID_ACTIONS = ["dismiss", "warn", "refund", "restrict_7days", "block"];
    if (!reportId || !VALID_ACTIONS.includes(action)) {
      return res.status(400).json({
        isSuccess: false,
        message: `action must be one of: ${VALID_ACTIONS.join(", ")}`,
      });
    }

    const report = await ServiceReport.findById(reportId).populate("booking");
    if (!report || report.type !== "user") {
      return res.status(404).json({ isSuccess: false, message: "Report not found" });
    }
    if (report.status !== "pending") {
      return res
        .status(400)
        .json({ isSuccess: false, message: "This report has already been resolved" });
    }

    let adminAction = "dismissed";
    let reportedUserDoc = null;

    // ⭐ Shown to the reported user in-app for a short window (via
    // User.accountNotice, read by e.g. the home-feed API) — separate from
    // the push notification below, since the push can be missed/dismissed.
    const ACCOUNT_NOTICE_MESSAGES = {
      warned:
        "You've received a warning following a reported incident. Repeated issues may lead to a temporary or permanent restriction.",
      restricted:
        "Your account has been restricted for 7 days due to a reported incident.",
      blocked: "Your account has been blocked due to a reported incident.",
    };

    if (action === "dismiss") {
      adminAction = "dismissed";
    } else if (action === "warn") {
      adminAction = "warned";
      reportedUserDoc = await User.findById(report.reportedUser);
      if (!reportedUserDoc) {
        return res
          .status(404)
          .json({ isSuccess: false, message: "Reported user not found" });
      }
      reportedUserDoc.accountNotice = {
        noticeType: "warned",
        message: ACCOUNT_NOTICE_MESSAGES.warned,
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      };
      // ⭐ Notify while fcmToken is still intact — nothing invalidates
      // sessions/tokens for a plain warning, unlike restrict/block below.
      await notificationController.notifyReportOutcome(
        reportedUserDoc,
        adminAction,
        notes,
      );
      await reportedUserDoc.save();
    } else if (action === "refund") {
      if (!report.booking) {
        return res.status(400).json({
          isSuccess: false,
          message: "This report has no linked booking to refund",
        });
      }
      // Reuses the existing refundBooking exactly as-is — forcing
      // cancelledBy:"provider" gives a full refund with no cancellation fee.
      const paymentController = require("./paymentController");
      const fakeReq = {
        body: {
          bookingId: String(report.booking._id),
          cancelledBy: "provider",
          reason: notes || "Resolved via admin report",
        },
      };
      let refundResult = null;
      let refundError = null;
      const fakeRes = {
        status: (code) => ({
          json: (body) => {
            refundResult = { code, body };
          },
        }),
        json: (body) => {
          refundResult = { code: 200, body };
        },
      };
      try {
        await paymentController.refundBooking(fakeReq, fakeRes);
      } catch (err) {
        refundError = err;
      }
      if (refundError || !refundResult || refundResult.code >= 400) {
        return res.status(400).json({
          isSuccess: false,
          message: "Refund failed",
          detail: refundResult?.body || refundError?.message,
        });
      }
      adminAction = "refunded";
    } else if (action === "restrict_7days" || action === "block") {
      const reportedUser = await User.findById(report.reportedUser);
      if (!reportedUser) {
        return res
          .status(404)
          .json({ isSuccess: false, message: "Reported user not found" });
      }
      adminAction = action === "restrict_7days" ? "restricted" : "blocked";
      reportedUser.accountNotice = {
        noticeType: adminAction,
        message: ACCOUNT_NOTICE_MESSAGES[adminAction],
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      };
      // ⭐ Notify BEFORE banUser() runs — banUser clears fcmToken as part of
      // logging the user out of every device, so the push must go out first
      // or it silently has no token left to send to.
      await notificationController.notifyReportOutcome(
        reportedUser,
        adminAction,
        notes,
      );
      const bannedUntil =
        action === "restrict_7days"
          ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          : null;
      // banUser() saves the document — this persists accountNotice too.
      await banUser(reportedUser, { bannedUntil });
      reportedUserDoc = reportedUser;
    }

    report.status = action === "dismiss" ? "dismissed" : "resolved";
    report.adminAction = adminAction;
    report.adminNotes = notes || null;
    await report.save();

    if (adminAction !== "dismissed") {
      await User.updateOne(
        { _id: report.reportedUser },
        { $inc: { reportCount: 1 } },
      );
    }

    return res.json({
      isSuccess: true,
      message: "Report resolved successfully",
      data: report,
    });
  } catch (err) {
    console.error("resolveUserReport error:", err);
    return res.status(500).json({ isSuccess: false, message: "Server error" });
  }
};
