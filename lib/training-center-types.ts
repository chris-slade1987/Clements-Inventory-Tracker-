/**
 * Client-safe types and constants for the Training Center UI. Kept free of
 * "server-only" / prisma so client components can import the shared shapes and
 * labels. The read helpers (which touch the database) live in lib/training-center.ts.
 */

// ---- Pickers ----
export type EmployeePick = {
  id: string;
  name: string;
  branch: string | null;
  role: string | null;
  division: string | null;
};

export type CoursePick = {
  code: string;
  name: string;
  group: string;
  courseType: string;
};

// ---- Employee record ----
export type EmployeeCourseRow = {
  code: string;
  name: string;
  group: string;
  courseType: string;
  status: string; // assigned | in_progress | complete | credited | not_started
  completedDate: string | null;
  score: number | null;
};

export type EmployeeAssignmentView = {
  id: string;
  moduleCode: string | null;
  moduleName: string | null;
  programCode: string | null;
  standaloneCourseCode: string | null;
  status: string;
  startMonth: string | null;
  assignedAt: string;
  assignedByName: string | null;
  branch: string | null;
  prereqNote: string | null;
  courses: EmployeeCourseRow[];
  completeCount: number;
  totalCount: number;
};

export type EmployeeSignoffView = {
  id: string;
  courseCode: string | null;
  courseName: string | null;
  certCode: string | null;
  date: string;
  hours: number | null;
  trainerName: string | null;
  approved: boolean;
  approvedByName: string | null;
  note: string | null;
};

export type EmployeeRecord = {
  employee: { id: string; name: string; branch: string | null; role: string | null; division: string | null };
  awards: { code: string; name: string; awardedAt: string; approvedByName: string | null }[];
  activeAssignments: EmployeeAssignmentView[];
  completedAssignments: EmployeeAssignmentView[];
  signoffs: EmployeeSignoffView[];
  history: EmployeeCourseRow[];
};

/** Status → human label. */
export const COURSE_STATUS_LABEL: Record<string, string> = {
  assigned: "Assigned",
  in_progress: "In progress",
  complete: "Complete",
  credited: "Credited",
};

// ---- Reports ----
export type InProgressRow = { branch: string; moduleCode: string; moduleName: string; count: number };

export type StalledRow = {
  assignmentId: string;
  employeeId: string;
  employeeName: string;
  branch: string | null;
  moduleCode: string | null;
  moduleName: string | null;
  assignedAt: string;
  daysOld: number;
  outstanding: { code: string; name: string }[];
};

export type PendingSignoffRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  branch: string | null;
  courseCode: string | null;
  certCode: string | null;
  date: string;
  hours: number | null;
  trainerName: string | null;
};

export type AwardsByMonthRow = {
  month: string;
  count: number;
  certs: { certCode: string; employeeName: string }[];
};

// "Stalled" threshold: an active assignment started more than this many days ago
// that still has incomplete courses. VERIFY — the spec does not define a
// threshold, so 30 days is an assumption; adjust if the business defines one.
export const STALLED_DAYS = 30;
