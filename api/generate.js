// ---------- Shared guard helpers (Redis rate limits + owner alerts) ----------
const REDIS_URL = process.env.HP_KV_REST_API_URL;
const REDIS_TOKEN = process.env.HP_KV_REST_API_TOKEN;
const ALERT_TO = process.env.ALERT_EMAIL || 'roberts4807@gmail.com';
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
};
const SHORT_LEANING = ['Funny and playful', 'Honest and direct', 'Reserved but sincere', 'Celebratory and upbeat', 'Lighthearted but real'];

// A different way in for each card, so cards do not all start the same way.
const OPENING_MOVES = [
  'Open with a specific, true observation about who they are.',
  'Open plainly and directly, as if picking up a conversation already in progress.',
  'Open with the shared memory if one was given; otherwise with what this person is like to be around.',
  'Open with something about where they are in life right now, using only what the inputs say.',
  'Open with a short, simple sentence. Let the next sentence do the work.',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function buildPrompt(A, currentCardText, mode, note){
  // mode: 'new' | 'another' | 'shorten' | 'revise'
  const isRev = mode === 'revise';
  const name=A.name||'';
  const isMD=A.occasion==="Mother's Day",isFD=A.occasion==="Father's Day",isNND=A.occasion==="National Nurses Day",isLoss=A.occasion==="Sympathy",isApology=A.occasion==="Apology",isBirthday=A.occasion==="Birthday";
  // Only use birthday age and children when they belong to the current occasion
  // (they can be left over if the person changed the occasion after answering).
  const birthdayAge = isBirthday ? (A.birthdayAge||'') : '';
  const kidsText=(isMD||isFD)?A.kids.filter(k=>k&&(k.age||k.sex)).map(k=>{const p=[];if(k.sex)p.push(k.sex);if(k.age)p.push('age '+k.age);if(k.name)p.push('('+k.name+')');return p.join(' ');}).join(' | '):'';
  const tonesList=[...A.tones,...(A.toneOther?[A.toneOther]:[])];
  const toneVal=tonesList.join(' + ')||'Warm and heartfelt';
  const toneGuide=(tonesList.length?tonesList:['Warm and heartfelt']).map(t=>TONE_GUIDE[t]?'- '+t+': '+TONE_GUIDE[t]:'- '+t+' (the sender described this tone in their own words): follow it as written, including how light or heavy it should feel.').join('\n');
  const feelVal=A.feels.join(', ')||'loved';
  const lengthIsStandard = A.length===LENGTHS[1];
  const leansShort = tonesList.length>0 && tonesList.every(t=>SHORT_LEANING.includes(t));
  const lengthRule = lengthIsStandard
    ? '50 to 80 words.'
    : (leansShort && !isLoss
        ? '75 to 110 words. Stay in this range. Fill it with substance from the inputs, not padding or repetition.'
        : '100 to 130 words. Stay in this range. Fill it with substance from the inputs, not padding or repetition.');
  const fromGuide = A.from==='Me and my partner' ? 'Warm collective voice; use "we" and "us" naturally.'
    : (A.from==='From family'||/from family/i.test(A.senderAge||'')) ? 'Inclusive collective voice, written on behalf of everyone.'
    : A.from==='On behalf of someone else' ? 'The person filling this out is writing for someone else. Write in the voice of the actual sender, singular unless the inputs say otherwise. Never mention that someone helped write it.'
    : 'Singular voice throughout. Never use "we" to mean the sender.';
  const celebratory = CELEBRATORY.test(A.occasion||'') && !isLoss && !isApology;

  const faithText=(A.faithTradition||'');
const isChristianFaith=/christ|catholic|protestant|baptist|methodist|lutheran|presbyterian|episcopal|evangelical|pentecostal|anglican|denominational|latter.day|\blds\b|mormon/i.test(faithText)||(/orthodox/i.test(faithText)&&!/jew/i.test(faithText));
const isGodOptional=/jew|juda|muslim|islam|sikh|bah[aá]|hindu/i.test(faithText);
const isNoGod=/buddh/i.test(faithText);
const spiritualRule=A.spirituality==='None'||!A.spirituality?'No spiritual language of any kind.':A.spirituality==='Gently spiritual'?'Use gently universal spiritual language, such as grace, light, presence, purpose, or being held in kindness. Do not mention God, prayer, scripture, or any religion by name. Keep it to one or two light touches; the card should still read as warm and personal first.':'Use openly faith-based language. You may mention God, prayer, and blessings directly, and one short faith-centered line is welcome. Let faith feel woven in, not preached.'+(A.faithTradition?' PRIVATE CONTEXT, the sender faith tradition is: '+A.faithTradition+'. Write the faith language the way someone from within that tradition would naturally say it: the phrasing, blessings, and warmth that feel at home there, and the customs of that tradition for how God is referred to. NEVER name the religion, denomination, or tradition anywhere in the card. Do not mention specific rituals, saints, holy days, or practices unless the user included them elsewhere. Do not quote scripture or prayers. One or two natural touches is enough. It should sound like it came from someone who shares the faith, not someone describing it. If the tradition entered is unclear or is not a religion, use broadly shared faith language instead.'+(isChristianFaith?'  For this tradition, refer to God directly by name at least once, in a way that grows out of what the card is saying about this person, such as a blessing on their year ahead, gratitude for who they are, or a prayer for them. Write the God reference fresh for this specific card rather than using a stock phrase. Do not mention God more than twice.':isGodOptional?' Referring to God by name is welcome here if it fits naturally, but not required; blessing language alone is also fine. Do not mention God more than twice. Write "God" spelled out in full unless the user wrote it another way (such as "G-d") in their inputs, in which case match their spelling.':isNoGod?' This tradition generally does not center a creator God, so do not mention God. Express the faith through wishes for peace, ease, compassion, and well-being instead.':''):' Use broadly shared faith language (God, prayer, blessing) without naming a specific tradition.');

  const occasionRules=isLoss?'Sympathy. Gentleness and presence only. No silver linings. No fixing. Let them feel less alone.':isApology?'Apology. Sincere and direct. No deflecting. Own the moment.':isMD?'Mother\'s Day. No clichés: no unconditional love, no SuperMom. Honor the day through specificity. End the card with Happy Mother\'s Day as the final line.'+(kidsText?' Children: '+kidsText+'. Adult children reflect on what was already built. Young children tenderness about now.':''):isFD?'Father\'s Day. No clichés. End the card with Happy Father\'s Day as the final line.'+(kidsText?' Children: '+kidsText+'.':''):isNND?'National Nurses Day. Specific and respectful. No generic heroism.':isBirthday&&birthdayAge?'Birthday. Turning '+birthdayAge+'.'+(([30,40,50,60,70,80,90,100].includes(Number(birthdayAge)))?' Milestone.':''):'';

  const closingRule = celebratory
    ? 'End with a short, warm wish for the occasion as the final line (e.g. "Happy Birthday!"). It can be light or playful if the tone is; it does not need to be solemn.'
    : 'End with the natural close of the card for this tone. Do not force an occasion label as the final line.';

  const intensityRule = 'Match emotional intensity to the tone, the occasion, and the relationship. Most cards should be warm but not weighty. Understatement usually lands harder than declaration. Not every card needs a profound moment or a memorable final line. Never escalate beyond what the tone and inputs call for. Restraint is about emotional intensity, never length: a light or understated card still fills its full LENGTH.';
  const feelingsRule = 'The feelings above are the goal underneath the card, not words to put in it. Let them come through what is said; do not announce them (never write "you are deeply loved" or "I see you"). The TONE decides how they are expressed: in a funny card, "deeply loved" might show up as affectionate teasing, or one sincere line; in a reserved card, as one plain sentence.';

  const privateCtx = `RELATIONSHIP CONTEXT — CONFIDENTIAL WRITER BRIEFING ONLY:
"${A.relationshipCtx||''}"
This field is private context for the writer, never the card. Use it to understand emotional distance, what to avoid, and how measured the tone should be. If it contains something genuinely positive about the recipient, that quality may be reflected. Complicated or ambivalent feelings must never surface in the card. The card always builds from what is true and good.`;

  const coreRules = `- No greeting
- Always write in second person, speaking directly to the recipient. Never slip into third person (e.g. never "the person who..." or "someone who..."). Use "you" and "your" throughout. When referring to shared experiences between sender and recipient, use "we," "us," and "our," never "both of you," "the two of you," or any phrasing that positions the writer as an outside observer.
- Never use em dashes (—) anywhere in the card. They are a clear AI writing signal. Use periods, commas, or line breaks instead.
- Never use "journey," "words cannot express," or end with "always"
- CRITICAL: Never invent specific moments, events, or details not provided by the user. If no memory or specific moment was shared, write around feeling and relationship. Never fabricate a story, proposal, or event.
- CRITICAL: Treat every user input as a fact to reflect, not a story to expand. If someone says "two kittens," say two kittens. Do not add drama or narrative color. Embellish the feeling, never the facts.`;

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
- NAME RULE: ${name?'Use "'+name+'" once only, never more than once.':'No name.'}
- OPENING: ${A.opening?'Start with exactly: "'+A.opening+'"':'No greeting or opening line.'}
- SIGN-OFF: ${A.signoff?'End with exactly: "'+A.signoff+'"':'No sign-off.'}
${A.misc?'- INCLUDE IN CARD: "'+A.misc+'". Keep this in the card.':''}
${A.memory?'- SHARED MEMORY: "'+A.memory+'". Keep this woven in.':''}

${privateCtx}

ALWAYS:
${coreRules}

Fix ONLY what was flagged. Keep everything else. Write ONLY the revised card message, with no commentary or explanation.`;
  }

  return`ROLE AND STANDARD:
You are a senior greeting card writer with 20 years of experience. Your job is to write a card message that sounds like the sender wrote it themselves, on a good day, to this specific person. Not a card company, not AI. It should sound like this relationship actually sounds: sometimes tender, sometimes funny, sometimes plain. Real cards vary in tone and shape.

INPUTS:
${name?'RECIPIENT NAME: '+name:''}
CARD FROM: ${A.from||'Just me'}
${A.senderAge&&!/from family/i.test(A.senderAge)?'SENDER AGE: '+A.senderAge:''}
THE RECIPIENT IS MY: ${A.relationship||'—'} (this is who the recipient is to the sender)
${A.recipientAge?'RECIPIENT AGE: '+A.recipientAge:''}
OCCASION: ${A.occasion||'—'}
${birthdayAge?'TURNING: '+birthdayAge:''}
${kidsText?'CHILDREN: '+kidsText:''}
TONE: ${toneVal}
LENGTH: ${lengthRule}
SPIRITUALITY: ${A.spirituality||'None'}
WANT THEM TO FEEL: ${feelVal}
${A.memory?'SHARED MEMORY (card content): "'+A.memory+'"':''}
${A.misc?'INCLUDE IN CARD (fair game): "'+A.misc+'"':''}

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
- ${pick(OPENING_MOVES)} Never name the occasion in the opening.
- Middle: amplify what was expressed and give it room, in the card's tone. This is where most of the length lives. Build it from everything provided: who they are to the sender, the relationship context, the occasion, their ages and stage of life, what the sender wants them to feel, and any memories or details. If no memories were given, develop the feeling and the relationship more fully instead: what this person is like, what they bring to the sender's life, what the sender wishes for them. Never invent events or facts.
- Ending: as the TONE section says for this tone.
- Paragraphs: two or three short paragraphs. Never one long unbroken block.

LENGTH: ${lengthRule}
FROM GUIDANCE: ${fromGuide}
RELATIONSHIP GUIDANCE: Use who the recipient is to the sender to shape the register. To a spouse or partner: intimate and knowing. To a parent: respectful, warm, honoring. To a child: nurturing, proud, full of belief in them. To a friend: easy, real, peer-level. To a sibling: familiar, often teasing. To a colleague: professional warmth, never overly personal.
CHILDREN GUIDANCE: If children are listed, they may be referenced naturally once if it fits, never more. Do not make the card about the children.
AGE GUIDANCE: Use sender and recipient ages to calibrate vocabulary, references, and register. For teen senders, write naturally and warmly; no slang or trying to sound "young." If the recipient is older, never reference their age in a way that could feel diminishing.
SPIRITUALITY: ${spiritualRule}
OCCASION: ${occasionRules||'—'}
OPENING: ${A.opening?'Start the card with exactly: "'+A.opening+'". Use this and nothing else as the opening.':'No opening line. Do NOT add "Dear [name]" or any greeting. Start directly with the card message.'}
NAME RULE: ${name?'You may use "'+name+'" once only if it fits naturally mid-card. Never in the opening or closing. Never more than once.':'No name.'}
SIGN-OFF: ${A.signoff?'End the card with exactly: "'+A.signoff+'" on its own line. Use this and nothing else.':'No sign-off. Do NOT add "Love," or any closing. End with the last line of the message.'}
FINAL LINE: ${closingRule}

ABSOLUTE RULES:
- Write ONLY the card message
${coreRules}
- Reflect what was expressed; never project or assume beyond it
- Never assume anything about people not described in the inputs
- Card stays entirely about the recipient
- People before pets when listing names
- Never quote inputs verbatim. Put them in your own words, in the card's tone.

BEFORE YOU FINISH: count the words. If the card is under the LENGTH range, develop the middle further until it is within range.`;
}

const ANOTHER_SUFFIX = '\n\nIMPORTANT: Completely different opening, structure, and closing. Do not repeat or echo the previous version.';
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
      + (action === 'another' ? ANOTHER_SUFFIX : action === 'shorten' ? resizeSuffix(answers, currentCardText) : '');
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

    const text = data.content?.find(b => b.type === 'text')?.text || '';
    res.status(200).json({ text });
  } catch (e) {
    console.error('Generate error:', e);
    await alertOwner('Card generation failing', String(e));
    return res.status(503).json({ error: BUSY_MSG });
  }
}
