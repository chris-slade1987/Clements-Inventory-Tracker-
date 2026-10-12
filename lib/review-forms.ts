// New-hire 30 / 60-day review FORMS — client-safe (constants + pure helpers
// only, no server imports) so both the server queries in `lib/review.ts` and the
// client renderers/pickers can share them. Forms are encoded as sections of
// typed items and rendered by one generic renderer. Faithful to the company
// PDFs, with a few modest improvements (flagged with `added: true`).
//
// Forms are ROLE-SPECIFIC: each role (template) has its own 30- and 60-day form.
// The right template is resolved from the employee's access level / role at
// creation (stamped onto the review) and can be overridden by HR at any time.

export type ReviewItem = {
  key: string;
  type: "yesno" | "choice" | "text" | "textarea" | "number";
  label: string;
  options?: string[];
  who?: "manager" | "employee"; // whose perspective (for a subtle label hint)
  added?: boolean; // an improvement beyond the original form
};
export type ReviewSection = { title: string; items: ReviewItem[] };
export type ReviewForm = { title: string; sections: ReviewSection[] };

/** The role-specific review form a review is built from. */
export type ReviewTemplateKey = "technician" | "service_advisor" | "csr" | "branch_manager" | "corporate";
/** The two review milestones. */
export type ReviewType = "30_day" | "60_day";

const YN = ["Yes", "No"];
const COMFORT = ["Very Comfortable", "Somewhat Comfortable", "Neutral", "Uncomfortable"];
const CONFIDENCE = ["Much More Confident", "Somewhat More Confident", "About the Same", "Less Confident"];
const RATING = ["Exceeds Expectations", "Meets Expectations", "Needs Improvement"];
const RECOMMENDATION = ["Continue employment", "Extend review period", "Do not continue"];

