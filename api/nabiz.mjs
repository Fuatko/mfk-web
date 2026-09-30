// POST /api/nabiz
// Kıyaslama hesaplar, Claude ile yapılandırılmış bulgu raporu üretir,
// veritabanına kaydeder ve isteğe bağlı olarak e-posta gönderir.
//
// Ortam değişkenleri: NABIZ_DATABASE_URL, ANTHROPIC_API_KEY
//                     RESEND_API_KEY, MAIL_FROM, MAIL_BCC  (opsiyonel)

import { query } from './_db.mjs';

const LEVELS = [
  'Böyle bir uygulama yok',
  'Var ama kişiye bağlı, yazılı değil',
  'Kısmen yazılı, düzensiz uygulanıyor',
  'Yazılı ve düzenli uygulanıyor',
  'Uygulanıyor ve düzenli denetleniyor',
  'Denetleniyor, verisiyle iyileştiriliyor'
];

// Kıyaslama: önce sektör, yetersizse genel. 10'un altında hiç döndürme.
async function getBenchmark(sector) {
  const call = async (p_sector) => {
    const r = await query('SELECT * FROM public.nabiz_benchmark($1)', [p_sector]);
    return r.rows[0] || null;
  };
  try {
    if (sector) {
      const s = await call(sector);
      if (s && Number(s.n) >= 10) {
        return { label: sector + ' sektörü', n: Number(s.n), avg_total: s.avg_total,
                 dims: [s.avg_d1, s.avg_d2, s.avg_d3, s.avg_d4, s.avg_d5] };
      }
    }
    const g = await call(null);
    if (g && Number(g.n) >= 10) {
      return { label: 'Tüm katılımcılar', n: Number(g.n), avg_total: g.avg_total,
               dims: [g.avg_d1, g.avg_d2, g.avg_d3, g.avg_d4, g.avg_d5] };
    }
  } catch (e) { console.error('benchmark:', e); }
  return null;
}

