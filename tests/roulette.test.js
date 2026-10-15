const test = require("node:test");
const assert = require("node:assert");

const Roulette = require("../hitch/static/roulette.js");

const spot = (lat, lon, rating, review_count) => ({ lat, lon, rating, review_count });

test("pickSpot prefers well-rated, reviewed spots", () => {
  const spots = [spot(1, 1, 1, 9), spot(2, 2, 5, 1), spot(3, 3, 5, 4), spot(4, 4, 4, 2)];
  assert.strictEqual(Roulette.pickSpot(spots, () => 0).lat, 3);
  assert.strictEqual(Roulette.pickSpot(spots, () => 0.99).lat, 4);
});

test("pickSpot falls back to any spot, and to null when there are none", () => {
  assert.strictEqual(Roulette.pickSpot([spot(1, 1, 1, 1)], () => 0.5).lat, 1);
  assert.strictEqual(Roulette.pickSpot([], () => 0.5), null);
});

test("spotId matches the rides/by-spot filename format", () => {
  assert.strictEqual(Roulette.spotId(spot(68.55688, 17.5624)), "68.55688_17.56240");
});

test("waitMinutes uses the spot's recorded average, else guesses from the rating", () => {
  assert.strictEqual(Roulette.waitMinutes({ wait: 26 }, 5), 26);
  const good = Roulette.waitMinutes({}, 5, () => 0.5);
  const bad = Roulette.waitMinutes({}, 1, () => 0.5);
  assert.ok(bad > good);
  assert.ok(good >= 1 && bad <= 180);
});

test("nextSaturday is today on a Saturday and otherwise the coming one", () => {
  const sat = Roulette.nextSaturday(new Date(2026, 9, 14, 10));
  assert.deepStrictEqual([sat.getMonth(), sat.getDate(), sat.getDay()], [9, 17, 6]);
  assert.strictEqual(Roulette.nextSaturday(new Date(2026, 9, 17, 8)).getDate(), 17);
  assert.strictEqual(Roulette.nextSaturday(new Date(2026, 9, 18, 8)).getDate(), 24);
});

test("toCalendarFile makes an all-day event at the spot", () => {
  const ics = Roulette.toCalendarFile(spot(52.5, 13.4, 4, 3), "Berlin A10", new Date(2026, 9, 17));
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261017/);
  assert.match(ics, /DTEND;VALUE=DATE:20261018/);
  assert.match(ics, /SUMMARY:Hitch Roulette: Berlin A10/);
  assert.match(ics, /GEO:52.5;13.4/);
});

test("toCalendarFile escapes ICS text", () => {
  const ics = Roulette.toCalendarFile(spot(1, 2, 4, 3), "A, B; C", new Date(2026, 9, 17));
  assert.ok(ics.includes("SUMMARY:Hitch Roulette: A\\, B\\; C"));
});
