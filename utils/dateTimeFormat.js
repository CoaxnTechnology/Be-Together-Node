// Custom "DD/MM/YYYY hh:mm AM/PM" parsing + formatting, and relative
// "time ago" text (e.g. "2 hours ago") — used by Service Requests so the
// user only picks one date/time and everything else (expiry, display) is
// derived from it automatically.

const DATE_TIME_REGEX =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})[:.](\d{2})\s*([AaPp][Mm])$/;

// "18/09/2026 06:00 PM" -> Date (local server time), or null if invalid/unparseable
function parseDateTime(input) {
  if (!input || typeof input !== "string") return null;
  const match = input.trim().match(DATE_TIME_REGEX);
  if (!match) return null;

  const [, dayStr, monthStr, yearStr, hourStr, minuteStr, ampmRaw] = match;
  const day = parseInt(dayStr, 10);
  const month = parseInt(monthStr, 10);
  const year = parseInt(yearStr, 10);
  let hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  const ampm = ampmRaw.toUpperCase();

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 1 ||
    hour > 12 ||
    minute > 59
  ) {
    return null;
  }

  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);

  // Reject impossible calendar dates (e.g. 31/02) — the Date constructor
  // silently rolls those over into the next month instead of erroring.
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;

  return date;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

// Date -> "18/09/2026 06:00 PM"
function formatDateTime(date) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;

  const day = pad2(d.getDate());
  const month = pad2(d.getMonth() + 1);
  const year = d.getFullYear();

  let hour = d.getHours();
  const minute = pad2(d.getMinutes());
  const ampm = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;

  return `${day}/${month}/${year} ${pad2(hour)}:${minute} ${ampm}`;
}

// Date -> "2 hours ago" / "just now" / "3 days ago" ...
function timeAgo(date) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;

  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;

  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

module.exports = { parseDateTime, formatDateTime, timeAgo };
