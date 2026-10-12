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
export type ReviewTemplateKey = "technician" | "service_advisor" | "csr";
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

/** Role-specific review forms, keyed by template then by milestone. */
export const REVIEW_FORMS: Record<ReviewTemplateKey, Record<ReviewType, ReviewForm>> = {
  technician: TECHNICIAN,
  service_advisor: SERVICE_ADVISOR,
  csr: CSR,
};

/** The templates HR can pick from (dropdown order + labels). */
export const REVIEW_TEMPLATES: { key: ReviewTemplateKey; label: string }[] = [
  { key: "technician", label: "Technician" },
  { key: "service_advisor", label: "Service Advisor" },
  { key: "csr", label: "Customer Service Representative" },
];

export function templateLabel(key: string | null | undefined): string {
  return REVIEW_TEMPLATES.find((t) => t.key === key)?.label ?? "Technician";
}

const TEMPLATE_KEYS = new Set<string>(REVIEW_TEMPLATES.map((t) => t.key));
export function isReviewTemplate(key: string | null | undefined): key is ReviewTemplateKey {
  return !!key && TEMPLATE_KEYS.has(key);
}

/**
 * Resolve the review form for an employee from their access level, then role /
 * title keywords. Returns null for an off-list role (HR then picks the form).
 * Accepts the employee's own `accessLevel` or, failing that, their login's.
 */
export function templateForEmployee(e: {
  accessLevel?: string | null;
  role?: string | null;
  title?: string | null;
  user?: { accessLevel?: string | null } | null;
}): ReviewTemplateKey | null {
  const accessLevel = e.accessLevel ?? e.user?.accessLevel ?? null;
  if (accessLevel === "technician") return "technician";
  if (accessLevel === "sales") return "service_advisor";
  if (accessLevel === "csr") return "csr";

  const hay = `${e.role ?? ""} ${e.title ?? ""}`;
  if (/tech/i.test(hay)) return "technician";
  if (/service advisor|sales advisor|\bsales\b/i.test(hay)) return "service_advisor";
  if (/csr|customer service/i.test(hay)) return "csr";
  return null;
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
