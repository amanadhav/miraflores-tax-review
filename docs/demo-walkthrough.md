# Demo walkthrough

A fresh visitor can run this path from the landing page in about twelve
minutes. Each step names the screen, what to click, and what the app proves.
Every action persists; reload any page to see the saved state, and open the
same workspace in a second browser (Join with the workspace id in the header)
to watch two people work at once.

## 1. Start (landing page)

Click **Start workspace**. You get your own copy of the engagement at return
version v3 (June 23, 2026) acting as Priya, the assigned preparer. The packet
is loaded exactly as delivered; the hash is on the landing page.

## 2. Overview

The engine baseline sits on the left, accepted changes with estimated effects
in the middle, and the findings that block filing on the right. The review
areas table shows open findings, proposals, stale lines and sign-off state per
area. Nothing here claims a corrected final tax.

## 3. E01: confidence is not verification (Evidence)

Open **Evidence**, then **D62**. The simulated page prints Tax ID 74-3829156;
the extracted value panel shows 74-3829516 at 97 percent confidence, marked
"not found on page" beside the printed digits. Add an anchor quoting the
printed Tax ID (try quoting the extracted digits first: the server refuses
text that is not on the page). Open the line F2441.1b from "Where this page
landed" and propose a label change citing D62.

## 4. E03: books to tax (Review)

Open **Review**, area **Business**, line **SchC.1**. Sources list the books
total income (151,300) and the 1099-K (12,400). Propose 163,700 to 151,300 with
category Schedule C profit; the server returns an estimated effect of
federal -4,402 and California -384.40 and flags partner approval. Open
**Review > Bridge**: the bridge shows the 12,400 of receipts not in books.

## 5. Roles and no self-review

Switch persona to Daniel (reviewer) and try to accept: refused, partner
approval required. Switch to Helen (partner) and accept: SchC.31 recomputes to
69,454 through the verified sum formulas, Schedule SE and QBI lines show
**stale**, and the Overview's estimated effect updates. Switch back to Priya
and try to sign off the business area as reviewer: refused, she prepared it.
As Daniel, sign off the business area, then add an anchor as Priya: Daniel's
sign-off reopens with the reason "an evidence link changed"; California's
stays active.

## 6. Two people at once

Open a second browser, Join the workspace as Daniel. Make a change in each
browser from the same revision: one wins, the other sees "someone else changed
the workpaper" with the list of what changed, and nothing is overwritten.

## 7. Sensitive data

Switch to Marcus (no clearance). The Firm page, searches and evidence pages
show masked identifiers; a reveal attempt is refused and logged. Switch to
Daniel, reveal one SSN: it shows for thirty seconds and the view log records
it.

## 8. Replay time and client evidence

Open **Changes > Timeline**. msg-07 (the crypto basis answer) is in the
future on June 23; try citing it in a proposal and the server names the date
it arrives. Advance the clock to June 30 and it becomes evidence.

## 9. Questions that become evidence

Open **People > Requests**, ask Ngozi about the C6 lot. Switch to Ngozi
(client): the client page shows only her request; reply with an attachment.
Back as Priya, the reply is a citable reference (reply:...) in a proposal.

## 10. Filing, rejection, correction, freeze

Open **Filing**. The checklist is the firm's required steps evaluated from
records. Work through them (batch-explain variances, record due diligence,
disposition the unused documents), sign off the whole return as Daniel and
Helen, present to the client, approve as both spouses, submit as Helen. The
workpaper is frozen. Replay the packet's federal rejection (R0000-504-02):
the file reopens; advance the clock to July 13 so D71 is available; record
the identifier judgment; re-present, re-approve, resubmit; replay both
acceptances; the return is frozen for good and later edits are refused.
Start an amendment: a new workspace branches from the accepted snapshot.

## 11. Exports

From Filing, download the client copy (self-contained HTML with the frozen
values, decisions and manifest hashes) and, after advancing the clock to
2028, the notice bundle scoped to the examination items. Disconnect and open
them: everything inside is readable without the app.

## Reset

Start workspace on the landing page creates a fresh copy; other visitors'
workspaces are untouched.
