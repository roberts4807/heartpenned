const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const themeColors = {
  birthday:        { from: '#FF6B9D', to: '#FFB347', accent: '#FF4757', light: '#FFF0F5' },
  anniversary:     { from: '#C9A96E', to: '#E8D5B0', accent: '#8B6914', light: '#FDF8F0' },
  wedding:         { from: '#F8BBD9', to: '#E8D5F0', accent: '#AD5F8A', light: '#FDF5FB' },
  sympathy:        { from: '#7B9EA6', to: '#B8D4DA', accent: '#3D6B75', light: '#F0F7F9' },
  congratulations: { from: '#4ECDC4', to: '#95E1D3', accent: '#1A7A72', light: '#F0FDFB' },
  thanksgiving:    { from: '#E07B39', to: '#F4A261', accent: '#8B3E0F', light: '#FEF6EE' },
  christmas:       { from: '#2D6A4F', to: '#74C69D', accent: '#1B4332', light: '#F0FBF5' },
  default:         { from: '#667EEA', to: '#A78BFA', accent: '#4C51BF', light: '#F5F3FF' },
};

function getTheme(occasion) {
  if (!occasion) return themeColors.default;
  const key = occasion.toLowerCase();
  for (const [name, colors] of Object.entries(themeColors)) {
    if (key.includes(name)) return colors;
  }
  return themeColors.default;
}

function buildCardEmail({ recipientName, senderName, cardText, occasion }) {
  const theme = getTheme(occasion);
  const greeting = recipientName ? 'Dear ' + recipientName + ',' : '';
  const signoff = senderName ? 'With love,<br><strong>' + senderName + '</strong>' : '';
  const occasionLabel = occasion ? occasion.charAt(0).toUpperCase() + occasion.slice(1) : 'A Special Message';

  const paragraphs = cardText
    .split('\n')
    .filter(function(p) { return p.trim(); })
    .map(function(p) { return '<p style="margin: 0 0 16px 0; line-height: 1.8;">' + p.trim() + '</p>'; })
    .join('');

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>' + occasionLabel + '</title></head><body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Georgia,serif;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f4f4f4;"><tr><td style="padding:40px 20px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;margin:0 auto;"><tr><td style="background:linear-gradient(135deg,' + theme.from + ' 0%,' + theme.to + ' 100%);border-radius:16px 16px 0 0;padding:40px 48px 32px;text-align:center;"><p style="margin:0 0 8px 0;font-size:13px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.85);">HeartPenned</p><h1 style="margin:0;font-family:Georgia,serif;font-size:28px;font-weight:normal;color:#ffffff;">' + occasionLabel + '</h1></td></tr><tr><td style="background-color:#ffffff;padding:48px 48px 40px;border-left:1px solid #e8e8e8;border-right:1px solid #e8e8e8;">' + (greeting ? '<p style="margin:0 0 24px 0;font-size:18px;color:' + theme.accent + ';font-style:italic;">' + greeting + '</p>' : '') + '<div style="font-size:17px;line-height:1.8;color:#2d2d2d;">' + paragraphs + '</div>' + (signoff ? '<div style="margin-top:32px;padding-top:24px;border-top:1px solid ' + theme.light + ';font-size:16px;color:#4a4a4a;font-style:italic;">' + signoff + '</div>' : '') + '</td></tr><tr><td style="background:linear-gradient(135deg,' + theme.from + ' 0%,' + theme.to + ' 100%);height:6px;border-radius:0 0 16px 16px;"></td></tr><tr><td style="padding:24px 0 0;text-align:center;"><p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#999999;">Sent with <a href="https://heartpenned.com" style="color:' + theme.accent + ';text-decoration:none;">HeartPenned</a> &middot; Because some words matter</p></td></tr></table></td></tr></table></body></html>';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { recipientEmail, recipientName, senderName, cardText, occasion } = req.body;

  if (!recipientEmail || !cardText) {
    return res.status(400).json({ error: 'Recipient email and card text are required.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(recipientEmail)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  const occasionLabel = occasion
    ? occasion.charAt(0).toUpperCase() + occasion.slice(1)
    : 'A Special Message';

  const subject = senderName
    ? senderName + ' sent you a ' + occasionLabel + ' card 💌'
    : 'You have a ' + occasionLabel + ' card 💌';

  try {
    const data = await resend.emails.send({
      from: 'HeartPenned <hello@heartpenned.com>',
      to: [recipientEmail],
      subject: subject,
      html: buildCardEmail({ recipientName: recipientName, senderName: senderName, cardText: cardText, occasion: occasion }),
    });

    return res.status(200).json({ success: true, id: data.id });
  } catch (error) {
    console.error('Resend error:', error);
    return res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }
};
