// ---------- Shared guard helpers (Redis rate limits + owner alerts) ----------
const REDIS_URL = process.env.HP_KV_REST_API_URL;
const REDIS_TOKEN = process.env.HP_KV_REST_API_TOKEN;
const ALERT_TO = process.env.ALERT_EMAIL || 'hello@heartpenned.com';
let lastLocalAlert = 0;

async function redis(cmd) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.result;
}

// Returns true if the action is allowed. Fails open if Redis is unreachable.
async function allow(key, limit, windowSec) {
  try {
    const n = await redis(['INCR', key]);
    if (n === 1) await redis(['EXPIRE', key, windowSec]);
    return n <= limit;
  } catch (e) {
    console.error('Rate limit check failed:', e);
    alertOwner('Redis unreachable', String(e));
    return true;
  }
}

// Emails the owner, at most once per hour per alert type.
async function alertOwner(subject, detail) {
  try {
    let shouldSend = true;
    try {
      const ok = await redis(['SET', `alert:${subject}`, '1', 'EX', 3600, 'NX']);
      shouldSend = ok === 'OK';
    } catch {
      shouldSend = Date.now() - lastLocalAlert > 3600 * 1000;
    }
    if (!shouldSend) return;
    lastLocalAlert = Date.now();
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'HeartPenned Alerts <hello@heartpenned.com>',
        to: [ALERT_TO],
        subject: `HeartPenned alert: ${subject}`,
        text: `${subject}\n\n${detail}\n\nTime: ${new Date().toISOString()}`,
      }),
    });
  } catch (e) {
    console.error('Alert email failed:', e);
  }
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}
function today() { return new Date().toISOString().slice(0, 10); }
// ---------------------------------------------------------------------------

// ===========================================================================
//  CARD PROMPT  —  edit the writing rules here
//  (Moved from index.html so the prompt stays private on the server.)
// ===========================================================================

const LENGTHS = ['handwritten note — 90 to 130 words', 'standard card length — 50 to 80 words'];
const CELEBRATORY = /birthday|anniversary|graduation|valentine|christmas|hanukkah|thanksgiving|easter|new year|mother's day|father's day|milestone|nurses day|halloween|4th of july/i;

// How each tone should be shaped, including how it ends.
const TONE_GUIDE = {
  'Warm and heartfelt': 'Flowing sentences, gentle rhythm, never saccharine. Ends on a warm, simple line, not a grand one.',
  'Funny and playful': 'Short punchy sentences, wit over jokes, affection underneath. Stays mostly light. At most one sincere line, and it can be brief. It is fine to end on the joke. Do not build to an emotional climax.',
  'Honest and direct': 'Plain language, no flourish, sounds said aloud. Ends plainly, the way a person would actually stop talking.',
  'Poetic and sentimental': 'Rhythm and imagery, earned emotion, beauty through specificity. This is the tone where a resonant closing line belongs.',
  'Lighthearted but real': 'Starts light, has one genuine beat, and does not linger on it. Ends light or warm, not heavy.',
  'Reserved but sincere': 'Understated. Plain, unshowy sentences. Restraint in feeling, not in length. No big closing line; a plain, sincere sentence is enough.',
  'Celebratory and upbeat': 'Energetic, warm, joy-forward. Ends on celebration and good wishes, not reflection.',
  'Tender and gentle': 'Soft, careful, quietly loving. Ends gently.',
  'Simple and classic': 'Short and traditional, like a beautifully chosen store-bought sympathy card. Plain, familiar sympathy language; nothing elaborate.',
  'Respectful': 'Polite, sincere, and a little more formal, right for a coworker, client, neighbor, or acquaintance. Warm but not intimate; no endearments.',
  'Gently hopeful': 'Still sorry, but looks gently toward lighter days ahead: peace, strength, brighter days. Never a silver lining, never a reason for the loss, never "it will get better."',
};
// Tone guides that differ for Apology. Other occasions never see these.
const APOLOGY_TONE_GUIDE = {
  'Honest and direct': TONE_GUIDE['Honest and direct'] + ' Own it plainly and briefly, without emotional language or big declarations.',
  'Lighthearted': 'Light in voice, for small things. Never light about the hurt it caused; the "I\'m sorry" itself stays plain and sincere. Ends warm, not heavy.',
};
// Get well has its own lighter tones. Other occasions never see these.
const GETWELL_TONE_GUIDE = {
  'Lighthearted': 'Warm with an easy, light touch, the way a friend talks. One genuine beat, and it does not linger. Ends warm, not heavy.',
  'Playful': 'Affectionate and a little playful: short, easy sentences and gentle teasing about everyday life or about them. Kind underneath. Fine to end light.',
};
// Rules shared by the newer occasion modes (Get well, Apology).
const SHARED_MODE_RULES = `- No advice and no general statements about the situation ("healing takes time," "rest is the best medicine," "everyone makes mistakes"). Gentle hopes and wishes are fine.
- Never describe or assume how they feel right now ("I know you're exhausted," "I know you're upset").
- If a PREVIOUS VERSION is shown below, change the ideas and images from it, not just the wording.`;
const SHORT_LEANING = ['Funny and playful', 'Honest and direct', 'Reserved but sincere', 'Celebratory and upbeat', 'Lighthearted but real'];

// A different way in for each card, so cards do not all start the same way.
// Only Thank you still picks from these; other rich-detail regular cards open classic first.
const OPENING_MOVES = [
  'Open with a specific, true observation about who they are.',
  'Open plainly and directly, as if picking up a conversation already in progress.',
  'Open with the shared memory if one was given; otherwise with what this person is like to be around.',
  'Open with something about where they are in life right now, using only what the inputs say.',
  'Open with a short, simple sentence. Let the next sentence do the work.',
];
// Rich-detail regular cards (not Thank you): a familiar classic start, then the personal part.
const CLASSIC_FIRST_OPENING = 'Open with one or two sentences in the warm, familiar style of a beautifully written classic card for this occasion and relationship: fresh wording, not a stock phrase, and nothing about what they are like. Then move into what the sender shared.';
// Used for every thin-detail card, and as one of the random choices for rich cards.
const OCCASION_OPENING = 'Open with the occasion: a fresh line about what this day or moment means for them, not a stock greeting. Find your own way in rather than reaching for the most familiar phrase for this occasion.';
// Thin-detail cards pick one of these, so they do not all open the same way.
const THIN_OPENINGS = [
  'Open warmly and simply. It may open with a wish or a warm line about the occasion. Find your own way in rather than reaching for the most familiar phrase for this occasion.',
  'Open with what the sender shared, in your own words.',
];

