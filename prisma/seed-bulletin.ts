import { PrismaClient } from "@prisma/client";

// Seeds the Company Bulletin: grants posting rights to the designated authors,
// and (when empty) loads demo posts, calendar events, and placeholder birthdays
// / anniversaries modeled on the "Inside the Colony" quarterly newsletter. Real
// birthday & anniversary data will come from the HR platform — the placeholders
// here just show the feature working; gaps stay quiet until HR data lands.

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

// Only these four may post for now (by login email). Easily changed later.
const AUTHOR_EMAILS = [
  "jglanville@clementspestcontrol.com", // Julie
  "c.slade@clementspestcontrol.com", // Chris
  "lignazio@clementspestcontrol.com", // Larry
  "awilliford@clementspestcontrol.com", // April
];

/** Grant/refresh bulletin posting rights — safe to run every deploy. */
export async function grantBulletinAuthors(prisma: PrismaClient) {
  const res = await prisma.user.updateMany({ where: { email: { in: AUTHOR_EMAILS } }, data: { canPostBulletin: true } });
  return { granted: res.count };
}

// Birthdays from the newsletter (month/day only — no birth year). Names matched
// loosely against the employee roster.
const BIRTHDAYS: { name: string; m: number; d: number }[] = [
  { name: "Liberti", m: 4, d: 14 },
  { name: "Segroves", m: 4, d: 19 },
  { name: "Graham Foster", m: 4, d: 24 },
  { name: "Travelute", m: 5, d: 2 },
  { name: "Jessica Sanderson", m: 5, d: 8 },
  { name: "Mike Mace", m: 5, d: 11 },
  { name: "Adam Goetz", m: 5, d: 24 },
  { name: "Robin Berning", m: 5, d: 28 },
  { name: "Luis Ramos", m: 6, d: 17 },
  // A couple placeholder birthdays in the near-term window so the calendar shows
  // celebrations in the demo — replace with real HR data.
  { name: "Kourtney Rannow", m: 7, d: 29 },
  { name: "Justin Chen", m: 8, d: 12 },
];

// Placeholder hire dates so a couple of work anniversaries surface in the demo
// window (real hire dates come from HR). Only set when currently null.
const HIRE_DATES: { name: string; date: string }[] = [
  { name: "Julie Glanville", date: "2019-08-05" },
  { name: "Larry Ignazio", date: "2021-09-01" },
];

const POSTS = [
  {
    type: "event", pinned: true,
    title: "Semi-Annual Manager Bootcamp & All-Staff Outing",
    excerpt: "Leadership bootcamp in the morning, team competition and buggy rides in the afternoon — at Blackwater Creek Ranch.",
    eventDate: "2026-08-22", location: "Blackwater Creek Ranch",
    body: "Mark your calendars! We're heading to Blackwater Creek Ranch for our semi-annual Manager Bootcamp and All-Staff Outing. The day kicks off with our Manager Bootcamp — a deep dive into leadership strategies, team development, and key company initiatives for the second half of the year.\n\nAfter a productive morning and a catered lunch, we shift into the afternoon's activities. We'll split into teams for a friendly shooting challenge, take buggy rides through the scenic trails, and round out the day with games and plenty of laughs.\n\nThis isn't just about professional development — it's about celebrating the hard work and dedication that makes Clements what it is. Stay tuned for more details as we get closer to the date!",
  },
  {
    type: "announcement", pinned: false,
    title: "Online Training Portal Is Live and Running Smoothly",
    excerpt: "Our Paychex training portal is fully up and running — onboarding new hires and keeping techs current on CEUs.",
    body: "After months of planning and development, our online training portal through Paychex is fully up and running — and it's already making a big impact. Over the past three months, our technicians have completed their continued-education courses through the platform, and multiple new hires have gone through onboarding.\n\nWith all onboarding and monthly CEU courses housed in one place, learning has never been more efficient. New employees get a strong, structured start while experienced team members stay sharp with ongoing education.\n\nThank you to everyone who's embraced the system and made this rollout a success. Be sure to stay up to date with your required monthly courses!",
  },
  {
    type: "shoutout", pinned: false,
    title: "Welcome to the Team: Christian, Ben & Chris",
    excerpt: "Three new team members join the colony — please help them feel at home!",
    honoreeName: "Christian Tejada, Benjamin Neal, Chris Scheidell",
    body: "As Clements continues to grow, please join us in welcoming our newest team members:\n\n• Christian Tejada — a devoted husband and father of four who cherishes family time, from Disney trips to Sundays filled with worship and great food.\n\n• Benjamin Neal — a family man who loves making memories with his three boys fishing, hunting, and at the range.\n\n• Chris Scheidell — joining us from Hulett Pest Control with a passion for excellence; outside work he loves to read, travel, and unwind with his partner and their dog.\n\nWe're thrilled to have them on board and look forward to all they'll accomplish here!",
  },
  {
    type: "shoutout", pinned: false,
    title: "46 Years and Counting — Thank You, Tim Slade",
    excerpt: "Celebrating a remarkable work anniversary and decades of dedication to Clements.",
    honoreeName: "Tim Slade",
    body: "This quarter we're celebrating an incredible milestone — Tim Slade's 46th work anniversary with Clements Pest Control. Tim's decades of dedication, knowledge, and leadership have helped shape the company into what it is today. Thank you, Tim, for everything you've given the colony over the years. Here's to many more!",
  },
  {
    type: "story", pinned: false,
    title: "Inside the Colony — What's Happened and What's to Come",
    excerpt: "A look back at the quarter and a look ahead at the events, training, and celebrations coming up.",
    body: "There's plenty happening at Clements. From the semi-annual Manager Bootcamp and All-Staff Outing to the full rollout of our online training portal, we've got a lot to be proud of — and even more to look forward to.\n\nWe're welcoming new team members, celebrating birthdays and work anniversaries, and keeping our holiday schedule front and center so everyone can plan ahead. Thank you for all your hard work and dedication. Enjoy this edition of Inside the Colony!",
  },
];

