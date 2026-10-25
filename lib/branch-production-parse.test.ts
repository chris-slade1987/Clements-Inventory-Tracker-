// Parser tests for the weekly PestPac production reports (pinned to the real formats).
// Run: npx tsx --test lib/branch-production-parse.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProductionReport, parseAppointmentList, parseUnservicedReport, parseGainLossReport, parseCallbackReport, detectReportType } from "./branch-production-parse";

const T = (rows: string[][]) => rows.map((r) => r.join("\t")).join("\n");

test("detectReportType identifies each PestPac report by header", () => {
  assert.equal(detectReportType("Technician Schedule Report\n..."), "schedule");
  assert.equal(detectReportType("x\nTechnician Production Report\n"), "production");
  assert.equal(detectReportType("||Appointment List||"), "appointments");
  assert.equal(detectReportType("||Uncommitted Orders Report||"), "unserviced");
  assert.equal(detectReportType("||Gain & Loss Report||"), "gainloss");
  assert.equal(detectReportType("Call Back Report"), "callback");
  assert.equal(detectReportType("Some Other Report"), "unknown");
});

test("parseProductionReport pulls account/date/service/$", () => {
  const text = T([
    ["Technician Production Report"],
    ["Invoice Date", "Invoice", "Tech. Name", "Inv. Type", "Order", "Work Date", "Location", "Location Name", "Service", "Count", "%", "Amount", "%", "Count", "%", "Man Hours"],
    ["2026/10/01", "A622606", "Main, Josh", "PR", "622606", "2026/10/02", "108137", "Smith, Brad", "re-fill bait", "", "", "44.00", "0.0", "", "", "0.00"],
    ["2026/10/01", "A622652", "Main, Josh", "PR", "622652", "2026/10/03", "108998", "Boundy, Gail", "PC-MONTHLY", "", "", "1,350.00", "0.0", "", "", "0.00"],
  ]);
  const rows = parseProductionReport(text);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { account: "108137", date: "2026-10-02", service: "RE-FILL BAIT", dollars: 44, techName: "Main, Josh" });
  assert.equal(rows[1].dollars, 1350); // comma stripped
});

test("parseAppointmentList reads the 4-line record (account/service/date/route/tech)", () => {
  const text = T([
    ["01 JOSH  Josh Main", "$265.00", "622501", "Redsteel", "", "Service Order", "Yes"],
    ["2026/10/26  Monday", "0.00", "107291", "9625 N US Highway 1", "", "", "pc-monthly"],
    ["06:45 AM-06:50 AM", "00:05", "2026/09/25", "Sebastian, FL", "772-766-4408", "01", "M4MON"],
    ["Location Instructions: exterior rodent"],
  ]);
  const rows = parseAppointmentList(text);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { account: "107291", date: "2026-10-26", service: "PC-MONTHLY", route: "01", techName: "01 JOSH  Josh Main", dollars: 265 });
});

test("parseUnservicedReport skips group/totals lines, keeps order rows", () => {
  const text = T([
    ["Technician: 02 RUSTY"],
    ["Work Date: 2026/10/02"],
    ["Order", "Location", "Name", "Work Date", "Work Time", "Duration", "Invoice Date", "Technician", "Order Type", "Service Total", "Service"],
    ["623603", "121146", "Debbie Cianchetti", "2026/10/02", " ", "01:00", "", "02 RUSTY", "Order", "439.00", "sen-monitor"],
    ["Totals Work Date: 2026/10/02", "", "", "", "", "", "", "1 Order", "Total:", "439.00"],
  ]);
  const rows = parseUnservicedReport(text);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { account: "121146", date: "2026-10-02", service: "SEN-MONITOR", route: "02", techName: "02 RUSTY", dollars: 439, name: "Debbie Cianchetti" });
});

test("parseUnservicedReport derives route from a no-space tech code", () => {
  const text = T([
    ["Order", "Location", "Name", "Work Date", "WT", "Dur", "ID", "Technician", "OT", "Service Total", "Service"],
    ["700", "555001", "ACME", "2026/10/10", "", "", "", "208MAURICE", "Order", "200.00", "PC-EOM"],
  ]);
  assert.equal(parseUnservicedReport(text)[0].route, "208");
});

test("parseGainLossReport tracks route context, gains/losses/net", () => {
  const text = T([
    ["Tech 1: 01 JOSH"],
    ["Route: 01", "Location", "Service", "Gains Count", "Gains Value", "Loss Count", "Loss Value", "Price Change Count", "Price Change Value", "Net"],
    ["1002225", "PC-MONTHLY", "", "", "1", "504.00", "0", "0.00", "-504.00"],
    ["128318", "PC-EOM", "1", "1,050.00", "", "", "0", "0.00", "1,050.00"],
    ["Totals Route: 01", "", "1", "1,050.00", "2", "844.00", "0", "0.00", "206.00"],
  ]);
  const rows = parseGainLossReport(text);
  assert.equal(rows.length, 2);
  const loss = rows.find((r) => r.account === "1002225")!;
  assert.equal(loss.route, "01");
  assert.equal(loss.lossCount, 1);
  assert.equal(loss.lossValue, 504);
  assert.equal(loss.net, -504);
  const gain = rows.find((r) => r.account === "128318")!;
  assert.equal(gain.gainsCount, 1);
  assert.equal(gain.gainsValue, 1050);
  assert.equal(gain.net, 1050);
});

test("parseCallbackReport reads callback events, skips group/totals", () => {
  const text = T([
    ["Technician: 01 JOSH"],
    ["Location", "Name", "City", "Route", "Work Date", "Service Code", "Description"],
    ["100739", "2300 Ocean Drive LLC", "Vero Beach", "01", "2026/10/15", "3-callback", "CALLBACK SERVICE"],
    ["Totals Technician: 01 JOSH", "", "", "2"],
  ]);
  const rows = parseCallbackReport(text);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { account: "100739", name: "2300 Ocean Drive LLC", city: "Vero Beach", route: "01", date: "2026-10-15", serviceCode: "3-CALLBACK", description: "CALLBACK SERVICE" });
});
