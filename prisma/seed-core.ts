import type { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

// Local copy of the password hasher so the seed has no app-import dependencies.
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export const MANAGER_EMAIL = "manager@clementspest.com";
export const MANAGER_PASSWORD = "clements123";

/**
 * Seed the database with sample data. When reset is true, existing rows are
 * cleared first (local `npm run db:seed`). When false, it assumes an empty
 * database (deploy-time bootstrap).
 */
export async function seedDatabase(
  prisma: PrismaClient,
  { reset }: { reset: boolean }
) {
  if (reset) {
    await prisma.alert.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.invoiceLine.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.session.deleteMany();
    await prisma.technician.deleteMany();
    await prisma.product.deleteMany();
    await prisma.user.deleteMany();
    await prisma.warehouse.deleteMany();
    await prisma.setting.deleteMany();
  }

  // --- Warehouses -----------------------------------------------------
  const vero = await prisma.warehouse.create({ data: { name: "Vero Beach (HQ)" } });
  const stuart = await prisma.warehouse.create({ data: { name: "Stuart" } });
  const orlando = await prisma.warehouse.create({ data: { name: "Orlando" } });

  // --- Manager --------------------------------------------------------
  const manager = await prisma.user.create({
    data: {
      name: "Chris Slade",
      email: MANAGER_EMAIL,
      passwordHash: hashPassword(MANAGER_PASSWORD),
      role: "admin",
      warehouseId: vero.id,
    },
  });

  // --- Technicians (no logins; pick-list only) ------------------------
  const techSpec: Array<[string, string, string]> = [
    ["Mike Alvarez", vero.id, "FL-1001"],
    ["Danny Cooper", vero.id, "FL-1002"],
    ["Luis Ramirez", stuart.id, "FL-2001"],
    ["Sarah Bishop", stuart.id, "FL-2002"],
    ["Tyrone Woods", orlando.id, "FL-3001"],
    ["Kayla Nguyen", orlando.id, "FL-3002"],
  ];
  const techs: { id: string; homeWarehouseId: string }[] = [];
  for (const [name, wh, card] of techSpec) {
    const t = await prisma.technician.create({
      data: { name, homeWarehouseId: wh, employeeIdCard: card },
    });
    techs.push({ id: t.id, homeWarehouseId: wh });
  }

  // --- Products -------------------------------------------------------
  const productSpec = [
    ["Termidor SC", "BASF", "7969-210", "bottle", "Termiticide", "072845079692"],
    ["Taurus SC", "Control Solutions", "53883-279", "bottle", "Termiticide", "758211532793"],
    ["Talstar P Professional", "FMC", "279-3206", "gallon", "Insecticide", "049969032061"],
    ["Bifen I/T", "Control Solutions", "53883-118", "gallon", "Insecticide", "758211181182"],
    ["Demand CS", "Syngenta", "100-1066", "bottle", "Insecticide", "010667010663"],
    ["Temprid FX", "Envu", "432-1483", "bottle", "Insecticide", "043214814831"],
    ["Suspend PolyZone", "Envu", "432-1514", "bottle", "Insecticide", "043214815142"],
    ["Tempo SC Ultra", "Envu", "432-1363", "bottle", "Insecticide", "043214813636"],
    ["Alpine WSG", "BASF", "499-561", "bottle", "Insecticide", null],
    ["Advion Ant Gel", "Syngenta", "100-1484", "box", "Bait", "010667014845"],
    ["Advion Cockroach Gel", "Syngenta", "100-1498", "box", "Bait", "010667014982"],
    ["Optigard Ant Gel", "Syngenta", "100-1483", "box", "Bait", null],
    ["Gentrol IGR", "Zoecon", "2724-484", "bottle", "IGR", null],
    ["CimeXa Dust", "Rockwell Labs", "73079-1", "bottle", "Dust", "857641002019"],
    ["Contrac Blox", "Bell Labs", "12455-79", "pail", "Rodenticide", "744627124556"],
    ["Fastrac Blox", "Bell Labs", "12455-95", "pail", "Rodenticide", null],
  ] as const;

  const products: Record<string, { id: string }> = {};
  for (const [name, manufacturer, epa, unit, category, barcode] of productSpec) {
    const p = await prisma.product.create({
      data: {
        name,
        manufacturer,
        epaRegNumber: epa,
        unitOfMeasure: unit,
        category,
        barcode: barcode ?? undefined,
        distributorSku: `SITEONE-${epa.replace(/-/g, "")}`,
      },
    });
    products[name] = { id: p.id };
  }

  // --- Sample confirmed invoices + opening stock ----------------------
  const daysAgo = (n: number) => new Date(Date.now() - n * 864e5);

  async function seedInvoice(opts: {
    warehouseId: string;
    number: string;
    date: Date;
    lines: Array<[string, number, number]>;
  }) {
    const lineData = opts.lines.map(([name, qty, price]) => ({
      name,
      qty,
      price,
      productId: products[name].id,
    }));
    const subtotal = lineData.reduce((s, l) => s + l.qty * l.price, 0);
    const invoice = await prisma.invoice.create({
      data: {
        distributor: "SiteOne",
        invoiceNumber: opts.number,
        invoiceDate: opts.date,
        warehouseId: opts.warehouseId,
        status: "confirmed",
        uploadedById: manager.id,
        subtotal,
        total: subtotal,
        lines: {
          create: lineData.map((l) => ({
            productId: l.productId,
            descriptionRaw: l.name,
            quantity: l.qty,
            unit: "ea",
            unitPrice: l.price,
            lineTotal: l.qty * l.price,
            matched: true,
          })),
        },
      },
    });
    for (const l of lineData) {
      await prisma.stockMovement.create({
        data: {
          type: "check_in",
          productId: l.productId,
          warehouseId: opts.warehouseId,
          quantity: l.qty,
          unitPrice: l.price,
          sourceInvoiceId: invoice.id,
          userId: manager.id,
          createdAt: opts.date,
        },
      });
    }
  }

  await seedInvoice({
    warehouseId: vero.id,
    number: "SO-100421",
    date: daysAgo(40),
    lines: [
      ["Termidor SC", 12, 78.5],
      ["Talstar P Professional", 10, 62.0],
      ["Advion Cockroach Gel", 24, 34.25],
      ["Demand CS", 8, 89.0],
      ["Contrac Blox", 6, 41.5],
    ],
  });
  await seedInvoice({
    warehouseId: vero.id,
    number: "SO-104882",
    date: daysAgo(5),
    lines: [
      ["Termidor SC", 6, 92.75], // ~18% jump vs 78.50 -> price_increase
      ["Talstar P Professional", 8, 63.5],
      ["Temprid FX", 10, 71.0],
    ],
  });
  await seedInvoice({
    warehouseId: stuart.id,
    number: "SO-104901",
    date: daysAgo(6),
    lines: [
      ["Taurus SC", 10, 44.0],
      ["Bifen I/T", 12, 39.5],
      ["Advion Ant Gel", 18, 36.0],
      ["Fastrac Blox", 8, 45.0],
    ],
  });
  await seedInvoice({
    warehouseId: orlando.id,
    number: "SO-104777",
    date: daysAgo(8),
    lines: [
      ["Suspend PolyZone", 10, 84.0],
      ["Tempo SC Ultra", 9, 67.5],
      ["Optigard Ant Gel", 20, 33.0],
      ["CimeXa Dust", 6, 29.0],
    ],
  });

  // --- Sample check-outs ----------------------------------------------
  const checkout = (name: string, warehouseId: string, techId: string, q: number, dAgo: number) =>
    prisma.stockMovement.create({
      data: {
        type: "check_out",
        productId: products[name].id,
        warehouseId,
        technicianId: techId,
        quantity: -Math.abs(q),
        userId: manager.id,
        createdAt: daysAgo(dAgo),
      },
    });

  await checkout("Termidor SC", vero.id, techs[0].id, 3, 3);
  await checkout("Talstar P Professional", vero.id, techs[0].id, 2, 3);
  await checkout("Advion Cockroach Gel", vero.id, techs[1].id, 6, 2);
  await checkout("Taurus SC", stuart.id, techs[2].id, 2, 2);
  await checkout("Advion Ant Gel", stuart.id, techs[3].id, 4, 1);
  await checkout("Suspend PolyZone", orlando.id, techs[4].id, 3, 1);

  await prisma.setting.create({
    data: { key: "price_increase_threshold_pct", value: "10" },
  });

  return {
    warehouses: 3,
    technicians: techs.length,
    products: Object.keys(products).length,
  };
}
