# Suggested updates — for HR/legal review

**Internal review note. NOT shown to employees and NOT part of the published handbook.**

While transcribing the 2025 Employee Handbook into the portal (version 1), the policy
language was preserved **verbatim** — nothing below was changed inline. This note flags
wording that HR and employment counsel may want to review. Each item is a *question to
confirm*, not a statement that the current policy is wrong. Line references are to the
handbook's section titles.

## Potentially legally risky — recommend counsel review first

1. **Weapons in the Workplace — firearms in a personal vehicle.** The policy prohibits
   possession "in a private vehicle parked on Company property." Florida's *Preservation and
   Protection of the Right to Keep and Bear Arms in Motor Vehicles Act* (Fla. Stat. § 790.251)
   generally bars employers from prohibiting employees from keeping a lawfully-possessed
   firearm locked inside their own vehicle in the parking lot. Recommend carving out the
   locked-personal-vehicle scenario to align with the statute.

2. **"We will resist formal organization" (Working Together).** This phrasing, and parts of
   the confidentiality, no-solicitation, social-media, and e-mail-monitoring policies, could
   be read to chill activity protected by Section 7 of the National Labor Relations Act. The
   handbook already includes an NLRA savings clause in the Disclaimer; counsel should confirm
   the operative sections are consistent with it (or soften the "resist organization" wording).

3. **Final-paycheck deductions for lost/damaged property, parking tickets, and unreturned
   equipment** (Final Paycheck; Traffic Violations; Mobile Device Policy). Deductions that
   reduce pay below the FLSA minimum wage, or that are taken without proper written
   authorization, can create wage-and-hour exposure. Recommend confirming each deduction is
   authorized and minimum-wage-compliant.

4. **Drug-Free Workplace / drug testing.** Florida's Drug-Free Workplace Program (§§ 440.101–
   440.102) has specific prerequisites for the workers'-comp premium credit and testing
   protections — a posted policy, **60 days' advance notice** before implementing testing, an
   EAP resource list, and defined testing circumstances. "Random drug testing" of all
   employees and medical-marijuana / lawful off-duty use should be reviewed against the
   statute and current Florida case law.

5. **Non-Solicitation Agreements (two years).** Enforceability of restrictive covenants in
   Florida turns on reasonableness under § 542.335. Counsel should confirm the two-year
   duration and scope are supportable for the roles being asked to sign.

## Possibly outdated / needs a factual confirmation

6. **FMLA-style leave entitlement (Family, Medical and Military Leave).** The 12-week / 1,250-
   hour language mirrors the FMLA, which applies only to employers with 50+ employees within
   75 miles. Confirm Clements meets the coverage threshold; if not, the entitlement language
   may overstate obligations and should be reframed as a company policy rather than "FMLA."

7. **Parental Leave "job protection."** The policy states leave is "job-protected in
   accordance with applicable federal and state law." If FMLA does not apply (see #6), confirm
   what statute provides the protection so the promise is accurate.

8. **Pre-employment "personality profiling" and skills assessment (How and Why You Were
   Selected).** Confirm any assessment is job-validated and does not constitute a prohibited
   pre-offer medical/disability inquiry under the ADA/EEOC guidance.

9. **Hands-free / Bluetooth prohibition citing the FMCSA (Use of Company Vehicles).** The
   FMCSA hand-held rules apply to commercial motor vehicles / CDL drivers. If Clements'
   service vehicles are not CMVs, the citation may be inaccurate — the safety rule can stand
   on its own as company policy without attributing it to the FMCSA.

10. **E-mail/Voice Mail password disclosure.** "Any password used by employees must be
    revealed to the Company" is appropriate for company systems, but should be scoped so it
    cannot be read to reach employees' **personal** accounts (Stored Communications Act risk).

## Consistency / clarity clean-ups (non-substantive)

11. **PTO forfeiture wording appears in three places** (Resignation, Final Paycheck, and both
    PTO appendices). They are consistent but worth a single cross-check to ensure the
    "forfeited regardless of voluntary/involuntary" rule and the "request payout by October 1"
    rule read together without ambiguity.

12. **At-will vs. progressive discipline.** The Progressive Discipline and General Rules
    sections describe escalating steps; the Disclaimer preserves at-will. Confirm the
    "four write-ups in twelve months = termination" mechanic is intended to be a floor, not a
    guarantee of process, so it does not read as an implied contract.

13. **Two PTO appendices** (Commission technicians vs. Salary team members) duplicate several
    rules with slightly different request-timing windows. A short table comparing the two
    tracks would reduce the risk of a technician applying the wrong deadline.

14. **Typos observed and left as-is** (policy language preserved): "onbaording"
    (Onboarding section of the Manager Manual, not this handbook), "eight- hour" style
    hyphen-spacing was a PDF artifact and was cleaned during transcription. No wording was
    altered.

## Portal-reconciliation pass — July 21, 2026 (Version 2)

*Added during the workflow-registry / doc-reconciliation audit. See `docs/DOC-RECONCILIATION.md`.*

15. **PTO request channel corrected inline (the ONE inline change in v2).** The two PTO
    appendices previously said requests "must be submitted **via Paychex Flex**." The portal
    now owns PTO requests (My PTO → request → branch-supervisor approval → team/company
    calendar; `lib/pto.ts`, `/api/pto`), and the handbook's own "Using the Clements Portal"
    section already states this. To remove the internal contradiction, the submission
    **mechanic** was corrected to "through the Clements portal" in both appendices. **Only the
    channel changed** — the 2-week / 3-week advance-notice windows and every other PTO rule
    (allotment, rollover, payout, forfeiture, cap) are verbatim. Because this is a wording
    change to a signed document, the handbook was bumped to **Version 2** and **every employee
    who acknowledged v1 will be re-prompted to acknowledge v2**. *HR/legal: confirm you accept
    the re-acknowledgment and that "the Clements portal" is the correct name to print.*

16. **Paychex is still the system of record for payroll, 401(k), and time/attendance.** The
    portal took over only PTO *requests*. Paychex Flex references elsewhere (401(k) enrollment;
    the "web clock" / time-sheet mechanics in General Rules) were **left unchanged** because
    those functions did not move. HR should confirm this split is described the way it operates
    (e.g., that sick-time and web-clock entries are still Paychex, not the portal).

17. **Sick-day / absence reporting mechanic — verify.** Both PTO appendices require sick
    absences to be reported "by phone call" to the Branch Manager/Supervisor. This mechanic was
    **not** changed; the portal does not capture sick-day call-outs. Confirm whether leadership
    wants call-outs logged anywhere in the portal or kept as the phone-call procedure.

18. **"Posting Work to Mobile App" (PestPac) unchanged.** The field-service logging policy still
    references PestPac Mobile, which remains accurate — the Command & Control portal does not
    track per-stop service. Left as-is (no portal mechanic to reconcile).