// Details are "rich" when 2+ of the four detail questions were answered, or when
// one was answered with at least RICH_DETAIL_CHARS characters (labels not counted).
// Otherwise they are "thin": the card blends in occasion warmth and wishes
// instead of describing the person.
const RICH_DETAIL_CHARS = 100;
const DETAIL_LABELS = ['Qualities the sender appreciates in them: ', 'What they mean to the sender: ', 'What is going on in their life right now: ', 'What the sender is thanking them for: ', 'What difference it made: '];
function hasRichDetails(A){
  const misc = A.misc || '';
  const answered = (A.memory ? 1 : 0) + DETAIL_LABELS.filter(l => misc.includes(l)).length;
  const chars = ((A.memory||'').split(' / ').join('') + DETAIL_LABELS.reduce((s, l) => s.split(l).join(''), misc)).trim().length;
  return answered >= 2 || chars >= RICH_DETAIL_CHARS;
}

// When the sender gave no memories or details, give each card a different focus
// so cards differ in content, not just in their first line.
const ANGLES = [
  'Center the middle on what this relationship means to the sender, without describing what they are like.',
  'Center the middle on what everyday life with them is like, from the sender\'s side of the relationship.',
  'Center the middle on what the sender hopes for them in the year ahead, grounded in who they are.',
  'Center the middle on gratitude: what the sender is thankful for about them and about this relationship.',
  'Center the middle on who they have become, or what they have grown into, as the sender sees it. Never invent specific events.',
  'Center the middle on the occasion itself: what this day marks for them and what the sender hopes it brings.',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function buildPrompt(A, currentCardText, mode, note){
  // mode: 'new' | 'another' | 'shorten' | 'revise'
  const isRev = mode === 'revise';
  const name=A.name||'';
  const isMD=A.occasion==="Mother's Day",isFD=A.occasion==="Father's Day",isNND=A.occasion==="National Nurses Day",isLoss=A.occasion==="Sympathy",isApology=A.occasion==="Apology",isBirthday=A.occasion==="Birthday",isGetwell=A.occasion==="Get well";
  // Thinking of you asks "What's behind it?"; "hard time" is its own mode, like Get well.
  const isThinking=A.occasion==="Thinking of you",isThankYou=A.occasion==="Thank you";
  const tyReason=isThinking&&['hard time','just because','missing them','big change'].includes(A.tyReason)?A.tyReason:'';
  const isHardtime=tyReason==='hard time';
  // Sympathy, Get well, Apology and hard time use their own questions; ignore any leftover answers from the regular detail questions.
  if (isLoss || isGetwell || isApology || isHardtime) A = { ...A, memory: '', misc: '' };
  const G = (isGetwell && A.getwell && typeof A.getwell === 'object') ? A.getwell : {};
  const gwStr = v => typeof v === 'string' ? v.trim().slice(0, 300) : '';
  const gwSerious = ['serious', 'minor', 'ongoing'].includes(G.serious) ? G.serious : '';
  const gwWhat = gwStr(G.what), gwOffer = gwStr(G.offer);
  const getwellBlock = !isGetwell ? '' : `THE SITUATION (use only what is given):
- WHAT THEY ARE DEALING WITH: ${!gwWhat ? 'Not given. Refer to it only in general terms ("what you\'re going through," "this stretch"); never guess what it is.'
    : G.mention === true ? '"' + gwWhat + '" The sender wants this mentioned. Refer to it plainly at most once. Don\'t describe symptoms, treatment or outcomes.'
    : 'Private context only: "' + gwWhat + '". Never name or describe it in the card; refer to it only in general terms ("what you\'re going through," "this stretch"). Use it to judge how gentle to be.'}
- HOW SERIOUS: ${gwSerious === 'serious' ? 'Serious. Steady and warm, close to a classic card. Wish them strength, comfort and good days; never say it will be over soon.'
    : gwSerious === 'minor' ? 'Minor; they\'ll bounce back. Light and warm is fine, with a little humor about everyday life or about them if the TONE allows, and you may look forward to them being back to themselves.'
    : gwSerious === 'ongoing' ? 'Ongoing illness. Steady and warm, close to a classic card. Never mention getting better, recovery or getting back to normal; wish them comfort, good days and strength.'
    : 'Not given. Warm and steady.'}
${gwSerious === 'minor' ? '' : '- If the TONE is Lighthearted or Playful, keep it to one warm, light touch about everyday life or about them; the card stays steady underneath. Treat Playful as Lighthearted here.\n'}- LOOK FORWARD TO OR OFFER: ${gwOffer ? '"' + gwOffer + '" Include it plainly and specifically.' : 'None given. Do not invent one, and do not write "let me know if you need anything."'}
- Never describe who they are, what they're like, or how they're handling this ("taking it in stride," "you're so strong," "the way you always do"). Say only what the sender gave.
- Do not write about the sender's own presence, closeness or distance ("I'm here for you," "even from far away"). The only exception is an offer the sender gave.
${SHARED_MODE_RULES}`;
  const P = (isApology && A.apology && typeof A.apology === 'object') ? A.apology : {};
  const apWhat = gwStr(P.what), apKnow = gwStr(P.know), apChange = gwStr(P.change);
  const apologyBlock = !isApology ? '' : `THE APOLOGY (use only what is given):
- WHAT HAPPENED: ${!apWhat ? 'Not given. Refer to it only in general terms; never guess what happened.'
    : P.mention === true ? '"' + apWhat + '" The sender wants this acknowledged. Name it once, plainly and briefly, in your own words; don\'t retell or explain it.'
    : 'Private context only: "' + apWhat + '". Never name or describe it in the card; refer to it only in general terms ("what I did," "how I handled things"). Use it to judge what the apology is for and how serious it is.'}
${apKnow ? '- WHAT THE SENDER MOST WANTS THEM TO KNOW: "' + apKnow + '" Make this the heart of the card, in your own words.\n' : ''}- WHAT THE SENDER WILL DO DIFFERENTLY: ${apChange ? '"' + apChange + '" Include it plainly as something the sender will do. Don\'t make it bigger than they wrote.' : 'None given. Do not invent a promise or a change.'}
- Never describe who they are or what they're like ("you've always been so patient," "you're the most forgiving person I know"). Say only what the sender gave.
${SHARED_MODE_RULES}`;
  const H = (isHardtime && A.hardtime && typeof A.hardtime === 'object') ? A.hardtime : {};
  const htWhat = gwStr(H.what), htOffer = gwStr(H.offer);
  const hardtimeBlock = !isHardtime ? '' : `THE HARD TIME (use only what is given):
- WHAT THEY ARE GOING THROUGH: ${!htWhat ? 'Not given. Refer to it only in general terms ("what you\'re going through," "this stretch"); never guess what it is.'
    : H.mention === true ? '"' + htWhat + '" The sender wants this mentioned. Refer to it plainly at most once. Don\'t describe or explain it.'
    : 'Private context only: "' + htWhat + '". Never name or describe it in the card; refer to it only in general terms ("what you\'re going through," "this stretch"). Use it to judge how gentle to be.'}
- OFFER: ${htOffer ? '"' + htOffer + '" Include it plainly and specifically.' : 'None given. Do not invent one, and do not write "let me know if you need anything."'}
- Never describe who they are or how they're handling it ("you're so strong," "you always land on your feet"). Say only what the sender gave.
${SHARED_MODE_RULES}`;
  // Only use birthday age and children when they belong to the current occasion
  // (they can be left over if the person changed the occasion after answering).
  const birthdayAge = isBirthday ? (A.birthdayAge||'') : '';
  const kidsText=(isMD||isFD)?A.kids.filter(k=>k&&(k.age||k.sex)).map(k=>{const p=[];if(k.sex)p.push(k.sex);if(k.age)p.push('age '+k.age);if(k.name)p.push('('+k.name+')');return p.join(' ');}).join(' | '):'';
  const tonesList=[...A.tones,...(A.toneOther?[A.toneOther]:[])];
  const toneVal=tonesList.join(' + ')||'Warm and heartfelt';
  const guideFor=t=>(isGetwell&&GETWELL_TONE_GUIDE[t])||(isApology&&APOLOGY_TONE_GUIDE[t])||TONE_GUIDE[t];
  const toneGuide=(tonesList.length?tonesList:['Warm and heartfelt']).map(t=>guideFor(t)?'- '+t+': '+guideFor(t):'- '+t+' (the sender described this tone in their own words): follow it as written, including how light or heavy it should feel.').join('\n');
  const feelOther=typeof A.feelOther==='string'?A.feelOther.trim().slice(0,200):'';
  const feelVal=[...A.feels,...(feelOther?[feelOther]:[])].join(', ')||'loved';
  const lengthIsStandard = A.length===LENGTHS[1];
  const leansShort = tonesList.length>0 && tonesList.every(t=>SHORT_LEANING.includes(t));
  let lengthRule = lengthIsStandard
    ? '50 to 80 words.'
    : (leansShort && !isLoss
        ? '85 to 115 words. Stay in this range. Fill it with substance from the inputs, not padding or repetition.'
        : '105 to 135 words. Stay in this range. Fill it with substance from the inputs, not padding or repetition.');
  const fromGuide = A.from==='Me and my partner' ? 'Warm collective voice; use "we" and "us" naturally.'
    : (A.from==='From family'||/from family/i.test(A.senderAge||'')) ? 'Inclusive collective voice, written on behalf of everyone.'
    : A.from==='On behalf of someone else' ? 'The person filling this out is writing for someone else. Write in the voice of the actual sender, singular unless the inputs say otherwise. Never mention that someone helped write it.'
    : 'Singular voice throughout. Never use "we" to mean the sender.';
  const celebratory = CELEBRATORY.test(A.occasion||'') && !isLoss && !isApology;
  const openingHasName = !!(name && A.opening && A.opening.toLowerCase().includes(name.toLowerCase()));
  const nameRule = !name ? 'No name.'
    : openingHasName ? 'The opening already uses "'+name+'". Do not use the name anywhere else in the card, including the final occasion wish (for example, "Happy Birthday!" rather than "Happy Birthday, '+name+'").'
    : 'You may use "'+name+'" once only if it fits naturally mid-card. Never in the closing or final line. Never more than once.';
  if ((isLoss || isGetwell || isApology || isHardtime) && !lengthIsStandard) lengthRule = '75 to 100 words. Stay in this range.';
  const hasSpecifics = !!((A.memory||'').trim() || (A.misc||'').trim());
  const angleLine = (hasSpecifics || isLoss || isApology || isGetwell || isHardtime) ? '' : '\n- FOCUS FOR THIS CARD (no memories or details were given): ' + pick(ANGLES) + ' Keep the card centered on this one focus rather than touching on everything.';
  // The sender skipped every detail question and chose "Keep it classic".
  const isClassic = !!A.classic && !hasSpecifics && !isLoss && !isGetwell && !isApology && !isHardtime;
  if (isClassic && !lengthIsStandard) lengthRule = '75 to 100 words. Stay in this range.';
  const classicLine = isClassic ? '\n- CLASSIC CARD: no personal details were given, by choice. Say nothing specific about this person or this relationship, including anything from the relationship context.' : '';
  // Regular cards: thin details lean on the occasion; rich details stay fully personal.
  const isThin = !isClassic && !isApology && !isLoss && !isGetwell && !isHardtime && !hasRichDetails(A);
  // Rich-detail Birthday cards end on two classic store-card sentences, then "Happy Birthday!".
  const classicClose = A.occasion === 'Birthday' && !isThin && !isClassic;
  const CLASSIC_CLOSE = 'End the card with two sentences in the style of a classic, beautifully written store-bought birthday card, then the final line ("Happy Birthday!"). The two sentences are warm, familiar birthday wishes for them and the year ahead, in plain, timeless greeting-card language, for example: "Wishing you a day filled with the people and things you love most. May the year ahead bring you happiness, good health and plenty to celebrate." Write your own; don\'t copy the example. These two sentences contain no memory, no detail from the sender, no jokes and nothing about what they are like. They come after the personal part and override how the TONE section says to end; the tone shapes everything before them.';
  if (isThin && !lengthIsStandard) lengthRule = '75 to 100 words. Stay in this range.';
  const roleText = isLoss
    ? 'You are a senior greeting card writer with 20 years of experience. This is a sympathy card to someone who is grieving. Write it like a beautifully written classic sympathy card: traditional, gracious sympathy-card language that would ring true from anyone who cares about them, never flowery or generic. The card is about their loss and comfort for them, not about the sender or the relationship. Add personal touches only from THE LOSS section.'
    : isGetwell
    ? 'You are a senior greeting card writer with 20 years of experience. This is a get well card. Write it like a beautifully written classic get well card: warm, gracious and sincere, never flowery or generic. The card is about them and good wishes for them, not about the sender or the relationship. Add personal touches only from THE SITUATION section.'
    : isApology
    ? 'You are a senior greeting card writer with 20 years of experience. This is an apology card. Write it the way a thoughtful person apologizes when they mean it: plain, sincere and direct, never flowery, defensive or generic. The card is about owning what happened and about the recipient, not the sender\'s feelings. Add personal touches only from THE APOLOGY section.'
    : isHardtime
    ? 'You are a senior greeting card writer with 20 years of experience. This is a thinking-of-you card to someone going through a hard time. Write it like a beautifully written classic thinking-of-you card: warm, steady and sincere, never flowery or generic. The card is about them and letting them know they are on the sender\'s mind, not about the sender or the relationship. Add personal touches only from THE HARD TIME section.'
    : isThin
    ? 'You are a senior greeting card writer with 20 years of experience. The sender shared only a little. Write a card that reads mostly like a beautifully written store-bought card for this occasion: warm, gracious, greeting-card language that rings true for this relationship, never generic filler, never cheesy, no rhymes. Then weave in the one thing the sender shared, so it is unmistakably from them to this person.'
    : isClassic
    ? 'You are a senior greeting card writer with 20 years of experience. The sender chose a CLASSIC card and shared no personal details. Write the kind of message found in a beautifully written store-bought card: warm, gracious, traditional greeting-card language that would ring true for anyone in this relationship on this occasion. It should feel lovely and sincere, never generic filler, never cheesy, no rhymes.'
    : 'You are a senior greeting card writer with 20 years of experience. Your job is to write a card message that sounds like the sender wrote it themselves, on a good day, to this specific person. Not a card company, not AI. It should sound like this relationship actually sounds: sometimes tender, sometimes funny, sometimes plain. Real cards vary in tone and shape.';
  const openText = isLoss
    ? 'Open simply and gently. A plain expression of sorrow is fine. No quotes or sayings.'
    : isGetwell
    ? (gwSerious === 'minor' ? 'Open warmly. A light touch is fine if the TONE is Lighthearted or Playful. No quotes or sayings.' : 'Open simply and warmly. No quotes or sayings.')
    : isApology
    ? 'Open plainly. The apology itself can come first. No quotes or sayings.'
    : isHardtime
    ? 'Open simply and warmly. No quotes or sayings.'
    : isClassic
    ? 'Open warmly and simply. It may open with a wish or a warm line about the occasion.'
    : (isThin ? pick(THIN_OPENINGS) : (isThankYou && (A.misc||'').includes('What the sender is thanking them for: ')) ? 'Open with what the sender is thanking them for, in your own words.' : (isThankYou ? pick([...OPENING_MOVES, OCCASION_OPENING]) : CLASSIC_FIRST_OPENING)) + ' Don\'t open with the occasion greeting itself (no "Happy Birthday!" as the first line; that belongs at the end).' + (isThin || isThankYou ? '' : ' Don\'t open by describing what they are like; if the card says what they are like, that comes later, and only from what the sender gave.');
  const middleText = isLoss
    ? 'Middle: classic sympathy sentiments: sorrow for their loss, comfort, and gentle wishes for peace and strength in the days ahead. Acknowledge the loss simply, without explaining or interpreting it. If the sender knew the person and shared something about them, include one line honoring them in that spirit. If an offer was given, include it plainly.'
    : isGetwell
    ? 'Middle: classic get well sentiments: thinking of them, and wishes for comfort, rest and good days ahead, shaped by HOW SERIOUS below. If the sender wants what they are dealing with mentioned, acknowledge it simply, without explaining it. If something to look forward to or an offer was given, include it plainly.'
    : isApology
    ? 'Middle: say sorry plainly and own it in a sentence or two. If the sender said what they most want the recipient to know, make it the heart of the card. If they said what they will do differently, include it plainly. Close with a simple hope to make things right, without asking for anything.'
    : isHardtime
    ? 'Middle: classic thinking-of-you sentiments for a hard stretch: they are on the sender\'s mind, and wishes for comfort, strength and better days. If the sender wants what they are going through mentioned, acknowledge it simply, without explaining it. If an offer was given, include it plainly.'
    : isClassic
    ? 'Middle: sentiments that fit the occasion. For a birthday, holiday, anniversary, graduation, or milestone: heartfelt wishes (for the day, the year ahead, what you hope for them). For sympathy: comfort and presence, never wishes about the future or silver linings. For thank you: sincere gratitude. For get well: wishes for healing, rest, and comfort. For thinking of you: warmth and a reminder that they are on the sender\'s mind. For an apology: a sincere, simple acknowledgment and the hope to make things right, never celebration. If it fits, add one meaningful universal reflection on the occasion or on this kind of relationship (for example, what another year means, or what a good friend is). Do not describe this person: no personality traits, habits, what they are like, how they make the sender feel, or what they bring to the sender\'s life. No first-person musing ("I think," "I don\'t always know the right words"). Speak to them warmly in second person.'
    : isThin
    ? 'Middle: sentiments that fit the occasion. For a birthday, holiday, anniversary, graduation, or milestone: a heartfelt wish (for the day or the year ahead). For sympathy: comfort and presence, never wishes about the future or silver linings. For thank you: sincere gratitude. For get well: a wish for healing, rest, and comfort. For thinking of you: warmth and a reminder that they are on the sender\'s mind. If it fits, add one meaningful universal reflection on the occasion or on this kind of relationship (for example, what another year means, or what a good friend is). Keep it addressed to them in second person, never about "a person" or "someone." Weave in what the sender shared as one thread, one or two sentences, in your own words and exactly as given. Do not add scene or sensory details that were not given (time of day, weather, sounds, what it looked or felt like). Do not extend it into new facts (a hobby does not become a career; enjoying something does not make them an expert at it). Beyond that thread, do not describe this person: no traits, habits, what they are like, how they make the sender feel, or what they bring to the sender\'s life. Speak to them warmly in second person. Never invent events or facts.'
    : 'Middle: amplify what was expressed and give it room, in the card\'s tone. This is where most of the length lives. Build it from everything provided: who they are to the sender, the relationship context, the occasion, their ages and stage of life, what the sender wants them to feel, and any memories or details. ' + (isThankYou ? 'If no memories were given, develop the gratitude more fully instead: what their help meant to the sender and what the sender wishes for them. Do not describe what they are like beyond what the sender gave.' : 'If no memories were given, develop the feeling and the relationship more fully instead: what they mean to the sender, what they bring to the sender\'s life, what the sender wishes for them. Say what they are like only as the sender described it (a quality they named); never add traits of your own. Use a quality as the sender gave it; don\'t compare them to other people or say how rare it is.') + ' Never invent events or facts.'
      + ((isApology || isThinking || isThankYou) ? '' : ' Required: somewhere in the body, before the closing line, include at least one line about what this day, season, or milestone means and what it marks for them, connected to them where possible. The closing occasion line does not count. For sympathy, this means acknowledging the loss simply, without explaining or interpreting it.');
  const wishLine = (isClassic || isApology || isGetwell || isHardtime) ? ''
    : classicClose ? '\n- Apart from the CLASSIC CLOSE, include at most one other wish, earlier in the body.'
    : '\n- Include one genuine wish for them in the body of the card (two at most, and not back to back). The closing occasion line already counts as a wish, so do not pile wishes up just before it. A short one-line wish just before the closing occasion line counts as a second wish. Shape it to the occasion: for a celebration, what you hope this day or year holds for them; for sympathy, comfort, rest, or company in the days ahead, never a silver lining; for get well, healing and rest; for thank you or thinking of you, something good for them. In a funny or light tone, the wish can be playful.';
  const musingLine = isClassic ? ''
    : (isThin || isLoss || isGetwell || isApology || isHardtime) ? '\n- No first-person musing, where the sender reflects on their own thoughts or on writing the card ("I think...", "I don\'t always know the right words"), including asides like ", I think," in the middle of a sentence. Plain feeling toward them ("I\'m so proud of you") is fine. Keep the attention on them and the occasion.'
    : '\n- At most one sentence of first-person musing, where the sender reflects on their own thoughts or on writing the card ("I think...", "I don\'t always know the right words"). This includes asides like ", I think," in the middle of a sentence. Plain feeling toward them ("I\'m so proud of you") is fine. Keep the attention on them and the occasion.';

  const faithText=(A.faithTradition||'');
const isChristianFaith=/christ|catholic|protestant|baptist|methodist|lutheran|presbyterian|episcopal|evangelical|pentecostal|anglican|denominational|latter.day|\blds\b|mormon/i.test(faithText)||(/orthodox/i.test(faithText)&&!/jew/i.test(faithText));
const isGodOptional=/jew|juda|muslim|islam|sikh|bah[aá]|hindu/i.test(faithText);
const isNoGod=/buddh/i.test(faithText);
const spiritualRule=A.spirituality==='None'||!A.spirituality?'No spiritual language of any kind.':A.spirituality==='Gently spiritual'?'Use gently universal spiritual language, such as light, presence, purpose, blessing, or being held in kindness. Do not use the word "grace" unless the user used it. Vary the wording from card to card rather than reaching for the same word. Do not mention God, prayer, scripture, or any religion by name. Keep it to one or two light touches; the card should still read as warm and personal first.':'Use openly faith-based language. You may mention God, prayer, and blessings directly, and one short faith-centered line is welcome. Let faith feel woven in, not preached.'+(A.faithTradition?' PRIVATE CONTEXT, the sender faith tradition is: '+A.faithTradition+'. Write the faith language the way someone from within that tradition would naturally say it: the phrasing, blessings, and warmth that feel at home there, and the customs of that tradition for how God is referred to. NEVER name the religion, denomination, or tradition anywhere in the card. Do not mention specific rituals, saints, holy days, or practices unless the user included them elsewhere. Do not quote scripture or prayers. One or two natural touches is enough. It should sound like it came from someone who shares the faith, not someone describing it. If the tradition entered is unclear or is not a religion, use broadly shared faith language instead.'+(isChristianFaith?'  For this tradition, refer to God directly by name at least once, in a way that grows out of what the card is saying about this person, such as a blessing on their year ahead, gratitude for who they are, or a prayer for them. Write the God reference fresh for this specific card rather than using a stock phrase. Do not mention God more than twice.':isGodOptional?' Referring to God by name is welcome here if it fits naturally, but not required; blessing language alone is also fine. Do not mention God more than twice. Write "God" spelled out in full unless the user wrote it another way (such as "G-d") in their inputs, in which case match their spelling.':isNoGod?' This tradition generally does not center a creator God, so do not mention God. Express the faith through wishes for peace, ease, compassion, and well-being instead.':''):' Use broadly shared faith language (God, prayer, blessing) without naming a specific tradition.');

  const occasionRules=isLoss?'Sympathy. Gentleness and presence only. No silver linings, no "at least," no "everything happens for a reason," no "in a better place" or "gained an angel" unless SPIRITUALITY is openly faith-based, and then gently. No fixing, no advice, no telling them how to feel or how long grief takes. Let them feel less alone.':isGetwell?'Get well. Never promise recovery or predict how it will go ("you\'ll beat this," "back on your feet in no time"). No medical advice. Never joke or make light of the illness, injury, treatment or recovery, however minor it is and whatever the TONE; any humor is about everyday life or about them.':isApology?'Apology. Own it plainly. No "if you were hurt" or "sorry you felt," no excuses or explanations of why it happened, no shifting blame, no over-explaining. Do not ask for forgiveness or push to move on ("please forgive me," "let\'s put this behind us"). No flattery or compliments to smooth it over.':isHardtime?'Thinking of you, during a hard time. Steady and warm. No silver linings, no "everything happens for a reason," no fixing or advice, no predicting how it will turn out. Never joke or make light of what they are going through; any light touch is about everyday life only.':tyReason==='just because'?'Thinking of you, just because. There is no special reason or event; never invent one. Warm and easy.':tyReason==='missing them'?'Thinking of you, because the sender misses them. Let missing them come through plainly once; never heavy or guilt-laden.':tyReason==='big change'?'Thinking of you, as they go through a big change (a move, a new job). Warm wishes for what\'s ahead. Never assume how they feel about the change.':isThankYou?'Thank you. Thank them plainly and specifically for what the sender gave, in your own words, without making it bigger than they wrote. Say what difference it made only as the sender described it. No praise of their character beyond what the sender said ("you\'re the most generous person I know").':isMD?'Mother\'s Day. No clichés: no unconditional love, no SuperMom. Honor the day through specificity. End the card with Happy Mother\'s Day as the final line.'+(kidsText?' Children: '+kidsText+'. Adult children reflect on what was already built. Young children tenderness about now.':''):isFD?'Father\'s Day. No clichés. End the card with Happy Father\'s Day as the final line.'+(kidsText?' Children: '+kidsText+'.':''):isNND?'National Nurses Day. Specific and respectful. No generic heroism.':isBirthday&&birthdayAge?'Birthday. Turning '+birthdayAge+'.'+(([30,40,50,60,70,80,90,100].includes(Number(birthdayAge)))?' Milestone.':''):'';

  const closingRule = celebratory
    ? 'End with a short, warm wish for the occasion as the final line (e.g. "Happy Birthday!"). It can be light or playful if the tone is; it does not need to be solemn.'
    : 'End with the natural close of the card for this tone. Do not force an occasion label as the final line.';

  const intensityRule = 'Match emotional intensity to the tone, the occasion, and the relationship. Most cards should be warm but not weighty. Understatement usually lands harder than declaration. Not every card needs a profound moment or a memorable final line. Never escalate beyond what the tone and inputs call for. Restraint is about emotional intensity, never length: a light or understated card still fills its full LENGTH.';
  const feelingsRule = 'The feelings above are the goal underneath the card, not words to put in it. Let them come through what is said; do not announce them (never write "you are deeply loved" or "I see you"). The TONE decides how they are expressed: in a funny card, "deeply loved" might show up as affectionate teasing, or one sincere line; in a reserved card, as one plain sentence.';

  const L = (isLoss && A.loss && typeof A.loss === 'object') ? A.loss : {};
  const lossStr = v => typeof v === 'string' ? v.trim().slice(0, 300) : '';
  const lossKnew = ['yes', 'a little', 'no'].includes(L.knew) ? L.knew : '';
  const lossWho = lossStr(L.who), lossName = L.useName ? lossStr(L.name) : '', lossOffer = lossStr(L.offer);
  const lossAbout = (lossKnew === 'yes' || lossKnew === 'a little') ? lossStr(L.about) : '';
  const lossBlock = !isLoss ? '' : `THE LOSS (card content; use only what is given):
- WHO THEY LOST: ${lossWho ? '"' + lossWho + '"' : 'Not given. Refer to the loss only in general terms ("your loss," "this loss"); never guess who died.'}
- NAME: ${lossName ? '"' + lossName + '" This is what the sender called them (it may be a family name like "Nana" or "Uncle Buck"). The sender wants it in the card. Use it once, exactly as written, naturally.' : 'Do not name the person who died, even if a name appears above.'}
- DID THE SENDER KNOW THEM: ${lossKnew === 'yes' ? 'Yes.' : lossKnew === 'a little' ? 'A little. Keep any line about them modest.' : (lossKnew === 'no' ? 'No.' : 'Not given.') + ' Never imply the sender knew them, met them, or knows what they were like. Do not describe them.'}
${lossAbout ? '- WHAT THE SENDER WANTS TO SAY ABOUT THEM: "' + lossAbout + '" Include one line honoring them in the spirit of this, in your own words. Add no qualities or stories beyond it.\n' : ''}- OFFER: ${lossOffer ? '"' + lossOffer + '" Include it plainly and specifically.' : 'None given. Do not invent one, and do not write "let me know if you need anything."'}
- If the loss is a pet, treat it as the loss of a family member, sincerely and in proportion. Never "just a pet," never compare it to losing a person.
- One line about the person who died is allowed as described above; otherwise the card stays about the recipient and their loss.
- Do not write about the sender's own presence, closeness, or distance ("I'm here for you," "how close I am," "even from far away," "I'm right beside you," "you're not alone"). The only exception is an OFFER the sender gave.
- Let the feelings come through comfort and sympathy, never through the sender describing themselves or the relationship.
- No advice and no observations about grief itself: nothing about how grief works, how long it takes, what it does, or what they should do or feel ("grief this tender takes time to heal," "grief is love with nowhere to go," "be gentle with yourself," "take all the time you need"). Gentle hopes and wishes are fine ("I hope your memories bring you comfort").
- No lines about them not being alone or not having to carry this alone, in any wording ("you don't have to carry this alone," "you're not alone in this").
- Do not use "hold," "holding," or "held" in any form ("holding you in my thoughts").
- No sweeping statements about the loss or about words failing ("a loss like no other," "leaves a space nothing can fill," "no comfort equal to this kind of loss," "there are no words that can reach that," "takes its own time"). Say you're sorry plainly instead.
- Never describe or assume how they feel right now ("when everything feels heavy," "I know how hard this is").
- If a PREVIOUS VERSION is shown below, use different comfort wishes and images from it, not just different wording (for example, if it said "surrounded by kindness" or "memories bring you peace," choose something else).
- No teasing or playfulness, even to a sibling or close friend. Some emotional weight is fitting here; keep it gentle and unforced.`;

  const privateCtx = `RELATIONSHIP CONTEXT — CONFIDENTIAL WRITER BRIEFING ONLY:
"${A.relationshipCtx||''}"
This field is private context for the writer, never the card. Nothing from it may appear in the card in any form: not quoted, not paraphrased, not hinted at, not even a positive quality mentioned here. It only tells you where the relationship stands today, so you can set how warm, how close, and how measured the card should be, and what to avoid.
- The recipient's role (parent, partner, friend, and so on) still sets the register and the warmth. A card to a parent still sounds like it is to a parent.
- Where things stand today limits what the card claims. If it is complicated, rebuilding, or up and down, or the sender says what to avoid: stay warm, but no superlatives, no "best ever," no declarations of closeness or gratitude bigger than what is real. Never mention the difficulty itself.
- Friendly or casual acquaintance: keep it light and kind, still warm, and never overstate how close they are.
The card always builds from what is true and good.${isLoss ? '\nFor this sympathy card: use the relationship only to set how warm or formal the card is. Never mention the relationship, closeness, or distance in the card.' : isGetwell ? '\nFor this get well card: use the relationship only to set how warm or formal the card is. Never mention the relationship, closeness, or distance in the card.' : isHardtime ? '\nFor this thinking-of-you card: use the relationship only to set how warm or formal the card is. Never mention the relationship, closeness, or distance in the card.' : ''}`;

  const coreRules = `- No greeting
- Always write in second person, speaking directly to the recipient. Never slip into third person (e.g. never "the person who..." or "someone who..."). Use "you" and "your" throughout. When referring to shared experiences between sender and recipient, use "we," "us," and "our," never "both of you," "the two of you," or any phrasing that positions the writer as an outside observer.
- Never use em dashes (—) anywhere in the card. They are a clear AI writing signal. Use periods, commas, or line breaks instead.
- Never use "journey," "words cannot express," or end with "always"
- Never open with "There is something about," "There's something about," "Something about," or any variation. Start somewhere else entirely.
- Never start any sentence with "There's something" or "There is something."
- Avoid stock greeting-card moves, including: "That's not nothing," "That is everything," "That's actually everything," "not a small thing," "exactly as you are," "right here, right now," "more than you know," "more than words can say," "the world is a better place with you in it," "you deserve the world," and "gives back even a fraction of what you give," "ordinary days," "doesn't announce itself," "I don't take that lightly," "hard to name" or "can't quite name," "reflected back to you," "everything you give," "more than I say," "I don't take (it/you) for granted," "you deserve a beautiful day," "you deserve a (day/year/Christmas/season) that...," "I keep coming back to," "I keep thinking about," "to say that plainly," "it's worth saying," "more than you may know," "more than you might know," "wherever you are," "you deserve" in any form, "good people deserve," "hard to put into words," "out loud" (as in "more than I say out loud"), "belonged to us" in any form, "not something I take lightly" or any "take (it/that/you) lightly," "a birthday as good as you are," "you've arrived at another birthday," and "I find myself thinking." Say the specific thing instead.
- Do not use "held" or "feel held" as a metaphor.
- Nowhere in the card, including the close, wish that something good comes back to them, finds its way back, is given back to them, or returns to them, in any wording. Find a different kind of wish.
- Use the "Not X, but Y" or "Not loud or complicated. Just..." construction at most once per card.
- Do not use "light" as a metaphor for the person unless the user used it.
- Use contractions the way people naturally talk (you're, I'm, don't, it's, here's). Avoid stiff phrasing like "I do not" or "Here is to you" unless the tone is formal.
- CRITICAL: Never invent specific moments, events, or details not provided by the user. ${isClassic ? 'In this classic card, do not describe the person or the relationship at all.' : 'If no memory or specific moment was shared, write around feeling and relationship.'} Never fabricate a story, proposal, or event.
- CRITICAL: Treat every user input as a fact to reflect, not a story to expand. If someone says "two kittens," say two kittens. Do not add drama or narrative color. Embellish the feeling, never the facts.
- CRITICAL: When building on a memory or detail, expand its meaning, not its contents. Do not add concrete specifics that were not given: no objects, habits, quirks, scenes, or jokes about things that may not have happened (if they shared a room, do not mention bunk beds, blankets, bedhead, or who snored). Humor must come from what the user actually said, not from invented details.
- Never use the word "honestly" anywhere in the card, in any position or capitalization, and never "to be honest."
- Use "quiet" or "quietly" at most once per card.`;

  if(isRev){
    return `This is a targeted revision of a greeting card.

CURRENT CARD:
"${currentCardText}"

WHAT TO FIX — FOLLOW THIS EXACTLY:
"${note}"

CRITICAL: The instruction above is a direct command. If it says to remove a word, remove it everywhere. If it says to add a specific phrase, include it verbatim. If it says to change the tone, change it, and that change overrides the original tone below. These are not suggestions. Honor them precisely.

ORIGINAL CONTEXT (keep consistent unless the fix above says otherwise):
- OCCASION: ${A.occasion||'—'}${occasionRules?' ('+occasionRules+')':''}
- THE RECIPIENT IS MY: ${A.relationship||'—'}
- CARD FROM: ${A.from||'Just me'}. ${fromGuide}
- TONE: ${toneVal}
- WANT THEM TO FEEL: ${feelVal}
- LENGTH: ${lengthRule}
- SPIRITUALITY: ${spiritualRule}
- NAME RULE: ${nameRule}
- OPENING: ${A.opening?'Start with exactly: "'+A.opening+'"':'No greeting or opening line.'}
- SIGN-OFF: ${A.signoff?'End with exactly: "'+A.signoff+'"':'No sign-off.'}
${A.misc?'- INCLUDE IN CARD: "'+A.misc+'". Keep this in the card.':''}
${A.memory?'- SHARED MEMORY: "'+A.memory+'". Keep this woven in.':''}
${(isLoss || isGetwell || isApology || isHardtime || isThankYou) ? '' : '- DESCRIBING THEM: Say what they are like only as the sender described it (a quality they named); never add traits of your own. Use a quality as the sender gave it; don\'t compare them to other people or say how rare it is.\n'}${classicClose ? '- CLASSIC CLOSE (keep it): ' + CLASSIC_CLOSE + '\n' : ''}${lossBlock}${getwellBlock}${apologyBlock}${hardtimeBlock}

${privateCtx}

ALWAYS:
${coreRules}

Fix ONLY what was flagged. Keep everything else. Write ONLY the revised card message, with no commentary or explanation. Do all checking silently: no notes, word counts, drafts, or separator lines such as ---.`;
  }

  return`ROLE AND STANDARD:
${roleText}

INPUTS:
${name?'RECIPIENT NAME: '+name:''}
CARD FROM: ${A.from||'Just me'}
${A.senderAge&&!/from family/i.test(A.senderAge)?'SENDER AGE: '+A.senderAge:''}
THE RECIPIENT IS MY: ${A.relationship||'—'} (this is who the recipient is to the sender)
${A.recipientAge?'RECIPIENT AGE: '+A.recipientAge:''}
OCCASION: ${A.occasion||'—'}
${birthdayAge?(A.mentionAge?'TURNING: '+birthdayAge+'. The sender wants this age mentioned in the card (name the age naturally, as a person would in a birthday card).':'TURNING: '+birthdayAge+'. For calibration only. The sender did NOT ask for the age to be mentioned: do not state this number or refer to their specific age anywhere in the card.'):''}
${kidsText?'CHILDREN: '+kidsText:''}
TONE: ${toneVal}
LENGTH: ${lengthRule}
SPIRITUALITY: ${A.spirituality||'None'}
WANT THEM TO FEEL: ${feelVal}
${A.memory?'SHARED MEMORY (card content): "'+A.memory+'"':''}
${A.misc?'INCLUDE IN CARD (fair game): "'+A.misc+'"':''}
${lossBlock}${getwellBlock}${apologyBlock}${hardtimeBlock}

${privateCtx}

INPUT HIERARCHY:
1. TONE: sets the register of the whole card. Everything else is expressed within it.
2. SHARED MEMORY and INCLUDE IN CARD: direct card content. Use it.
3. WANT THEM TO FEEL: the goal underneath. See FEELINGS below.
4. RELATIONSHIP CONTEXT: writer briefing only. Calibrate from it, never surface it.

TONE (follow closely, including how the card ends):
${toneGuide}
If two tones are listed, blend them, letting the first one lead.

EMOTIONAL INTENSITY: ${intensityRule}
FEELINGS: ${feelingsRule}

SHAPE:
- ${openText}
- ${middleText}${wishLine}
- Ending: ${classicClose ? 'the CLASSIC CLOSE below.' : 'as the TONE section says for this tone.'}${isClassic ? classicLine : angleLine}
- Paragraphs: two or three short paragraphs. Never one long unbroken block.

LENGTH: ${lengthRule}
FROM GUIDANCE: ${fromGuide}
RELATIONSHIP GUIDANCE: Use who the recipient is to the sender to shape the register. To a spouse or partner: intimate and knowing. To a parent: respectful, warm, honoring. To a child: nurturing, proud, full of belief in them. To a friend: easy, real, peer-level. To a sibling: familiar, often teasing. To a colleague: professional warmth, never overly personal.
CHILDREN GUIDANCE: If children are listed, they may be referenced naturally once if it fits, never more. Do not make the card about the children.
AGE GUIDANCE: Use sender and recipient ages to calibrate vocabulary, references, and register. The ages are broad ranges for calibration only: never state or guess the recipient's age in the card (no "your forties or fifties") unless the sender asked for the birthday age to be mentioned. For teen senders, write naturally and warmly; no slang or trying to sound "young." If the recipient is older, never reference their age in a way that could feel diminishing.
SPIRITUALITY: ${spiritualRule}
OCCASION: ${occasionRules||'—'}
OPENING: ${A.opening?'Start the card with exactly: "'+A.opening+'". Use this and nothing else as the opening.':'No opening line. Do NOT add "Dear [name]" or any greeting. Start directly with the card message.'}
NAME RULE: ${nameRule}
SIGN-OFF: ${A.signoff?'End the card with exactly: "'+A.signoff+'" on its own line. Use this and nothing else.':'No sign-off. Do NOT add "Love," or any closing. End with the last line of the message.'}
${classicClose ? 'CLASSIC CLOSE (follow exactly): ' + CLASSIC_CLOSE + '\n' : ''}FINAL LINE: ${closingRule}

ABSOLUTE RULES:
- Write ONLY the card message
${coreRules}
- Reflect what was expressed; never project or assume beyond it
- Never assume anything about people not described in the inputs
- Card stays entirely about the recipient
- People before pets when listing names
- Never quote inputs verbatim. Put them in your own words, in the card's tone.${musingLine}

BEFORE YOU FINISH: count the words. If the card is under the LENGTH range, develop the middle further until it is within range${isClassic ? ' (with more warm wishes or a universal reflection, never details about the person)' : ''}.
Do all checking silently. Your reply must contain only the final card message: no notes, word counts, drafts, explanations, or separator lines such as ---.`;
}

function anotherSuffix(currentCardText){
  return (currentCardText ? `\n\nPREVIOUS VERSION (for contrast only):\n"${currentCardText}"` : '')
    + '\n\nIMPORTANT: Write a new version with a completely different opening sentence, structure, and closing. Do not reuse the previous version\'s first sentence, its key phrases, or its central image.';
}
function resizeSuffix(A, currentCardText){
  const shorter = A.length===LENGTHS[1];
  return `\n\nCURRENT VERSION:\n"${currentCardText}"\n\nIMPORTANT: Rewrite this current version so it is noticeably ${shorter?'shorter':'longer'}, at the specified length${shorter?'. If it is already near that length, cut it by about a third':''}. Keep the same emotional core, voice, tone, and key details. ${shorter?'Cut rather than rephrase.':'Add depth from the inputs, never invented details.'}`;
}
// ===========================================================================

// Keeps answers to sensible sizes so the endpoint can only build card prompts.
function cleanAnswers(raw) {
  const MAX_STR = 1500, MAX_ITEMS = 20;
  function clean(v, depth) {
    if (typeof v === 'string') return v.slice(0, MAX_STR);
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (Array.isArray(v)) return depth > 2 ? [] : v.slice(0, MAX_ITEMS).map(x => clean(x, depth + 1));
    if (v && typeof v === 'object') {
      if (depth > 2) return {};
      const out = {};
      for (const k of Object.keys(v).slice(0, 60)) out[k] = clean(v[k], depth + 1);
      return out;
    }
    return '';
  }
  const A = clean(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}, 0);
  for (const k of ['kids', 'tones', 'feels', 'relChips']) if (!Array.isArray(A[k])) A[k] = [];
  A.kids = A.kids.filter(k => k && typeof k === 'object');
  if (!LENGTHS.includes(A.length)) A.length = LENGTHS[0];
  return A;
}

