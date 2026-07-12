# Board / Executive Dashboard — KPI Gap Analysis & Roadmap

Advisory research on how to elevate the Board/Executive dashboard toward what a
best-in-class recurring-revenue field-services company (and a PE portfolio
dashboard) would show. Not yet built — this is the plan.

**Compute legend:** **(a)** from data we already have · **(b)** small new input
(usually active account count or a tagged expense line) · **(c)** new data source.

## The single biggest gap
We track the forward **book value** (a snapshot) and **gross adds / gross
attrition** (flows), but don't present the **recurring base as a managed asset
with a movement bridge**. That reframing unlocks ~6 KPIs below and is what an
acquirer or lender asks for first.

## Ranked KPIs to add

| # | KPI | Theme | Compute |
|---|-----|-------|---------|
| 1 | Recurring revenue base (MRR/ARR) + movement bridge | Recurring health | a |
| 2 | Net & Gross Revenue Retention (NRR / GRR) | Recurring health | a |
| 3 | Account count, net logo change, logo churn % | Recurring health | b |
| 4 | ARPU / avg annual value per account | Unit economics | b |
| 5 | Adjusted EBITDA + Net Debt / EBITDA leverage | Profitability / leverage | a |
| 6 | CAC, LTV, LTV:CAC, CAC payback (by channel) | Unit economics | b |
| 7 | Rule of 40 (recurring growth % + EBITDA margin %) | Profitability | a |
| 8 | Free cash flow & FCF conversion (% of EBITDA) | Liquidity | a |
| 9 | Revenue per technician / per FTE (TTM) | Efficiency | a |
| 10 | Recurring revenue mix % (recurring vs one-time) | Recurring health | a |
| 11 | DSO, working capital, current & quick ratio | Liquidity | a |
| 12 | True gross margin vs route contribution | Profitability | b |
| 13 | New-sale first-year retention / cohort survival | Recurring health | b/c |
| 14 | Route density — revenue per route / stop / mile | Efficiency | c |
| 15 | M&A scorecard — entry multiple, acquired-account retention | M&A | c |

## Notes by theme

**Recurring health.** The ARR movement bridge (Beginning + New + Reactivation +
Expansion − Contraction − Churn = Ending) is *the* recurring chart we lack.
Price increases are a large expansion lever in pest control that our current
adds/attrition view hides. NRR >100% (price increases outrun cancellations)
materially raises valuation multiple; always show GRR alongside so logo bleed
isn't masked. Recurring-mix % is a headline valuation driver.

**Unit economics.** CAC = (sales+marketing)/new accounts; LTV = ARPU × gross
margin × (1/annual logo churn); target LTV:CAC ≥ 3–4x, CAC payback < 12–18 mo.
Split CAC by lead channel (we already capture lead sources) — blended hides
where money works. Needs active account count + S&M tagged out of SG&A.

**Profitability.** Show reported **and** Adjusted EBITDA side by side with
itemized add-backs (owner comp, management fee, one-offs); leverage = Net Debt /
TTM Adj. EBITDA (acquisition borrowing headroom). Rule of 40 as a one-number
growth-vs-margin read. Define a true gross margin (revenue − tech labor,
chemical, fuel, vehicle) distinct from route contribution.

**Liquidity.** FCF = CF from ops − maintenance capex; conversion = FCF/EBITDA
(vehicle-heavy business). DSO trend (segment commercial vs residential autopay),
working capital, current/quick ratios.

**Efficiency.** Revenue per tech (TTM, by branch) = operating-leverage read.
Route density (accounts/route, revenue/route-day, stops/tech-day, miles/stop)
is the profit engine in pest control — roadmap once scheduling/GPS data feeds in.

**M&A.** Per deal: entry multiple (EV/Adj. EBITDA and $/recurring account),
acquired-account retention curve (the #1 roll-up failure mode), model vs actual,
pro-forma leverage. Track acquired cohorts separately from organic.

## Views a top-tier deck uses that we don't
1. **ARR waterfall/bridge** — highest-impact single view.
2. **EBITDA bridge vs prior year** — decompose YoY into price/volume/labor/chemical-fuel/SG&A.
3. **Cohort retention triangle** — surfaces the early-churn cliff.
4. **Trailing-12-month trend lines** — Florida pest is seasonal; single-month vs budget misleads.
5. **Per-branch benchmarking scorecard** (heatmap) — revenue/tech, ARPU, churn, NRR, margin per branch.

## Guardrails (don't mislead)
- Label attrition/retention basis (gross vs net, logo vs dollar, monthly vs annualized).
- Show reported vs Adjusted EBITDA with add-backs itemized.
- Keep forward book value visually distinct from GAAP revenue.
- LTV is assumption-sensitive — show the churn & margin inputs on the tile.
- Reframe "cash runway" (startup framing) as months-of-opex-covered / leverage / FCF.
- Pair monthly figures with TTM and prior-year-same-month (seasonality).
- Never show a single blended CAC — split by channel.

## Suggested build sequence
1. **Now, from data we have (a):** ARR bridge, NRR/GRR, recurring mix %, Adjusted
   EBITDA + leverage, Rule of 40, FCF conversion, DSO/working capital/ratios,
   revenue per tech (TTM), plus the EBITDA bridge and TTM trend views.
2. **Next, one small input — active account count + tagged S&M (b):** logo
   metrics, ARPU, CAC/LTV/payback, true gross margin, cohort retention.
3. **Roadmap, new sources (c):** route density (scheduling/GPS), M&A scorecard.

Phase 1 is essentially free — repackaging the CFO's monthly report into the lens
a PE board expects — and most changes how the board perceives the business's value.