// ---------------------------------------------------------------------------
// Technician (the original encoded forms — unchanged, now under "technician").
// ---------------------------------------------------------------------------
const TECHNICIAN: Record<ReviewType, ReviewForm> = {
  "30_day": {
    title: "30-Day Technician Review",
    sections: [
      {
        title: "Onboarding & Training",
        items: [
          { key: "onboarding_complete", type: "yesno", label: "Completed all required onboarding training", who: "manager" },
          { key: "understands_policies", type: "yesno", label: "Demonstrates understanding of company policies & procedures", who: "manager" },
          { key: "enough_training", type: "choice", options: YN, label: "Have you received enough training to do your job effectively?", who: "employee" },
          { key: "training_needed", type: "textarea", label: "If not, what additional training would help?", who: "employee" },
          { key: "has_tools", type: "choice", options: YN, label: "Do you have the tools and resources needed to perform your job?", who: "employee" },
          { key: "tools_missing", type: "textarea", label: "If not, what is missing?", who: "employee" },
        ],
      },
      {
        title: "Job Performance & Competency",
        items: [
          { key: "follows_processes", type: "yesno", label: "Following all service processes and procedures", who: "manager" },
          { key: "uses_equipment", type: "yesno", label: "Properly using equipment and chemicals", who: "manager" },
          { key: "efficient", type: "yesno", label: "Completing work efficiently and within expected timeframes", who: "manager" },
          { key: "understands_treatments", type: "yesno", label: "Good understanding of pest control treatments", who: "manager" },
          { key: "proper_uniform", type: "yesno", label: "Wearing the proper uniform and maintaining a professional appearance", who: "manager" },
          { key: "mastered", type: "text", label: "Tasks / skills mastered", who: "employee" },
          { key: "challenging", type: "text", label: "Tasks / skills still challenging", who: "employee" },
          { key: "responsibilities_match", type: "choice", options: YN, label: "Have your job responsibilities matched what you expected?", who: "employee" },
          { key: "responsibilities_diff", type: "textarea", label: "If not, what differences have you noticed?", who: "employee" },
        ],
      },
      {
        title: "Customer Service & Interactions",
        items: [
          { key: "no_complaints", type: "yesno", label: "No customer complaints", who: "manager" },
          { key: "professional_comm", type: "yesno", label: "Communicating professionally with customers", who: "manager" },
          { key: "explains_treatments", type: "yesno", label: "Explaining treatments and answering questions effectively", who: "manager" },
          { key: "cs_challenges", type: "textarea", label: "What challenges have you faced, and how have you addressed them?", who: "employee" },
        ],
      },
      {
        title: "Teamwork & Communication",
        items: [
          { key: "respectful", type: "yesno", label: "Respectful & professional with office staff and coworkers", who: "manager" },
          { key: "timely_comm", type: "yesno", label: "Responding to office communications in a timely manner", who: "manager" },
          { key: "reports_issues", type: "yesno", label: "Reporting issues and concerns appropriately", who: "manager" },
          { key: "unclear_processes", type: "choice", options: YN, label: "Is anything unclear about company processes or expectations?", who: "employee" },
          { key: "unclear_explain", type: "textarea", label: "If yes, please explain", who: "employee" },
          { key: "feedback_manager", type: "textarea", label: "Any feedback for your manager or the company?", who: "employee" },
        ],
      },
      {
        title: "Attendance & Reliability",
        items: [
          { key: "on_time", type: "yesno", label: "Consistently on time for shifts", who: "manager" },
          { key: "callout_procedures", type: "yesno", label: "Adhered to scheduling and call-out procedures", who: "manager" },
          { key: "route_responsibility", type: "yesno", label: "Responsible in handling assigned routes and workload", who: "manager" },
        ],
      },
      {
        title: "Overall Experience & Future Growth",
        items: [
          { key: "comfort", type: "choice", options: COMFORT, label: "How comfortable do you feel in your role so far?", who: "employee" },
          { key: "on_track", type: "choice", options: YN, label: "Do you feel you are on track to meet your goals for the next few months?", who: "employee" },
          { key: "on_track_help", type: "textarea", label: "If no, what is needed to help?", who: "employee" },
          { key: "engagement", type: "textarea", label: "Anything we can do to help you feel more engaged and motivated?", who: "employee" },
          { key: "support_training", type: "textarea", label: "What additional support or training would help you perform better?", who: "employee" },
        ],
      },
      {
        title: "Summary",
        items: [
          { key: "overall_rating", type: "choice", options: RATING, label: "Overall performance rating", who: "manager" },
          { key: "goals_next", type: "textarea", label: "Goals for the next 30 days", who: "manager", added: true },
          { key: "next_steps", type: "textarea", label: "Next steps & action plan", who: "manager" },
        ],
      },
    ],
  },
  "60_day": {
    title: "60-Day Technician Review",
    sections: [
      {
        title: "Confidence & Comfort in Your Role",
        items: [
          { key: "confidence", type: "choice", options: CONFIDENCE, label: "How confident do you feel now compared to when you started?", who: "employee" },
          { key: "comfortable_with", type: "textarea", label: "What tasks or responsibilities do you feel most comfortable with?", who: "employee" },
          { key: "still_challenging", type: "textarea", label: "Are there any aspects of your role you still find challenging?", who: "employee" },
          { key: "enough_training", type: "choice", options: YN, label: "Do you feel you have received enough training and support?", who: "employee" },
          { key: "training_support", type: "textarea", label: "If not, what additional support do you need?", who: "employee" },
        ],
      },
      {
        title: "Training & Development",
        items: [
          { key: "additional_training", type: "textarea", label: "Areas where you'd like additional training or resources?", who: "employee" },
          { key: "skills_develop", type: "textarea", label: "What skills would you like to develop further?", who: "employee" },
          { key: "mentorship_helpful", type: "choice", options: YN, label: "Have you found mentorship or guidance helpful in your role?", who: "employee" },
          { key: "mentorship_notes", type: "textarea", label: "Mentorship notes", who: "employee" },
        ],
      },
      {
        title: "Challenges & Support",
        items: [
          { key: "support_challenges", type: "textarea", label: "How can we better support you in overcoming challenges?", who: "employee" },
          { key: "processes_unclear", type: "choice", options: YN, label: "Anything about our processes or policies you find unclear or frustrating?", who: "employee" },
          { key: "unclear_explain", type: "textarea", label: "If yes, please explain", who: "employee" },
          { key: "stay_engaged", type: "textarea", label: "What can we do to ensure you continue to grow and stay engaged?", who: "employee" },
        ],
      },
      {
        title: "Manager Assessment",
        items: [
          { key: "meets_standards", type: "yesno", label: "Consistently meeting performance & quality standards", who: "manager", added: true },
          { key: "safety_compliance", type: "yesno", label: "Following safety & compliance requirements", who: "manager", added: true },
          { key: "reliable", type: "yesno", label: "Reliable — attendance, punctuality, workload", who: "manager", added: true },
        ],
      },
      {
        title: "Summary",
        items: [
          { key: "overall_rating", type: "choice", options: RATING, label: "Overall performance rating", who: "manager" },
          { key: "recommendation", type: "choice", options: RECOMMENDATION, label: "End-of-probation recommendation", who: "manager", added: true },
          { key: "goals_next", type: "textarea", label: "Goals for the next 90 days", who: "manager", added: true },
          { key: "next_steps", type: "textarea", label: "Next steps & action plan", who: "manager" },
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Service Advisor (mirrors the HR director's Service Advisor PDFs).
// ---------------------------------------------------------------------------
const SERVICE_ADVISOR: Record<ReviewType, ReviewForm> = {
  "30_day": {
    title: "30-Day Service Advisor Review",
    sections: [
      {
        title: "Onboarding & Training",
        items: [
          { key: "onboarding_complete", type: "yesno", label: "Completed all required onboarding training", who: "manager" },
          { key: "understands_policies", type: "yesno", label: "Demonstrates understanding of company policies & procedures", who: "manager" },
          { key: "enough_training", type: "choice", options: YN, label: "Have you received enough training to do your job effectively?", who: "employee" },
          { key: "training_needed", type: "textarea", label: "If not, what additional training would help?", who: "employee" },
          { key: "has_tools", type: "choice", options: YN, label: "Do you have the tools and resources needed to perform your job (PestPac Mobile, pricing guides, sample agreements, etc.)?", who: "employee" },
          { key: "tools_missing", type: "textarea", label: "If not, what is missing?", who: "employee" },
        ],
      },
      {
        title: "Job Performance & Sales Competency",
        items: [
          { key: "follows_sales_process", type: "yesno", label: "Following the company's sales process and pricing guidelines", who: "manager" },
          { key: "accurate_estimates", type: "yesno", label: "Accurately prepares estimates and explains treatment programs", who: "manager" },
          { key: "thorough_inspections", type: "yesno", label: "Completes property inspections and consultations thoroughly and on schedule", who: "manager" },
          { key: "understands_offerings", type: "yesno", label: "Good understanding of the company's pest, termite, and lawn service offerings", who: "manager" },
          { key: "enters_pestpac", type: "yesno", label: "Enters leads, estimates, and new agreements into PestPac accurately and promptly", who: "manager" },
          { key: "proper_uniform", type: "yesno", label: "Wearing the proper uniform and maintaining a professional appearance", who: "manager" },
          { key: "responsibilities_match", type: "choice", options: YN, label: "Have your job responsibilities matched what you expected?", who: "employee" },
          { key: "mastered", type: "text", label: "Tasks / skills mastered", who: "employee" },
          { key: "challenging", type: "text", label: "Tasks / skills still challenging", who: "employee" },
          { key: "responsibilities_diff", type: "textarea", label: "If responsibilities haven't matched, what differences have you noticed?", who: "employee" },
        ],
      },
      {
        title: "Sales Performance & Activity",
        items: [
          { key: "agreements_closed", type: "number", label: "New service agreements closed to date", who: "manager" },
          { key: "nonrecurring_sold", type: "number", label: "Non-recurring services sold to date", who: "manager" },
          { key: "on_pace_goals", type: "yesno", label: "On pace to meet monthly sales goals", who: "manager" },
          { key: "follows_up_leads", type: "yesno", label: "Follows up on leads, referrals, and renewal opportunities in a timely manner", who: "manager" },
          { key: "understands_commission", type: "yesno", label: "Demonstrates a clear understanding of the commission structure and how pay is calculated", who: "manager" },
        ],
      },
      {
        title: "Customer Service & Interactions",
        items: [
          { key: "no_complaints", type: "yesno", label: "No customer complaints", who: "manager" },
          { key: "professional_comm", type: "yesno", label: "Communicating professionally with customers", who: "manager" },
          { key: "explains_treatments", type: "yesno", label: "Clearly explains treatments, pricing, and agreements, and answers customer questions effectively", who: "manager" },
          { key: "cs_challenges", type: "textarea", label: "What challenges have you faced with customers, and how have you addressed them?", who: "employee" },
        ],
      },
      {
        title: "Teamwork & Communication",
        items: [
          { key: "respectful", type: "yesno", label: "Respectful & professional with office staff, technicians, and coworkers", who: "manager" },
          { key: "timely_comm", type: "yesno", label: "Responding to office communications in a timely manner", who: "manager" },
          { key: "reports_issues", type: "yesno", label: "Reporting issues and concerns appropriately", who: "manager" },
          { key: "unclear_processes", type: "choice", options: YN, label: "Is anything unclear about company processes or expectations?", who: "employee" },
          { key: "unclear_explain", type: "textarea", label: "If yes, please explain", who: "employee" },
          { key: "feedback_manager", type: "textarea", label: "Any feedback for your manager or the company?", who: "employee" },
        ],
      },
      {
        title: "Attendance & Reliability",
        items: [
          { key: "on_time", type: "yesno", label: "Consistently on time for shifts and appointments", who: "manager" },
          { key: "callout_procedures", type: "yesno", label: "Adhered to scheduling and call-out procedures", who: "manager" },
          { key: "territory_responsibility", type: "yesno", label: "Responsible in managing assigned territory and workload", who: "manager" },
        ],
      },
      {
        title: "Overall Experience & Future Growth",
        items: [
          { key: "comfort", type: "choice", options: COMFORT, label: "How comfortable do you feel in your role so far?", who: "employee" },
          { key: "on_track", type: "choice", options: YN, label: "Do you feel you are on track to meet your sales goals for the next few months?", who: "employee" },
          { key: "on_track_help", type: "textarea", label: "If no, what is needed to help?", who: "employee" },
        ],
      },
      {
        title: "Summary",
        items: [
          { key: "overall_rating", type: "choice", options: RATING, label: "Overall performance rating", who: "manager", added: true },
          { key: "goals_next", type: "textarea", label: "Goals for the next 30 days", who: "manager", added: true },
          { key: "next_steps", type: "textarea", label: "Next steps & action plan", who: "manager", added: true },
        ],
      },
    ],
  },
  "60_day": {
    title: "60-Day Service Advisor Review",
    sections: [
      {
        title: "Confidence & Comfort in Your Role",
        items: [
          { key: "confidence", type: "choice", options: CONFIDENCE, label: "How confident do you feel now compared to when you started?", who: "employee" },
          { key: "comfortable_with", type: "textarea", label: "What tasks or responsibilities do you feel most comfortable with?", who: "employee" },
          { key: "still_challenging", type: "textarea", label: "Are there any aspects of your role you still find challenging?", who: "employee" },
        ],
      },
      {
        title: "Sales Performance & Expectations",
        items: [
          { key: "agreements_closed", type: "number", label: "New service agreements closed since your 30-day review", who: "manager" },
          { key: "nonrecurring_sold", type: "number", label: "Non-recurring services sold since your 30-day review", who: "manager" },
          { key: "on_pace_goals", type: "yesno", label: "On pace to meet monthly sales goals", who: "manager" },
          { key: "improved_activity", type: "yesno", label: "Shown measurable improvement in sales activity since the 30-day review", who: "manager" },
          { key: "follows_sales_process", type: "yesno", label: "Following the company's sales process and pricing guidelines", who: "manager" },
          { key: "understands_commission", type: "yesno", label: "Demonstrates a clear understanding of the commission structure and how pay is calculated", who: "manager" },
          { key: "meets_sales_expectations", type: "yesno", label: "Has been able to meet the sales expectations set for them", who: "manager" },
          { key: "expectations_challenges", type: "textarea", label: "If sales expectations haven't been met, what challenges have you faced?", who: "employee" },
          { key: "enough_training", type: "choice", options: YN, label: "Do you feel you have received enough training and support?", who: "employee" },
          { key: "training_support", type: "textarea", label: "If not, what additional support do you need?", who: "employee" },
        ],
      },
      {
        title: "Training & Development",
        items: [
          { key: "closed_training_gaps", type: "yesno", label: "Has closed the training gaps identified at the 30-day review", who: "manager" },
          { key: "additional_training", type: "textarea", label: "Areas where you'd like additional training or resources?", who: "employee" },
          { key: "skills_develop", type: "textarea", label: "What skills would you like to develop further?", who: "employee" },
          { key: "mentorship_helpful", type: "yesno", label: "Has found mentorship or guidance helpful in their role", who: "manager" },
        ],
      },
      {
        title: "Challenges & Support",
        items: [
          { key: "support_challenges", type: "textarea", label: "How can we better support you in overcoming challenges?", who: "employee" },
          { key: "processes_unclear", type: "yesno", label: "Finds something about our processes or policies unclear or frustrating", who: "manager" },
          { key: "unclear_explain", type: "textarea", label: "If yes, please explain", who: "employee" },
          { key: "stay_engaged", type: "textarea", label: "What can we do to ensure you continue to grow and stay engaged?", who: "employee" },
        ],
      },
      {
        title: "Manager Assessment",
        items: [
          { key: "meets_standards", type: "yesno", label: "Consistently meeting performance & quality standards", who: "manager", added: true },
          { key: "safety_compliance", type: "yesno", label: "Following safety & compliance requirements", who: "manager", added: true },
          { key: "reliable", type: "yesno", label: "Reliable — attendance, punctuality, workload", who: "manager", added: true },
        ],
      },
      {
        title: "Summary",
        items: [
          { key: "overall_rating", type: "choice", options: RATING, label: "Overall performance rating", who: "manager" },
          { key: "recommendation", type: "choice", options: RECOMMENDATION, label: "End-of-probation recommendation", who: "manager", added: true },
          { key: "goals_next", type: "textarea", label: "Goals for the next 90 days", who: "manager", added: true },
          { key: "next_steps", type: "textarea", label: "Next steps & action plan", who: "manager" },
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// CSR / Customer Service Representative (mirrors the HR director's CSR PDFs).
// CSR forms carry a Department/Team field (text) in place of the branch header
// the other roles use.
// ---------------------------------------------------------------------------
const CSR: Record<ReviewType, ReviewForm> = {
  "30_day": {
    title: "30-Day Customer Service Representative Review",
    sections: [
      {
        title: "Onboarding & Training",
        items: [
          { key: "department_team", type: "text", label: "Department / Team", who: "manager" },
          { key: "onboarding_complete", type: "yesno", label: "Completed all required onboarding training", who: "manager" },
          { key: "understands_policies", type: "yesno", label: "Demonstrates understanding of company policies & procedures", who: "manager" },
          { key: "enough_training", type: "choice", options: YN, label: "Have you received enough training to do your job effectively?", who: "employee" },
          { key: "training_needed", type: "textarea", label: "If not, what additional training would help?", who: "employee" },
          { key: "has_tools", type: "choice", options: YN, label: "Do you have the tools and resources needed to perform your job (CRM/ticketing software, headset, knowledge base access, etc.)?", who: "employee" },
          { key: "tools_missing", type: "textarea", label: "If not, what is missing?", who: "employee" },
        ],
      },
      {
        title: "Job Performance & Competency",
        items: [
          { key: "follows_processes", type: "yesno", label: "Following all customer service processes and procedures", who: "manager" },
          { key: "uses_systems", type: "yesno", label: "Properly using CRM, ticketing, and phone systems", who: "manager" },
          { key: "efficient", type: "yesno", label: "Resolving inquiries efficiently and within expected handle times", who: "manager" },
          { key: "understands_products", type: "yesno", label: "Good understanding of company products and services", who: "manager" },
          { key: "professional_tone", type: "yesno", label: "Maintains a professional tone and demeanor with customers", who: "manager" },
          { key: "responsibilities_match", type: "choice", options: YN, label: "Have your job responsibilities matched what you expected?", who: "employee" },
          { key: "mastered", type: "text", label: "Tasks / skills mastered", who: "employee" },
          { key: "challenging", type: "text", label: "Tasks / skills still challenging", who: "employee" },
          { key: "responsibilities_diff", type: "textarea", label: "If responsibilities haven't matched, what differences have you noticed?", who: "employee" },
        ],
      },
      {
        title: "Customer Service & Interactions",
        items: [
          { key: "no_complaints", type: "yesno", label: "No unresolved customer complaints", who: "manager" },
          { key: "professional_comm", type: "yesno", label: "Communicates professionally and empathetically with customers", who: "manager" },
          { key: "explains_products", type: "yesno", label: "Clearly explains products/services and answers customer questions effectively", who: "manager" },
          { key: "cs_challenges", type: "textarea", label: "What challenges have you faced, and how have you addressed them?", who: "employee" },
        ],
      },
      {
        title: "Teamwork & Communication",
        items: [
          { key: "respectful", type: "yesno", label: "Respectful & professional with teammates and supervisors", who: "manager" },
          { key: "timely_comm", type: "yesno", label: "Responding to internal communications in a timely manner", who: "manager" },
          { key: "reports_issues", type: "yesno", label: "Reporting issues and concerns appropriately", who: "manager" },
          { key: "unclear_processes", type: "choice", options: YN, label: "Is anything unclear about company processes or expectations?", who: "employee" },
          { key: "unclear_explain", type: "textarea", label: "If yes, please explain", who: "employee" },
          { key: "feedback_manager", type: "textarea", label: "Any feedback for your manager or the company?", who: "employee" },
        ],
      },
      {
        title: "Attendance & Reliability",
        items: [
          { key: "on_time", type: "yesno", label: "Consistently on time for shifts", who: "manager" },
          { key: "callout_procedures", type: "yesno", label: "Adhered to scheduling and call-out procedures", who: "manager" },
          { key: "queue_responsibility", type: "yesno", label: "Responsible in managing their queue/workload", who: "manager" },
        ],
      },
      {
        title: "Overall Experience & Future Growth",
        items: [
          { key: "comfort", type: "choice", options: COMFORT, label: "How comfortable do you feel in your role so far?", who: "employee" },
          { key: "on_track", type: "choice", options: YN, label: "Do you feel you are on track to meet your goals for the next few months?", who: "employee" },
          { key: "on_track_help", type: "textarea", label: "If no, what is needed to help?", who: "employee" },
          { key: "engagement", type: "textarea", label: "Anything we can do to help you feel more engaged and motivated?", who: "employee" },
          { key: "support_training", type: "textarea", label: "What additional support or training would help you perform better?", who: "employee" },
        ],
      },
      {
        title: "Summary",
        items: [
          { key: "overall_rating", type: "choice", options: RATING, label: "Overall performance rating", who: "manager" },
          { key: "goals_next", type: "textarea", label: "Goals for the next 30 days", who: "manager", added: true },
          { key: "next_steps", type: "textarea", label: "Next steps & action plan", who: "manager" },
        ],
      },
    ],
  },
  "60_day": {
    title: "60-Day Customer Service Representative Review",
    sections: [
      {
        title: "Continued Training & Development",
        items: [
          { key: "department_team", type: "text", label: "Department / Team", who: "manager" },
          { key: "closed_training_gaps", type: "yesno", label: "Has closed the training gaps identified at the 30-day review", who: "manager" },
          { key: "ongoing_policies", type: "yesno", label: "Demonstrates ongoing understanding of company policies and procedures", who: "manager" },
          { key: "developing_skills", type: "yesno", label: "Continuing to develop the skills needed to do the job effectively", who: "manager" },
          { key: "has_tools", type: "yesno", label: "Now has the tools and resources needed to perform the job (ticketing software, headset, knowledge base access, etc.)", who: "manager" },
          { key: "training_needed", type: "textarea", label: "If additional training would help, or something is missing, describe", who: "employee" },
        ],
      },
      {
        title: "Job Performance & Competency",
        items: [
          { key: "follows_processes", type: "yesno", label: "Following all customer service processes and procedures", who: "manager" },
          { key: "uses_systems", type: "yesno", label: "Properly using ticketing and phone systems", who: "manager" },
          { key: "efficient", type: "yesno", label: "Resolving inquiries efficiently and within expected handle times", who: "manager" },
          { key: "understands_products", type: "yesno", label: "Good understanding of company products and services", who: "manager" },
          { key: "professional_tone", type: "yesno", label: "Maintains a professional tone and demeanor with customers", who: "manager" },
          { key: "improved", type: "yesno", label: "Shown measurable improvement since the 30-day review", who: "manager" },
          { key: "responsibilities_match", type: "choice", options: YN, label: "Have your job responsibilities matched what you expected at this point?", who: "employee" },
          { key: "mastered", type: "text", label: "Tasks / skills mastered since the last review", who: "employee" },
          { key: "challenging", type: "text", label: "Tasks / skills still challenging", who: "employee" },
          { key: "responsibilities_diff", type: "textarea", label: "If responsibilities haven't matched, what differences have you noticed?", who: "employee" },
        ],
      },
      {
        title: "Customer Service & Interactions",
        items: [
          { key: "no_complaints", type: "yesno", label: "No unresolved customer complaints", who: "manager" },
          { key: "professional_comm", type: "yesno", label: "Communicates professionally and empathetically with customers", who: "manager" },
          { key: "explains_products", type: "yesno", label: "Clearly explains products/services and answers customer questions effectively", who: "manager" },
          { key: "cs_challenges", type: "textarea", label: "What challenges have you faced, and how have you addressed them?", who: "employee" },
        ],
      },
      {
        title: "Teamwork & Communication",
        items: [
          { key: "respectful", type: "yesno", label: "Respectful & professional with teammates and supervisors", who: "manager" },
          { key: "timely_comm", type: "yesno", label: "Responding to internal communications in a timely manner", who: "manager" },
          { key: "reports_issues", type: "yesno", label: "Reporting issues and concerns appropriately", who: "manager" },
          { key: "unclear_processes", type: "choice", options: YN, label: "Is anything unclear about company processes or expectations?", who: "employee" },
          { key: "unclear_explain", type: "textarea", label: "If yes, please explain", who: "employee" },
        ],
      },
      {
        title: "Attendance & Reliability",
        items: [
          { key: "on_time", type: "yesno", label: "Consistently on time for shifts", who: "manager" },
          { key: "callout_procedures", type: "yesno", label: "Adhered to scheduling and call-out procedures", who: "manager" },
          { key: "queue_responsibility", type: "yesno", label: "Responsible in managing their queue/workload", who: "manager" },
        ],
      },
      {
        title: "Overall Experience & Future Growth",
        items: [
          { key: "comfort", type: "choice", options: COMFORT, label: "How comfortable do you feel in your role so far?", who: "employee" },
          { key: "on_track_90", type: "choice", options: YN, label: "Do you feel you are on track to meet your goals by the 90-day mark?", who: "employee" },
          { key: "on_track_help", type: "textarea", label: "If no, what is needed to help?", who: "employee" },
          { key: "engagement", type: "textarea", label: "Anything we can do to help you feel more engaged and motivated?", who: "employee" },
          { key: "support_training", type: "textarea", label: "What additional support or training would help you perform better?", who: "employee" },
        ],
      },
      {
        title: "Manager Assessment",
        items: [
          { key: "meets_standards", type: "yesno", label: "Consistently meeting performance & quality standards", who: "manager", added: true },
          { key: "reliable", type: "yesno", label: "Reliable — attendance, punctuality, workload", who: "manager", added: true },
        ],
      },
      {
        title: "Summary",
        items: [
          { key: "overall_rating", type: "choice", options: RATING, label: "Overall performance rating", who: "manager" },
          { key: "recommendation", type: "choice", options: RECOMMENDATION, label: "End-of-probation recommendation", who: "manager", added: true },
          { key: "goals_next", type: "textarea", label: "Goals for the next 90 days", who: "manager", added: true },
          { key: "next_steps", type: "textarea", label: "Next steps & action plan", who: "manager" },
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Branch Manager (mirrors the HR director's Branch Manager PDFs). Reviewed by
// the branch manager's supervisor; uses the branch header like the field roles.
// ---------------------------------------------------------------------------
const BRANCH_MANAGER: Record<ReviewType, ReviewForm> = {
  "30_day": {
    title: "30-Day Branch Manager Review",
    sections: [
      {
        title: "Onboarding & Training",
        items: [
          { key: "onboarding_complete", type: "yesno", label: "Completed all required onboarding training, including HR, safety, and compliance", who: "manager" },
          { key: "understands_policies", type: "yesno", label: "Demonstrates understanding of company policies, procedures, and the employee handbook", who: "manager" },
          { key: "trained_pestpac", type: "yesno", label: "Trained on PestPac scheduling, routing, and reporting tools", who: "manager" },
          { key: "understands_regs", type: "yesno", label: "Understands state regulatory requirements (FDACS licensing, pesticide recordkeeping, label compliance)", who: "manager" },
          { key: "has_tools", type: "yesno", label: "Has the tools and resources needed to perform the job (laptop, PestPac access, financial reports, vehicle, etc.)", who: "manager" },
          { key: "intro_corporate", type: "yesno", label: "Introduced to key corporate contacts (HR, Accounting, Fleet, Safety, Marketing)", who: "manager" },
          { key: "training_needed", type: "textarea", label: "If additional training would help, or something is missing, describe", who: "employee" },
        ],
      },
      {
        title: "Leadership & Team Management",
        items: [
          { key: "met_team", type: "yesno", label: "Has met one-on-one with branch team members (technicians, office staff, service advisors)", who: "manager" },
          { key: "sets_expectations", type: "yesno", label: "Sets clear expectations and holds the team accountable", who: "manager" },
          { key: "team_meetings", type: "yesno", label: "Conducts or supports regular team and safety meetings", who: "manager" },
          { key: "addresses_performance", type: "yesno", label: "Addresses performance and conduct issues promptly and involves HR when needed", who: "manager" },
          { key: "visible", type: "yesno", label: "Visible and accessible to the team, including field ride-alongs", who: "manager" },
          { key: "professional", type: "yesno", label: "Models a professional appearance and conduct", who: "manager" },
          { key: "responsibilities_match", type: "yesno", label: "Job responsibilities have matched what was expected", who: "manager" },
          { key: "strengths", type: "text", label: "What has the Branch Manager done well so far?", who: "manager" },
          { key: "challenging", type: "text", label: "What has been challenging?", who: "manager" },
        ],
      },
      {
        title: "Branch Operations & Performance",
        items: [
          { key: "revenue_vs_budget", type: "text", label: "Branch revenue vs. budget to date", who: "manager" },
          { key: "service_backlog", type: "text", label: "Service completion / backlog", who: "manager" },
          { key: "cancellations", type: "text", label: "Cancellations to date", who: "manager" },
          { key: "staffing_needs", type: "text", label: "Open positions / staffing needs", who: "manager" },
          { key: "understands_pl", type: "yesno", label: "Understands the branch P&L, budget, and key performance metrics", who: "manager" },
          { key: "monitors_scheduling", type: "yesno", label: "Monitors daily scheduling, routing, and service completion", who: "manager" },
          { key: "manages_backlog", type: "yesno", label: "Manages service backlog, callbacks, and re-treatments promptly", who: "manager" },
          { key: "oversees_inventory", type: "yesno", label: "Oversees chemical inventory, equipment, and supply ordering", who: "manager" },
          { key: "fleet_uptodate", type: "yesno", label: "Ensures vehicle inspections and fleet maintenance are up to date", who: "manager" },
          { key: "supports_sales", type: "yesno", label: "Supports the sales team in meeting new-sales and renewal goals", who: "manager" },
        ],
      },
      {
        title: "Safety & Compliance",
        items: [
          { key: "enforces_safety", type: "yesno", label: "Enforces company safety policies and PPE requirements", who: "manager" },
          { key: "pesticide_compliance", type: "yesno", label: "Ensures pesticide applications, records, and storage meet state and label requirements", who: "manager" },
          { key: "licenses_current", type: "yesno", label: "Verifies that technician licenses and certifications are current", who: "manager" },
          { key: "reports_incidents", type: "yesno", label: "Reports accidents, injuries, and incidents promptly", who: "manager" },
        ],
      },
      {
        title: "Customer Service & Interactions",
        items: [
          { key: "no_complaints", type: "yesno", label: "Branch has no unresolved customer complaints", who: "manager" },
          { key: "handles_escalations", type: "yesno", label: "Handles escalated customer issues promptly and professionally", who: "manager" },
          { key: "monitors_reviews", type: "yesno", label: "Monitors customer reviews and feedback and follows up as needed", who: "manager" },
          { key: "cs_challenges", type: "textarea", label: "What customer challenges has the branch faced, and how have they been addressed?", who: "employee" },
        ],
      },
      {
        title: "Communication & Corporate Partnership",
        items: [
          { key: "communicates_corporate", type: "yesno", label: "Communicates effectively with the corporate office and other departments", who: "manager" },
          { key: "timely_comm", type: "yesno", label: "Responds to emails, messages, and calls in a timely manner", who: "manager" },
          { key: "submits_reports", type: "yesno", label: "Submits required reports and approvals (payroll, timesheets, expenses) accurately and on time", who: "manager" },
          { key: "reports_issues", type: "yesno", label: "Reports issues and concerns appropriately", who: "manager" },
          { key: "unclear_processes", type: "choice", options: YN, label: "Is anything unclear about company processes or expectations?", who: "employee" },
          { key: "unclear_explain", type: "textarea", label: "If yes, please explain", who: "employee" },
          { key: "feedback_manager", type: "textarea", label: "Any feedback for your supervisor or the company?", who: "employee" },
        ],
      },
      {
        title: "Attendance & Reliability",
        items: [
          { key: "present", type: "yesno", label: "Consistently present and available during branch hours", who: "manager" },
          { key: "coverage", type: "yesno", label: "Follows scheduling and time-off procedures and ensures branch coverage", who: "manager" },
          { key: "manages_workload", type: "yesno", label: "Manages workload and priorities effectively", who: "manager" },
        ],
      },
      {
        title: "Overall Experience & Future Growth",
        items: [
          { key: "comfort", type: "choice", options: COMFORT, label: "How comfortable do you feel in the role so far?", who: "employee" },
          { key: "on_track", type: "choice", options: YN, label: "Are you on track to meet branch goals for the next few months?", who: "employee" },
          { key: "on_track_help", type: "textarea", label: "If no, what is needed to help?", who: "employee" },
          { key: "priorities_goals", type: "textarea", label: "Priorities and goals for the next 30–60 days", who: "manager" },
        ],
      },
      {
        title: "Summary",
        items: [
          { key: "overall_rating", type: "choice", options: RATING, label: "Overall performance rating", who: "manager", added: true },
          { key: "goals_next", type: "textarea", label: "Goals for the next 30 days", who: "manager", added: true },
          { key: "next_steps", type: "textarea", label: "Next steps & action plan", who: "manager" },
        ],
      },
    ],
  },
  "60_day": {
    title: "60-Day Branch Manager Review",
    sections: [
      {
        title: "Follow-Up from 30-Day Review",
        items: [
          { key: "training_addressed", type: "yesno", label: "Training needs identified at the 30-Day Review have been addressed", who: "manager" },
          { key: "goals_on_track", type: "yesno", label: "Priorities and goals set at the 30-Day Review have been met or are on track", who: "manager" },
          { key: "has_tools", type: "yesno", label: "Now has all the tools, systems access, and resources needed to perform the job", who: "manager" },
          { key: "concerns_resolved", type: "yesno", label: "Concerns or questions raised at the 30-Day Review have been resolved", who: "manager" },
          { key: "followup_summary", type: "textarea", label: "Summarize progress on items from the 30-Day Review, and note anything still open", who: "manager" },
        ],
      },
      {
        title: "Leadership & Team Management",
        items: [
          { key: "runs_independently", type: "yesno", label: "Runs day-to-day branch operations independently with minimal supervision", who: "manager" },
          { key: "regular_oneonones", type: "yesno", label: "Holds regular one-on-ones and gives team members ongoing feedback", who: "manager" },
          { key: "accountable", type: "yesno", label: "Holds the team accountable to expectations consistently and fairly", who: "manager" },
          { key: "leads_meetings", type: "yesno", label: "Leads regular team and safety meetings", who: "manager" },
          { key: "documents_hr", type: "yesno", label: "Addresses performance and conduct issues promptly and documents them with HR", who: "manager" },
          { key: "involved_hiring", type: "yesno", label: "Involved in hiring, onboarding, and training new branch employees", who: "manager" },
          { key: "earned_trust", type: "yesno", label: "Has earned the trust and respect of the branch team", who: "manager" },
          { key: "strengths", type: "text", label: "What has the Branch Manager improved since the 30-Day Review?", who: "manager" },
          { key: "still_developing", type: "text", label: "What is still developing?", who: "manager" },
        ],
      },
      {
        title: "Branch Operations & Performance",
        items: [
          { key: "revenue_vs_budget", type: "text", label: "Branch revenue vs. budget to date", who: "manager" },
          { key: "service_backlog", type: "text", label: "Service completion / backlog", who: "manager" },
          { key: "cancellations", type: "text", label: "Cancellations to date", who: "manager" },
          { key: "staffing_needs", type: "text", label: "Open positions / staffing needs", who: "manager" },
          { key: "uses_pl", type: "yesno", label: "Uses the branch P&L and key metrics to make decisions", who: "manager" },
          { key: "efficient_routing", type: "yesno", label: "Keeps scheduling and routing efficient and service completion on target", who: "manager" },
          { key: "controls_backlog", type: "yesno", label: "Keeps service backlog, callbacks, and re-treatments under control", who: "manager" },
          { key: "manages_expenses", type: "yesno", label: "Manages labor, overtime, and branch expenses within budget", who: "manager" },
          { key: "fleet_current", type: "yesno", label: "Keeps chemical inventory, equipment, and fleet maintenance current", who: "manager" },
          { key: "works_sales", type: "yesno", label: "Works with the sales team on new-sales, renewal, and retention goals", who: "manager" },
          { key: "improvement_opportunity", type: "yesno", label: "Has identified at least one improvement opportunity for the branch", who: "manager" },
        ],
      },
      {
        title: "Safety & Compliance",
        items: [
          { key: "enforces_safety", type: "yesno", label: "Consistently enforces company safety policies and PPE requirements", who: "manager" },
          { key: "pesticide_compliance", type: "yesno", label: "Pesticide applications, records, and storage meet state and label requirements", who: "manager" },
          { key: "licenses_tracked", type: "yesno", label: "Technician licenses and certifications are current, and renewals are being tracked", who: "manager" },
          { key: "no_unreported", type: "yesno", label: "Branch has had no unreported accidents, injuries, or incidents", who: "manager" },
        ],
      },
      {
        title: "Customer Service & Interactions",
        items: [
          { key: "no_complaints", type: "yesno", label: "Branch has no unresolved customer complaints", who: "manager" },
          { key: "resolves_escalations", type: "yesno", label: "Resolves escalated customer issues promptly and professionally", who: "manager" },
          { key: "uses_reviews", type: "yesno", label: "Monitors customer reviews and feedback and uses them to improve service", who: "manager" },
          { key: "cs_challenges", type: "textarea", label: "What customer challenges has the branch faced, and how have they been addressed?", who: "employee" },
        ],
      },
      {
        title: "Communication & Corporate Partnership",
        items: [
          { key: "communicates_corporate", type: "yesno", label: "Communicates effectively with the corporate office and other departments", who: "manager" },
          { key: "timely_comm", type: "yesno", label: "Responds to emails, messages, and calls in a timely manner", who: "manager" },
          { key: "submits_reports", type: "yesno", label: "Submits required reports and approvals (payroll, timesheets, expenses) accurately and on time", who: "manager" },
          { key: "keeps_supervisor_informed", type: "yesno", label: "Keeps their Supervisor informed of branch results, problems, and risks", who: "manager" },
          { key: "unclear_processes", type: "choice", options: YN, label: "Is anything unclear about company processes or expectations?", who: "employee" },
          { key: "unclear_explain", type: "textarea", label: "If yes, please explain", who: "employee" },
          { key: "feedback_manager", type: "textarea", label: "Any feedback for your supervisor or the company?", who: "employee" },
        ],
      },
      {
        title: "Attendance & Reliability",
        items: [
          { key: "present", type: "yesno", label: "Consistently present and available during branch hours", who: "manager" },
          { key: "coverage", type: "yesno", label: "Follows scheduling and time-off procedures and ensures branch coverage", who: "manager" },
          { key: "follows_through", type: "yesno", label: "Follows through on commitments without needing follow-up", who: "manager" },
        ],
      },
      {
        title: "Overall Performance & Future Growth",
        items: [
          { key: "overall_rating", type: "choice", options: RATING, label: "Overall performance at 60 days", who: "manager" },
          { key: "comfort", type: "choice", options: COMFORT, label: "How comfortable do you feel in the role so far?", who: "employee" },
          { key: "on_track_90", type: "choice", options: YN, label: "On track to meet expectations at the 90-Day Review?", who: "employee" },
          { key: "on_track_help", type: "textarea", label: "If no, what is needed to help?", who: "employee" },
          { key: "priorities_goals", type: "textarea", label: "Branch priorities and goals leading into the 90-Day Review", who: "manager" },
        ],
      },
      {
        title: "Summary",
        items: [
          { key: "recommendation", type: "choice", options: RECOMMENDATION, label: "End-of-probation recommendation", who: "manager", added: true },
          { key: "goals_next", type: "textarea", label: "Goals for the next 90 days", who: "manager", added: true },
          { key: "next_steps", type: "textarea", label: "Next steps & action plan", who: "manager" },
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Corporate Employee — the CATCH-ALL. Any new hire who isn't a Technician,
// Service Advisor, CSR, or Branch Manager (coordinators, directors, marketing,
// chief of staff, etc.) gets this. Carries Department + Work Location fields in
// place of a branch. Mirrors the HR director's Corporate Employee PDFs.
// ---------------------------------------------------------------------------
const WORK_LOCATION = ["Corporate Office – Vero Beach", "Hybrid", "Remote", "Other"];

const CORPORATE: Record<ReviewType, ReviewForm> = {
  "30_day": {
    title: "30-Day Corporate Employee Review",
    sections: [
      {
        title: "Onboarding & Training",
        items: [
          { key: "department", type: "text", label: "Department", who: "manager" },
          { key: "work_location", type: "choice", options: WORK_LOCATION, label: "Work location", who: "manager" },
          { key: "onboarding_complete", type: "yesno", label: "Completed all required onboarding training and new-hire paperwork", who: "manager" },
          { key: "understands_policies", type: "yesno", label: "Demonstrates understanding of company policies, procedures, and the employee handbook", who: "manager" },
          { key: "enough_training", type: "choice", options: YN, label: "Have you received enough training to do your job effectively?", who: "employee" },
          { key: "training_needed", type: "textarea", label: "If not, what additional training would help?", who: "employee" },
          { key: "has_tools", type: "choice", options: YN, label: "Do you have the tools, systems access, and resources needed to perform your job (computer, email, phone, PestPac, software logins, etc.)?", who: "employee" },
          { key: "intro_contacts", type: "yesno", label: "Introduced to key contacts in other departments and branch locations", who: "manager" },
        ],
      },
      {
        title: "Job Performance & Competency",
        items: [
          { key: "understands_role", type: "yesno", label: "Understands the core responsibilities and priorities of the role", who: "manager" },
          { key: "accurate_ontime", type: "yesno", label: "Completes assigned tasks accurately and on time", who: "manager" },
          { key: "attention_detail", type: "yesno", label: "Demonstrates attention to detail and quality in their work", who: "manager" },
          { key: "learning_systems", type: "yesno", label: "Learning company systems and software (PestPac, Microsoft Office, etc.) at the expected pace", who: "manager" },
          { key: "understands_support", type: "yesno", label: "Understands how their role supports branch operations, field teams, and customers", who: "manager" },
          { key: "confidentiality", type: "yesno", label: "Follows confidentiality procedures for customer, employee, and financial information", who: "manager" },
          { key: "dress_code", type: "yesno", label: "Follows the dress code and maintains a professional appearance", who: "manager" },
          { key: "responsibilities_match", type: "yesno", label: "Job responsibilities have matched what was expected", who: "manager" },
          { key: "mastered", type: "text", label: "Tasks / skills mastered", who: "employee" },
          { key: "challenging", type: "text", label: "Tasks / skills still challenging", who: "employee" },
        ],
      },
      {
        title: "Goals & Key Deliverables",
        items: [
          { key: "key_projects", type: "text", label: "Key projects / tasks assigned to date", who: "manager" },
          { key: "progress_goals", type: "text", label: "Progress on 30-day goals", who: "manager" },
          { key: "on_track_goals", type: "yesno", label: "On track to meet the goals and expectations set at hire", who: "manager" },
          { key: "manages_workload", type: "yesno", label: "Manages workload and prioritizes tasks effectively", who: "manager" },
          { key: "asks_help", type: "yesno", label: "Asks for clarification or help when needed", who: "manager" },
          { key: "understands_pay", type: "yesno", label: "Demonstrates a clear understanding of their pay, benefits, and timekeeping/pay schedule", who: "manager" },
        ],
      },
      {
        title: "Internal & External Customer Service",
        items: [
          { key: "no_complaints", type: "yesno", label: "No complaints from customers, branches, or coworkers", who: "manager" },
          { key: "professional_comm", type: "yesno", label: "Communicates professionally by phone, email, and in person", who: "manager" },
          { key: "responds_promptly", type: "yesno", label: "Responds to branch, field team, and customer requests promptly and helpfully", who: "manager" },
          { key: "cs_challenges", type: "textarea", label: "What challenges have you faced with internal or external customers, and how have you addressed them?", who: "employee" },
        ],
      },
      {
        title: "Teamwork & Communication",
        items: [
          { key: "respectful", type: "yesno", label: "Respectful & professional with corporate staff, branch managers, technicians, and coworkers", who: "manager" },
          { key: "timely_comm", type: "yesno", label: "Responds to emails, messages, and calls in a timely manner", who: "manager" },
          { key: "reports_issues", type: "yesno", label: "Reports issues and concerns appropriately and through the proper channels", who: "manager" },
          { key: "collaborates", type: "yesno", label: "Collaborates effectively with other departments", who: "manager" },
          { key: "unclear_processes", type: "choice", options: YN, label: "Is anything unclear about company processes or expectations?", who: "employee" },
          { key: "unclear_explain", type: "textarea", label: "If yes, please explain", who: "employee" },
          { key: "feedback_manager", type: "textarea", label: "Any feedback for your manager or the company?", who: "employee" },
        ],
      },
      {
        title: "Attendance & Reliability",
        items: [
          { key: "on_time", type: "yesno", label: "Consistently on time for scheduled work hours and meetings", who: "manager" },
          { key: "callout_procedures", type: "yesno", label: "Adheres to scheduling, time-off request, and call-out procedures", who: "manager" },
          { key: "timekeeping", type: "yesno", label: "Follows timekeeping procedures accurately (clocking in/out, breaks)", who: "manager" },
          { key: "meets_deadlines", type: "yesno", label: "Meets deadlines and follows through on commitments", who: "manager" },
        ],
      },
      {
        title: "Overall Experience & Future Growth",
        items: [
          { key: "comfort", type: "choice", options: COMFORT, label: "How comfortable do you feel in the role so far?", who: "employee" },
          { key: "on_track", type: "choice", options: YN, label: "On track to meet expectations at the 60- and 90-day marks?", who: "employee" },
          { key: "on_track_help", type: "textarea", label: "If no, what is needed to help?", who: "employee" },
          { key: "goals_focus", type: "textarea", label: "Goals and focus areas for the next 30–60 days", who: "manager" },
        ],
      },
      {
        title: "Summary",
        items: [
          { key: "overall_rating", type: "choice", options: RATING, label: "Overall performance rating", who: "manager", added: true },
          { key: "goals_next", type: "textarea", label: "Goals for the next 30 days", who: "manager", added: true },
          { key: "next_steps", type: "textarea", label: "Next steps & action plan", who: "manager" },
        ],
      },
    ],
  },
  "60_day": {
    title: "60-Day Corporate Employee Review",
    sections: [
      {
        title: "Follow-Up from 30-Day Review",
        items: [
          { key: "department", type: "text", label: "Department", who: "manager" },
          { key: "work_location", type: "choice", options: WORK_LOCATION, label: "Work location", who: "manager" },
          { key: "training_addressed", type: "yesno", label: "Training needs identified at the 30-Day Review have been addressed", who: "manager" },
          { key: "goals_on_track", type: "yesno", label: "Goals set at the 30-Day Review have been met or are on track", who: "manager" },
          { key: "has_tools", type: "yesno", label: "Now has all the tools, systems access, and resources needed to perform the job", who: "manager" },
          { key: "concerns_resolved", type: "yesno", label: "Concerns or questions raised at the 30-Day Review have been resolved", who: "manager" },
          { key: "followup_summary", type: "textarea", label: "Summarize progress on items from the 30-Day Review, and note anything still open", who: "manager" },
        ],
      },
      {
        title: "Job Performance & Competency",
        items: [
          { key: "independent", type: "yesno", label: "Performs core job duties independently with minimal supervision", who: "manager" },
          { key: "accurate_ontime", type: "yesno", label: "Consistently completes work accurately and on time", who: "manager" },
          { key: "proficient_systems", type: "yesno", label: "Proficient in the company systems and software used in the role (PestPac, Microsoft Office, etc.)", who: "manager" },
          { key: "applies_policies", type: "yesno", label: "Applies company policies and procedures correctly without needing reminders", who: "manager" },
          { key: "solves_problems", type: "yesno", label: "Solves routine problems on their own and knows when to escalate issues", who: "manager" },
          { key: "confidentiality", type: "yesno", label: "Follows confidentiality procedures for customer, employee, and financial information", who: "manager" },
          { key: "dress_code", type: "yesno", label: "Follows the dress code and maintains a professional appearance", who: "manager" },
          { key: "mastered", type: "text", label: "Tasks / skills mastered since the 30-Day Review", who: "employee" },
          { key: "still_developing", type: "text", label: "Tasks / skills still developing", who: "employee" },
        ],
      },
      {
        title: "Goals & Key Deliverables",
        items: [
          { key: "key_projects", type: "text", label: "Key projects / tasks completed since 30-Day Review", who: "manager" },
          { key: "progress_goals", type: "text", label: "Progress on 60-day goals", who: "manager" },
          { key: "meeting_goals", type: "yesno", label: "Meeting the goals and expectations for the role", who: "manager" },
          { key: "manages_workload", type: "yesno", label: "Manages workload, prioritizes effectively, and meets deadlines", who: "manager" },
          { key: "takes_initiative", type: "yesno", label: "Takes initiative, such as suggesting improvements or taking on new tasks", who: "manager" },
          { key: "accepts_feedback", type: "yesno", label: "Accepts feedback and applies it to their work", who: "manager" },
        ],
      },
      {
        title: "Internal & External Customer Service",
        items: [
          { key: "no_complaints", type: "yesno", label: "No complaints from customers, branches, or coworkers", who: "manager" },
          { key: "positive_relationships", type: "yesno", label: "Has built positive working relationships with branch staff and field teams", who: "manager" },
          { key: "handles_difficult", type: "yesno", label: "Handles difficult requests or situations professionally", who: "manager" },
          { key: "cs_challenges", type: "textarea", label: "What challenges have you faced with internal or external customers, and how have you addressed them?", who: "employee" },
        ],
      },
      {
        title: "Teamwork & Communication",
        items: [
          { key: "respectful", type: "yesno", label: "Respectful & professional with corporate staff, branch managers, technicians, and coworkers", who: "manager" },
          { key: "timely_comm", type: "yesno", label: "Responds to emails, messages, and calls in a timely manner", who: "manager" },
          { key: "keeps_informed", type: "yesno", label: "Keeps their Manager informed of progress, problems, and deadlines", who: "manager" },
          { key: "collaborates", type: "yesno", label: "Collaborates effectively with other departments", who: "manager" },
          { key: "unclear_processes", type: "choice", options: YN, label: "Is anything unclear about company processes or expectations?", who: "employee" },
          { key: "unclear_explain", type: "textarea", label: "If yes, please explain", who: "employee" },
          { key: "feedback_manager", type: "textarea", label: "Any feedback for your manager or the company?", who: "employee" },
        ],
      },
      {
        title: "Attendance & Reliability",
        items: [
          { key: "on_time", type: "yesno", label: "Consistently on time for scheduled work hours and meetings", who: "manager" },
          { key: "callout_procedures", type: "yesno", label: "Adheres to scheduling, time-off request, and call-out procedures", who: "manager" },
          { key: "timekeeping", type: "yesno", label: "Follows timekeeping procedures accurately (clocking in/out, breaks)", who: "manager" },
          { key: "follows_through", type: "yesno", label: "Follows through on commitments without needing follow-up", who: "manager" },
        ],
      },
      {
        title: "Overall Performance & Future Growth",
        items: [
          { key: "overall_rating", type: "choice", options: RATING, label: "Overall performance at 60 days", who: "manager" },
          { key: "comfort", type: "choice", options: COMFORT, label: "How comfortable do you feel in the role so far?", who: "employee" },
          { key: "on_track", type: "choice", options: YN, label: "On track to meet expectations at the 90-Day Review?", who: "employee" },
          { key: "on_track_help", type: "textarea", label: "If no, what is needed to help?", who: "employee" },
          { key: "strengths", type: "textarea", label: "Strengths to build on", who: "manager" },
          { key: "goals_focus", type: "textarea", label: "Goals and focus areas leading into the 90-Day Review", who: "manager" },
        ],
      },
      {
        title: "Summary",
        items: [
          { key: "recommendation", type: "choice", options: RECOMMENDATION, label: "End-of-probation recommendation", who: "manager", added: true },
          { key: "goals_next", type: "textarea", label: "Goals for the next 90 days", who: "manager", added: true },
          { key: "next_steps", type: "textarea", label: "Next steps & action plan", who: "manager" },
        ],
      },
    ],
  },
};

/** Role-specific review forms, keyed by template then by milestone. */
export const REVIEW_FORMS: Record<ReviewTemplateKey, Record<ReviewType, ReviewForm>> = {
  technician: TECHNICIAN,
  service_advisor: SERVICE_ADVISOR,
  csr: CSR,
  branch_manager: BRANCH_MANAGER,
  corporate: CORPORATE,
};

/** The templates HR can pick from (dropdown order + labels). */
export const REVIEW_TEMPLATES: { key: ReviewTemplateKey; label: string }[] = [
  { key: "technician", label: "Technician" },
  { key: "service_advisor", label: "Service Advisor" },
  { key: "csr", label: "Customer Service Representative" },
  { key: "branch_manager", label: "Branch Manager" },
  { key: "corporate", label: "Corporate Employee" },
];

export function templateLabel(key: string | null | undefined): string {
  return REVIEW_TEMPLATES.find((t) => t.key === key)?.label ?? "Corporate Employee";
}

const TEMPLATE_KEYS = new Set<string>(REVIEW_TEMPLATES.map((t) => t.key));
export function isReviewTemplate(key: string | null | undefined): key is ReviewTemplateKey {
  return !!key && TEMPLATE_KEYS.has(key);
}

/**
 * Resolve the review form for an employee from their access level, then role /
 * title keywords. **Corporate Employee is the catch-all** — anyone who isn't a
 * Technician, Service Advisor, CSR, or Branch Manager defaults to it (e.g. a
 * coordinator, director, marketing assistant, or chief of staff). HR can always
 * override the resolved form. Accepts the employee's own `accessLevel` or, failing
 * that, their login's.
 */
export function templateForEmployee(e: {
  accessLevel?: string | null;
  role?: string | null;
  title?: string | null;
  user?: { accessLevel?: string | null } | null;
}): ReviewTemplateKey {
  const accessLevel = e.accessLevel ?? e.user?.accessLevel ?? null;
  if (accessLevel === "technician") return "technician";
  if (accessLevel === "sales") return "service_advisor";
  if (accessLevel === "csr") return "csr";
  if (accessLevel === "manager") return "branch_manager";

  const hay = `${e.role ?? ""} ${e.title ?? ""}`;
  if (/branch manager|branch mgr/i.test(hay)) return "branch_manager";
  if (/tech/i.test(hay)) return "technician";
  if (/service advisor|sales advisor|\bsales\b/i.test(hay)) return "service_advisor";
  if (/csr|customer service/i.test(hay)) return "csr";
  // Catch-all: coordinators, directors, corporate/office staff, and anyone else.
  return "corporate";
}

/** The resolved form for a (template, type), falling back to the technician form. */
export function getReviewForm(template: string | null | undefined, type: string): ReviewForm {
  const key: ReviewTemplateKey = isReviewTemplate(template) ? template : "technician";
  const milestone: ReviewType = type === "60_day" ? "60_day" : "30_day";
  return REVIEW_FORMS[key][milestone];
}

export const REVIEW_LABEL: Record<string, string> = { "30_day": "30-Day Review", "60_day": "60-Day Review" };
export const STATUS_LABEL: Record<string, string> = {
  due: "Due — awaiting HR",
  sent: "Sent to reviewer",
  in_progress: "In progress",
  pending_approval: "Pending HR approval",
  completed: "Completed",
};

export function dueFromStart(start: Date, type: string): Date {
  const days = type === "60_day" ? 60 : 30;
  return new Date(start.getTime() + days * 864e5);
}

export function parseResponses(s: string | null | undefined): Record<string, string> {
  if (!s) return {};
  try {
    return JSON.parse(s) as Record<string, string>;
  } catch {
    return {};
  }
}
