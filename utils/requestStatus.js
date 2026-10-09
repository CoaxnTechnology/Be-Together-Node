// =====================================================================
// SERVICE REQUEST — ONE STATUS FOR THE APP (`myStatus`)
// ---------------------------------------------------------------------
// Every request API (list, detail, offers, my offers, my bookings) sends
// `myStatus` + `role`, worked out here and only here, for whoever is
// calling. The app switches on myStatus alone — no more combining
// hasJoined / hasSubmittedOffer / isOfferAccepted / quotationChangeStatus /
// booking status / free-vs-paid on its side.
//
// role — the viewer's side of the request:
//   paid_offer  owner = "customer" (needs it), anyone offering = "provider"
//   free_*      owner = "customer" (needs it), anyone joining  = "provider"
//               (helps for free)
//   paid_fixed  owner = "provider" (sells at a fixed price), anyone booking = "customer"
//   null        guest (no userId)
// Note: a free join's Booking stores the joiner in `customer` and the owner
// in `provider` — the role here is the real-world side, not those fields.
//
// Nothing here is stored — it's computed from the request, offer, booking
// and payment each time, so it can never go out of sync.
// =====================================================================
const ServiceRequestOffer = require("../model/ServiceRequestOffer");
const Booking = require("../model/Booking");
const Payment = require("../model/Payment");

const MY_STATUS = Object.freeze({
  AVAILABLE: "available", //                 can send an offer / book / join
  WAITING_FOR_OFFERS: "waiting_for_offers", // owner (paid_offer): no offer yet
  OFFERS_RECEIVED: "offers_received", //       owner: offer(s) waiting for a decision
  WAITING_FOR_BOOKINGS: "waiting_for_bookings", // owner (paid_fixed / free): nobody yet
  OFFER_SENT: "offer_sent", //                 provider: offer waiting for the customer
  OFFER_DECLINED: "offer_declined", //         provider: customer said no
  OFFER_WITHDRAWN: "offer_withdrawn", //       provider: took the offer back
  PAYMENT_PENDING: "payment_pending", //       accepted / booked, checkout not paid yet
  BOOKED: "booked", //                         paid (or joined, free)
  QUOTATION_PENDING: "quotation_pending", //   price change waiting for the customer
  QUOTATION_PAYMENT_PENDING: "quotation_payment_pending", // customer paying the difference
  STARTED: "started", //                       service in progress (after OTP)
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  CLOSED: "closed", //                         expired / full / closed, viewer not part of it
});
const S = MY_STATUS;

const isPaidOffer = (request) => request?.requestMode === "paid_offer";

// The viewer's side of the request — see the table at the top.
function requestRole(request, userId) {
  if (!userId || !request) return null;
  const ownerId = request.owner?._id || request.owner;
  const isOwner = String(ownerId) === String(userId);
  if (request.requestMode === "paid_fixed") return isOwner ? "provider" : "customer";
  return isOwner ? "customer" : "provider";
}

// Can someone new still offer / book / join?
function isRequestAvailable(request) {
  if (!request || request.status !== "open") return false;
  if (request.expiresAt && new Date(request.expiresAt) <= new Date()) return false;
  if (
    !isPaidOffer(request) &&
    typeof request.numberOfParticipants === "number" &&
    (request.seatsBooked || 0) >= request.numberOfParticipants
  ) {
    return false;
  }
  return true;
}

// One booking → its status. Same answer for customer and provider; only
// the label the app puts on it differs.
function bookingStatus(booking) {
  if (!booking) return null;
  switch (booking.status) {
    case "pending_payment":
      return S.PAYMENT_PENDING;
    case "booked": {
      const changes = booking.quotationChanges || [];
      const latest = changes[changes.length - 1];
      if (latest?.status === "pending") return S.QUOTATION_PENDING;
      if (latest?.status === "awaiting_payment") return S.QUOTATION_PAYMENT_PENDING;
      return S.BOOKED;
    }
    case "started":
      return S.STARTED;
    case "completed":
      return S.COMPLETED;
    case "cancelled":
      return S.CANCELLED;
    default:
      return null;
  }
}

// One offer (+ its booking once paid) → its status, for an offer card.
//   role "provider" — their own offer (my offers, request detail)
//   role "customer" — an offer on their request (offers list)
function offerStatus(offer, booking, role) {
  if (!offer) return null;
  if (offer.status === "accepted") {
    // Paid — the booking decides from here on. (Accepted without a booking
    // can't normally happen; treat it as still paying.)
    return bookingStatus(booking) || S.PAYMENT_PENDING;
  }
  switch (offer.status) {
    case "payment_pending":
      return S.PAYMENT_PENDING;
    case "pending":
      return role === "customer" ? S.OFFERS_RECEIVED : S.OFFER_SENT;
    case "declined":
      return S.OFFER_DECLINED;
    case "withdrawn":
      return S.OFFER_WITHDRAWN;
    default:
      return null;
  }
}

// Owner with several bookings / offers (group requests): one summary
// value — whatever needs attention first wins.
const OWNER_PRIORITY = [
  S.QUOTATION_PENDING,
  S.QUOTATION_PAYMENT_PENDING,
  S.OFFERS_RECEIVED,
  S.PAYMENT_PENDING,
  S.STARTED,
  S.BOOKED,
];

