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
function buildPrompt(A, currentCardText, isRev, note){
  const name=A.name||'';
  const isMD=A.occasion==="Mother's Day",isFD=A.occasion==="Father's Day",isNND=A.occasion==="National Nurses Day",isLoss=A.occasion==="Sympathy",isApology=A.occasion==="Apology",isBirthday=A.occasion==="Birthday",isTOY=A.occasion==="Thinking of you";
  const kidsText=A.kids.filter(k=>k&&(k.age||k.sex)).map(k=>{const p=[];if(k.sex)p.push(k.sex);if(k.age)p.push('age '+k.age);if(k.name)p.push('('+k.name+')');return p.join(' ');}).join(' | ');
  const toneVal=[...A.tones,...(A.toneOther?[A.toneOther]:[])].join(' + ')||'Warm and heartfelt';
  const feelVal=A.feels.join(', ')||'loved';
  const faithText=(A.faithTradition||'');
const isChristianFaith=/christ|catholic|protestant|baptist|methodist|lutheran|presbyterian|episcopal|evangelical|pentecostal|anglican|denominational|latter.day|\blds\b|mormon/i.test(faithText)||(/orthodox/i.test(faithText)&&!/jew/i.test(faithText));
const isGodOptional=/jew|juda|muslim|islam|sikh|bah[aá]|hindu/i.test(faithText);
const isNoGod=/buddh/i.test(faithText);
const spiritualRule=A.spirituality==='None'||!A.spirituality?'No spiritual language of any kind.':A.spirituality==='Gently spiritual'?'Use gently universal spiritual language, such as grace, light, presence, purpose, or being held in kindness. Do not mention God, prayer, scripture, or any religion by name. Keep it to one or two light touches; the card should still read as warm and personal first.':'Use openly faith-based language. You may mention God, prayer, and blessings directly, and one short faith-centered line is welcome. Let faith feel woven in, not preached.'+(A.faithTradition?' PRIVATE CONTEXT, the sender faith tradition is: '+A.faithTradition+'. Write the faith language the way someone from within that tradition would naturally say it: the phrasing, blessings, and warmth that feel at home there, and the customs of that tradition for how God is referred to. NEVER name the religion, denomination, or tradition anywhere in the card. Do not mention specific rituals, saints, holy days, or practices unless the user included them elsewhere. Do not quote scripture or prayers. One or two natural touches is enough. It should sound like it came from someone who shares the faith, not someone describing it. If the tradition entered is unclear or is not a religion, use broadly shared faith language instead.'+(isChristianFaith?'  For this tradition, refer to God directly by name at least once, in a way that grows out of what the card is saying about this person, such as a blessing on their year ahead, gratitude for who they are, or a prayer for them. Write the God reference fresh for this specific card rather than using a stock phrase. Do not mention God more than twice.':isGodOptional?' Referring to God by name is welcome here if it fits naturally, but not required; blessing language alone is also fine. Do not mention God more than twice. Write "God" spelled out in full unless the user wrote it another way (such as "G-d") in their inputs, in which case match their spelling.':isNoGod?' This tradition generally does not center a creator God, so do not mention God. Express the faith through wishes for peace, ease, compassion, and well-being instead.':''):' Use broadly shared faith language (God, prayer, blessing) without naming a specific tradition.');
  const occasionRules=isLoss?'Sympathy. Gentleness and presence only. No silver linings. No fixing. Let them feel less alone.':isApology?'Apology. Sincere and direct. No deflecting. Own the moment.':isMD?'Mother\'s Day. No clichés: no unconditional love, no SuperMom. Honor the day through specificity. End the card with Happy Mother\'s Day as the final line.'+(kidsText?' Children: '+kidsText+'. Adult children reflect on what was already built. Young children tenderness about now.':''):isFD?'Father\'s Day. No clichés. End the card with Happy Father\'s Day as the final line.'+(kidsText?' Children: '+kidsText+'.':''):isNND?'National Nurses Day. Specific and respectful. No generic heroism.':isBirthday&&A.birthdayAge?'Birthday. Turning '+A.birthdayAge+'.'+(([30,40,50,60,70,80].includes(Number(A.birthdayAge)))?' Milestone.':''):'';
  if(isRev){
    return `This is a targeted revision of a greeting card.

CURRENT CARD:
"${currentCardText}"

WHAT TO FIX — FOLLOW THIS EXACTLY:
"${note}"

CRITICAL: The instruction above is a direct command. If it says to remove a word, remove it everywhere. If it says to add a specific phrase, include it verbatim. If it says to change the tone, change it. These are not suggestions — honor them precisely.

CARRY OVER ALL ORIGINAL RULES:
- TONE: ${toneVal}
- LENGTH: ${A.length||'handwritten note — 90 to 130 words'}
- SPIRITUALITY: ${spiritualRule}
- FORMAT: ${A.rhyme||'write it like a letter'}
- NAME RULE: ${A.name?'Use "'+A.name+'" once only — never more than once.':'No name.'}
- SIGN-OFF: ${A.signoff?'End with exactly: "'+A.signoff+'"':'No sign-off.'}
${A.misc?'- INCLUDE IN CARD: "'+A.misc+'" — keep this in the card.':''}
${A.memory?'- SHARED MEMORY: "'+A.memory+'" — keep this woven in.':''}

Fix ONLY what was flagged. Keep everything else. Write ONLY the revised card message — no commentary, no explanation.`;
  }
  return`ROLE AND STANDARD:
You are a senior greeting card writer with 20 years of experience. Your singular job is to write a card message that feels like it was written by someone who truly knows this recipient — not by a card company, not by AI. The gold standard: the recipient reads this and feels completely seen — not an idealized version of themselves, but exactly who they are in this relationship right now. You write for real relationships — complicated, evolving, quietly loving, deeply loving.

INPUTS:
${name?'RECIPIENT NAME: '+name:''}
CARD FROM: ${A.from||'Just me'}
${A.senderAge?'SENDER AGE: '+A.senderAge:''}
I AM THEIR: ${A.relationship||'—'}
${A.recipientAge?'RECIPIENT AGE: '+A.recipientAge:''}
OCCASION: ${A.occasion||'—'}
${A.birthdayAge?'TURNING: '+A.birthdayAge:''}
${kidsText?'CHILDREN: '+kidsText:''}
TONE: ${toneVal}
SPIRITUALITY: ${A.spirituality||'None'}
WANT THEM TO FEEL: ${feelVal}
LENGTH: ${A.length||'handwritten note — 90 to 130 words'}
FORMAT: ${A.rhyme||'write it like a letter'}
${A.memory?'SHARED MEMORY (card content): "'+A.memory+'"':''}
${A.misc?'INCLUDE IN CARD (fair game): "'+A.misc+'"':''}

RELATIONSHIP CONTEXT — CONFIDENTIAL WRITER BRIEFING ONLY:
"${A.relationshipCtx||''}"
CRITICAL: This field is private context for the writer — never the card. Use it to understand emotional distance, what to avoid, and how measured the tone should be. If it contains something genuinely positive about the recipient, that quality may be amplified. Complicated or ambivalent feelings must never surface in the card. The card always finds and builds from what is true and good.

INPUT HIERARCHY:
1. SHARED MEMORY and INCLUDE IN CARD — direct card content. Use it.
2. RELATIONSHIP CONTEXT — writer briefing only. Calibrate from it, never surface it.

CARD ARCHITECTURE:
1. OPENING — Specific and true about the recipient. Never generic. Never name the occasion.
2. MIDDLE — Amplify what was expressed. Give it more weight. Never project beyond what was provided.
3. CLOSING LINE — Inevitable. Quiet weight. They will remember it.

TONE GUIDE:
Warm and heartfelt: Flowing sentences, gentle rhythm, never saccharine.
Funny and playful: Short punchy sentences, wit over jokes, warmth underneath.
Honest and direct: Plain language, no flourish, feels said aloud.
Poetic and sentimental: Rhythm and imagery, earned emotion, beauty through specificity.
Lighthearted but real: Starts light, lands with genuine feeling.
Reserved but sincere: Understated, says less means more.
Celebratory and upbeat: Energetic, warm, joy-forward.
Tender and gentle: Soft, careful, quietly loving.

LENGTH: Standard card length 50-80 words. Handwritten note 90-130 words.
FROM GUIDANCE: If the card is from "Just me" — singular voice throughout, never use "we." If from "Me and my partner" — warm collective voice, use "we" and "us" naturally. If from "From family" or "varies — from family" — inclusive collective voice, written on behalf of everyone.
RELATIONSHIP GUIDANCE: Use the relationship type to shape emotional register. Writing to a spouse or partner: intimate and knowing. To a parent: respectful, warm, honoring. To a child: nurturing, proud, full of belief in them. To a friend: easy, real, peer-level warmth. To a colleague: professional warmth, never overly personal.
CHILDREN GUIDANCE: If children are listed, they may be referenced naturally once if it fits — never more. Do not make the card about the children. They add texture, not focus.
AGE GUIDANCE: Use sender and recipient ages to calibrate vocabulary, cultural references, and emotional register. A card from an older sender carries more gravitas; a younger sender reads lighter and more immediate. For teen senders, write naturally and warmly — do not use slang, Gen Z references, or try to sound "young." If the recipient is older, never reference their age in a way that could feel diminishing or make them feel old. The card should feel timeless regardless of age.
SPIRITUALITY: ${spiritualRule}
OCCASION: ${occasionRules}
OPENING: ${A.opening?'Start the card with exactly: "'+A.opening+'" — use this and nothing else as the opening.':'No opening line. Do NOT add "Dear [name]" or any greeting. Start directly with the card message.'}
NAME RULE: ${name?'You may use "'+name+'" once only if it fits naturally mid-card. Never in the opening or closing — those are handled separately. Never more than once.':'No name.'}
SIGN-OFF: ${A.signoff?'End the card with exactly: "'+A.signoff+'" on its own line — use this and nothing else.':'No sign-off. Do NOT add "Love," or any closing. End with the last line of the message.'}
ABSOLUTE RULES:
- Write ONLY the card message
- Structure the card in 2-3 short paragraphs. Never write it as one long unbroken block.
- Always write in second person, speaking directly to the recipient. Never slip into third person (e.g. never "the person who..." or "someone who..."). Use "you" and "your" throughout. When referring to shared experiences between sender and recipient, use "we," "us," and "our" — never "both of you," "the two of you," or any phrasing that positions the writer as an outside observer.
- No greeting
- Amplify what was expressed — never project or assume beyond it
- Never assume anything about people not described in the inputs
- Card stays entirely about the recipient
- People before pets when listing names
- Never quote inputs verbatim — transform into language with more weight
- Never use "journey," "words cannot express," or end with "always"
- Never use em dashes (—) anywhere in the card. They are a clear AI writing signal. Use periods, commas, or line breaks instead.
- CRITICAL: Never invent specific moments, events, or details not provided by the user. If no memory or specific moment was shared, write around feeling and relationship — never fabricate a story, proposal, or event.
- CRITICAL: Treat every user input as a fact to reflect, not a story to expand. If someone says "two kittens" — say two kittens. Do not add chaos, drama, or narrative color around it. If someone says "two sons" — say two sons. Do not editorialize about how they turned out or imply anything about their story. Report what was given. Embellish the emotion, never the facts.
- For celebratory occasions (birthday, anniversary, graduation, congratulations, wedding, thanksgiving, christmas, father's day, mother's day), end with a warm celebration of the occasion as the final line (e.g. "Happy Birthday," "Happy Anniversary," "Happy Father's Day," "Happy Mother's Day"). For emotionally complex occasions (sympathy, illness, apology, thinking of you), end with the natural emotional close of the card — do not force an occasion label as the final line.`;
}

const ANOTHER_SUFFIX = '\n\nIMPORTANT: Completely different opening, structure, and closing. Do not repeat or echo the previous version.';
const SHORTEN_SUFFIX = '\n\nIMPORTANT: Write a version of this card at the specified length. Keep the same emotional core, voice, and key details. Match the paragraph structure and format of the current version — same number of paragraphs, same rhythm.';
const LENGTHS = ['handwritten note — 90 to 130 words', 'standard card length — 50 to 80 words'];
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
    if (action === 'revise') prompt = buildPrompt(answers, currentCardText, true, note);
    else prompt = buildPrompt(answers, currentCardText, false)
      + (action === 'another' ? ANOTHER_SUFFIX : action === 'shorten' ? SHORTEN_SUFFIX : '');
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
