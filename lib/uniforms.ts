// Approved customer-facing uniform guidelines per role (CEO-approved standard).
// Client-safe: constants only. The full guideline is the hosted image; the text
// items mirror it for accessibility, search, and reuse (e.g. onboarding emails).

export type UniformRole = {
  key: string; // stable slug + image basename
  label: string; // display name
  image: string; // hosted guideline sheet
  blurb: string;
  items: string[]; // approved uniform items
  footwear: string[]; // approved footwear options
};

export const UNIFORMS: UniformRole[] = [
  {
    key: "service-manager",
    label: "Service Manager",
    image: "/uniforms/service-manager.webp",
    blurb: "Approved customer-facing uniform standard for Service Managers.",
    items: [
      "White button-down shirt",
      "Clements logo on left chest",
      "Black belt",
      "Black performance slacks",
    ],
    footwear: ["Black work boots", "All-black sneakers", "Black dress shoes"],
  },
  {
    key: "service-advisor",
    label: "Service Advisor",
    image: "/uniforms/service-advisor.webp",
    blurb: "Approved customer-facing uniform standard for Service Advisors.",
    items: [
      "Grey long-sleeve polo with Clements logo on left chest",
      "Black belt",
      "Black performance slacks",
    ],
    footwear: ["Black work boots", "All-black sneakers"],
  },
  {
    key: "technician",
    label: "Technician",
    image: "/uniforms/technician.webp",
    blurb: "Approved customer-facing uniform standard for Technicians.",
    items: [
      "Green long-sleeve work shirt with Clements logo on left chest",
      "Black belt",
      "Dark gray pants",
    ],
    footwear: ["Black work boots", "All-black sneakers"],
  },
];

export const UNIFORM_BY_KEY: Record<string, UniformRole> = Object.fromEntries(UNIFORMS.map((u) => [u.key, u]));

/** Map a person's access level to the uniform standard that applies to them.
 *  Managers → Service Manager; Service Advisors (sales) → Service Advisor;
 *  Technicians → Technician. Office/leadership roles have no field uniform. */
export function uniformKeyForLevel(accessLevel: string | null | undefined): string | null {
  switch (accessLevel) {
    case "manager":
      return "service-manager";
    case "sales":
      return "service-advisor";
    case "technician":
      return "technician";
    default:
      return null;
  }
}