function ownerStatus(request, { bookings = [], offers = [] }) {
  const found = new Set(bookings.map(bookingStatus).filter(Boolean));
  const available = isRequestAvailable(request);
  if (isPaidOffer(request)) {
    if (offers.some((o) => o.status === "payment_pending")) found.add(S.PAYMENT_PENDING);
    if (available && offers.some((o) => o.status === "pending")) found.add(S.OFFERS_RECEIVED);
  }
  const active = OWNER_PRIORITY.find((s) => found.has(s));
  if (active) return active;

  // Nothing in progress.
  if (available) return isPaidOffer(request) ? S.WAITING_FOR_OFFERS : S.WAITING_FOR_BOOKINGS;
  if (found.has(S.COMPLETED)) return S.COMPLETED;
  if (found.has(S.CANCELLED)) return S.CANCELLED;
  return S.CLOSED;
}

// The status of a request for one viewer.
//   ctx.offers   — offers on this request the viewer can see (theirs, or
//                  all of them for the paid_offer owner)
//   ctx.bookings — bookings on this request the viewer is part of
//   ctx.payments — the viewer's still-open checkouts on this request
function requestStatus(request, userId, { offers = [], bookings = [], payments = [] } = {}) {
  const role = requestRole(request, userId);
  const ownerId = String(request.owner?._id || request.owner);
  const isOwner = Boolean(userId) && ownerId === String(userId);

  if (!role) {
    return { role: null, myStatus: isRequestAvailable(request) ? S.AVAILABLE : S.CLOSED };
  }
  if (isOwner) return { role, myStatus: ownerStatus(request, { bookings, offers }) };

  const newest = (list) =>
    [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

  // paid_offer — the viewer is a provider; their latest offer decides.
  if (isPaidOffer(request)) {
    const offer = newest(offers.filter((o) => String(o.provider?._id || o.provider) === String(userId)));
    const booking = newest(bookings.filter((b) => String(b.provider?._id || b.provider) === String(userId)));
    if (offer && offer.status !== "withdrawn") {
      return { role, myStatus: offerStatus(offer, booking, "provider") };
    }
    // Withdrew their own offer: they may send a new one while it's open.
    if (isRequestAvailable(request)) return { role, myStatus: S.AVAILABLE };
    return { role, myStatus: offer ? S.OFFER_WITHDRAWN : S.CLOSED };
  }

  // paid_fixed (viewer books) / free (viewer joins) — their booking decides.
  // Both are stored with the viewer in the booking's `customer` field.
  const mine = bookings.filter((b) => String(b.customer?._id || b.customer) === String(userId));
  const active = newest(mine.filter((b) => b.status !== "cancelled"));
  if (active) return { role, myStatus: bookingStatus(active) };
  if (payments.some((p) => p.status === "pending")) return { role, myStatus: S.PAYMENT_PENDING };
  const cancelled = newest(mine);
  if (cancelled) return { role, myStatus: S.CANCELLED };
  return { role, myStatus: isRequestAvailable(request) ? S.AVAILABLE : S.CLOSED };
}

// Loads what requestStatus needs for many requests in 3 queries, and
// returns a function request → { role, myStatus }. Used by the list and the
// detail API alike, so both always agree.
async function loadRequestStatuses(requests, userId) {
  const list = (requests || []).filter(Boolean);
  if (!userId || !list.length) {
    return (request) => requestStatus(request, null);
  }

  const ids = list.map((r) => r._id);
  const ownedPaidOfferIds = list
    .filter((r) => isPaidOffer(r) && String(r.owner?._id || r.owner) === String(userId))
    .map((r) => r._id);

  const [offers, bookings, payments] = await Promise.all([
    ServiceRequestOffer.find({
      request: { $in: ids },
      $or: [{ provider: userId }, { request: { $in: ownedPaidOfferIds } }],
    })
      .select("request provider status createdAt")
      .lean(),
    Booking.find({
      serviceRequest: { $in: ids },
      $or: [{ customer: userId }, { provider: userId }],
    })
      .select("serviceRequest customer provider status quotationChanges createdAt")
      .lean(),
    Payment.find({ serviceRequest: { $in: ids }, user: userId, status: "pending" })
      .select("serviceRequest status")
      .lean(),
  ]);

  const byRequest = (rows, key) => {
    const map = new Map();
    for (const row of rows) {
      const k = String(row[key]);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(row);
    }
    return map;
  };
  const offersBy = byRequest(offers, "request");
  const bookingsBy = byRequest(bookings, "serviceRequest");
  const paymentsBy = byRequest(payments, "serviceRequest");

  return (request) => {
    const k = String(request._id);
    return requestStatus(request, userId, {
      offers: offersBy.get(k) || [],
      bookings: bookingsBy.get(k) || [],
      payments: paymentsBy.get(k) || [],
    });
  };
}

// Adds { role, myStatus } to each request in a list.
async function withRequestStatuses(requests, userId) {
  const statusOf = await loadRequestStatuses(requests, userId);
  return requests.map((r) => ({ ...r, ...statusOf(r) }));
}

module.exports = {
  MY_STATUS,
  requestRole,
  isRequestAvailable,
  bookingStatus,
  offerStatus,
  requestStatus,
  loadRequestStatuses,
  withRequestStatuses,
};
