// POST /api/track
// Huni olayı kaydeder. Kişisel veri toplamaz: isim, e-posta, IP, çerez yok.
// Body: { sid, type, step, ref, device }

import { query } from './_db.mjs';

const TYPES = ['view', 'start', 'step', 'capture', 'submit', 'intent'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { sid, type, step, ref, device } = req.body || {};
  if (!sid || !TYPES.includes(type)) return res.status(204).end();

  try {
    await query(
      'INSERT INTO public.nabiz_events (sid, type, step, ref, device) VALUES ($1, $2, $3, $4, $5)',
      [
        String(sid).slice(0, 40),
        type,
        Number.isInteger(step) && step >= 1 && step <= 10 ? step : null,
        ref ? String(ref).slice(0, 80) : null,
        device === 'mobile' ? 'mobile' : 'desktop'
      ]
    );
  } catch (e) {
    console.error('track:', e);
  }

  // Ölçüm hiçbir zaman kullanıcıyı bekletmez ya da hata göstermez.
  return res.status(204).end();
}
