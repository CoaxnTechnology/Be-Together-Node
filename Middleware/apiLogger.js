const ApiLog = require("../model/ApiLog");

module.exports = (req, res, next) => {
  // =====================================
  // SKIP WEBHOOKS & STATIC FILES
  // =====================================

  if (
    req.originalUrl.startsWith("/webhook") ||
    req.originalUrl.includes("/stripe/webhook") ||
    req.originalUrl.startsWith("/uploads") ||
    req.originalUrl.startsWith("/public")
  ) {
    return next();
  }

  const start = Date.now();

  const originalJson = res.json;
  const originalSend = res.send;

  // =====================================
  // COMMON LOGGER
  // =====================================

  const saveLog = async (body) => {
    try {
      const duration = Date.now() - start;

      let message = null;
      let error = null;

      if (typeof body === "object" && body !== null) {
        message = body.message || body.Message || null;
        error = body.error || null;
      } else if (typeof body === "string") {
        message = body;
      }

      if (res.statusCode >= 400) {
        error = error || message || "Unknown Error";
        message = null;
      }

      await ApiLog.create({
        method: req.method,
        endpoint: req.originalUrl,
        statusCode: res.statusCode,

        success: res.statusCode < 400,

        message:
          res.statusCode < 400
            ? message || "Success"
            : null,

        error,

        userId: req.user?.id || null,
        adminId: req.admin?.id || null,

        ip: req.ip,

        duration,
      });
    } catch (err) {
      console.error("API Logger Error:", err.message);
    }
  };

  // =====================================
  // OVERRIDE JSON
  // =====================================

  res.json = function (body) {
    saveLog(body);
    return originalJson.call(this, body);
  };

  // =====================================
  // OVERRIDE SEND
  // =====================================

  res.send = function (body) {
    saveLog(body);
    return originalSend.call(this, body);
  };

  next();
};