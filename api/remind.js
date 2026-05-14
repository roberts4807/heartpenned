const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, occasion, recipientName, reminderDate } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  const occasionLabel = occasion
    ? occasion.charAt(0).toUpperCase() + occasion.slice(1)
    : 'Special occasion';

  // Use provided date or fall back to next year
  let displayDate = reminderDate;
  if (!displayDate) {
    const now = new Date();
    displayDate = `${now.getFullYear() + 1}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }

  // Format date nicely for email
  const dateObj = new Date(displayDate + 'T12:00:00');
  const niceDate = dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  try {
    // Get or create audience
    let audienceId;
    const audiencesRes = await fetch('https://api.resend.com/audiences', {
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    const audiencesData = await audiencesRes.json();

    if (audiencesData?.data?.length > 0) {
      audienceId = audiencesData.data[0].id;
    } else {
      const createRes = await fetch('https://api.resend.com/audiences', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: 'HeartPenned Reminders' })
      });
      const createData = await createRes.json();
      audienceId = createData?.id;
    }

    if (!audienceId) throw new Error('Could not get or create audience');

    await resend.contacts.create({
      email,
      firstName: recipientName || '',
      lastName: '',
      unsubscribed: false,
      audienceId,
    });

    await resend.emails.send({
      from: 'HeartPenned <hello@heartpenned.com>',
      to: [email],
      subject: `Reminder set for ${recipientName ? recipientName + "'s " : ''}${occasionLabel} 💌`,
      html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f4f4f4;font-family:Georgia,serif;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f4f4f4;"><tr><td style="padding:40px 20px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:520px;margin:0 auto;"><tr><td style="background:linear-gradient(135deg,#667EEA 0%,#A78BFA 100%);border-radius:16px 16px 0 0;padding:32px 40px;text-align:center;"><p style="margin:0 0 6px;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.8);">HeartPenned</p><h1 style="margin:0;font-size:24px;font-weight:normal;color:#fff;">Reminder saved</h1></td></tr><tr><td style="background:#fff;padding:36px 40px;border-left:1px solid #e8e8e8;border-right:1px solid #e8e8e8;"><p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#2d2d2d;">We will remind you on <strong>${niceDate}</strong> so you never miss ${recipientName ? recipientName + "'s " : 'this '}${occasionLabel}.</p><p style="margin:0;font-size:15px;line-height:1.7;color:#555;">Your card will be ready to inspire next year.</p></td></tr><tr><td style="background:linear-gradient(135deg,#667EEA 0%,#A78BFA 100%);height:5px;border-radius:0 0 16px 16px;"></td></tr><tr><td style="padding:20px 0;text-align:center;"><p style="margin:0;font-size:12px;color:#999;">Sent with <a href="https://heartpenned.com" style="color:#667EEA;text-decoration:none;">HeartPenned</a></p></td></tr></table></td></tr></table></body></html>`
    });

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Remind error:', error);
    return res.status(500).json({ error: 'Failed to save reminder. Please try again.' });
  }
};
