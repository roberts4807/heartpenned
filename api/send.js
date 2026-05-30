const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// Colors keyed by occasion (fallback when no themeId passed)
const occasionColors = {
  birthday:        { from: '#FF6B9D', to: '#FFB347', accent: '#FF4757' },
  anniversary:     { from: '#C9A96E', to: '#E8D5B0', accent: '#8B6914' },
  wedding:         { from: '#F8BBD9', to: '#E8D5F0', accent: '#AD5F8A' },
  sympathy:        { from: '#7B9EA6', to: '#B8D4DA', accent: '#3D6B75' },
  congratulations: { from: '#4ECDC4', to: '#95E1D3', accent: '#1A7A72' },
  thanksgiving:    { from: '#E07B39', to: '#F4A261', accent: '#8B3E0F' },
  christmas:       { from: '#2D6A4F', to: '#74C69D', accent: '#1B4332' },
  default:         { from: '#667EEA', to: '#A78BFA', accent: '#4C51BF' },
};

// Colors keyed by themeId (matches CARD_THEMES in index.html)
const themeIdColors = {
  warm:     { from: '#F5C28A', to: '#F0A060', accent: '#8B5A20' },
  blush:    { from: '#F9A8C0', to: '#F472A0', accent: '#C0446A' },
  sage:     { from: '#8BC8A0', to: '#5FAA78', accent: '#2A6A40' },
  twilight: { from: '#8890E0', to: '#6070C8', accent: '#2A3A8A' },
  gold:     { from: '#E8C84A', to: '#C8A020', accent: '#7A6010' },
  slate:    { from: '#8A9BB0', to: '#6A7A90', accent: '#3A5060' },
  dusk:     { from: '#C090D0', to: '#9060B0', accent: '#602080' },
};

function getColors(occasion, themeId) {
  if (themeId && themeIdColors[themeId]) return themeIdColors[themeId];
  if (!occasion) return occasionColors.default;
  const key = occasion.toLowerCase();
  for (const [name, colors] of Object.entries(occasionColors)) {
    if (key.includes(name)) return colors;
  }
  return occasionColors.default;
}

function buildCardEmail({ recipientName, senderName, cardText, occasion, themeId, headerImageUrl, isSenderCopy }) {
  const colors = getColors(occasion, themeId);
  const occasionLabel = occasion
    ? occasion.charAt(0).toUpperCase() + occasion.slice(1)
    : 'A Special Message';

  const paragraphs = cardText
    .split('\n')
    .filter(p => p.trim())
    .map(p => `<p style="margin:0 0 16px 0;line-height:1.8;">${p.trim()}</p>`)
    .join('');

  // Build header — image if available, gradient fallback otherwise
  const headerHtml = headerImageUrl
    ? `<tr>
        <td style="border-radius:16px 16px 0 0;overflow:hidden;line-height:0;font-size:0;">
          <img src="${headerImageUrl}" alt="${occasionLabel}" width="560" style="width:100%;max-width:560px;height:160px;object-fit:cover;object-position:top;display:block;border-radius:16px 16px 0 0;" />
        </td>
      </tr>`
    : `<tr>
        <td style="background:linear-gradient(135deg,${colors.from} 0%,${colors.to} 100%);border-radius:16px 16px 0 0;padding:40px 48px 32px;text-align:center;">
          <p style="margin:0 0 8px 0;font-size:13px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.85);">HeartPenned</p>
          <h1 style="margin:0;font-family:Georgia,serif;font-size:28px;font-weight:normal;color:#ffffff;">${occasionLabel}</h1>
        </td>
      </tr>`;

  // Confirmation banner shown only to sender
  const recipientDisplay = recipientName || 'your recipient';
  const confirmationBanner = isSenderCopy
    ? `<tr>
        <td style="background-color:#F0F4FF;border:1px solid #D0D8F0;border-radius:10px;padding:16px 24px;margin-bottom:24px;">
          <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#3A4A7A;line-height:1.6;">
            <strong>Your card was sent.</strong> Below is exactly what <strong>${recipientDisplay}</strong> received.
          </p>
        </td>
      </tr>
      <tr><td style="height:24px;"></td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${occasionLabel}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Georgia,serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f4f4f4;">
    <tr><td style="padding:40px 20px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;margin:0 auto;">
        ${confirmationBanner}
        ${headerHtml}
        <tr>
          <td style="background-color:#ffffff;padding:48px 48px 40px;border-left:1px solid #e8e8e8;border-right:1px solid #e8e8e8;">
            <div style="font-size:17px;line-height:1.8;color:#2d2d2d;">${paragraphs}</div>
          </td>
        </tr>
        <tr>
          <td style="background:linear-gradient(135deg,${colors.from} 0%,${colors.to} 100%);height:6px;border-radius:0 0 16px 16px;"></td>
        </tr>
        <tr>
          <td style="padding:24px 0 0;text-align:center;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#999999;line-height:1.8;">
              Sent with <a href="https://heartpenned.com" style="color:${colors.accent};text-decoration:none;">HeartPenned</a><br>
              <strong style="color:#666666;">Simply reply to respond to sender.</strong>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { recipientEmail, recipientName, senderName, cardText, occasion, themeId, headerImageUrl, isSenderCopy } = req.body;

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

  const subject = isSenderCopy
    ? `Your HeartPenned card — ${occasionLabel} 💌`
    : senderName
      ? `${senderName} sent you a ${occasionLabel} card 💌`
      : `You have a ${occasionLabel} card 💌`;

  try {
  const data = await resend.emails.send({
      from: 'HeartPenned <hello@heartpenned.com>',
      to: [recipientEmail],
      subject,
      ...(req.body.senderEmail && !isSenderCopy ? { reply_to: req.body.senderEmail } : {}),
      html: buildCardEmail({ recipientName, senderName, cardText, occasion, themeId, headerImageUrl, isSenderCopy }),
    });

    return res.status(200).json({ success: true, id: data.id });
  } catch (error) {
    console.error('Resend error:', error);
    return res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }
};
