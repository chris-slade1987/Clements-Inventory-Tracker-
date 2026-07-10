import { prisma } from "@/lib/prisma";

// The cost-savings agent. Runs alongside the anomaly agent on "run checks now".
// It looks for opportunities to spend less on the same job and files them as
// `savings` alerts (upserted by dedupeKey, never overriding a user's dismissal).
//
// Two grounded signals come from the company's OWN data:
//   1. equivalent  — a cheaper product with the same active ingredient (priced
//                    per unit of active ingredient so different concentrations
//                    compare fairly), same unit of measure.
//   2. distributor — the same product bought cheaper from another distributor.
// A third, optional signal uses Claude (ANTHROPIC_API_KEY) to surface market
// alternatives as *leads to verify* — never with invented prices.

const TRAILING_DAYS = 180;
const MIN_SAVINGS = 50; // dollars over the trailing window
const MIN_PCT = 10; // ignore differences smaller than this
const AI_LEAD_PRODUCTS = 6; // top-spend products sent to Claude for leads

export type SavingsSummary = {
  equivalent: number;
  distributor: number;
  ai_lead: number;
};

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

async function getMinSavings(): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: "savings_min_dollars" } });
  const n = s ? Number(s.value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : MIN_SAVINGS;
}

async function raise(
  dedupeKey: string,
  data: {
    productId?: string | null;
    message: string;
    severity: "info" | "warning" | "critical";
  }
) {
  await prisma.alert.upsert({
    where: { dedupeKey },
    create: {
      dedupeKey,
      type: "savings",
      productId: data.productId ?? null,
      message: data.message,
      severity: data.severity,
      status: "open",
    },
    update: { message: data.message, severity: data.severity },
  });
}

/** First single percentage in an active-ingredient string, e.g. "Bifenthrin 7.9%" -> 7.9.
 *  Returns null for multi-ingredient strings (a "+" or "," joins two AIs) so we
 *  don't compare mixtures as if they were one chemical. */
function singleConcentration(ai: string | null): number | null {
  if (!ai) return null;
  if (/[+,]/.test(ai)) return null; // mixture — not a clean single-AI comparison
  const m = ai.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const pct = parseFloat(m[1]);
  return Number.isFinite(pct) && pct > 0 ? pct : null;
}

/** Chemical name portion of an active ingredient, lowercased. */
function aiName(ai: string | null): string | null {
  if (!ai) return null;
  const name = ai.replace(/\d.*$/, "").trim().toLowerCase();
  return name || null;
}

const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

type ProductStat = {
  id: string;
  name: string;
  manufacturer: string | null;
  category: string | null;
  activeIngredient: string | null;
  unit: string;
  avgPrice: number | null; // trailing-window average paid unit price
  usageQty: number; // trailing check-out volume (proxy for go-forward need)
  spend: number; // trailing purchase spend
};

async function gatherStats(): Promise<ProductStat[]> {
  const since = daysAgo(TRAILING_DAYS);
  const products = await prisma.product.findMany({ where: { active: true } });

  // Trailing purchase prices + spend, per product.
  const lines = await prisma.invoiceLine.findMany({
    where: {
      productId: { not: null },
      unitPrice: { not: null },
      invoice: { status: "confirmed", invoiceDate: { gte: since } },
    },
    select: { productId: true, quantity: true, unitPrice: true, lineTotal: true },
  });
  const priceAgg = new Map<string, { sum: number; n: number; spend: number }>();
  for (const l of lines) {
    if (!l.productId || l.unitPrice == null) continue;
    const a = priceAgg.get(l.productId) ?? { sum: 0, n: 0, spend: 0 };
    a.sum += l.unitPrice;
    a.n += 1;
    a.spend += l.lineTotal ?? l.quantity * l.unitPrice;
    priceAgg.set(l.productId, a);
  }

  // Fallback pricing (all-time latest priced movement) when no trailing invoice.
  const moves = await prisma.stockMovement.findMany({
    where: { unitPrice: { not: null } },
    select: { productId: true, unitPrice: true },
    orderBy: { createdAt: "asc" },
  });
  const lastMovePrice = new Map<string, number>();
  for (const m of moves) if (m.unitPrice != null) lastMovePrice.set(m.productId, m.unitPrice);

  // Trailing check-out volume, per product.
  const checkouts = await prisma.stockMovement.groupBy({
    by: ["productId"],
    where: { type: "check_out", createdAt: { gte: since } },
    _sum: { quantity: true },
  });
  const usage = new Map<string, number>();
  for (const c of checkouts) usage.set(c.productId, Math.abs(c._sum.quantity ?? 0));

  return products.map((p) => {
    const agg = priceAgg.get(p.id);
    const avgPrice = agg && agg.n > 0 ? agg.sum / agg.n : lastMovePrice.get(p.id) ?? null;
    return {
      id: p.id,
      name: p.name,
      manufacturer: p.manufacturer,
      category: p.category,
      activeIngredient: p.activeIngredient,
      unit: (p.unitOfMeasure || "ea").trim().toLowerCase(),
      avgPrice,
      usageQty: usage.get(p.id) ?? 0,
      spend: agg?.spend ?? 0,
    };
  });
}

