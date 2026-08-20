// Canonical content for the August 2026 GHP CEU, embedded in code so it is
// available at BUILD time (deploy seed) AND RUNTIME (admin re-seed endpoint)
// without reading a file — a runtime readFileSync of prisma/data is not traced
// into the serverless bundle. Edit here; the .md copy is documentation only.
import type { Question } from "./training";

export const GHP_COURSE_TITLE = "Roach Identification — The Clements Way (August 2026)";
export const GHP_PASSING_SCORE = 80;

const TF = ["True", "False"];
export const GHP_QUESTIONS: Question[] = [
  { prompt: "Seeing a cockroach in the middle of the day usually means the infestation is small.", options: TF, correctIndex: 1 },
  { prompt: "The German cockroach is identified by two dark stripes running lengthwise behind its head.", options: TF, correctIndex: 0 },
  { prompt: "A cockroach nymph looks like a small, wingless version of the adult.", options: TF, correctIndex: 0 },
  { prompt: "Because eggs are protected inside the ootheca, a single treatment often does not end a German roach problem.", options: TF, correctIndex: 0 },
  { prompt: "Oriental cockroaches respond well to gel bait placed in the kitchen.", options: TF, correctIndex: 1 },
  { prompt: "Crickets and cockroaches can be told apart because crickets have large jumping legs and roaches do not.", options: TF, correctIndex: 0 },
  { prompt: "A clean home cannot get a roach infestation.", options: TF, correctIndex: 1 },
  { prompt: "Brown-banded cockroaches are best controlled with floor-level treatment only.", options: TF, correctIndex: 1 },
  { prompt: "A strong musty, oily odor in a home can indicate a large or long-standing roach population.", options: TF, correctIndex: 0 },
  { prompt: "Killing the visible German roaches with spray is enough to eliminate the infestation.", options: TF, correctIndex: 1 },
  { prompt: "The shield-like plate behind a roach's head, whose markings help identify the species, is called the:", options: ["Cerci", "Ootheca", "Pronotum", "Instar"], correctIndex: 2 },
  { prompt: "Which cockroach is the largest, reddish-brown, and marked with a yellowish figure-eight behind the head?", options: ["German cockroach", "Brown-banded cockroach", "American cockroach", "Oriental cockroach"], correctIndex: 2 },
  { prompt: "A technician finds small tan roaches with two dark stripes behind the refrigerator. The species is most likely:", options: ["Oriental cockroach", "German cockroach", "American cockroach", "Brown-banded cockroach"], correctIndex: 1 },
  { prompt: "Which species is shiny dark brown to black, has no stripes, and prefers cool, damp places like drains?", options: ["German cockroach", "American cockroach", "Oriental cockroach", "Brown-banded cockroach"], correctIndex: 2 },
  { prompt: "Why does correct species identification matter before treating?", options: ["It is required for billing purposes only", "Each species has different habitat and behavior, so each needs a different treatment approach", "All roaches respond identically to the same treatment", "It only matters for commercial accounts"], correctIndex: 1 },
  { prompt: "Small black specks resembling ground pepper or coffee grounds in a cabinet corner are most likely:", options: ["Shed skins", "Egg cases", "Droppings from small roaches", "Smear marks"], correctIndex: 2 },
  { prompt: "Which behavior best explains why roach activity concentrates in shared harborage rather than spreading evenly?", options: ["Roaches are territorial and avoid each other", "Droppings release pheromones that attract other roaches", "Roaches only live where there is no food", "Roaches are active only in daylight"], correctIndex: 1 },
  { prompt: "A customer reports roaches high in the upper cabinets and behind picture frames, in dry rooms. Which species and approach fit best?", options: ["Oriental cockroach — treat the drains", "American cockroach — treat the perimeter", "Brown-banded cockroach — whole-room approach with treatment placed high", "German cockroach — bait under the sink only"], correctIndex: 2 },
  { prompt: "A customer asks whether having roaches means their house is dirty. The best response is:", options: ["Yes — roaches only appear in dirty homes", "No — roaches are common opportunists; sanitation helps control them but isn't the only cause", "It doesn't matter, just treat and leave", "Only if they saw the roaches in the kitchen"], correctIndex: 1 },
  { prompt: "A technician finds a German cockroach infestation plus a drip under the sink. The most complete response is:", options: ["Spray all visible roaches and leave", "Bait the harborage, recommend fixing the drip and improving sanitation, and schedule follow-up", "Apply spray over the bait to work faster", "Treat only the countertops where the customer saw roaches"], correctIndex: 1 },
];

