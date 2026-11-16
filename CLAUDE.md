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

## Header images

### How headers work

- Headers live in the `CARD_HEADERS` array in `index.html`. Each has `id`, `label`, `occasions: [...]`, `category` (`'classic'` or `'fun'`), `theme`, `image`, and `render(w, h)` returning an `<img src="/public/headers/NAME.png">`.
- `image: 'NAME.png'` is required; without it the PDF silently skips the image.
- A header shows on the Classic or Fun tab of every occasion in its `occasions` list. Each header has exactly one `category`.
- Browse All groups headers by their **first** occasion only, so cross-listed headers don't appear under later occasions there. Robert decided to leave this as is.
- Occasion chips are hard-coded in the HTML (`data-val="..."`). An occasion with no chip can't be selected in the card flow. Typed "Other" occasions only get headers tagged `'Other'`. Occasion spelling must match the chip exactly (e.g. `'Get well'`, `'Thinking of you'`).
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