function parseJson(text) {
  if (!text) return null;
  const clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(clean); } catch (_) {}
  const a = clean.indexOf('{'), b = clean.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(clean.slice(a, b + 1)); } catch (_) {} }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const b = req.body || {};
  const { name, title, email, company, sector, size, answers, total, dims, band, unknown, kvkk } = b;

  if (!kvkk) return res.status(400).json({ error: 'KVKK onayı gerekli.' });
  if (!email || !company || !Array.isArray(answers) || answers.length !== 10) {
    return res.status(400).json({ error: 'Eksik veya hatalı veri.' });
  }

  // Boyut adlarını beyaz listeye karşı doğrula; istemciden gelen serbest metin prompt'a girmemeli.
  const RESMI_BOYUTLAR = [
    'Stratejik Yönetim',
    'Süreç ve Standartlar',
    'İnsan ve Performans',
    'Veri ve Ölçüm',
    'Yönetişim ve Süreklilik',
  ];
  if (!Array.isArray(dims) || dims.length !== 5 ||
      dims.some((d, i) => d.name !== RESMI_BOYUTLAR[i])) {
    return res.status(400).json({ error: 'Geçersiz boyut adı.' });
  }

  const bench = await getBenchmark(sector);

  const measured = dims.filter(d => d.score !== null);
  const weakest = [...measured].sort((a, c) => a.score - c.score).slice(0, 2);
  const strongest = [...measured].sort((a, c) => c.score - a.score)[0];
  const unmeasured = dims.filter(d => d.score === null).map(d => d.name);

  // Kıyaslamadan türeyen, uydurulmamış fırsat/tehdit dayanağı
  let gap = '';
  if (bench) {
    const below = dims.map((d, i) => ({ n: d.name, s: d.score, avg: bench.dims[i] }))
      .filter(x => x.s !== null && x.avg !== null && x.s < x.avg);
    const above = dims.map((d, i) => ({ n: d.name, s: d.score, avg: bench.dims[i] }))
      .filter(x => x.s !== null && x.avg !== null && x.s > x.avg);
    gap = `\nORTALAMANIN ALTINDA KALAN BOYUTLAR: ${below.length ? below.map(x => `${x.n} (${x.s} / ort. ${x.avg})`).join('; ') : 'yok'}` +
          `\nORTALAMANIN ÜSTÜNDE OLAN BOYUTLAR: ${above.length ? above.map(x => `${x.n} (${x.s} / ort. ${x.avg})`).join('; ') : 'yok'}`;
  }

  let out = null, raw = '';
  try {
    const prompt = `Aşağıdaki şirket için "Kurumsal Nabız Teşhisi" ön bulgu raporu hazırla.

ŞİRKET: ${company}
SEKTÖR: ${sector || 'belirtilmemiş'}
ÇALIŞAN SAYISI: ${size || 'belirtilmemiş'}
DEĞERLENDİRENİN UNVANI: ${title || 'belirtilmemiş'}

Ölçek altı kademeli olgunluk ölçeğidir:
${LEVELS.map((l, i) => `${i} = ${l}`).join('\n')}
"Bilgim yok" yanıtları skora dahil edilmemiştir.

GENEL OLGUNLUK SKORU: ${total}/100 — seviye: ${band}
BOYUT SKORLARI:
${dims.map(d => `- ${d.name}: ${d.score === null ? 'ölçülemedi (bilgi yok)' : d.score + '/100'}`).join('\n')}

EN ZAYIF İKİ BOYUT: ${weakest.map(d => `${d.name} (${d.score})`).join(', ') || 'yok'}
EN GÜÇLÜ BOYUT: ${strongest ? `${strongest.name} (${strongest.score})` : 'yok'}
"BİLGİM YOK" SAYISI: ${unknown || 0} / 10
${unmeasured.length ? `HİÇ ÖLÇÜLEMEYEN BOYUTLAR: ${unmeasured.join(', ')}` : ''}
${bench ? `KIYASLAMA (${bench.label}, ${bench.n} şirket): ortalama ${bench.avg_total}/100. Boyut ortalamaları sırasıyla: ${bench.dims.join(', ')}.${gap}` : 'KIYASLAMA: yeterli veri yok. Rapora kıyaslama yazma, sektör ortalamasından hiç bahsetme.'}

YALNIZCA aşağıdaki yapıda geçerli JSON döndür. Öncesinde ve sonrasında hiçbir metin, açıklama veya kod bloğu işareti olmasın.

{
  "gzft": {
    "guclu":  ["madde", "madde"],
    "zayif":  ["madde", "madde"],
    "firsat": ["madde", "madde"],
    "tehdit": ["madde", "madde"]
  },
  "plan": [
    {"adim":"...", "rol":"...", "sure":"...", "cikti":"..."}
  ],
  "rapor": "markdown metin",
  "kapanis": "tek paragraf"
}

Kurallar:

GZFT — her kutuda 2 ya da 3 madde, her madde tek cümle ve en fazla 20 kelime.
- "guclu" ve "zayif" yalnızca ölçüm sonucundan türesin. Skoru yüksek boyutlar güçlü, düşük boyutlar zayıf.
- "guclu" maddelerinde yanıt verme davranışını veya katılımcının profilini güçlü yön olarak yazma (ör. "tüm sorulara yanıt verilmiş olması" gibi ifadeler yasak). Güçlü yön yalnızca yüksek puanlı boyuttan çıkar.
- "firsat" maddeleri ${bench ? 'ortalamanın altında kalan boyutlardan türesin: kapatılabilir açık demektir. Puan farkını maddede belirt.' : 'bir üst olgunluk kademesine geçildiğinde elde edilecek somut kazanımdan türesin.'}
- "tehdit" maddeleri en zayıf boyutların önümüzdeki 12 ayda doğuracağı somut sonuçtan türesin.
- Pazar, ekonomi, döviz, rekabet, teknoloji trendi gibi dış çevre yorumu YAPMA. Elinde o veri yok. Yalnızca ölçüm ve kıyaslama verisinden konuş.

"plan" — tam 4 madde, önem sırasına göre.
- "adim": tek ve somut bir iş. Genel tavsiye değil. Örnek: "Yetki ve karar matrisi taslağının hazırlanması".
- "rol": bu işi kimin sahiplenmesi gerektiği. Kişi adı değil rol yaz: "Genel Müdür", "İK Yöneticisi", "Kalite Sorumlusu".
- "sure": gerçekçi süre. Örnek: "3 hafta", "6 hafta".
- "cikti": elde kalacak somut belge ya da sonuç. Örnek: "İmzalı tek sayfalık karar matrisi", "Aylık İK gösterge raporunun ilk sürümü".

"rapor" — 350-450 kelime markdown. Sadece "## Genel Değerlendirme" ve "## Öne Çıkan Bulgular" başlıklarını kullan; GZFT ve plan ayrı yapıda verildiği için onları tekrar etme.
- Genel Değerlendirme: bu olgunluk seviyesinin bu ölçek ve sektördeki bir şirket için pratikte ne anlama geldiği. Seviye adını ("${band}") kullan. ${bench ? 'Kıyaslamadaki konumu açıkça belirt; ortalamanın üstündeyse teslim et, altındaysa suçlayıcı olmadan söyle.' : ''}
- Öne Çıkan Bulgular: en zayıf iki boyut, madde madde, her maddede somut iş sonucu (karar hızı, çalışan devri, denetim uygunsuzluğu, müşteri şikâyeti, maliyet).
${(unknown || 0) >= 3 ? `- Bulgulara ayrı bir madde ekle: yanıtlayan kişi ${unknown} maddede bilgi sahibi olmadığını belirtti. Bunu eksik mekanizma değil, yönetim görünürlüğü bulgusu olarak yorumla.` : ''}
- Sadece ## başlık, - madde ve **kalın** kullan.

"kapanis" — 3-4 cümlelik tek paragraf. Şunları içersin:
- Değerlendirmeyi tamamladığı için kısa bir teşekkür.
- Bu raporun tek kişilik yanıta dayanan bir ön teşhis olduğu; tam değerlendirmenin yönetim ekibinin tamamıyla yapıldığı.
- Bulguların ağırlıklı olarak iki alana işaret ettiği: organizasyon yönetimi (görev ve yetki tanımları, karar mekanizmaları, raporlama ilişkileri, yedekleme) ve süreç yönetimi (süreçlerin tanımlanması, ölçülmesi ve iyileştirilmesi). Bu iki alanı isimleriyle an ve bu şirketin kendi bulgularıyla bağını tek cümlede kur.
- Görüşmeye davet: raporun birlikte okunabileceği, önceliklendirmenin birlikte yapılabileceği.
Hizmet satma, fiyat verme, ısrarcı olma. Sıcak ama ölçülü bir dille yaz. "Memnuniyet duyarız" gibi kalıp nezaket cümleleri kullanma; ne olacağını söyle.

Genel: Türkçe yaz. Danışman ağzıyla, doğrudan ve saygılı. Abartılı övgü yapma, korku pazarlama, klişe kullanma.
- Uzun tire (—) kullanma; bunun yerine virgül, noktalı virgül veya yeni cümle kur.
- "çöküş", "felç", "derin kriz", "alarm", "tehlike" gibi abartılı ifadeler yerine ölçülü danışman dili kullan.`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (r.ok) {
      const data = await r.json();
      raw = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
      out = parseJson(raw);
    } else {
      console.error('claude status:', r.status, await r.text());
    }
  } catch (e) {
    console.error('claude:', e);
  }

  const result = out || (raw ? { rapor: raw } : null);

  // Kayıt — id geri döner, görüşme talebi bu id'ye bağlanır
  let submissionId = null;
  try {
    const ins = await query(
      `INSERT INTO public.nabiz_submissions
         (name, email, company, job_title, sector, company_size, answers, dim_scores,
          d1, d2, d3, d4, d5, total_score, band, unknown_count, report,
          benchmark_label, benchmark_n, kvkk_consent, kvkk_consent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, true, now())
       RETURNING id`,
      [
        name || null,
        email,
        company,
        title || null,
        sector || null,
        size || null,
        JSON.stringify(answers),  // JSONB — ham JS dizisi pg tarafından PostgreSQL dizi biçimine ({..}) çevrilir, geçersiz JSON
        JSON.stringify(dims),     // JSONB — aynı nedenle
        dims[0]?.score ?? null,
        dims[1]?.score ?? null,
        dims[2]?.score ?? null,
        dims[3]?.score ?? null,
        dims[4]?.score ?? null,
        total,
        band,
        unknown || 0,
        result ? JSON.stringify(result) : null,
        bench ? bench.label : null,
        bench ? bench.n : null
      ]
    );
    submissionId = ins.rows[0]?.id || null;
  } catch (e) {
    console.error('[nabiz] db insert error:', e.message, e.code);
    return res.status(500).json({ error: 'Kayıt oluşturulamadı.' });
  }

  // E-posta
  if (process.env.RESEND_API_KEY && result) {
    try {
      const rr = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        body: JSON.stringify({
          from: process.env.MAIL_FROM,
          to: [email],
          bcc: process.env.MAIL_BCC ? [process.env.MAIL_BCC] : undefined,
          subject: `${company} — Kurumsal olgunluk bulgu raporu (${total}/100, ${band})`,
          html: buildEmail({ name, company, total, band, dims, bench, result })
        })
      });
      if (!rr.ok) {
        const err = await rr.text();
        console.error('[resend] error', rr.status, err);
      }
    } catch (e) {
      console.error('resend:', e);
    }
  }

  return res.status(200).json({ ...(result || {}), benchmark: bench, id: submissionId });
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function mdToHtml(t) {
  return String(t || '')
    .replace(/^## (.+)$/gm, '<h3 style="color:#1B3A5C;margin:20px 0 6px;font-size:15px">$1</h3>')
    .replace(/^- (.+)$/gm, '<li style="margin-bottom:5px">$1</li>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .split('\n').filter(Boolean)
    .map(l => (l.startsWith('<') ? l : `<p style="margin:8px 0">${l}</p>`)).join('');
}

function quad(title, items, color, bgc) {
  if (!items || !items.length) return '';
  return `<td width="50%" valign="top" style="padding:6px">
    <div style="border-left:3px solid ${color};background:${bgc};padding:11px 13px">
      <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${color};font-weight:bold;margin-bottom:6px">${title}</div>
      <ul style="margin:0;padding-left:16px">${items.map(i => `<li style="font-size:13px;color:#0F2438;margin-bottom:4px;line-height:1.5">${esc(i)}</li>`).join('')}</ul>
    </div></td>`;
}

function buildEmail({ name, company, total, band, dims, bench, result }) {
  const g = result.gzft || {};
  const gzft = (g.guclu || g.zayif || g.firsat || g.tehdit) ? `
    <h3 style="color:#1B3A5C;margin:24px 0 4px;font-size:15px">Kurumsal Olgunluk GZFT'si</h3>
    <p style="font-size:12px;color:#5B7189;margin:0 0 8px">İç değerlendirme verisine dayanır. Pazar analizi içermez.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr>${quad('Güçlü', g.guclu, '#10B981', '#ECFDF5')}${quad('Zayıf', g.zayif, '#D4614E', '#FDECE9')}</tr>
      <tr>${quad('Fırsat', g.firsat, '#1B3A5C', '#E9F0F6')}${quad('Tehdit', g.tehdit, '#E8A33D', '#FDF4E6')}</tr>
    </table>` : '';

  const plan = (result.plan && result.plan.length) ? `
    <h3 style="color:#1B3A5C;margin:24px 0 8px;font-size:15px">İlk 90 gün</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">
      <tr style="background:#F2F6F9">
        <th align="left" style="padding:8px;color:#5B7189;font-size:11px;letter-spacing:1px;text-transform:uppercase">Adım</th>
        <th align="left" style="padding:8px;color:#5B7189;font-size:11px;letter-spacing:1px;text-transform:uppercase">Sorumlu</th>
        <th align="left" style="padding:8px;color:#5B7189;font-size:11px;letter-spacing:1px;text-transform:uppercase">Süre</th>
        <th align="left" style="padding:8px;color:#5B7189;font-size:11px;letter-spacing:1px;text-transform:uppercase">Çıktı</th>
      </tr>
      ${result.plan.map(p => `<tr style="border-top:1px solid #DCE6EE">
        <td style="padding:9px 8px;color:#0F2438"><strong>${esc(p.adim)}</strong></td>
        <td style="padding:9px 8px;color:#5B7189">${esc(p.rol)}</td>
        <td style="padding:9px 8px;color:#5B7189;white-space:nowrap">${esc(p.sure)}</td>
        <td style="padding:9px 8px;color:#5B7189">${esc(p.cikti)}</td>
      </tr>`).join('')}
    </table>` : '';

  const bars = dims.map(d => `<tr>
      <td style="padding:4px 0;font-size:13px;color:#0F2438;width:58%">${esc(d.name)}</td>
      <td style="padding:4px 0;font-size:13px;color:#1B3A5C;font-weight:bold;text-align:right">${d.score === null ? '—' : d.score}</td>
    </tr>`).join('');

  return `<div style="font-family:Calibri,Arial,sans-serif;max-width:660px;color:#0F2438;line-height:1.6">
    <p style="font-size:11px;letter-spacing:2px;color:#10B981;font-weight:bold;margin:0">MFK DANIŞMANLIK</p>
    <h2 style="color:#1B3A5C;margin:4px 0 16px">Kurumsal Nabız Teşhisi — ${esc(company)}</h2>
    <p>Sayın ${esc(name)}, kurumsal olgunluk skorunuz <strong>${total}/100</strong> — seviye: <strong>${esc(band)}</strong>.
    ${bench ? `${esc(bench.label)} kapsamındaki ${bench.n} şirketin ortalaması ${bench.avg_total}.` : ''}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:14px 0">${bars}</table>
    <hr style="border:0;border-top:1px solid #DCE6EE;margin:20px 0">
    ${mdToHtml(result.rapor)}
    ${gzft}
    ${plan}
    ${result.kapanis ? `<p style="margin:22px 0 0;color:#0F2438">${esc(result.kapanis)}</p>` : ''}
    <hr style="border:0;border-top:1px solid #DCE6EE;margin:20px 0">
    <p style="font-size:12px;color:#5B7189">Bu bir ön teşhistir ve tek kişilik yanıta dayanır. Bulguları birlikte değerlendirmek isterseniz bu e-postayı yanıtlamanız yeterli.<br>
    Servispro Yazılım Destek Danışmanlık Hizmetleri Ltd. Şti. · Ataşehir, İstanbul</p>
  </div>`;
}
