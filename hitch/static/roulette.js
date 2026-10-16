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

  const EARTH_RADIUS_KM = 6371;
  const NEAR_RADIUS_KM = 150;
  const rad = (deg) => (deg * Math.PI) / 180;

  function distanceKm(a, b) {
    const h =
      Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
  }

  // Spots nobody rated well or reviewed once are a poor weekend plan; fall back to
  // anything only when the map has nothing better loaded yet. With `near`, pick among
  // the good spots within its radius, or the closest good one when none is in range.
  function pickSpot(spots, random = Math.random, near = null) {
    const good = spots.filter((s) => s.rating >= MIN_RATING && s.review_count >= MIN_REVIEWS);
    let pool = good.length ? good : spots;
    if (near && pool.length) {
      const dist = new Map(pool.map((s) => [s, distanceKm(near.origin, s)]));
      const inRange = pool.filter((s) => dist.get(s) <= (near.radiusKm || NEAR_RADIUS_KM));
      pool = inRange.length ? inRange : [pool.reduce((a, b) => (dist.get(b) < dist.get(a) ? b : a))];
    }
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
  let home = null; // set once the visitor asks for spots near them
  let spinId = 0; // a slow ride-detail fetch must not overwrite a newer spin

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function closeCard() {
    if (!card) return;
    card.remove();
    card = null;
    const button = document.getElementById("roulette-btn");
    if (button) button.focus();
  }

  function button(cls, text, onClick) {
    const b = el("button", cls, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  function closeButton() {
    const close = button("roulette-close", "×", closeCard);
    close.setAttribute("aria-label", tr("Close"));
    return close;
  }

  function locate() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 10000 }
      );
    });
  }

  async function fetchDetail(spot) {
    let data = {};
    try {
      const response = await fetch(`/rides/by-spot/${encodeURIComponent(spotId(spot))}.json`);
      if (response.ok) data = await response.json();
    } catch (e) {}
    const withComment = (data.rides || []).find((r) => r.comment);
    return { detail: data.spot || {}, comment: withComment ? withComment.comment : "" };
  }

  function downloadCalendar(spot, name, day) {
    const file = new Blob([toCalendarFile(spot, name, day)], { type: "text/calendar" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = "hitch-roulette.ics";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function showCard(...children) {
    if (!card) {
      card = el("div", "roulette-card");
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-label", tr("Hitch Roulette: a random spot"));
      card.tabIndex = -1;
      document.body.append(card);
    }
    card.replaceChildren(...children.filter(Boolean));
    card.focus({ preventScroll: true });
  }

  // Spots hidden by the map's active filters must not be offered either.
  function visibleMarkers() {
    return (typeof filteredMarkers !== "undefined" && filteredMarkers) || root.allMarkers || [];
  }

  async function spin(wantNear) {
    const id = ++spinId;
    const spinner = el("div", "roulette-spinner", "🎲");
    spinner.setAttribute("aria-hidden", "true");
    showCard(spinner);

    if (wantNear && !home) home = await locate();
    if (id !== spinId) return;
    if (wantNear && !home) {
      showCard(closeButton(), el("div", "roulette-comment", tr("Location unavailable")), button("roulette-go", tr("Spin again"), () => spin(false)));
      return;
    }
    if (!wantNear) home = null;

    const markers = visibleMarkers();
    const spot = pickSpot(markers.map((m) => m.options._data), Math.random, home && { origin: home });
    if (!spot) return closeCard();
    const marker = markers.find((m) => m.options._data === spot);
    const { detail, comment } = await fetchDetail(spot);
    if (id !== spinId) return;

    const name = detail.name || `${spot.lat.toFixed(3)}, ${spot.lon.toFixed(3)}`;
    const saturday = nextSaturday();
    const label = saturday.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    const stats = [
      "★".repeat(Math.round(spot.rating)),
      `~${waitMinutes(detail, spot.rating)} min`,
      `${spot.review_count} rides`,
      home && (typeof formatDistance === "function" ? formatDistance(distanceKm(home, spot)) : `${Math.round(distanceKm(home, spot))} km`),
    ].filter(Boolean);

    const go = button("roulette-go", `${tr("Go there this weekend?")} (${label})`, () => {
      downloadCalendar(spot, name, saturday);
      closeCard();
      root.map.setView([spot.lat, spot.lon], 15);
      if (marker) root.handleMarkerClick(marker, marker.getLatLng(), null);
    });
    const more = el("div", "roulette-more");
    more.append(
      button("roulette-again", tr("Spin again"), () => spin(Boolean(home))),
      button("roulette-again", home ? tr("Spin anywhere") : tr("Spin near me"), () => spin(!home))
    );
    showCard(closeButton(), el("div", "roulette-name", name), el("div", "roulette-stats", stats.join("  ·  ")), comment && el("div", "roulette-comment", comment.slice(0, 160)), go, more);
  }

  function init() {
    const trigger = document.getElementById("roulette-btn");
    if (!trigger) return;
    trigger.addEventListener("click", () => spin(false));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeCard();
    });
  }

  return { pickSpot, distanceKm, spotId, waitMinutes, nextSaturday, toCalendarFile, init };
});