export async function runSavingsChecks(): Promise<SavingsSummary> {
  const summary: SavingsSummary = { equivalent: 0, distributor: 0, ai_lead: 0 };
  const minSavings = await getMinSavings();
  const stats = await gatherStats();

  // ---- 1. cheaper equivalent (same active ingredient, same unit) -----------
  // Group by chemical name + unit; within a group, price per unit of active
  // ingredient (unitPrice / concentration) makes concentrations comparable.
  type Priced = ProductStat & { pct: number; costPerAi: number; goVolume: number };
  const groups = new Map<string, Priced[]>();
  for (const s of stats) {
    const pct = singleConcentration(s.activeIngredient);
    const name = aiName(s.activeIngredient);
    if (pct == null || !name || s.avgPrice == null || s.avgPrice <= 0) continue;
    const key = `${name}::${s.unit}`;
    const priced: Priced = {
      ...s,
      pct,
      costPerAi: s.avgPrice / (pct / 100),
      goVolume: s.usageQty > 0 ? s.usageQty : 0,
    };
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(priced);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const cheapest = list.reduce((a, b) => (b.costPerAi < a.costPerAi ? b : a));
    for (const p of list) {
      if (p.id === cheapest.id || p.goVolume <= 0) continue;
      const pctCheaper = Math.round(((p.costPerAi - cheapest.costPerAi) / p.costPerAi) * 100);
      if (pctCheaper < MIN_PCT) continue;
      // Savings = active-ingredient we currently deliver, priced at the cheaper rate.
      const aiUnits = p.goVolume * (p.pct / 100);
      const est = aiUnits * (p.costPerAi - cheapest.costPerAi);
      if (est < minSavings) continue;
      await raise(`savings_equiv:${p.id}:${cheapest.id}`, {
        productId: p.id,
        severity: est >= minSavings * 4 ? "warning" : "info",
        message:
          `Switching ${p.name} to ${cheapest.name} (same active ingredient, ~${pctCheaper}% cheaper per unit of active ingredient) ` +
          `could save about ${money(est)} over ${TRAILING_DAYS} days at recent usage. Verify label rates and site suitability before switching.`,
      });
      summary.equivalent++;
    }
  }

  // ---- 2. same product cheaper from another distributor --------------------
  const since = daysAgo(TRAILING_DAYS);
  const distLines = await prisma.invoiceLine.findMany({
    where: {
      productId: { not: null },
      unitPrice: { not: null },
      invoice: { status: "confirmed", invoiceDate: { gte: since } },
    },
    select: {
      productId: true,
      quantity: true,
      unitPrice: true,
      product: { select: { name: true } },
      invoice: { select: { distributor: true } },
    },
  });
  type DAgg = { sum: number; n: number; qty: number };
  const byProdDist = new Map<string, Map<string, DAgg>>();
  const nameOf = new Map<string, string>();
  for (const l of distLines) {
    if (!l.productId || l.unitPrice == null) continue;
    nameOf.set(l.productId, l.product?.name ?? "Product");
    const dist = l.invoice.distributor || "Unknown";
    if (!byProdDist.has(l.productId)) byProdDist.set(l.productId, new Map());
    const dm = byProdDist.get(l.productId)!;
    const a = dm.get(dist) ?? { sum: 0, n: 0, qty: 0 };
    a.sum += l.unitPrice;
    a.n += 1;
    a.qty += l.quantity;
    dm.set(dist, a);
  }
  for (const [productId, dm] of byProdDist) {
    if (dm.size < 2) continue;
    const rows = [...dm.entries()].map(([dist, a]) => ({
      dist,
      avg: a.sum / a.n,
      qty: a.qty,
    }));
    const cheapest = rows.reduce((a, b) => (b.avg < a.avg ? b : a));
    const dearest = rows.reduce((a, b) => (b.avg > a.avg ? b : a));
    const pctCheaper = Math.round(((dearest.avg - cheapest.avg) / dearest.avg) * 100);
    if (pctCheaper < MIN_PCT) continue;
    const totalQty = rows.reduce((s, r) => s + r.qty, 0);
    const est = (dearest.avg - cheapest.avg) * totalQty;
    if (est < minSavings) continue;
    await raise(`savings_distributor:${productId}`, {
      productId,
      severity: est >= minSavings * 4 ? "warning" : "info",
      message:
        `${nameOf.get(productId)} is ~${pctCheaper}% cheaper from ${cheapest.dist} ` +
        `($${cheapest.avg.toFixed(2)}) than ${dearest.dist} ($${dearest.avg.toFixed(2)}). ` +
        `Consolidating recent volume with ${cheapest.dist} could save about ${money(est)} over ${TRAILING_DAYS} days.`,
    });
    summary.distributor++;
  }

  // ---- 3. AI market leads (optional; needs ANTHROPIC_API_KEY) --------------
  const topSpend = stats
    .filter((s) => s.spend > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, AI_LEAD_PRODUCTS);
  if (process.env.ANTHROPIC_API_KEY && topSpend.length > 0) {
    try {
      const leads = await fetchMarketLeads(topSpend);
      const byId = new Map(topSpend.map((s) => [s.id, s]));
      for (const lead of leads) {
        const s = byId.get(lead.productId);
        if (!s || !lead.alternative) continue;
        await raise(`savings_ai:${s.id}`, {
          productId: s.id,
          severity: "info",
          message:
            `AI lead — verify pricing & registration: for ${s.name}, consider ${lead.alternative}` +
            (lead.manufacturer ? ` (${lead.manufacturer})` : "") +
            `. ${lead.rationale}`.trim(),
        });
        summary.ai_lead++;
      }
    } catch {
      // Market leads are best-effort; a failure never blocks the grounded checks.
    }
  }

  return summary;
}

