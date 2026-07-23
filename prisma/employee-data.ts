// AUTO-GENERATED — employee personnel profiles. Names/role/division/branch
// come from the branch contact sheet; emails from the Google Workspace admin
// export (shared mailboxes like accountspayable@ / info@ excluded). Employees
// without a branch are corporate / HQ staff.

export type EmployeeSeed = {
  name: string;
  email: string | null;
  role: string | null;
  division: string | null;
  branch: string | null;
  // Hire/start date from the Paychex census (authoritative), ISO "YYYY-MM-DD".
  // Parsed as UTC midnight when applied. Optional — not everyone is on the census.
  hireDate?: string;
};

export const EMPLOYEES: EmployeeSeed[] = [
  {
    "name": "Chase Solofra",
    "email": "csolofra@clementspestcontrol.com",
    "role": "Technician",
    "division": "General Pest",
    "branch": "naples",
    "hireDate": "2026-06-15"
  },
  {
    "name": "Corey Carter",
    "email": "ccarter@clementspestcontrol.com",
    "role": "Manager",
    "division": "Service",
    "branch": "naples",
    "hireDate": "2024-09-03"
  },
  {
    "name": "Jason Borden",
    "email": "jborden@clementspestcontrol.com",
    "role": "Technician",
    "division": "Service",
    "branch": "naples",
    "hireDate": "2023-08-01"
  },
  {
    "name": "Tyler Etter",
    "email": "tetter@clementspestcontrol.com",
    "role": "Technician",
    "division": "Lawn",
    "branch": "naples",
    "hireDate": "2025-07-21"
  },
  {
    "name": "David Butler",
    "email": "dbutler@clementspestcontrol.com",
    "role": "Technician",
    "division": "General Pest",
    "branch": "orlando",
    "hireDate": "2021-01-26"
  },
  {
    "name": "Josh Flagg",
    "email": "jflagg@clementspestcontrol.com",
    "role": "Sales Advisor",
    "division": "Service",
    "branch": "orlando",
    "hireDate": "2026-05-04"
  },
  {
    "name": "Luis Ramos",
    "email": "lramos@clementspestcontrol.com",
    "role": "Technician",
    "division": "General Pest",
    "branch": "orlando",
    "hireDate": "2024-03-11"
  },
  {
    "name": "Samuel Dixon",
    "email": "sdixon@clementspestcontrol.com",
    "role": "Technician",
    "division": "Lawn",
    "branch": "orlando",
    "hireDate": "2026-06-30"
  },
  {
    "name": "Sarah Hoyt",
    "email": "shoyt@clementspestcontrol.com",
    "role": "Technician",
    "division": "Service",
    "branch": "orlando",
    "hireDate": "2023-07-03"
  },
  {
    "name": "Steve Liberti",
    "email": "sliberti@clementspestcontrol.com",
    "role": "Technician",
    "division": "Service",
    "branch": "orlando",
    "hireDate": "2019-04-24"
  },
  {
    "name": "Ted Travelute",
    "email": "etravelute@clementspestcontrol.com",
    "role": "Manager",
    "division": "Service",
    "branch": "orlando",
    "hireDate": "2019-04-24"
  },
  {
    "name": "Adam Goetz",
    "email": "agoetz@clementspestcontrol.com",
    "role": "Manager",
    "division": "Service",
    "branch": "stuart",
    "hireDate": "2018-08-01"
  },
  {
    "name": "Dann Alagna",
    "email": "dalagna@clementspestcontrol.com",
    "role": "Sales Advisor",
    "division": "Service",
    "branch": "stuart",
    "hireDate": "2025-12-15"
  },
  {
    "name": "Jason Renteria",
    "email": "jrenteria@clementspestcontrol.com",
    "role": "Technician",
    "division": "General Pest",
    "branch": "stuart",
    "hireDate": "2025-01-03"
  },
  {
    "name": "Jesse Gonzalez",
    "email": "jgonzalez@clementspestcontrol.com",
    "role": "Technician",
    "division": "General Pest",
    "branch": "stuart",
    "hireDate": "2022-07-25"
  },
  {
    "name": "Maurice Campbell",
    "email": "mcampbell@clementspestcontrol.com",
    "role": "Technician",
    "division": "Lawn",
    "branch": "stuart",
    "hireDate": "2026-05-26"
  },
  {
    "name": "Mike Verderame",
    "email": "mverderame@clementspestcontrol.com",
    "role": "Technician",
    "division": "General Pest",
    "branch": "stuart",
    "hireDate": "2025-09-02"
  },
  {
    "name": "Brian Krause",
    "email": "bkrause@clementspestcontrol.com",
    "role": "Technician",
    "division": "Lawn",
    "branch": "vero",
    "hireDate": "2026-06-22"
  },
  {
    "name": "Chad Koehler",
    "email": "ckoehler@clementspestcontrol.com",
    "role": "Technician",
    "division": "General Pest",
    "branch": "vero",
    "hireDate": "2006-09-18"
  },
  {
    "name": "Christian Tejeda",
    "email": "ctejeda@clementspestcontrol.com",
    "role": "Technician",
    "division": "General Pest",
    "branch": "vero",
    "hireDate": "2025-02-24"
  },
  {
    "name": "Cote Lawrence",
    "email": "clawrence@clementspestcontrol.com",
    "role": "Technician",
    "division": "General Pest",
    "branch": "vero",
    "hireDate": "2022-05-04"
  },
  {
    "name": "Graham Foster",
    "email": "gfoster@clementspestcontrol.com",
    "role": "Manager",
    "division": "Service",
    "branch": "vero",
    "hireDate": "1989-05-22"
  },
  {
    "name": "Gus Ludriecus",
    "email": "aludriecus@clementspestcontrol.com",
    "role": "Technician",
    "division": "Lawn",
    "branch": "vero",
    "hireDate": "2026-03-09"
  },
  {
    "name": "Jacob Johns",
    "email": "jjohns@clementspestcontrol.com",
    "role": "Technician",
    "division": "Lawn",
    "branch": "vero",
    "hireDate": "2025-07-07"
  },
  {
    "name": "Jason Colontrelle",
    "email": "jcolontrelle@clementspestcontrol.com",
    "role": "Manager",
    "division": "Service",
    "branch": "vero",
    "hireDate": "2017-10-06"
  },
  {
    "name": "Josh Main",
    "email": "jmain@clementspestcontrol.com",
    "role": "Technician",
    "division": "General Pest",
    "branch": "vero",
    "hireDate": "2019-06-24"
  },
  {
    "name": "Logan Coffey",
    "email": "lcoffey@clementspestcontrol.com",
    "role": "Technician",
    "division": "Lawn",
    "branch": "vero",
    "hireDate": "2022-01-24"
  },
  {
    "name": "Matt Potter",
    "email": "mpotter@clementspestcontrol.com",
    "role": "Technician",
    "division": "Service",
    "branch": "vero",
    "hireDate": "2026-03-12"
  },
  {
    "name": "Mike Mace",
    "email": "mmace@clementspestcontrol.com",
    "role": "Technician",
    "division": "Lawn",
    "branch": "vero",
    "hireDate": "1996-09-03"
  },
  {
    "name": "Rob Segroves",
    "email": "rsegroves@clementspestcontrol.com",
    "role": "Technician",
    "division": "Lawn",
    "branch": "vero",
    "hireDate": "1997-03-19"
  },
  {
    "name": "Ronnie Slade",
    "email": "rslade@clementspestcontrol.com",
    "role": "Technician",
    "division": "General Pest",
    "branch": "vero",
    "hireDate": "1975-06-01"
  },
  {
    "name": "Rusty Stevens",
    "email": "rstevens@clementspestcontrol.com",
    "role": "Technician",
    "division": "General Pest",
    "branch": "vero",
    "hireDate": "1995-12-11"
  },
  {
    "name": "Steve Farless",
    "email": "sfarless@clementspestcontrol.com",
    "role": "Technician",
    "division": "General Pest",
    "branch": "vero",
    "hireDate": "2019-10-07"
  },
  {
    "name": "April Williford",
    "email": "awilliford@clementspestcontrol.com",
    "role": null,
    "division": null,
    "branch": null,
    "hireDate": "2022-06-13"
  },
  {
    "name": "Chayse Harrell",
    "email": "charrell@clementspestcontrol.com",
    "role": null,
    "division": null,
    "branch": null,
    "hireDate": "2025-04-14"
  },
  {
    "name": "Christopher Slade",
    "email": "c.slade@clementspestcontrol.com",
    "role": null,
    "division": null,
    "branch": null,
    "hireDate": "2014-02-07"
  },
  {
    "name": "Heather McCormack",
    "email": "hmccormack@clementspestcontrol.com",
    "role": null,
    "division": null,
    "branch": null,
    "hireDate": "2024-08-05"
  },
  {
    "name": "Jessica Sanderson",
    "email": "jsanderson@clementspestcontrol.com",
    "role": null,
    "division": null,
    "branch": null,
    "hireDate": "2021-05-10"
  },
  {
    "name": "Julie Glanville",
    "email": "jglanville@clementspestcontrol.com",
    "role": null,
    "division": null,
    "branch": null
  },
  {
    "name": "Kourtney Rannow",
    "email": "krannow@clementspestcontrol.com",
    "role": null,
    "division": null,
    "branch": null,
    "hireDate": "2026-06-08"
  },
  {
    "name": "Larry Ignazio",
    "email": "lignazio@clementspestcontrol.com",
    "role": null,
    "division": null,
    "branch": null,
    "hireDate": "2025-08-04"
  },
  {
    "name": "Robin Berning",
    "email": "rberning@clementspestcontrol.com",
    "role": null,
    "division": null,
    "branch": null,
    "hireDate": "2023-10-25"
  },
  {
    "name": "Tim Slade",
    "email": "tslade@clementspestcontrol.com",
    "role": null,
    "division": null,
    "branch": null,
    "hireDate": "1975-06-01"
  }
];
