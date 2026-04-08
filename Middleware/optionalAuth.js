const jwt = require("jsonwebtoken");

exports.optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // 👉 Guest user
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      req.user = null;
      return next();
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = { id: decoded.id };

    next();
  } catch (err) {
    // 👉 invalid token → treat as guest
    req.user = null;
    next();
  }
};