const User = require("../model/User");
const Territory = require("../model/Territory");
const AmbassadorWallet = require("../model/AmbassadorWallet");
const AmbassadorWalletHistory = require("../model/AmbassadorWalletHistory");

async function creditAmbassador({
  ambassador,
  amount,
  booking,
  service,
  commissionSource,
  commissionRate,
  territory = null,
  referredUser = null,
}) {
  try {
    console.log("[AmbassadorCommission] creditAmbassador:start", {
      ambassadorId: ambassador?._id,
      ambassadorName: ambassador?.name,
      amount,
      bookingId: booking?._id,
      serviceId: service?._id,
      commissionSource,
      commissionRate,
      territory,
      referredUser,
    });

    if (!ambassador || amount <= 0) {
      console.log("[AmbassadorCommission] creditAmbassador:skipped", {
        reason: !ambassador ? "missing_ambassador" : "invalid_amount",
        ambassadorId: ambassador?._id,
        amount,
        commissionSource,
      });
      return;
    }

    // Prevent duplicate commission
    const existingHistory = await AmbassadorWalletHistory.findOne({
      booking: booking._id,
      ambassador: ambassador._id,
      commissionSource,
      type: "commission_earned",
    });

    if (existingHistory) {
      console.log("[AmbassadorCommission] duplicate commission found", {
        historyId: existingHistory._id,
        bookingId: booking._id,
        ambassadorId: ambassador._id,
        commissionSource,
      });
      return;
    }

    let wallet = await AmbassadorWallet.findOne({
      ambassador: ambassador._id,
    });

    if (!wallet) {
      console.log("[AmbassadorCommission] wallet not found, creating wallet", {
        ambassadorId: ambassador._id,
      });

      wallet = await AmbassadorWallet.create({
        ambassador: ambassador._id,
      });
    } else {
      console.log("[AmbassadorCommission] wallet found", {
        walletId: wallet._id,
        ambassadorId: ambassador._id,
        balance: wallet.balance,
        totalEarned: wallet.totalEarned,
      });
    }

    const roundedAmount = Number(amount.toFixed(2));

    const balanceBefore = wallet.balance;

    wallet.balance += roundedAmount;
    wallet.totalEarned += roundedAmount;

    await wallet.save();

    console.log("[AmbassadorCommission] wallet credited", {
      walletId: wallet._id,
      ambassadorId: ambassador._id,
      roundedAmount,
      balanceBefore,
      balanceAfter: wallet.balance,
      totalEarned: wallet.totalEarned,
    });

    // Update ambassador stats
    await User.findByIdAndUpdate(ambassador._id, {
      $inc: {
        totalReferralEarned: roundedAmount,
      },
    });

    console.log("[AmbassadorCommission] ambassador stats updated", {
      ambassadorId: ambassador._id,
      totalReferralEarnedIncrement: roundedAmount,
    });

    const walletHistory = await AmbassadorWalletHistory.create({
      ambassador: ambassador._id,

      transactionType: "credit",

      type: "commission_earned",

      amount: roundedAmount,

      balanceBefore,

      balanceAfter: wallet.balance,

      commissionSource,

      commissionRate,

      booking: booking._id,

      service: service._id,

      territory,

      referredUser,

      note: `Commission earned (${commissionSource})`,
    });

    console.log("[AmbassadorCommission] wallet history created", {
      historyId: walletHistory._id,
      ambassadorId: ambassador._id,
      bookingId: booking._id,
      commissionSource,
      amount: roundedAmount,
    });

    console.log("[AmbassadorCommission] commission credited", {
      commissionSource,
      ambassadorId: ambassador._id,
      amount: roundedAmount,
    });
  } catch (error) {
    console.error("[AmbassadorCommission] creditAmbassador:error", error);
    throw error;
  }
}