const PER_IP_PER_DAY = 50;      // generations (new cards, revisions, versions, shorten)
const GLOBAL_PER_DAY = 500;     // emergency brake for the whole site
const MAX_PROMPT_CHARS = 25000;

const BUSY_MSG = "HeartPenned is getting a lot of love right now. Please try again in a little while.";

// Safety net: if the model ever adds a self-check or a second draft, keep only the final card.
const META_RE = /word count|let me revise|let me fix|violat|the (name|length) rule|revised version|here(?:'s| is) the (?:revised|final|updated) (?:card|version)|i see i used/i;
function extractCard(text) {
  let t = (text || '').trim();
  if (!t) return t;
  const parts = t.split(/\n\s*(?:-{3,}|\*{3,}|_{3,})\s*\n/).map(p => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const cards = parts.filter(p => !META_RE.test(p));
    t = (cards.length ? cards[cards.length - 1] : parts[parts.length - 1]);
  }
  // Drop any leftover note lines (e.g. "*Word count check:* ...").
  t = t.split('\n').filter(line => !META_RE.test(line)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body || {};
  const action = body.action;
  if (!['new', 'revise', 'another', 'shorten'].includes(action)) {
    return res.status(400).json({ error: 'Unknown request.' });
  }
  const answers = cleanAnswers(body.answers);
  const currentCardText = typeof body.currentCardText === 'string' ? body.currentCardText.slice(0, 4000) : '';
  const note = typeof body.note === 'string' ? body.note.slice(0, 1000) : '';
  if (action === 'revise' && (note.trim().length < 3 || !currentCardText.trim())) {
    return res.status(400).json({ error: 'Please describe what you would like changed.' });
  }

  let prompt;
  try {
    if (action === 'revise') prompt = buildPrompt(answers, currentCardText, 'revise', note);
    else prompt = buildPrompt(answers, currentCardText, action)
      + (action === 'another' ? anotherSuffix(currentCardText) : action === 'shorten' ? resizeSuffix(answers, currentCardText) : '');
  } catch (e) {
    console.error('Prompt build error:', e);
    return res.status(400).json({ error: 'Something about those answers did not work. Please try again.' });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return res.status(400).json({ error: 'That request is too long. Please shorten your answers and try again.' });
  }

  const ip = clientIp(req);
  if (!(await allow(`rl:gen:ip:${ip}:${today()}`, PER_IP_PER_DAY, 86400))) {
    return res.status(429).json({ error: "You've written a lot of cards today! Please come back tomorrow to write more." });
  }
  if (!(await allow(`rl:gen:global:${today()}`, GLOBAL_PER_DAY, 172800))) {
    alertOwner('Daily generation limit reached', `The site-wide cap of ${GLOBAL_PER_DAY} generations per day was hit.`);
    return res.status(429).json({ error: BUSY_MSG });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (data.error) {
      console.error('Anthropic error:', data.error);
      await alertOwner('Card generation failing', `Status ${response.status}: ${data.error.type || ''} ${data.error.message || ''}`);
      return res.status(503).json({ error: BUSY_MSG });
    }

    const text = extractCard(data.content?.find(b => b.type === 'text')?.text || '');
    res.status(200).json({ text });
  } catch (e) {
    console.error('Generate error:', e);
    await alertOwner('Card generation failing', String(e));
    return res.status(503).json({ error: BUSY_MSG });
  }
}
