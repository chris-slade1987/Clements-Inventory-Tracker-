// Parser tests for the Cancellation Center (PestPac Gain & Loss, sorted by Branch, Route).
// Run: npx tsx --test lib/cancellations-parse.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCancellationReport, divisionForService, splitAddress, totalsMatch, CancellationParseError } from "./cancellations-parse";

const T = (rows: string[][]) => rows.map((r) => r.join("\t")).join("\r\n");
const HEAD = [
  ["Date:", "2026/11/16 11:36 AM"],
  ["", "", "Gain & Loss Report"],
  ["Start Date:", "2026/11/01", "Service:", "[All]"],
  ["End Date:", "2026/11/16", "Branch:", "[All]"],
  ["Sorted by:", "[Branch, Route]"],
];
const HDR = (r: string) => [`Route: ${r}`, "Location", "Name", "Address", "Service", "Gains Count", "Gains Value", "Loss Count", "Loss Value", "Price Change Count", "Price Change Value", "Net"];

test("parses branch/route-sorted losses and proves the totals", () => {
  const p = parseCancellationReport(T([
    ...HEAD,
    ["Branch: Naples - Branch 4"],
    HDR("405"),
    ["120620", "Michaels, Nancy", "5113 Castlerock Way, Naples, FL 34112", "RE-FILL BAIT", "", "", "1", "390.00", "0", "0.00", "-390.00"],
    ["120635", "Llerena, Ray", "533 Hernando Dr, Marco Island, FL 34145-2411", "L LAWN", "", "", "1", "1,396.00", "0", "0.00", "-1,396.00"],
    ["120700", "Gain, Only", "1 Main St, Naples, FL 34102", "PC-EOM", "1", "300.00", "0", "0.00", "0", "0.00", "300.00"],
    ["Totals Route: 405", "", "", "", "1", "300.00", "2", "1,786.00", "0", "0.00", "-1,486.00"],
    ["Branch: Vero Beach - Branch 1"],
    HDR("12"),
    ["100001", "Doe, Jane", "10 Ocean Dr, Port Saint Lucie, FL 34952", "PC-QUARTERLY", "", "", "1", "500.00", "0", "0.00", "-500.00"],
    ["Report Totals", "", "", "", "1", "300.00", "3", "2,286.00", "0", "0.00", "-1,986.00"],
  ]));
  assert.equal(p.periodKey, "2026-11");
  assert.equal(p.startDate, "2026-11-01");
  assert.equal(p.endDate, "2026-11-16");
  assert.equal(p.rows.length, 3); // the gain-only row is not a cancellation
  assert.deepEqual(p.rows[1], {
    branch: "naples", route: "405", account: "120635", customer: "Llerena, Ray",
    address: "533 Hernando Dr, Marco Island, FL 34145-2411", city: "Marco Island", zip: "34145",
    serviceCode: "L LAWN", division: "LO", lossCount: 1, lossValue: 1396,
  });
  assert.equal(p.rows[2].branch, "vero");
  assert.equal(p.rows[2].city, "Port St Lucie");
  assert.equal(totalsMatch(p), true);
});

test("rejects multi-month ranges and technician grouping", () => {
  const multi = T([["", "", "Gain & Loss Report"], ["Start Date:", "2025/11/01"], ["End Date:", "2026/11/16"], ["Branch: Vero Beach - Branch 1"]]);
  assert.throws(() => parseCancellationReport(multi), CancellationParseError);
  const tech = T([...HEAD, ["Tech 1: 22 TIM"], HDR("22"), ["100001", "Doe", "x, Vero Beach, FL 32960", "PC-EOM", "", "", "1", "1", "0", "0", "-1"]]);
  assert.throws(() => parseCancellationReport(tech), /sorted by Branch, Route/);
  assert.throws(() => parseCancellationReport("Technician Production Report"), /Gain & Loss/);
});

test("service codes map to divisions", () => {
  assert.equal(divisionForService("PC-EOM"), "GHP");
  assert.equal(divisionForService("IPM"), "GHP");
  assert.equal(divisionForService("GR TURF-SHRUB"), "LO");
  assert.equal(divisionForService("L-WEED"), "LO");
  assert.equal(divisionForService("A-FIRE ANT"), "LO");
  assert.equal(divisionForService("SEN-MONITOR"), "TERMITE");
  assert.equal(divisionForService("L-MOSQUITO"), "MOSQUITO");
  assert.equal(divisionForService("MM-MIST PROGRAM"), "MOSQUITO");
  assert.equal(divisionForService("R-BAIT STATIONS"), "RODENT");
  assert.equal(divisionForService("W1-ATI"), "OTHER");
});

test("splitAddress pulls city and zip", () => {
  assert.deepEqual(splitAddress("28502 Highgate Drive, Bonita Springs, FL 34135"), { city: "Bonita Springs", zip: "34135" });
  assert.deepEqual(splitAddress("5 A St, ST. CLOUD, FL 34769-1234"), { city: "St Cloud", zip: "34769" });
});