// 2026 holiday schedule (modeled on the newsletter's 2025 list). Stored in full;
// the calendar sidebar shows whatever falls in its window.
const EVENTS = [
  { title: "Labor Day — Close Early", kind: "early_release", date: "2026-09-04", timeLabel: "Closing 1:00 PM" },
  { title: "Labor Day — Closed", kind: "closure", date: "2026-09-07" },
  { title: "Thanksgiving — Close Early", kind: "early_release", date: "2026-11-25", timeLabel: "Closing 1:00 PM" },
  { title: "Thanksgiving — Closed", kind: "closure", date: "2026-11-26", endDate: "2026-11-27" },
  { title: "Christmas — Close Early", kind: "early_release", date: "2026-12-24", timeLabel: "Closing 1:00 PM" },
  { title: "Christmas — Closed", kind: "closure", date: "2026-12-25" },
  { title: "New Year's Day — Closed", kind: "holiday", date: "2027-01-01" },
];

export async function seedBulletin(prisma: PrismaClient) {
  const grant = await grantBulletinAuthors(prisma);

  // Birthdays (set month/day where a matching employee exists).
  let birthdays = 0;
  for (const b of BIRTHDAYS) {
    const emp = await prisma.employee.findFirst({ where: { name: { contains: b.name } } });
    if (emp) { await prisma.employee.update({ where: { id: emp.id }, data: { birthMonth: b.m, birthDay: b.d } }); birthdays++; }
  }
  // Placeholder hire dates (only when null) so a few anniversaries surface.
  for (const h of HIRE_DATES) {
    const emp = await prisma.employee.findFirst({ where: { name: h.name } });
    if (emp && !emp.hireDate) await prisma.employee.update({ where: { id: emp.id }, data: { hireDate: D(h.date) } });
  }

  // Posts + events only when the board is empty (don't clobber real posts).
  const existingPosts = await prisma.bulletinPost.count();
  let posts = 0, events = 0;
  if (existingPosts === 0) {
    const author = await prisma.user.findFirst({ where: { email: { in: AUTHOR_EMAILS } } });
    for (const p of POSTS) {
      await prisma.bulletinPost.create({
        data: {
          type: p.type, title: p.title, excerpt: p.excerpt, body: p.body, pinned: p.pinned ?? false,
          eventDate: p.eventDate ? D(p.eventDate) : null, location: p.location ?? null, honoreeName: p.honoreeName ?? null,
          authorId: author?.id ?? null, authorName: author?.name ?? "Clements Team",
        },
      });
      posts++;
    }
  }
  const existingEvents = await prisma.calendarEvent.count();
  if (existingEvents === 0) {
    for (const e of EVENTS) {
      await prisma.calendarEvent.create({ data: { title: e.title, kind: e.kind, date: D(e.date), endDate: e.endDate ? D(e.endDate) : null, timeLabel: e.timeLabel ?? null, createdByName: "Seed" } });
      events++;
    }
  }

  console.log(`Bulletin seeded: ${grant.granted} authors granted, ${birthdays} birthdays, ${posts} posts, ${events} calendar events.`);
  return { granted: grant.granted, birthdays, posts, events };
}

if (process.argv[1] && process.argv[1].includes("seed-bulletin")) {
  const prisma = new PrismaClient();
  seedBulletin(prisma).catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
}
