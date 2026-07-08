const Territory = require("../model/Territory");

const logTerritoryFlow = (step, data = {}) => {
  console.log(`[territoryController] ${step}`, data);
};

const logTerritoryError = (step, err) => {
  console.error(`[territoryController] ${step}`, {
    message: err.message,
    stack: err.stack,
  });
};

// =====================================
// CREATE TERRITORY
// =====================================
exports.createTerritory = async (req, res) => {
  try {
    logTerritoryFlow("createTerritory:start", { body: req.body });

    const { city, country } = req.body;

    if (!city || !country) {
      logTerritoryFlow("createTerritory:validation_failed", { city, country });

      return res.status(400).json({
        isSuccess: false,
        message: "City and country are required",
      });
    }

    logTerritoryFlow("createTerritory:checking_duplicate", {
      city: city.trim(),
      country: country.trim(),
    });

    const existingTerritory = await Territory.findOne({
      city: city.trim(),
      country: country.trim(),
    });

    if (existingTerritory) {
      logTerritoryFlow("createTerritory:duplicate_found", {
        territoryId: existingTerritory._id,
      });

      return res.status(400).json({
        isSuccess: false,
        message: "Territory already exists",
      });
    }

    logTerritoryFlow("createTerritory:creating", {
      city: city.trim(),
      country: country.trim(),
    });

    const territory = await Territory.create({
      city: city.trim(),
      country: country.trim(),
    });

    logTerritoryFlow("createTerritory:success", {
      territoryId: territory._id,
    });

    return res.status(201).json({
      isSuccess: true,
      message: "Territory created successfully",
      territory,
    });
  } catch (err) {
    logTerritoryError("createTerritory:error", err);

    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

// =====================================
// GET ALL TERRITORIES
// =====================================
exports.getAllTerritories = async (req, res) => {
  try {
    logTerritoryFlow("getAllTerritories:start", { query: req.query });

    const territories = await Territory.find()
      .populate(
        "exclusiveAmbassador",
        "name email ambassadorCode ambassadorType",
      )
      .sort({ city: 1 });

    logTerritoryFlow("getAllTerritories:success", {
      count: territories.length,
    });

    return res.status(200).json({
      isSuccess: true,
      count: territories.length,
      territories,
    });
  } catch (err) {
    logTerritoryError("getAllTerritories:error", err);

    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

// =====================================
// GET TERRITORY BY ID
// =====================================
exports.getTerritoryById = async (req, res) => {
  try {
    const { territoryId } = req.params;

    logTerritoryFlow("getTerritoryById:start", { territoryId });

    const territory = await Territory.findById(territoryId).populate(
      "exclusiveAmbassador",
      "name email ambassadorCode ambassadorType",
    );

    if (!territory) {
      logTerritoryFlow("getTerritoryById:not_found", { territoryId });

      return res.status(404).json({
        isSuccess: false,
        message: "Territory not found",
      });
    }

    logTerritoryFlow("getTerritoryById:success", {
      territoryId: territory._id,
      exclusiveAmbassador: territory.exclusiveAmbassador?._id,
    });

    return res.status(200).json({
      isSuccess: true,
      territory,
    });
  } catch (err) {
    logTerritoryError("getTerritoryById:error", err);

    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

// =====================================
// UPDATE TERRITORY
// =====================================
exports.updateTerritory = async (req, res) => {
  try {
    const { territoryId } = req.params;

    const { city, country, active, notes } = req.body;

    logTerritoryFlow("updateTerritory:start", {
      territoryId,
      body: req.body,
    });

    const territory = await Territory.findById(territoryId);

    if (!territory) {
      logTerritoryFlow("updateTerritory:not_found", { territoryId });

      return res.status(404).json({
        isSuccess: false,
        message: "Territory not found",
      });
    }

    logTerritoryFlow("updateTerritory:before_update", {
      territoryId: territory._id,
      city: territory.city,
      country: territory.country,
      active: territory.active,
      notes: territory.notes,
    });

    if (city) territory.city = city.trim();

    if (country) territory.country = country.trim();

    if (typeof active === "boolean") {
      territory.active = active;
    }

    if (notes !== undefined) {
      territory.notes = notes;
    }

    await territory.save();

    logTerritoryFlow("updateTerritory:success", {
      territoryId: territory._id,
      city: territory.city,
      country: territory.country,
      active: territory.active,
      notes: territory.notes,
    });

    return res.status(200).json({
      isSuccess: true,
      message: "Territory updated successfully",
      territory,
    });
  } catch (err) {
    logTerritoryError("updateTerritory:error", err);

    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

// =====================================
// DELETE TERRITORY
// =====================================
exports.deleteTerritory = async (req, res) => {
  try {
    const { territoryId } = req.params;

    logTerritoryFlow("deleteTerritory:start", { territoryId });

    const territory = await Territory.findById(territoryId);

    if (!territory) {
      logTerritoryFlow("deleteTerritory:not_found", { territoryId });

      return res.status(404).json({
        isSuccess: false,
        message: "Territory not found",
      });
    }

    if (territory.exclusiveAmbassador) {
      logTerritoryFlow("deleteTerritory:blocked_assigned_ambassador", {
        territoryId: territory._id,
        exclusiveAmbassador: territory.exclusiveAmbassador,
      });

      return res.status(400).json({
        isSuccess: false,
        message: "Cannot delete territory assigned to an ambassador",
      });
    }

    logTerritoryFlow("deleteTerritory:deleting", { territoryId });

    await Territory.findByIdAndDelete(territoryId);

    logTerritoryFlow("deleteTerritory:success", { territoryId });

    return res.status(200).json({
      isSuccess: true,
      message: "Territory deleted successfully",
    });
  } catch (err) {
    logTerritoryError("deleteTerritory:error", err);

    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};

// =====================================
// ASSIGN EXCLUSIVE AMBASSADOR
// =====================================
exports.assignExclusiveAmbassador = async (req, res) => {
  try {
    const { territoryId } = req.params;

    const { ambassadorId } = req.body;

    logTerritoryFlow("assignExclusiveAmbassador:start", {
      territoryId,
      ambassadorId,
    });

    const territory = await Territory.findById(territoryId);

    if (!territory) {
      logTerritoryFlow("assignExclusiveAmbassador:territory_not_found", {
        territoryId,
      });

      return res.status(404).json({
        isSuccess: false,
        message: "Territory not found",
      });
    }

    const User = require("../model/User");

    const ambassador = await User.findById(ambassadorId);

    if (!ambassador) {
      logTerritoryFlow("assignExclusiveAmbassador:ambassador_not_found", {
        ambassadorId,
      });

      return res.status(404).json({
        isSuccess: false,
        message: "Ambassador not found",
      });
    }

    logTerritoryFlow("assignExclusiveAmbassador:assigning", {
      territoryId: territory._id,
      ambassadorId: ambassador._id,
      previousExclusiveAmbassador: territory.exclusiveAmbassador,
    });

    territory.exclusiveAmbassador = ambassador._id;

    territory.assignedAt = new Date();

    territory.reviewDueAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

    await territory.save();

    logTerritoryFlow("assignExclusiveAmbassador:territory_saved", {
      territoryId: territory._id,
      exclusiveAmbassador: territory.exclusiveAmbassador,
      assignedAt: territory.assignedAt,
      reviewDueAt: territory.reviewDueAt,
    });

    ambassador.territory = territory._id;
    ambassador.ambassadorType = "exclusive";

    await ambassador.save();

    logTerritoryFlow("assignExclusiveAmbassador:success", {
      territoryId: territory._id,
      ambassadorId: ambassador._id,
      ambassadorType: ambassador.ambassadorType,
    });

    return res.status(200).json({
      isSuccess: true,
      message: "Exclusive ambassador assigned successfully",
      territory,
    });
  } catch (err) {
    logTerritoryError("assignExclusiveAmbassador:error", err);

    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};