async function processAmbassadorCommission({
  booking,
  payment,
  customer,
  provider,
  service,
}) {
  try {
    console.log("[AmbassadorCommission] process:start", {
      bookingId: booking?._id,
      paymentId: payment?._id,
      customerId: customer?._id,
      providerId: provider?._id,
      serviceId: service?._id,
      paymentOriginalAmount: payment?.originalAmount,
      bookingAmount: booking?.amount,
    });
    if (booking.ambassadorCommissionProcessed) {
      console.log("[AmbassadorCommission] already processed");
      return true;
    }

    if (booking.status !== "completed") {
      return true;
    }

    if (payment.status !== "completed") {
      return true;
    }
    const serviceAmount = Number(
      payment?.originalAmount || booking.amount || 0,
    );

    console.log("[AmbassadorCommission] service amount resolved", {
      serviceAmount,
      source: payment?.originalAmount
        ? "payment.originalAmount"
        : "booking.amount",
    });

    if (serviceAmount <= 0) {
      console.log("[AmbassadorCommission] process:skipped", {
        reason: "invalid_service_amount",
        serviceAmount,
      });
      return true;
    }

    console.log("[AmbassadorCommission] processing ambassador commissions");

    // ==================================================
    // CUSTOMER AMBASSADOR
    // ==================================================

    if (customer?.referredBy) {
      console.log("[AmbassadorCommission] customer referral found", {
        customerId: customer._id,
        referredBy: customer.referredBy,
      });

      const customerAmbassador = await User.findById(customer.referredBy);

      console.log("[AmbassadorCommission] customer ambassador lookup result", {
        ambassadorId: customerAmbassador?._id,
        isAmbassador: customerAmbassador?.isAmbassador,
        ambassadorStatus: customerAmbassador?.ambassadorStatus,
        commissionRate: customerAmbassador?.commissionRate,
      });

      if (
        customerAmbassador &&
        customerAmbassador.isAmbassador &&
        customerAmbassador.ambassadorStatus === "approved"
      ) {
        const commission =
          serviceAmount * (customerAmbassador.commissionRate / 100);

        console.log("[AmbassadorCommission] customer commission calculated", {
          serviceAmount,
          commissionRate: customerAmbassador.commissionRate,
          commission,
        });

        await creditAmbassador({
          ambassador: customerAmbassador,
          amount: commission,
          booking,
          service,
          commissionSource: "customer_side",
          commissionRate: customerAmbassador.commissionRate,
          referredUser: customer._id,
        });
      } else {
        console.log("[AmbassadorCommission] customer ambassador skipped", {
          reason: "not_found_or_not_approved",
          referredBy: customer.referredBy,
        });
      }
    } else {
      console.log("[AmbassadorCommission] no customer referral", {
        customerId: customer?._id,
      });
    }

    // ==================================================
    // PROVIDER AMBASSADOR
    // ==================================================

    if (provider?.referredBy) {
      console.log("[AmbassadorCommission] provider referral found", {
        providerId: provider._id,
        referredBy: provider.referredBy,
      });

      const providerAmbassador = await User.findById(provider.referredBy);

      console.log("[AmbassadorCommission] provider ambassador lookup result", {
        ambassadorId: providerAmbassador?._id,
        isAmbassador: providerAmbassador?.isAmbassador,
        ambassadorStatus: providerAmbassador?.ambassadorStatus,
        commissionRate: providerAmbassador?.commissionRate,
      });

      if (
        providerAmbassador &&
        providerAmbassador.isAmbassador &&
        providerAmbassador.ambassadorStatus === "approved"
      ) {
        const commission =
          serviceAmount * (providerAmbassador.commissionRate / 100);

        console.log("[AmbassadorCommission] provider commission calculated", {
          serviceAmount,
          commissionRate: providerAmbassador.commissionRate,
          commission,
        });

        await creditAmbassador({
          ambassador: providerAmbassador,
          amount: commission,
          booking,
          service,
          commissionSource: "provider_side",
          commissionRate: providerAmbassador.commissionRate,
          referredUser: provider._id,
        });
      } else {
        console.log("[AmbassadorCommission] provider ambassador skipped", {
          reason: "not_found_or_not_approved",
          referredBy: provider.referredBy,
        });
      }
    } else {
      console.log("[AmbassadorCommission] no provider referral", {
        providerId: provider?._id,
      });
    }

    // ==================================================
    // TERRITORY AMBASSADOR
    // ==================================================

    if (service?.city) {
      console.log("[AmbassadorCommission] checking territory", {
        serviceId: service._id,
        city: service.city,
      });

      const territory = await Territory.findOne({
        city: {
          $regex: new RegExp(`^${service.city.trim()}$`, "i"),
        },
        active: true,
      }).populate("exclusiveAmbassador");

      console.log("[AmbassadorCommission] territory lookup result", {
        territoryId: territory?._id,
        city: territory?.city,
        exclusiveAmbassadorId: territory?.exclusiveAmbassador?._id,
        isAmbassador: territory?.exclusiveAmbassador?.isAmbassador,
        ambassadorStatus: territory?.exclusiveAmbassador?.ambassadorStatus,
        commissionRate: territory?.exclusiveAmbassador?.commissionRate,
      });

      if (
        territory &&
        territory.exclusiveAmbassador &&
        territory.exclusiveAmbassador.isAmbassador &&
        territory.exclusiveAmbassador.ambassadorStatus === "approved"
      ) {
        const territoryAmbassador = territory.exclusiveAmbassador;

        const commission =
          serviceAmount * (territoryAmbassador.commissionRate / 100);

        console.log(
          "[AmbassadorCommission] territorial commission calculated",
          {
            serviceAmount,
            commissionRate: territoryAmbassador.commissionRate,
            commission,
            territoryId: territory._id,
          },
        );

        await creditAmbassador({
          ambassador: territoryAmbassador,
          amount: commission,
          booking,
          service,
          commissionSource: "territorial",
          commissionRate: territoryAmbassador.commissionRate,
          territory: territory._id,
        });
      } else {
        console.log("[AmbassadorCommission] territorial ambassador skipped", {
          reason: "territory_or_ambassador_not_found_or_not_approved",
          city: service.city,
        });
      }
    } else {
      console.log(
        "[AmbassadorCommission] no service city for territory check",
        {
          serviceId: service?._id,
        },
      );
    }
    booking.ambassadorCommissionProcessed = true;

    booking.ambassadorCommissionProcessedAt = new Date();

    await booking.save();

    console.log("[AmbassadorCommission] processing completed", {
      bookingId: booking?._id,
      serviceAmount,
    });

    return true;
  } catch (error) {
    console.error("[AmbassadorCommission] process:error", error);

    throw error;
  }
}

module.exports = {
  processAmbassadorCommission,
  creditAmbassador,
};
