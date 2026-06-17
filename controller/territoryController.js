const Territory = require("../model/Territory");

// =====================================
// CREATE TERRITORY
// =====================================
exports.createTerritory = async (req, res) => {
  try {
    const { city, country } = req.body;

    if (!city || !country) {
      return res.status(400).json({
        isSuccess: false,
        message: "City and country are required",
      });
    }

    const existingTerritory = await Territory.findOne({
      city: city.trim(),
      country: country.trim(),
    });

    if (existingTerritory) {
      return res.status(400).json({
        isSuccess: false,
        message: "Territory already exists",
      });
    }

    const territory = await Territory.create({
      city: city.trim(),
      country: country.trim(),
    });

    return res.status(201).json({
      isSuccess: true,
      message: "Territory created successfully",
      territory,
    });
  } catch (err) {
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
    const territories = await Territory.find()
      .populate(
        "exclusiveAmbassador",
        "name email ambassadorCode ambassadorType",
      )
      .sort({ city: 1 });

    return res.status(200).json({
      isSuccess: true,
      count: territories.length,
      territories,
    });
  } catch (err) {
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

    const territory = await Territory.findById(territoryId).populate(
      "exclusiveAmbassador",
      "name email ambassadorCode ambassadorType",
    );

    if (!territory) {
      return res.status(404).json({
        isSuccess: false,
        message: "Territory not found",
      });
    }

    return res.status(200).json({
      isSuccess: true,
      territory,
    });
  } catch (err) {
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

    const { city, country, active, kpiTarget, notes } = req.body;

    const territory = await Territory.findById(territoryId);

    if (!territory) {
      return res.status(404).json({
        isSuccess: false,
        message: "Territory not found",
      });
    }

    if (city) territory.city = city.trim();

    if (country) territory.country = country.trim();

    if (typeof active === "boolean") {
      territory.active = active;
    }

    if (kpiTarget) {
      territory.kpiTarget = kpiTarget;
    }

    if (notes !== undefined) {
      territory.notes = notes;
    }

    await territory.save();

    return res.status(200).json({
      isSuccess: true,
      message: "Territory updated successfully",
      territory,
    });
  } catch (err) {
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

    const territory = await Territory.findById(territoryId);

    if (!territory) {
      return res.status(404).json({
        isSuccess: false,
        message: "Territory not found",
      });
    }

    if (territory.exclusiveAmbassador) {
      return res.status(400).json({
        isSuccess: false,
        message: "Cannot delete territory assigned to an ambassador",
      });
    }

    await Territory.findByIdAndDelete(territoryId);

    return res.status(200).json({
      isSuccess: true,
      message: "Territory deleted successfully",
    });
  } catch (err) {
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

    const territory = await Territory.findById(territoryId);

    if (!territory) {
      return res.status(404).json({
        isSuccess: false,
        message: "Territory not found",
      });
    }

    const User = require("../model/User");

    const ambassador = await User.findById(ambassadorId);

    if (!ambassador) {
      return res.status(404).json({
        isSuccess: false,
        message: "Ambassador not found",
      });
    }

    territory.exclusiveAmbassador = ambassador._id;

    territory.assignedAt = new Date();

    territory.reviewDueAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

    await territory.save();

    ambassador.territory = territory._id;
    ambassador.ambassadorType = "exclusive";

    await ambassador.save();

    return res.status(200).json({
      isSuccess: true,
      message: "Exclusive ambassador assigned successfully",
      territory,
    });
  } catch (err) {
    return res.status(500).json({
      isSuccess: false,
      message: err.message,
    });
  }
};
