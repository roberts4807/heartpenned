# HeartPenned: notes for Claude

HeartPenned (heartpenned.com) is an AI greeting-card web app owned by Robert. The site is mostly one file, `index.html`, plus serverless functions in `api/`. `main` auto-deploys to Vercel.

## Workflow (always follow)

1. Start a new branch from the latest `main`, named `topic-MM.DD.YY` (e.g. `new-headers-11.16.26`). Never commit to `main`.
2. Make the changes, run the checks below, commit, push.
3. Robert tests the Vercel preview (make a card and download the PDF).
4. When he confirms, open a PR. **Robert merges; Claude never merges.** Robert deletes the branch after merging.

### Checks before every push

- `index.html` still ends with `</html>`.
- Every inline `<script>` block passes `node --check` (extract each block to a .js file and check it).
- For header changes: no duplicate `id` in `CARD_HEADERS`, no duplicate `label` within an occasion, and every `image` resolves to a `.jpg` in `public/headers/`.

### Git and GitHub in a Claude session

- Clone shallow; push with `git -c push.negotiate=true push -u origin BRANCH`.
- GitHub GraphQL is blocked, so `gh pr create` fails. Use REST: `gh api repos/roberts4807/heartpenned/pulls -f title=... -f head=BRANCH -f base=main -F body=@file`.
- End PR descriptions with the Claude Code attribution line.

## Card-writing rules Robert cares about

- Never assume anything about anyone's personality or character unless the sender typed it.
- No jokes about an illness, injury or treatment, at any seriousness level.
- When the sender gives little, lean classic (store-card style), not invented detail.
- Any prompt change for one occasion must leave every other occasion's prompt unchanged. Check by building the prompt with old and new `api/generate.js` for the same inputs and diffing.
- Show Robert new screen wording and prompt text before building.

## Occasion modes

- `OCC_MODES` in `index.html` gives some occasions their own flow: Sympathy (`key: 'loss'`, details page `q9s`), Get well (`'getwell'`, `q9g`), Apology (`'apology'`, `q9a`), and Thinking of you when "What's behind it?" is "Going through a hard time" (`'Thinking of you: hard time'`, `'hardtime'`, `q9t`; `occMode()` picks it from `A.tyReason`). Each sets its own tone chips (choose one), feel chips, a details page in place of "Tell us about them" (no "Keep it classic" pop-up), whether "What's your relationship like?" is optional, and which relationship chips show. Occasions not listed use the regular flow.
- Mode tone and feel chips are built from those lists; the regular ones are the HTML in `#qc6` and `#qc8`.
- Details-page answers go to the server as `A.loss`, `A.getwell`, `A.apology` or `A.hardtime`.
- Thinking of you always asks "What's behind it?" (page `q4t`, before the tone page; optional). `A.tyReason` is `hard time`, `just because`, `missing them` or `big change`. Only hard time is a mode; the other three keep the regular flow and get a one-line occasion rule in the prompt.
- Thank you keeps the regular flow, but its first two detail questions are "What are you thanking them for?" and "What difference did it make?" (`setDetailQuestions()`); they go to the server in `A.misc` with their own labels, which are in `DETAIL_LABELS`.
- In `api/generate.js`, `isLoss`, `isGetwell`, `isApology` and `isHardtime` switch in each mode's role, opening, middle, occasion rule, tone guides and its block (THE LOSS, THE SITUATION, THE APOLOGY, THE HARD TIME); length is 75–100 words (Shorten still gives 50–80); no random focus angle and no thin or classic switching. Revisions carry the same rules.
- Relationship chips are the 7 in `#rel-chips`, always in this order: Loving, Easy and comfortable, Complicated, Rebuilding, Long distance, Friendly, Casual acquaintance. A mode's `rel` list may only hide chips, never reorder them. Sympathy, Get well and hard time show Loving, Complicated, Long distance, Friendly, Casual acquaintance (`MODE_REL_CHIPS`); Apology shows all 7. Complicated shows on every occasion.
- The plan and exact prompt text are in Robert's Claude Doc "HeartPenned: Harder Occasions Strategy".

## Card ratings (testers and Prolific)

- Thumbs up/down show under each card version only for testers (`?tester=1`, remembered for the browser tab) and Prolific participants (`PROLIFIC_PID`, `STUDY_ID`, `SESSION_ID` in the link). Thumbs down opens reason chips and a note.
- `api/feedback.js`: POST saves one rating in the Redis hash `fb:all`; GET lists them and needs `?key=` matching the `FEEDBACK_KEY` environment variable. The reason chips in `index.html` must match `REASONS` in `feedback.js`.
- A rating saves the card text and the sender's choices only. Private free-text answers are never saved. Keep it that way.
- Robert reviews ratings at `/feedback.html` (asks for the key once per site).
- On a Vercel preview, the Vercel sign-in drops `?tester=1`. Add it to the address after the page loads.

## Header images

### How headers work

- Headers live in the `CARD_HEADERS` array in `index.html`. Each has `id`, `label`, `occasions: [...]`, `category` (`'classic'` or `'fun'`), `theme`, `image`, and `render(w, h)` returning an `<img src="/public/headers/NAME.png">`.
- `image: 'NAME.png'` is required; without it the PDF silently skips the image.
- A header shows on the Classic or Fun tab of every occasion in its `occasions` list. Each header has exactly one `category`.
- Browse All groups headers by their **first** occasion only, so cross-listed headers don't appear under later occasions there. Robert decided to leave this as is.
- Occasion chips are built in JavaScript from `OCC_ALWAYS`, `OCC_MORE_ALWAYS` and `OCC_SEASONAL` in `index.html` (seasonal ones show from 60 days before their date to 7 days after, otherwise under the "More occasions" chip, which is the last chip). An occasion missing from those lists can't be selected in the card flow. Typed "Other" occasions only get headers tagged `'Other'`. Occasion spelling must match the chip exactly (e.g. `'Get well'`, `'Thinking of you'`).
- `theme` sets the card background and must be one of the `CARD_THEMES` ids: `classic`, `warm`, `blush`, `sage`, `twilight`, `gold`, `slate`, `dusk`. Pick the one closest to the image's colors.
- Place new entries right after the last existing header for their first occasion. Position within an occasion = display order in the picker.

### Image files

- Images are **JPGs** in `public/headers/`, 1200×403 (3:1), roughly 50–125 KB. Convert Midjourney PNGs with Pillow: flatten onto white if needed, resize to 1200 wide, save JPEG quality ~82, optimized, progressive.
- Code still references `.png`. `vercel.json` rewrites `/public/headers/NAME.png` to `NAME.jpg`. **`vercel.json` must stay.** Never add a real `.png` header.
- Name files `occasion-subject.jpg`, lowercase, no spaces (e.g. `getwell-rainbow.jpg`), so the name shows where the image is used. Header ids follow the same pattern with `-img-` (e.g. `getwell-img-rainbow`).

### Midjourney prompt format

Robert generates images himself. When drafting prompts, use this format:

```
**Title:** `subject and details, colors, mood, painterly illustration, wide horizontal banner, white background, no text --ar 3:1 --v 7`
```