export const GHP_COURSE_BODY = `![Roach Identification — The Clements Way](/training/ghp-august/hero.svg)

**GHP Technician Training · August 2026 · Module 8**

# Roach Identification — *The Clements Way*

General Household Pest Control · cockroach species identification, behavior &amp; habits, and home detection.

| Module | Duration | Format | Assessment |
| :-- | :-- | :-- | :-- |
| August — Module 8 | 30–40 minutes | Self-study + discussion | Follow-up quiz (20 questions) |

> **Key point.** Correct identification is the whole job. Name the species first, and the treatment plan almost writes itself. Guess the species, and you are treating blind.

## Learning objectives

This module is written for every technician — including those brand new to pest control. No prior knowledge of cockroaches is assumed. By the end, you will be able to:

- Explain what a cockroach is and name the basic body parts used to identify one
- Describe the cockroach life cycle — egg, nymph, and adult — and why it affects treatment
- Identify the four cockroach species most commonly found in homes — German, American, Oriental, and Brown-banded
- Tell cockroaches apart from common lookalikes such as beetles and crickets
- Use a quick field ID guide to narrow down a species on site
- Describe cockroach behavior and habits, and use them to predict where roaches hide
- Recognize the physical signs of an infestation even when no live roach is visible
- Connect accurate identification to the correct treatment strategy
- Explain findings and answer common customer questions clearly and without judgment

## Why this matters

Cockroach control begins with correct identification. Every species looks, lives, and behaves differently — and each one responds to a different treatment approach. **A treatment that eliminates one species can completely miss another.**

Because each species enters, hides, and breeds differently, the right treatment depends entirely on which one you are dealing with. If you cannot name the species, you cannot reliably solve the problem.

Identification also matters for health. Cockroaches contaminate food and surfaces, spread bacteria, and their droppings and shed skins are a leading trigger for asthma and allergies — especially in children. When we identify and eliminate roaches correctly, we are protecting the customer's health, not just removing a nuisance.

## Roach 101 — what is a cockroach?

A cockroach is a flat, oval, fast-moving insect that has lived alongside people for a very long time. There are thousands of species worldwide, but only a handful ever become pests inside homes. A few basics make the rest of this training easy to follow.

**What all cockroaches have in common:**

- Six legs and two long, thread-like antennae they constantly move to "feel" their surroundings
- A flat, oval body that lets them squeeze into cracks as thin as the edge of a coin
- A preference for darkness — most active at night, hiding during the day
- The ability to eat almost anything organic — food, grease, glue, soap, even paper
- Fast reproduction, which is why a small problem can become a big one quickly

### Parts to know

![The parts used to identify a cockroach — antennae, head, pronotum, wings, six legs, and cerci](/training/ghp-august/photos/anatomy.jpg)

| Body part | What it is | Why it matters for ID |
| :-- | :-- | :-- |
| **Antennae** | Two long, thread-like feelers on the head | Long antennae help tell roaches from beetles |
| **Pronotum (shield)** | The flat plate covering the area right behind the head | Its color and markings (stripes, figure-8) are the **#1 ID clue** |
| **Wings** | Wing covers over the back in most adults | Length and coverage vary by species and help with ID |
| **Legs (six)** | Spiny legs built for speed | Roaches run and scramble; they do **not** jump |
| **Cerci** | Two short tail-like sensors at the rear | They detect air movement — which is why roaches are hard to catch |

## The roach life cycle

Cockroaches grow through three stages: **egg, nymph, and adult.** This is called *incomplete metamorphosis.* Unlike a caterpillar that transforms into a butterfly, a baby cockroach already looks like a small adult and simply grows larger with each molt.

![Incomplete metamorphosis: egg case (ootheca) → nymph → winged adult](/training/ghp-august/photos/life-cycle-1.jpg)

- **Egg** — a female produces an egg case called an *ootheca,* a small purse-like capsule that holds many eggs. Depending on the species she either carries it or glues it in a hidden spot.
- **Nymph** — newly hatched roaches are wingless, smaller, and often darker than adults. As they grow they *molt* (shed their outer skin) several times. Each stage between molts is called an *instar.*
- **Adult** — the fully grown roach, usually with wings, able to reproduce and start the cycle again.

![A nymph (left) looks like a small, wingless version of the adult (right) and simply grows with each molt](/training/ghp-august/photos/life-cycle-2.jpg)

> **Why it matters.** Eggs are protected inside the ootheca and survive many sprays. That is why one treatment is rarely enough — as the eggs hatch, a second wave appears. Lasting control uses **bait plus follow-up visits** to catch the newly hatched nymphs.

## Cockroach biology &amp; behavior — the basics

All cockroaches share a set of survival traits. Understanding these traits is what lets a technician predict where roaches are, *even before finding one.*

- **Nocturnal** — they feed and travel at night and hide during the day. Seeing them in daylight usually signals a heavy population.
- **Thigmotactic** — they instinctively seek tight spaces where their bodies touch surfaces on multiple sides: cracks, crevices, and gaps behind and under things.
- **Aggregating** — droppings release pheromones (scent signals) that attract other roaches, so activity concentrates in shared hiding areas rather than spreading evenly.
- **Warmth-, moisture-, and food-seeking** — roaches gather where all three meet; kitchens, bathrooms, and areas around appliances and plumbing are prime.
- **Fast-breeding** — under good conditions a single female and her offspring can produce thousands of roaches in under a year.
- **Omnivorous scavengers** — they eat food, grease, glue, soap, paper, and other organic residue, so sanitation directly affects populations.

> **Field note.** Roaches don't hide randomly — they hide where warmth, moisture, food, and a tight crack all meet. Learn to read a room for those four things and you will find the harborage before you find the roach.

## Meet the four species

These are the cockroaches Clements technicians encounter in homes. Learn to tell them apart on sight — size, color, and markings are usually enough.

### German cockroach — the one you'll see most

![German cockroach — small and tan with two dark parallel stripes behind the head](/training/ghp-august/photos/german.jpg)

Small (about 1/2 to 5/8 inch), light tan to brown, with **two dark parallel stripes** running lengthwise behind the head. The most common indoor cockroach and the primary target of most residential work. Lives almost exclusively indoors, concentrated in kitchens and bathrooms near food, water, and warmth. Breeds rapidly and responds well to gel bait.

### American cockroach — the big one

![American cockroach — large and reddish-brown with a pale yellowish figure-eight behind the head](/training/ghp-august/photos/american.jpg)

Large (1-1/2 to 2 inches), reddish-brown, with a pale yellowish **figure-eight** marking behind the head. Often called a palmetto bug or water bug. Prefers warm, damp areas — basements, crawl spaces, sewers, drains, and utility areas — and often enters from outside or through drain lines.

### Oriental cockroach — the dark, damp-loving one

![Oriental cockroach — shiny dark brown to black, with no stripes or markings](/training/ghp-august/photos/oriental.jpg)

Medium (about 1 to 1-1/4 inches), shiny dark brown to black, with **no stripes or markings.** Prefers cool, damp, soggy places — drains, sewers, basements, crawl spaces, and mulch beds. Slow-moving and strongly tied to moisture; associated with a strong musty odor. Baits work poorly, so control targets moisture, drains, and harborage.

### Brown-banded cockroach — the one that hides high

![Brown-banded cockroach — light brown with two lighter pale bands across the body](/training/ghp-august/photos/brown-banded.jpg)

Small (about 1/2 inch), light brown with **two lighter pale bands** across the wings and abdomen. Unlike the others, it prefers dry, warm areas and spreads throughout the home — living rooms, bedrooms, closets, and up high in cabinets, behind picture frames, and near ceilings. Floor-level treatment misses them; you must treat high.

![The four home cockroaches shown to scale, with a one-inch reference](/training/ghp-august/photos/species-compare.jpg)

| Species | Size | Color / markings | Where it lives |
| :-- | :-- | :-- | :-- |
| **German** | 1/2–5/8 in | Tan; two dark stripes behind the head | Kitchens &amp; bathrooms, indoors |
| **American** | 1.5–2 in | Reddish-brown; yellowish figure-8 | Warm, damp; basements, drains |
| **Oriental** | 1–1.25 in | Shiny dark brown/black; no stripes | Cool, damp; drains, crawl spaces |
| **Brown-banded** | ~1/2 in | Light brown; two pale bands | Dry, warm; high and spread out |

## Quick field ID guide

Use this simple flow on site to narrow down the species quickly.

1. **Confirm it's a roach.** Long antennae, flat oval body, six legs, and no jumping legs? If yes, it's almost certainly a cockroach (see Lookalikes below).
2. **Check the size.** Small (about 1/2 inch) or large (1 inch or more)?
3. **Look at color and markings.** Stripes, bands, a figure-8, or nothing? This is the deciding clue.
4. **Confirm with location.** Does where you found it match the species? A matching location raises your confidence.

![Quick field ID decision guide: confirm it's a roach, check the size, then read the markings to name the species](/training/ghp-august/photos/field-id.jpg)

| If you see… | With… | It's most likely… |
| :-- | :-- | :-- |
| A small roach (~1/2 in) | Tan body, two dark stripes behind the head | **German** |
| A small roach (~1/2 in) | Light brown body, two pale bands across it | **Brown-banded** |
| A large roach (1 in+) | Reddish-brown, yellowish figure-8 marking | **American** |
| A large roach (1 in+) | Shiny dark brown to black, no markings | **Oriental** |

## Is it even a roach? Common lookalikes

Beginners — and customers — often mistake other insects for cockroaches. Before you build a treatment plan, make sure you are actually dealing with a roach.

![Not every brown bug is a roach — an American cockroach (left), a beetle (center), and a cricket (right)](/training/ghp-august/photos/lookalikes.jpg)

| Insect | Why it's confused with a roach | How to tell it apart |
| :-- | :-- | :-- |
| **Beetles** | Brown or black, similar size, scurry when disturbed | Hard wing covers meet in a straight line down the back; antennae are shorter. Roaches look flatter and more leathery with long antennae |
| **Crickets** | Brown, active at night, found indoors | Crickets have large bent back legs and **jump.** Roaches do not jump |
| **"Water bugs"** | A common nickname, not an actual species | Usually people mean American or Oriental roaches. True water bugs live in water. Treat as a roach until proven otherwise |
| **Bed bugs** | Small, reddish-brown, hide in cracks | Much smaller, wingless, flat and round, with short antennae. Found near beds, not kitchens |

> **Field tip.** When in doubt, capture the specimen — a clear jar or a strip of clear tape works — and confirm the ID before treating. Misidentifying the pest wastes product and time.

## The German cockroach — our primary target

The German cockroach is the species you will treat most often, and the hardest to eliminate. It is worth knowing in detail.

- **Reproduction:** a female carries her egg case (ootheca) attached to her body until about two days before it hatches. Each ootheca holds roughly 30–40 eggs, and a female produces 4–8 in her lifetime.
- **Speed:** egg to breeding adult in about 6–10 weeks. This is why a small problem becomes a large one so quickly.
- **Harborage:** tight, warm cracks near food and water — hinges and corners of cabinets, behind and under the refrigerator, dishwasher, and stove, under the sink, and inside the motor compartments of appliances.
- **Why they persist:** because the female shelters the egg case, spraying surfaces often kills adults while eggs survive to repopulate. Consistent **baiting and sanitation** — not just contact spray — is what breaks the cycle.

![Why speed matters — one female German cockroach and her offspring can grow into the tens of thousands within a year](/training/ghp-august/photos/german-harborage-1.jpg)

![A German cockroach beside its egg case (ootheca) — she shelters it until just before it hatches, which is why contact spray alone leaves the eggs to repopulate](/training/ghp-august/photos/german-harborage-2.jpg)

## How to tell if roaches are in a home

You will rarely be handed a live roach. The professional standard is confirming activity from the evidence roaches leave behind — and knowing where to look for it.

**The signs of an infestation:**

- **Live sightings** — even one roach in daylight often means many more are hidden nearby.
- **Droppings** — small roaches leave black or brown specks that look like ground pepper or coffee grounds; large roaches leave cylindrical, ridged pellets. Look in drawers, cabinet corners, and along baseboards.
- **Egg cases (oothecae)** — small tan-to-brown capsules, often empty, left in cracks, corners, and behind appliances. A capsule confirms breeding, not just visiting.
- **Shed skins** — roaches molt several times as they grow, leaving pale, translucent cast skins near harborage.
- **Smear marks** — in very damp, heavy infestations, dark irregular smears appear along travel routes on walls and surfaces.
- **Odor** — established populations give off a distinctive musty, oily smell; a strong odor signals a large or long-standing infestation.
- **Damage &amp; residue** — chewed food packaging and grease or feeding residue in cabinets and around appliances.

![Signs of activity — pepper-like droppings and shed egg cases collected in a cabinet corner](/training/ghp-august/photos/signs-1.jpg)

![Shed skins (pale cast skins) left behind near harborage as nymphs molt and grow](/training/ghp-august/photos/signs-2.jpg)

### Where to inspect first

![Where they hide: high &amp; dry (brown-banded), main living / kitchens &amp; baths (German), and low &amp; damp (American &amp; Oriental)](/training/ghp-august/photos/inspect.jpg)

| Inspection zone | What to look for | Why |
| :-- | :-- | :-- |
| Under &amp; behind kitchen appliances | Droppings, egg cases, live roaches, warmth | Warmth + food + tight space = prime German harborage |
| Under sinks &amp; around plumbing | Moisture, droppings, smears | Water source and pipe penetrations for entry |
| Cabinet corners, hinges &amp; drawer tracks | Pepper-like specks, shed skins, capsules | Tight cracks where German roaches aggregate |
| Drains, floor drains &amp; crawl spaces | Large dark roaches, musty odor | American &amp; Oriental breeding and entry |
| High cabinets, ceilings, behind frames | Pale bands, capsules glued high up | Brown-banded roaches live and breed up high |

> **Field note.** Bring a flashlight and check corners, not just open surfaces. The heaviest activity is almost always in the tightest, darkest, warmest crack you didn't want to reach into.

## Applying identification to service

Once you have identified the species and confirmed activity, the findings drive the service plan.

| If you identify… | Then the service plan should emphasize… |
| :-- | :-- |
| **German cockroach** | Gel bait at harborage points, sanitation guidance, and follow-up — do not rely on spray alone |
| **American cockroach** | Perimeter and entry-point treatment, drain/utility areas, and moisture correction |
| **Oriental cockroach** | Moisture reduction, drain and crawl-space treatment, and exterior harborage — baiting is secondary |
| **Brown-banded cockroach** | Whole-room approach with treatment placed high — cabinets, ceilings, and behind wall items |
| **Any species** | Communicate health risks, sanitation, and exclusion so the customer helps prevent recurrence |

## Talking to the customer

Customers often feel embarrassed or anxious about roaches. Part of the job is explaining clearly, without judgment, and setting realistic expectations.

- **Reassure them:** roaches are extremely common and are not proof of a dirty home. They need only warmth, moisture, and small amounts of food.
- **Explain what you found** in plain terms — the species, where they are hiding, and why they are there.
- **Set expectations:** with German roaches especially, it can take more than one visit because eggs keep hatching.
- **Give the customer a role:** sanitation and fixing moisture make the treatment far more effective.

| The customer asks… | A clear, honest answer |
| :-- | :-- |
| "Why do I have roaches?" | They found warmth, water, and food. Even a clean home can attract them through gaps, boxes, or groceries |
| "Does this mean my house is dirty?" | No. Roaches are opportunists and anyone can get them. Good sanitation helps control them but is not the only cause |
| "Will they be gone after one visit?" | Often not right away. Eggs are protected and hatch later, so follow-up visits are normal — especially for German roaches |
| "What can I do to help?" | Keep food sealed, clean up crumbs and grease, fix leaks, and reduce clutter where roaches hide |
| "Are they dangerous?" | They can spread bacteria and trigger allergies and asthma, so control protects your health, not just your comfort |

## Example application

A technician responds to a call reporting roaches in the kitchen. During inspection:

- Small, tan roaches with two dark stripes are found behind the refrigerator and inside a lower cabinet
- Pepper-like droppings line the cabinet corners and drawer tracks
- Two empty tan egg capsules are wedged in the cabinet hinge
- A slow drip is present under the sink

**Interpretation.** Size, color, stripes, harborage location, and pepper-like droppings all identify this as a **German cockroach** infestation. The egg capsules confirm active breeding indoors — an established population, not a few strays. The drip under the sink provides the moisture that sustains them.

**Recommended approach:**

- Apply gel bait directly at harborage points — cabinet corners, hinges, and behind and under the refrigerator
- Avoid broadcast spraying over bait, which can repel roaches away from it
- Recommend the customer correct the sink drip to remove the moisture source
- Recommend sanitation — cleaning grease and food residue from cabinets and around appliances
- Schedule follow-up, since egg cases will continue hatching after the first visit

> **The orange ice cube.** The customer expected you to spray and leave. Instead you named the species, showed them the egg cases in the hinge, explained why the drip under the sink is feeding the problem, and told them what to expect at follow-up. *That's the difference between a vendor and an expert — and that's what earns the 5-star review.*

## Glossary of key terms

| Term | Plain-English meaning |
| :-- | :-- |
| **Ootheca** | The egg case a female cockroach produces — a capsule holding many eggs |
| **Nymph** | A young cockroach that has hatched; looks like a small, wingless adult |
| **Instar** | A growth stage between molts; nymphs pass through several instars |
| **Molt** | When a roach sheds its outer skin to grow, leaving a pale cast skin behind |
| **Harborage** | The hidden, protected spot where roaches rest and nest (cracks, voids, under appliances) |
| **Aggregation** | Roaches gathering together, drawn by scent (pheromones) in their droppings |
| **Thigmotactic** | The instinct to squeeze into tight spaces that touch the body on multiple sides |
| **Pronotum** | The shield-like plate behind the head; its markings are a key ID clue |
| **Exclusion** | Sealing gaps and cracks to keep pests from getting in |
| **Gel bait** | A product roaches eat and carry back to others, spreading the effect |
| **IPM** | Integrated Pest Management — combining inspection, sanitation, exclusion, and targeted treatment |

## The standard we are setting

**Name the species. Read the signs. Find the harborage. Match the treatment.** That sequence is the Clements standard for cockroach work — it turns a spray-and-go visit into lasting control and protects the customer's home and health.

When you're ready, complete the 20-question assessment below. You'll need **80%** to pass, and correct answers are shown afterward for review. A copy of your result is emailed to you and filed to your training record.

---

*Clements Pest Control · 1-844-606-BUGS · GHP Technician Training — August 2026*`;