type Lead = { productId: string; alternative: string; manufacturer?: string; rationale: string };

async function fetchMarketLeads(products: ProductStat[]): Promise<Lead[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
  const list = products
    .map(
      (p) =>
        `- id:${p.id} | ${p.name} | active: ${p.activeIngredient ?? "unknown"} | category: ${p.category ?? "unknown"}`
    )
    .join("\n");

  const prompt = `You advise a Florida pest-control company on chemical purchasing. For each product below, name ONE lower-cost alternative that a US pest-control operator could realistically buy and that does the same job — typically a generic with the same active ingredient, or a well-known equivalent brand. These are LEADS for the manager to verify, not purchase instructions.

STRICT RULES:
- Do NOT invent or state any prices or dollar figures.
- Only suggest real, commercially available products you are confident exist.
- The alternative must share the primary active ingredient / mode of action.
- If you don't know a credible alternative for an item, omit that item.
- Respond with ONLY a JSON array, no prose, no code fences:
[{"productId": string, "alternative": string, "manufacturer": string, "rationale": string}]
Keep each rationale to one short sentence (why it's an equivalent / typically cheaper).

Products:
${list}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}`);
  const data = (await res.json()) as { content?: { text?: string }[] };
  const text = data.content?.map((c) => c.text ?? "").join("") ?? "";
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  const parsed = JSON.parse(text.slice(start, end + 1)) as unknown[];
  const valid = new Set(products.map((p) => p.id));
  return parsed
    .map((r) => r as Record<string, unknown>)
    .filter((r) => typeof r.productId === "string" && valid.has(r.productId) && typeof r.alternative === "string")
    .map((r) => ({
      productId: String(r.productId),
      alternative: String(r.alternative),
      manufacturer: r.manufacturer ? String(r.manufacturer) : undefined,
      rationale: r.rationale ? String(r.rationale) : "",
    }));
}
