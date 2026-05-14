const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, occasion, recipientName, occasionDate, reminderDate } = req.body;

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

  // Format dates nicely
  function niceDate(d) {
    if (!d) return null;
    const obj = new Date(d + 'T12:00:00');
    return obj.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  const niceOccasionDate = niceDate(occasionDate);
  const niceReminderDate = niceDate(reminderDate);

  try {
    // Add contact using new global contacts API (no audienceId needed)
    await resend.contacts.create({
      email,
      firstName: recipientName || '',
      lastName: '',
      unsubscribed: false,
    });

    // Send confirmation email
    await resend.emails.send({
      from: 'HeartPenned <hello@heartpenned.com>',
      to: [email],
      subject: `Reminder set for ${recipientName ? recipientName + "'s " : ''}${occasionLabel} 💌`,
      html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f4f4f4;font-family:Georgia,serif;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f4f4f4;"><tr><td style="padding:40px 20px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:520px;margin:0 auto;"><tr><td style="background:linear-gradient(135deg,#667EEA 0%,#A78BFA 100%);border-radius:16px 16px 0 0;padding:32px 40px;text-align:center;"><p style="margin:0 0 6px;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.8);">HeartPenned</p><h1 style="margin:0;font-size:24px;font-weight:normal;color:#fff;">Reminder saved</h1></td></tr><tr><td style="background:#fff;padding:36px 40px;border-left:1px solid #e8e8e8;border-right:1px solid #e8e8e8;">${niceOccasionDate ? '<p style="margin:0 0 12px;font-size:16px;line-height:1.7;color:#2d2d2d;"><strong>Occasion date:</strong> ' + niceOccasionDate + '</p>' : ''}<p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#2d2d2d;">${niceReminderDate ? 'We will remind you on <strong>' + niceReminderDate + '</strong> so you have time to write the perfect card.' : 'Your reminder has been saved.'}</p><p style="margin:0;font-size:15px;line-height:1.7;color:#555;">HeartPenned will be here when you need it.</p></td></tr><tr><td style="background:linear-gradient(135deg,#667EEA 0%,#A78BFA 100%);height:5px;border-radius:0 0 16px 16px;"></td></tr><tr><td style="padding:20px 0;text-align:center;"><p style="margin:0;font-size:12px;color:#999;">Sent with <a href="https://heartpenned.com" style="color:#667EEA;text-decoration:none;">HeartPenned</a></p><p style="margin:6px 0 0;font-size:11px;color:#bbb;"><a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#bbb;text-decoration:underline;">Unsubscribe from reminders</a></p></td></tr></table></td></tr></table></body></html>`
    });

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Remind error:', error);
    return res.status(500).json({ error: 'Failed to save reminder. Please try again.' });
  }
};
