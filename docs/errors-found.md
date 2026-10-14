# Errors found in the packet, and how the workpaper surfaces them

Every item below is a conflict that exists in the supplied packet. Trace does
not decide tax law; it puts the printed evidence, the extracted value and the
engine's number side by side, estimates the effect of a correction at the
version's supplied rates, and routes the decision to a person with the right
role. "Surfaced by" names the screen where a reviewer meets the conflict
without being told where to look.

## Confirmed discrepancies

| # | What the packet does | Evidence | Surfaced by | Candidate correction (reviewer decides) |
|---|---|---|---|---|
| E01 | Childcare provider EIN extracted as 74-3829516 at 97 percent confidence | D62 page 1 prints 74-3829156 | Evidence page for D62: the extracted value is marked "not found on page" and the printed Tax ID is highlighted beside it; the line inspector shows the label carrying the wrong digits | Label change on F2441.1b; zero tax effect; the anchor must quote the printed digits |
| E02 | Bank sweep interest counted twice | D28 page 1 and D29 page 1 both describe the account ending 7731 and 1,840 of interest; SchB.1.1 and SchB.1.2 each carry it | Evidence index shows both documents feeding Schedule B; investments area lists both lines; search for "7731" finds both pages | Reduce interest by 1,840 and link both documents to one economic item; neither document is deleted |
| E03 | Payment-card revenue added to books that already include it | D14 page 1 total income 151,300; D15 page 3 says the 12,400 Paywell receipts are inside that total; D21 reports the same 12,400 | Books-to-tax bridge shows 12,400 of receipts "on the return not in books"; the line inspector for SchC.1 lists all seven sources; search for "Paywell" lands on the D15 passage | SchC.1 163,700 to 151,300; estimated effect federal -4,402 and California -384.40 at v3 rates; partner approval required |
| E04 | Mileage log page scanned twice | D23 page 3 says "second scan" of page 2; the engine sums all four page totals to 11,800 miles | Evidence page for D23 page 3 shows the duplicate page feeding SchC.44a and, transitively, SchC.9 | Miles 8,100; deduction 5,670 through the verified mileage formula; profit up 2,590 |
| E05 to E07 | RSU lots N1, N3, N4 use zero basis | D11 page 2 supplies adjusted basis 19,100, 19,100 and 9,420 (ev-0066, ev-0068, ev-0070) and no return line uses them | Evidence page for D11 shows the matched ESPP use and the unmatched RSU values; the sales record flags each lot beside its supplemental basis | Gains 140, -620 and 5,880; N2 (ESPP) is already correct and is shown as such |
| E08 | Meridian lot M18 printed but never extracted | D31 page 32 prints proceeds 250 and basis 310; the pipeline reported the page unread | Evidence page for D31 page 32 shows "nothing was extracted" and offers the exact-text anchor; the sales record calls out the lot | Add a manually verified lot with a page anchor; loss 60; D30 stays visible as superseded |
| E09 | Foreign interest converted at last year's rate | SchB.1.6 cites ref:fx.SEK.2024_average (10.56); the packet supplies 9.86 for 2025 | Line inspector for SchB.1.6 lists the rate reference; the retirement and foreign record shows the alternative figure 1,871 as an identified rate choice | Document the rate decision; the year-end rate for Form 8938 is a separate parameter |
| E10 | Mortgage payoff interest counted twice | D55 page 1 says its 13,900 includes interest paid at payoff; D56 adds a separate 2,150 | Deductions record shows each 1098 and the payoff statement with the duplicate-risk callout | SchA.8a 21,847 to 19,697 before the separate refinance points |
| E11 | Federal estimated payments credit disagrees with the IRS | F1040.26 is 13,000 including the questionnaire's uncertain 4,000; the March transcript shows four payments of 3,000 | Payments record reconciles each payment to the transcript available at the clock; the 1,000 difference is called out | Payment category correction: balance due rises 1,000, tax unchanged |
| E12 | California payment credited to the wrong year | D68 and the FTB account assign September's 3,500 to 2024; only 10,500 is credited to 2025 | Payments record shows the 2024-designated payment separately | F540NR.72 14,000 to 10,500; a transfer request is tracked as a request, not assumed |
| E13 | Dependent identifier conflicts with the prior return | Organizer ends 3309; D06 ends 3390; D71 (received July 13) confirms 3390 | Firm page identity block (masked, reveal logged); the scripted e-file rejection R0000-504-02 reopens the file; D71 becomes available only when the clock passes July 13 | Judgment on household:theo citing D71, msg-10 and D06; re-present, re-approve, resubmit |
| E14 | Utilities deducted in full | call-01 documents phone at 70 percent and internet at 50 percent business use | Evidence client items show the call note cited by SchC.25; the bridge isolates the 1,308 difference once accepted | SchC.25 3,480 to 2,172; profit up 1,308 |
| E15 | Personal subscription left in business software | D15 page 1 shows Spotify 216; call-01 says it is personal | Bridge and line inspector for SchC.27a.1 | SchC.27a.1 6,850 to 6,634 |
| E16 | Care provider name wrong on the return | F2441.1a says Bright Oak Preschool; D61 says Bright Oak Kids Club | Evidence page for D61 beside the line label | Label change; amount and EIN unchanged |

## Judgment items the app records but does not decide

Health insurance eligibility (Sch1.17 and qa-25), HVAC repair versus
improvement (SchE.14A, D47, the supplied what-if), vehicle donation value
(F8283 and D66), property tax seller credit (SchA.5b and D54), California
wage sourcing (SchCA540NR.1.E against D73), the SEP limit gap (Sch1.16 and
D26), the C6 crypto basis (msg-07, available only after June 30), the
low-confidence parish receipt (ev-1049, corroborated by msg-08 in July),
California AMT not computed (F540NR.61 shown as "not computed", never
"verified zero"), the prior-year Form 3520 and FBAR as outside filings, the
contractor information returns, Form 8867 due diligence, and the partnership
outside basis that stays unknown. Each is offered on the judgments screen
with its evidence and recorded with the authority relied on.

## Controls that are already right

The duplicate W-2 image (D10) is counted once; the ESPP lot already carries
its basis adjustment; the IRA prior basis of 7,000 is carried despite the
questionnaire; the late 2023 S corporation K-1 and the late partnership K-1
are in v3; the parish receipt is corroborated rather than disproved; all 260
Brightpath lot gains agree with the printed detail. Trace shows these as
verified evidence, not as findings, so the queue stays honest.

## How the design makes these visible

Printed text and extracted values are stored and rendered separately, every
return line keeps its source references and inputs, the reference graph can be
walked from any document to every line it reached (or did not), adjustments
carry an estimated effect with limitations, sign-offs reopen when evidence
changes, and the replay clock keeps later evidence out of earlier decisions.
