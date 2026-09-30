// /api/panel — takip paneli veri ucu
// GET   : kayıt listesi          (x-panel-key başlığı zorunlu)
// GET   : ?view=funnel           (huni + adım + kaynak verisi)
// PATCH : durum / not güncelleme  (x-panel-key başlığı zorunlu)
//
// Ortam değişkeni: PANEL_KEY

import { query } from './_db.mjs';

function authed(req) {
  const key = req.headers['x-panel-key'];
  const expected = process.env.PANEL_KEY;
  if (!expected || !key) return false;
  const a = Buffer.from(String(key));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const FIELDS = [
  'id', 'created_at', 'name', 'job_title', 'email', 'phone', 'company', 'sector',
  'company_size', 'dim_scores', 'd1', 'd2', 'd3', 'd4', 'd5', 'total_score', 'band',
  'unknown_count', 'report', 'benchmark_label', 'benchmark_n', 'meeting_requested',
  'meeting_requested_at', 'preferred_time', 'message', 'status', 'contacted_at',
  'next_action_at', 'notes'
];

// Fonksiyon adları sabit eşleme tablosundan gelir — kullanıcı girdisi SQL'e yansımaz.
const FN_MAP = {
  funnel:  'nabiz_funnel',
  steps:   'nabiz_steps',
  sources: 'nabiz_sources'
};

export default async function handler(req, res) {
  if (!authed(req)) return res.status(401).json({ error: 'Yetkisiz.' });

  // Huni verisi
  if (req.method === 'GET' && req.query?.view === 'funnel') {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const callFn = async (key) => {
      const r = await query(`SELECT * FROM public.${FN_MAP[key]}($1)`, [days]);
      return r.rows;
    };
    try {
      const [f, st, src] = await Promise.all([
        callFn('funnel'),
        callFn('steps'),
        callFn('sources')
      ]);
      return res.status(200).json({
        funnel: f[0] || null,
        steps: st || [],
        sources: src || []
      });
    } catch (e) {
      console.error('panel funnel:', e);
      return res.status(500).json({ error: 'Huni verisi okunamadı.' });
    }
  }

  // Kayıt listesi
  if (req.method === 'GET') {
    try {
      const r = await query(
        `SELECT ${FIELDS.join(', ')}
         FROM public.nabiz_submissions
         WHERE kvkk_consent = true
         ORDER BY created_at DESC
         LIMIT 500`,
        []
      );
      return res.status(200).json({ rows: r.rows });
    } catch (e) {
      console.error('panel get:', e);
      return res.status(500).json({ error: 'Kayıtlar okunamadı.' });
    }
  }

  // Durum / not güncelleme — yalnızca izinli kolonlar
  if (req.method === 'PATCH') {
    const { id, status, notes, next_action_at, contacted } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Kayıt belirtilmedi.' });

    const setClauses = [];
    const params = [id];
    let i = 2;

    if (status !== undefined)        { setClauses.push(`status = $${i++}`);         params.push(status); }
    if (notes !== undefined)         { setClauses.push(`notes = $${i++}`);          params.push(notes !== null ? notes : null); }
    if (next_action_at !== undefined){ setClauses.push(`next_action_at = $${i++}`); params.push(next_action_at || null); }
    if (contacted === true)          { setClauses.push('contacted_at = now()'); }
    if (contacted === false)         { setClauses.push('contacted_at = null'); }

    if (!setClauses.length) return res.status(400).json({ error: 'Değişiklik yok.' });

    try {
      const r = await query(
        `UPDATE public.nabiz_submissions
         SET ${setClauses.join(', ')}
         WHERE id = $1
         RETURNING *`,
        params
      );
      return res.status(200).json({ row: r.rows[0] || null });
    } catch (e) {
      console.error('panel patch:', e);
      return res.status(500).json({ error: 'Güncellenemedi.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
