// POST /api/intent
// Raporu okuyan kişinin görüşme talebini kaydeder ve anında bildirim gönderir.
// Body: { id, phone, preferredTime, message }

import { query } from './_db.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id, phone, preferredTime, message } = req.body || {};
  if (!id || !UUID_RE.test(id)) return res.status(400).json({ error: 'Kayıt bulunamadı.' });

  let row = null;
  try {
    const result = await query(
      `UPDATE public.nabiz_submissions
       SET meeting_requested      = true,
           meeting_requested_at   = now(),
           phone                  = $2,
           preferred_time         = $3,
           message                = $4
       WHERE id = $1
       RETURNING *`,
      [id, phone || null, preferredTime || null, message || null]
    );
    row = result.rows[0] || null;
    if (!row) return res.status(404).json({ error: 'Kayıt bulunamadı.' });
  } catch (e) {
    console.error('intent:', e);
    return res.status(500).json({ error: 'Talep kaydedilemedi.' });
  }

  // Anında bildirim — sıcak lead beklemez
  if (process.env.RESEND_API_KEY && process.env.MAIL_BCC && row) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        body: JSON.stringify({
          from: process.env.MAIL_FROM,
          to: [process.env.MAIL_BCC],
          reply_to: row.email,
          subject: `🔔 Görüşme talebi — ${row.company} (${row.total_score}/100)`,
          html: `<div style="font-family:Calibri,Arial,sans-serif;max-width:560px;color:#0F2438;line-height:1.6">
            <h2 style="color:#1B3A5C;margin:0 0 14px">Görüşme talebi geldi</h2>
            <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
              ${[
                ['Şirket', row.company],
                ['Kişi', `${row.name || ''}${row.job_title ? ' — ' + row.job_title : ''}`],
                ['E-posta', row.email],
                ['Telefon', row.phone || '—'],
                ['Sektör', row.sector || '—'],
                ['Çalışan', row.company_size || '—'],
                ['Skor', `${row.total_score}/100 — ${row.band}`],
                ['Bilgi yok', `${row.unknown_count} / 10`],
                ['Tercih ettiği zaman', row.preferred_time || '—']
              ].map(([k, v]) => `<tr>
                   <td style="padding:5px 14px 5px 0;color:#5B7189;white-space:nowrap">${k}</td>
                   <td style="padding:5px 0;font-weight:600">${String(v || '—')}</td></tr>`).join('')}
            </table>
            ${row.message ? `<p style="margin:16px 0 0;padding:12px;background:#F2F6F9;border-left:3px solid #10B981">${
              String(row.message).replace(/</g, '&lt;')}</p>` : ''}
            <p style="margin:18px 0 0;font-size:13px;color:#5B7189">Bu e-postayı yanıtlarsanız doğrudan kişiye gider.</p>
          </div>`
        })
      });
    } catch (e) {
      console.error('intent notify:', e);
    }
  }

  return res.status(200).json({ ok: true });
}
