# Catalog consolidation — review & notes

**How to use this file.** Every real product is listed below, grouped by family so look-alikes sit together. Add a note under any product (or family) and I'll adjust the consolidation. Three shortcuts take effect automatically on the next deploy (I translate your notes into `prisma/data/catalog-overrides.json`):

- **Merge:** "merge A into B" → folds duplicate A into canonical B (on-hand + history move to B).
- **Keep separate:** "A and B are different" → they will never be merged.
- **Rename:** "rename A to …" → changes the catalog display name.

Anything else (reclassify, split one row into two, fix an active ingredient, change a unit, etc.) — just write it in plain English under the product and I'll make the code/data change.

Identity is the **SiteOne item number** (the invoice key): different item numbers are always different products; the same item number is always the same product.

_Generated from `prisma/data/inventory-reset/01_product_catalog.csv` + `prisma/data/product-research.json`. Regenerate with `npx tsx scripts/gen-catalog-notes.ts`._

---

## Acephate

### Acephate 90 Prill Insecticide 5 lb.
- SiteOne item #: `83014004` · short name: "Acephate 90 Prill"
- form: soluble · active: Acephate 90% · cat: Insecticide · cost: $50.078
- **Notes:** _(add yours here)_

## Advion

_5 products in this family — check these are genuinely distinct (different item #, NPK, size, or formula) vs. duplicates to merge._

### Advion Ant Gel Bait 4 x 30 gm tube (1pk/4 tubes)
- SiteOne item #: `53204-NLA` · short name: "Advion Ant Gel"
- form: bait_gel · active: Indoxacarb 0.05% · cat: Insecticide · cost: $43.553
- **Notes:** _(add yours here)_

### Advion Evolution Cockroach Gel Bait 4x30g (4 pack)
- SiteOne item #: `88501, 88504` · short name: "Advion cockroach gel bait"
- form: bait_gel · active: Indoxacarb 0.6% · cat: Insecticide · cost: $30.2
- **Notes:** _(add yours here)_

### Advion Insect Granule 25 lb.
- SiteOne item #: `—` · short name: "Advion Insect Granular"
- form: bait_granular · active: Indoxacarb 0.22%
- **Notes:** _(add yours here)_

### Advion WDG Insecticide 16.5 oz.
- SiteOne item #: `63953N`
- form: wettable_granule · active: Indoxacarb 30% · cat: Insecticide · cost: $136.85
- **Notes:** _(add yours here)_

### Advion WDG Insecticide 5 Packets x 0.33oz
- SiteOne item #: `63795N` · short name: "Advion WDG Insecticide"
- form: wettable_granule · active: Indoxacarb 30% · cat: Insecticide · cost: $37.75
- **Notes:** _(add yours here)_

## Aerosol

### LESCO Aerosol Wasp and Hornet Spray
- SiteOne item #: `D00001534` · short name: "Wasp & Hornet Spray"
- form: aerosol · cat: Insecticide · cost: $11.183
- **Notes:** _(add yours here)_

## Alpine

_3 products in this family — check these are genuinely distinct (different item #, NPK, size, or formula) vs. duplicates to merge._

### Alpine Cockroach Gel Bait Rotation 1 Box (4 x 30 gm) Syringes
- SiteOne item #: `—` · short name: "Alpine Roach Gel Bait"
- form: bait_gel · active: Dinotefuran 0.5%
- **Notes:** _(add yours here)_

### Alpine WSG Insecticide (10gm)
- SiteOne item #: `59020846`
- form: soluble · active: Dinotefuran 40% · cat: Insecticide · cost: $8.213
- **Notes:** _(add yours here)_

### Alpine WSG Insecticide 200 gm
- SiteOne item #: `59014203`
- form: soluble · active: Dinotefuran 40% · cat: Insecticide · cost: $120.084
- **Notes:** _(add yours here)_

## Arbor

_2 products in this family — check these are genuinely distinct (different item #, NPK, size, or formula) vs. duplicates to merge._

### Arborjet Arbor OTC Injectable Fungicide 1 oz.
- SiteOne item #: `040-7500`
- form: other · active: Oxytetracycline hydrochloride 39.6% · cat: Fungicide · cost: $140.0
- **Notes:** _(add yours here)_

### Arborjet Arbor OTC Injectable Fungicide 5 oz.
- SiteOne item #: `—` · short name: "OTC Fungicide"
- form: other · active: Oxytetracycline hydrochloride 39.6%
- **Notes:** _(add yours here)_

## Archer

### Archer Igr Insecticide 1 pt.
- SiteOne item #: `73218` · short name: "Archer IGR"
- form: liquid · active: Pyriproxyfen 1.3% · cat: Insecticide · cost: $63.375
- **Notes:** _(add yours here)_

## Arena

### Nufarm Arena 0.25G  Granular Insecticide 30 lb. Bag
- SiteOne item #: `10580032` · short name: "Arena Granular Insecticide"
- form: granular · active: Clothianidin 0.25% · cat: Insecticide · cost: $72.0
- **Notes:** _(add yours here)_

## Avenue

### Avenue South Post Emergent Liquid Herbicide 2.5 gal.
- SiteOne item #: `8731126` · short name: "Avenue South"
- form: liquid · active: 2,4-D 7.28% + Dicamba 2.06% + Penoxsulam 0.70% + Sulfentrazone 0.70% · cat: Herbicide · cost: $240.0
- **Notes:** _(add yours here)_

## Axilo

### Helena Axilo Mix 5 5 lb.
- SiteOne item #: `—`
- cat: Fertilizer · cost: $65.0
- **Notes:** _(add yours here)_

## Bandit

### LESCO Bandit 2F Systemic Liquid Insecticide 1 gal. Jug
- SiteOne item #: `D00000906` · short name: "Bandit 2F"
- form: liquid · active: Imidacloprid 21.4% (2 lb/gal) · cat: Insecticide · cost: $61.268
- **Notes:** _(add yours here)_

## Bifen

### Bifen XTS Insecticide 1 gal.
- SiteOne item #: `82004443` · short name: "Bifen XTS"
- form: liquid · active: Bifenthrin 25.1% · cat: Insecticide · cost: $140.223
- **Notes:** _(add yours here)_

## Bora-Care

### Bora-Care Termiticide 1 gal.
- SiteOne item #: `30222TL`
- form: liquid · active: Disodium octaborate tetrahydrate (DOT) 40% · cat: Insecticide · cost: $94.505
- **Notes:** _(add yours here)_

## CB-

### CB-80 Dual Spray Can Aerosol Insecticide 17 oz.
- SiteOne item #: `11008370` · short name: "CB-80 Insecticide"
- form: aerosol · active: Pyrethrins 0.5% + Piperonyl butoxide 1.0% · cat: Insecticide · cost: $26.886
- **Notes:** _(add yours here)_

## CROSSCHECK

### LESCO CROSSCHECK PL Granular insecticide
- SiteOne item #: `—` · short name: "Other Product"
- **Notes:** _(add yours here)_

## Celsius

### Celsius Post Emergent Water Dispersible Granule Herbicide 10 oz.
- SiteOne item #: `D00000911` · short name: "Celsius"
- cat: Herbicide · cost: $165.3
- **Notes:** _(add yours here)_

## Certainty

### Certainty Turf Post Emergent Dry Herbicide
- SiteOne item #: `—` · short name: "Certainty"
- form: wettable_granule · active: Sulfosulfuron 75%
- **Notes:** _(add yours here)_

## Contrac

### Contrac Bait Block Cb4052 18lb. Pail
- SiteOne item #: `CB4051` · short name: "Contrac Rodent Bait Blox"
- cat: Other/Rodenticide · cost: $94.614
- **Notes:** _(add yours here)_

## Crosscheck

### LESCO Crosscheck Plus Liquid Insecticide 1 gal. Tip & Pour Container
- SiteOne item #: `D00001542` · short name: "CrossCheck Plus"
- form: liquid · active: Bifenthrin 7.9% · cat: Insecticide · cost: $39.438
- **Notes:** _(add yours here)_

## Cyper

### Cyper TC Termiticide/Insecticide 1 gal.
- SiteOne item #: `82008300` · short name: "Cyper TC"
- form: liquid · active: Cypermethrin 25.4% · cat: Insecticide · cost: $69.81
- **Notes:** _(add yours here)_

## DeltaDust

### DeltaDust Insecticide
- SiteOne item #: `—` · short name: "Delta dust"
- form: dust · active: Deltamethrin 0.05%
- **Notes:** _(add yours here)_

## Demand

### Demand CS Insecticide 1 qt.
- SiteOne item #: `80081D` · short name: "Demand CS"
- form: liquid · active: Lambda-cyhalothrin 9.7% · cat: Insecticide · cost: $112.75
- **Notes:** _(add yours here)_

## DiPel

### DiPel PRO DF Biological Insecticide 1 lb.
- SiteOne item #: `10586301` · short name: "DIPEL PRO"
- form: wettable_granule · active: Bacillus thuringiensis subsp. kurstaki (Btk) · cat: Insecticide · cost: $23.222
- **Notes:** _(add yours here)_

## Drive

### Drive XLR8 Post Emergent Herbicide 64 oz.
- SiteOne item #: `59030455`
- form: liquid · active: Quinclorac 18.92% · cat: Herbicide · cost: $78.897
- **Notes:** _(add yours here)_

## Eaton

### Eaton Stick-Em Rat & Mouse
- SiteOne item #: `—`
- form: device
- **Notes:** _(add yours here)_

## Extinguish

_3 products in this family — check these are genuinely distinct (different item #, NPK, size, or formula) vs. duplicates to merge._

### Extinguish Plus Fire Ant Bait 4.5 lb. Shaker Jug
- SiteOne item #: `24550`
- form: bait_granular · active: Hydramethylnon 0.365% + (S)-Methoprene 0.25% · cat: Insecticide · cost: $87.264
- **Notes:** _(add yours here)_

### Extinguish Professional Fire Ant Bait (25 lb. bag)
- SiteOne item #: `37970` · short name: "Extinguish"
- form: bait_granular · active: (S)-Methoprene 0.5% · cat: Insecticide · cost: $238.123
- **Notes:** _(add yours here)_

### Wellmark Extinguish Plus Fire Ant Bait 25 lb.
- SiteOne item #: `24560-FAB` · short name: "Extinguish Plus"
- form: bait_granular · active: Hydramethylnon 0.365% + (S)-Methoprene 0.25% · cat: Insecticide · cost: $245.624
- **Notes:** _(add yours here)_

## Ferrilene

### Helena Ferrilene 5 lb.
- SiteOne item #: `—`
- form: fertilizer_granular · cat: Fertilizer · cost: $56.35
- **Notes:** _(add yours here)_

## Fertilizers

_23 products in this family — check these are genuinely distinct (different item #, NPK, size, or formula) vs. duplicates to merge._

### GreenEdge Organic 7-7-7 Fertilizer 50 lb.
- SiteOne item #: `510559`
- form: fertilizer_granular · cat: Fertilizer · cost: $27.414
- **Notes:** _(add yours here)_

### LESCO 16-0-8 Turf Granular Fertilizer 50 lb.
- SiteOne item #: `511384`
- form: fertilizer_granular · cat: Fertilizer · cost: $22.648
- **Notes:** _(add yours here)_

### LESCO 19-19-19  Soluble Fertilizer 25 lb. Bag
- SiteOne item #: `511621` · short name: "19-19-19 Sprayable fertilizer"
- form: fertilizer_granular · cat: Fertilizer · cost: $55.651
- **Notes:** _(add yours here)_

### LESCO 20-0-0 Liquid Fertilizer 2.5 gal. Jug
- SiteOne item #: `—` · short name: "20-0-0 Liquid Fertilizer"
- form: fertilizer_liquid
- **Notes:** _(add yours here)_

### LESCO 24-0-11 50 lb. Bag
- SiteOne item #: `—` · short name: "Fertilizer 24-0-11 (Turf)"
- form: fertilizer_granular
- **Notes:** _(add yours here)_

### LESCO 25-0-10 GRANULAR FERT 50lb bag
- SiteOne item #: `—` · short name: "Other Product"
- **Notes:** _(add yours here)_

### LESCO 25-0-10 Turf Granular Fertilizer
- SiteOne item #: `511233`
- form: fertilizer_granular · cat: Fertilizer · cost: $31.99
- **Notes:** _(add yours here)_

### LESCO 33-0-17 AM Turf Soluble Fertilizer 50 lb. Bag
- SiteOne item #: `—` · short name: "33-0-17 Sprayable Fertilizer"
- form: fertilizer_granular
- **Notes:** _(add yours here)_

### LESCO 8-10-10 Palm & Tropical Granular Fertilizer 50 lb.
- SiteOne item #: `511385`
- form: fertilizer_granular · cat: Fertilizer · cost: $28.094
- **Notes:** _(add yours here)_

### LESCO Atrazine Post Emergent Plus Fertilizer 50 lb.
- SiteOne item #: `—` · short name: "Atrazine"
- form: granular · active: Atrazine (plus NPK fertilizer)
- **Notes:** _(add yours here)_

### LESCO Bio Iron Plus Liquid Fertilizer 2.5 gal.
- SiteOne item #: `511493-2.5` · short name: "Lesco Bio Iron Plus"
- form: fertilizer_liquid · cat: Fertilizer · cost: $79.74
- **Notes:** _(add yours here)_

### LESCO Crosscheck 0.069% 0-0-7 AM Insecticide Plus Fertilizer 50 lb.
- SiteOne item #: `092003, 291500` · short name: "CrossCheck 0.069% plus fertilizer (0-0-7)"
- form: granular · active: Bifenthrin 0.069% (plus 0-0-7 fertilizer) · cat: Insecticide · cost: $17.036
- **Notes:** _(add yours here)_

### LESCO Crosscheck 0.096% 21-0-10 Insecticide Plus Fertilizer 50 lb.
- SiteOne item #: `291527`
- form: granular · active: Bifenthrin 0.096% (plus 21-0-10 fertilizer) · cat: Insecticide · cost: $31.015
- **Notes:** _(add yours here)_

### LESCO Fertilizer 10-0-12 50 lb.
- SiteOne item #: `—` · short name: "Lesco 10-0-12"
- form: fertilizer_granular
- **Notes:** _(add yours here)_

### LESCO Fertilizer 13-0-0 2.5 gal
- SiteOne item #: `—` · short name: "Lesco Fertilizer 13-0-0"
- form: fertilizer_liquid
- **Notes:** _(add yours here)_

### LESCO Fertilizer 21-0-6 50 lb
- SiteOne item #: `—` · short name: "Fertilizer 21-0-6 (Turf)"
- form: fertilizer_granular
- **Notes:** _(add yours here)_

### LESCO L&O Palm 8-0-10 Granular Fertilizer 50 lb. Bag
- SiteOne item #: `511413` · short name: "Fertilizer 8-0-10 (Shrub)"
- form: fertilizer_granular · cat: Fertilizer · cost: $22.304
- **Notes:** _(add yours here)_

### LESCO Liquid Fertilizer 0-0-25 2.5 gal.
- SiteOne item #: `098504-NLA, 511649-2.5` · short name: "LESCO Liquid 0-0-25"
- form: fertilizer_liquid · cat: Fertilizer · cost: $58.113
- **Notes:** _(add yours here)_

### LESCO MacroN Soluble Fertilizer 20-20-20 25 lb. Bag
- SiteOne item #: `—` · short name: "20-20-20 Sprayable Fertilizer"
- form: fertilizer_granular
- **Notes:** _(add yours here)_

### LESCO Nutra-Tech Micro Mix Liquid Fertilizer 2.5 gal.
- SiteOne item #: `511665-2.5`
- form: fertilizer_liquid · cat: Fertilizer · cost: $35.279
- **Notes:** _(add yours here)_

### LESCO Organic/Organic-Base Fertilizer 0-0-18 40 lb.
- SiteOne item #: `—` · short name: "Blackout Fertilizer 0-0-18 (turf)"
- **Notes:** _(add yours here)_

### LESCO Stonewall 0-0-7 Pre-Emergent Herbicide Plus Fertilizer 50 lb.
- SiteOne item #: `702137`
- form: granular · active: Prodiamine (plus 0-0-7 fertilizer) · cat: Herbicide · cost: $21.165
- **Notes:** _(add yours here)_

### LESCO T&O Chelated Liquid Chelated Micronutrient Fertilizer 2.5 gal. Jug
- SiteOne item #: `098186` · short name: "Lesco T&O Chelated Liquid Fertilizer"
- cat: Fertilizer · cost: $37.27
- **Notes:** _(add yours here)_

## Fipronil-Plus-C

### Fipronil-Plus-C Liquid Insecticide 16 oz.
- SiteOne item #: `ACGFPC16`
- form: liquid · active: Fipronil 0.65% · cat: Insecticide · cost: $74.398
- **Notes:** _(add yours here)_

## Flumioxazin

### Albaugh Flumioxazin 51 WDG Herbicide 5 lb.
- SiteOne item #: `298182`
- form: wettable_granule · active: Flumioxazin 51% · cat: Herbicide · cost: $207.121
- **Notes:** _(add yours here)_

## Gentrol

_2 products in this family — check these are genuinely distinct (different item #, NPK, size, or formula) vs. duplicates to merge._

### Gentrol Aerosol 16oz
- SiteOne item #: `37820`
- form: aerosol · active: (S)-Hydroprene 1.2% · cat: Insecticide · cost: $19.406
- **Notes:** _(add yours here)_

### Gentrol Igr Insecticide 10/ 1 oz. Bottles
- SiteOne item #: `37860A` · short name: "Gentrol IGR Concentrate"
- cat: Insecticide · cost: $8.7456
- **Notes:** _(add yours here)_

## Heritage

### Syngenta Heritage Granular Fungicide
- SiteOne item #: `38687`
- form: granular · active: Azoxystrobin 0.31% · cat: Fungicide · cost: $88.732
- **Notes:** _(add yours here)_

## In

### In2Care In2Mix Refill (25 refills)
- SiteOne item #: `IN2MIX-RFL`
- cat: Insecticide · cost: $148.75
- **Notes:** _(add yours here)_

## Invade

### Invade Hot Spot Pest Control 16 oz.
- SiteOne item #: `IHSF019-12` · short name: "Invade Hot Spot"
- cat: Other/Rodenticide · cost: $18.883
- **Notes:** _(add yours here)_

## Kickstand

### Helena Kickstand Multi (2.5 gal)
- SiteOne item #: `—`
- form: fertilizer_liquid · cat: Fertilizer · cost: $78.575
- **Notes:** _(add yours here)_

## L&O

### LESCO L&O PALM 8-0-10 GRANULAR 50LB BAG
- SiteOne item #: `—` · short name: "Other Product"
- **Notes:** _(add yours here)_

## Mansion

### LESCO Mansion Post Emergent Dry Granule Herbicide 8 oz. Bottle
- SiteOne item #: `10780880` · short name: "Mansion Turf Herbicide"
- form: wettable_granule · active: Metsulfuron-methyl 60% · cat: Herbicide · cost: $29.379
- **Notes:** _(add yours here)_

## Maxforce

_2 products in this family — check these are genuinely distinct (different item #, NPK, size, or formula) vs. duplicates to merge._

### Maxforce Complete Insect Bait 4 lb.
- SiteOne item #: `D00000948` · short name: "Maxforce Complete Granular Bait"
- form: bait_granular · active: Hydramethylnon 1.0% · cat: Insecticide · cost: $82.046
- **Notes:** _(add yours here)_

### Maxforce Quantum Ant Bait 120 gm.
- SiteOne item #: `D00000959` · short name: "Maxforce Quantum Ant Bait"
- form: bait_gel · active: Imidacloprid 0.03% · cat: Insecticide · cost: $47.238
- **Notes:** _(add yours here)_

## Momentum

_2 products in this family — check these are genuinely distinct (different item #, NPK, size, or formula) vs. duplicates to merge._

### LESCO Momentum Southern Herbicide 1 gal.
- SiteOne item #: `8732076`
- form: liquid · active: 2,4-D + dicamba + triclopyr (southern formulation) · cat: Herbicide · cost: $101.0
- **Notes:** _(add yours here)_

### LESCO Momentum Southern Herbicide 2.5 gal.
- SiteOne item #: `8732176`
- form: liquid · active: 2,4-D + dicamba + triclopyr (southern formulation) · cat: Herbicide · cost: $237.5
- **Notes:** _(add yours here)_

## Nisus

_2 products in this family — check these are genuinely distinct (different item #, NPK, size, or formula) vs. duplicates to merge._

### Nisus Web Out Spider Insecticide 1 gal.
- SiteOne item #: `30117`
- form: liquid · active: Thyme oil 2% + Lemongrass oil 2% + Citronella 2% · cat: Insecticide · cost: $71.693
- **Notes:** _(add yours here)_

### Nisus Web Out Spider Insecticide 32 oz.
- SiteOne item #: `30115`
- form: liquid · active: Thyme oil 2% + Lemongrass oil 2% + Citronella 2% · cat: Insecticide · cost: $18.893
- **Notes:** _(add yours here)_

## Optigard

_2 products in this family — check these are genuinely distinct (different item #, NPK, size, or formula) vs. duplicates to merge._

### Optigard Ant Gel Bait 4 x 30 gm.
- SiteOne item #: `71339S` · short name: "Optigard Ant Gel Bait"
- form: bait_gel · active: Thiamethoxam 0.01% · cat: Insecticide · cost: $42.93
- **Notes:** _(add yours here)_

### Optigard Cockroach Gel Bait 4x30g (4 pack)
- SiteOne item #: `—` · short name: "Optigard Cockroach Gel Bait"
- form: bait_gel · active: Emamectin benzoate 0.05%
- **Notes:** _(add yours here)_

## Orthene

### Orthene 97 Insecticide .773 lb.
- SiteOne item #: `12602`
- form: soluble · active: Acephate 97.4% · cat: Insecticide · cost: $24.115
- **Notes:** _(add yours here)_

## PT

_8 products in this family — check these are genuinely distinct (different item #, NPK, size, or formula) vs. duplicates to merge._

### PT Alpine Pressurized Insecticide 14 oz.
- SiteOne item #: `59026328` · short name: "PT Alpine"
- form: aerosol · active: Dinotefuran 0.5% · cat: Insecticide · cost: $24.187
- **Notes:** _(add yours here)_

### PT Alpine WSG Insecticide 500 gm
- SiteOne item #: `59014217` · short name: "PT ALPINE WSG"
- form: soluble · active: Dinotefuran 40% · cat: Insecticide · cost: $216.573
- **Notes:** _(add yours here)_

### PT Microcare CS Pressurized Insecticide 14 oz.
- SiteOne item #: `59026327` · short name: "PT Microcare CS"
- form: aerosol · active: Pyrethrins + Piperonyl butoxide (microencapsulated) · cat: Insecticide · cost: $20.393
- **Notes:** _(add yours here)_

### PT Phantom II Pressurized Insecticide 14 oz.
- SiteOne item #: `59026311` · short name: "PT Phantom"
- form: aerosol · active: Chlorfenapyr 0.5% · cat: Insecticide · cost: $28.746
- **Notes:** _(add yours here)_

### PT PI Pressurized Contact Insecticide 14 oz
- SiteOne item #: `59026306`
- form: aerosol · active: Pyrethrins 0.5% + Piperonyl butoxide 1.0% · cat: Insecticide · cost: $29.404
- **Notes:** _(add yours here)_

### PT PI PRESSURIZED CONTACT INSECTICIDE 14 OZ CAN
- SiteOne item #: `—` · short name: "Other Product"
- form: aerosol · active: Pyrethrins 0.5% + Piperonyl butoxide 1.0%
- **Notes:** _(add yours here)_

### PT Ultracide Pressurized Flea Insecticide 14 oz.
- SiteOne item #: `59026330` · short name: "PT Ultraside"
- form: aerosol · active: Permethrin 0.4% + Pyrethrins 0.05% + Pyriproxyfen 0.1% · cat: Insecticide · cost: $25.847
- **Notes:** _(add yours here)_

### PT Wasp Freeze II Aerosol Insecticide 17.5 oz.
- SiteOne item #: `59026305` · short name: "PT wasp Freeze"
- form: aerosol · active: Prallethrin 0.1% · cat: Insecticide · cost: $12.805
- **Notes:** _(add yours here)_

## Pageant

### Pageant Fungicide 1lb
- SiteOne item #: `—`
- form: wettable_granule · active: Pyraclostrobin 12.8% + Boscalid 25.2%
- **Notes:** _(add yours here)_

## Phantom

### Phantom Termiticide/Insecticide 21 oz.
- SiteOne item #: `59021551`
- form: liquid · active: Chlorfenapyr 21.45% · cat: Insecticide · cost: $104.989
- **Notes:** _(add yours here)_

## Precor

### Precor 2000 Premise Spray 16 oz.
- SiteOne item #: `D00000977` · short name: "Premise Foam"
- form: aerosol · active: Permethrin 0.50% + (S)-Methoprene 0.085% + Pyrethrins 0.057% + PBO · cat: Insecticide · cost: $18.204
- **Notes:** _(add yours here)_

## Prosecutor

### LESCO Prosecutor Pro Non Selective Liquid Herbicide 2.5 gal
- SiteOne item #: `86703432` · short name: "Prosecutor"
- form: liquid · active: Glyphosate 41% (isopropylamine salt) · cat: Herbicide · cost: $57.318
- **Notes:** _(add yours here)_

## Protecta

### Protecta Evo Express Bait Station w/ Weight
- SiteOne item #: `44244, EV8001` · short name: "Evo Bait Station"
- form: bait_station · cat: Other/Rodenticide · cost: $18.38
- **Notes:** _(add yours here)_

## Roundup

### Roundup QuikPro Herbicide 6.8 lb.
- SiteOne item #: `86764776`
- form: soluble · active: Glyphosate 73.3% + Diquat dibromide 2.9% · cat: Herbicide · cost: $121.104
- **Notes:** _(add yours here)_

## Safari

### Safari 20 SG Insecticide 3 lb.
- SiteOne item #: `—` · short name: "Safari SG"
- form: soluble · active: Dinotefuran 20%
- **Notes:** _(add yours here)_

## Sector

### Sector Misting Insecticide 1 gal.
- SiteOne item #: `27991B-K07` · short name: "Sector"
- form: liquid · active: Permethrin 10% + Piperonyl butoxide 10% · cat: Insecticide · cost: $131.248
- **Notes:** _(add yours here)_

## Sedgehammer

### Sedgehammer Soluble Herbicide 1.33 oz. Bottle
- SiteOne item #: `35720` · short name: "Sedgehammer Turf Herbicide"
- form: wettable_granule · active: Halosulfuron-methyl 5% · cat: Herbicide · cost: $65.151
- **Notes:** _(add yours here)_

## Shockwave

### Shockwave Fogging Concentrate Insecticide 1 gal.
- SiteOne item #: `7452-K07` · short name: "Shockwave"
- form: liquid · active: Pyrethrins 1% + Esfenvalerate 0.2% + Pyriproxyfen 0.1% + PBO 2% · cat: Insecticide · cost: $239.361
- **Notes:** _(add yours here)_

## SpeedZone

### PBI Gordon SpeedZone Southern EW Post Emergent Liquid Herbicide
- SiteOne item #: `—` · short name: "Speedzone Southern Herbicide"
- form: liquid · active: 2,4-D 2-EH ester 9.02% + Dichlorprop-p 5.19% + Dicamba 0.59% + Carfentrazone-ethyl 0.47%
- **Notes:** _(add yours here)_

## Spreader

_2 products in this family — check these are genuinely distinct (different item #, NPK, size, or formula) vs. duplicates to merge._

### LESCO Spreader Sticker 1 gal.
- SiteOne item #: `400506`
- form: liquid · cat: Other/Rodenticide · cost: $50.253
- **Notes:** _(add yours here)_

### LESCO Spreader Sticker 2.5 gal.
- SiteOne item #: `400507` · short name: "Spreader Sticker"
- form: liquid · cat: Other/Rodenticide · cost: $83.591
- **Notes:** _(add yours here)_

## Stop

### Stop the Bite
- SiteOne item #: `85460078`
- form: liquid · active: Castor oil 6% + Lemongrass oil 5% + Geraniol 4.5% + Cedarwood oil 3% · cat: Insecticide · cost: $419.923
- **Notes:** _(add yours here)_

## Suspend

_2 products in this family — check these are genuinely distinct (different item #, NPK, size, or formula) vs. duplicates to merge._

### Suspend Polyzone Insecticide 16 oz.
- SiteOne item #: `D00000994`
- form: liquid · active: Deltamethrin 4.75% · cat: Insecticide · cost: $80.258
- **Notes:** _(add yours here)_

### Suspend SC Insecticide 1 gal. Jug
- SiteOne item #: `D00000997` · short name: "Suspend SC"
- form: liquid · active: Deltamethrin 4.75% · cat: Insecticide · cost: $361.626
- **Notes:** _(add yours here)_

## Sygenta

### Sygenta Headway G Broad Spectrum Granualr Fungicide 30 lb. Bag
- SiteOne item #: `44882` · short name: "Headway Fungicide"
- cat: Fungicide · cost: $70.16
- **Notes:** _(add yours here)_

## T-Storm

_2 products in this family — check these are genuinely distinct (different item #, NPK, size, or formula) vs. duplicates to merge._

### LESCO T-Storm 2G Granular Fungicide 30lb
- SiteOne item #: `10163032`
- form: granular · active: Thiophanate-methyl 2% · cat: Fungicide · cost: $57.198
- **Notes:** _(add yours here)_

### LESCO T-Storm Liquid Fungicide 2.5 gal. Jug
- SiteOne item #: `10441225` · short name: "T-Storm Fungicide"
- form: liquid · active: Thiophanate-methyl 46.2% (4.5 lb/gal) · cat: Fungicide · cost: $134.086
- **Notes:** _(add yours here)_

## Taurus

### Taurus SC Insecticide 78 oz.
- SiteOne item #: `82003599` · short name: "Taurus SC"
- form: liquid · active: Fipronil 9.1% · cat: Insecticide · cost: $95.0
- **Notes:** _(add yours here)_

## Tekko

### Tekko Pro Insecticide 1pt
- SiteOne item #: `—`
- **Notes:** _(add yours here)_

## Termidor

_2 products in this family — check these are genuinely distinct (different item #, NPK, size, or formula) vs. duplicates to merge._

### Termidor Foam Insecticide 20 oz.
- SiteOne item #: `59012846` · short name: "Termidor Foam"
- form: aerosol · active: Fipronil 0.005% · cat: Insecticide · cost: $33.117
- **Notes:** _(add yours here)_

### Termidor SC Termiticide/Insecticide
- SiteOne item #: `—` · short name: "Termidor SC"
- form: liquid · active: Fipronil 9.1%
- **Notes:** _(add yours here)_

## Tim-bor

### Tim-bor Insecticide/Fungicide
- SiteOne item #: `—` · short name: "Timbor"
- form: dust · active: Disodium octaborate tetrahydrate (DOT) 98%
- **Notes:** _(add yours here)_

## Topchoice

### Topchoice Granular Insecticide
- SiteOne item #: `D00001012` · short name: "Top Choice"
- form: granular · active: Fipronil 0.0103% · cat: Insecticide · cost: $81.021
- **Notes:** _(add yours here)_

## Transport

### Transport Mikron Insecticide 1 qt.
- SiteOne item #: `—` · short name: "Transport Mikron Insecticide"
- form: liquid · active: Acetamiprid 5% + Bifenthrin 6%
- **Notes:** _(add yours here)_

## Trapper

_2 products in this family — check these are genuinely distinct (different item #, NPK, size, or formula) vs. duplicates to merge._

### Trapper T-Rex Plastic Snap Trap
- SiteOne item #: `ST2000`
- form: device · cat: Other/Rodenticide · cost: $6.489
- **Notes:** _(add yours here)_

### Trapper T-Rex Plastic Snap Trap (12/case)
- SiteOne item #: `—` · short name: "T-Rex Snap Trap"
- form: device
- **Notes:** _(add yours here)_

## ULD

### ULD BP-300 Formula II Insecticide 1 gal.
- SiteOne item #: `7485A-K07` · short name: "ULD BP-300"
- form: liquid · active: Pyrethrins 3% + Piperonyl butoxide 6% + MGK-264 10% · cat: Insecticide · cost: $268.871
- **Notes:** _(add yours here)_

## Vendetta

### Vendetta Plus Roaach Bait 30 gm. X 4
- SiteOne item #: `2976-H40` · short name: "Vendetta Plus"
- cat: Insecticide · cost: $41.328
- **Notes:** _(add yours here)_
