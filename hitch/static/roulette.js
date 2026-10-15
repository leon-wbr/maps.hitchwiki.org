// Hitch Roulette: a dice button that picks a random well-rated spot, shows its name,
// rating and typical wait, and offers to take you there this weekend.
//
// Dual export (browser + CommonJS) so the pure helpers are testable under node,
// matching account.js. The UI half only runs in the browser, after map.js has built
// `allMarkers`.
(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  else {
    root.Roulette = mod;
    document.addEventListener("DOMContentLoaded", () => mod.init());
  }
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  const MIN_RATING = 4;
  const MIN_REVIEWS = 2;
  const SATURDAY = 6;
  const WAIT_BY_RATING = { 1: 90, 2: 55, 3: 30, 4: 15, 5: 6 };

  // Spots nobody rated well or reviewed once are a poor weekend plan; fall back to
  // anything only when the map has nothing better loaded yet.
  function pickSpot(spots, random = Math.random) {
    const good = spots.filter((s) => s.rating >= MIN_RATING && s.review_count >= MIN_REVIEWS);
    const pool = good.length ? good : spots;
    return pool.length ? pool[Math.floor(random() * pool.length)] : null;
  }

  // Same 5-decimal id map.js derives for rides/by-spot/<id>.json.
  function spotId(spot) {
    return `${spot.lat.toFixed(5)}_${spot.lon.toFixed(5)}`;
  }

  // Recorded average wait when the spot has one, else a rough rating-based guess.
  function waitMinutes(spotDetail, rating, random = Math.random) {
    if (spotDetail && spotDetail.wait) return Math.round(spotDetail.wait);
    const base = WAIT_BY_RATING[Math.round(rating || 3)] || 30;
    return Math.min(180, Math.max(1, Math.round(base * (0.5 + random()))));
  }

  function nextSaturday(from = new Date()) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    day.setDate(day.getDate() + ((SATURDAY - day.getDay() + 7) % 7));
    return day;
  }

  const icsDate = (d) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const icsText = (s) => String(s).replace(/[\\,;]/g, (c) => "\\" + c).replace(/\r?\n/g, "\\n");

  function toCalendarFile(spot, name, day) {
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Hitchwiki Maps//Hitch Roulette//EN",
      "BEGIN:VEVENT",
      `UID:${spotId(spot)}-${icsDate(day)}@maps.hitchwiki.org`,
      `DTSTAMP:${icsDate(new Date())}T000000Z`,
      `DTSTART;VALUE=DATE:${icsDate(day)}`,
      `DTEND;VALUE=DATE:${icsDate(end)}`,
      `SUMMARY:${icsText("Hitch Roulette: " + name)}`,
      `GEO:${spot.lat};${spot.lon}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
  }

  const tr = (s) => (typeof root.t === "function" ? root.t(s) : s);

  // --- browser UI -----------------------------------------------------------
  let card = null;

  function closeCard() {
    if (card) card.remove();
    card = null;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  async function spin() {
    const markers = root.allMarkers || [];
    const spot = pickSpot(markers.map((m) => m.options._data));
    if (!spot) return;
    const marker = markers.find((m) => m.options._data === spot);

    closeCard();
    card = el("div", "roulette-card");
    card.setAttribute("role", "dialog");
    card.append(el("div", "roulette-spinner", "🎲"));
    document.body.append(card);

    let detail = {};
    let comment = "";
    try {
      const response = await fetch(`/rides/by-spot/${spotId(spot)}.json`);
      if (response.ok) {
        const data = await response.json();
        detail = data.spot || {};
        comment = ((data.rides || []).find((r) => r.comment) || {}).comment || "";
      }
    } catch (e) {}
    if (!card) return;

    const name = detail.name || `${spot.lat.toFixed(3)}, ${spot.lon.toFixed(3)}`;
    const minutes = waitMinutes(detail, spot.rating);
    const saturday = nextSaturday();
    const label = saturday.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

    card.replaceChildren(
      el("button", "roulette-close", "×"),
      el("div", "roulette-name", name),
      el("div", "roulette-stats", `${"★".repeat(Math.round(spot.rating))}  ·  ~${minutes} min  ·  ${spot.review_count} rides`),
      el("div", "roulette-comment", comment.slice(0, 160)),
      el("button", "roulette-go", `${tr("Go there this weekend?")} (${label})`),
      el("button", "roulette-again", tr("Spin again"))
    );
    card.querySelector(".roulette-close").addEventListener("click", closeCard);
    card.querySelector(".roulette-again").addEventListener("click", spin);
    card.querySelector(".roulette-go").addEventListener("click", () => {
      const file = new Blob([toCalendarFile(spot, name, saturday)], { type: "text/calendar" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(file);
      link.download = "hitch-roulette.ics";
      link.click();
      URL.revokeObjectURL(link.href);
      closeCard();
      root.map.setView([spot.lat, spot.lon], 15);
      if (marker) root.handleMarkerClick(marker, marker.getLatLng(), null);
    });
  }

  function init() {
    const button = document.getElementById("roulette-btn");
    if (button) button.addEventListener("click", spin);
  }

  return { pickSpot, spotId, waitMinutes, nextSaturday, toCalendarFile, init };
});
