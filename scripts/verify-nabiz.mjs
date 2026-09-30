// scripts/verify-nabiz.mjs
// Faz D doğrulama testi — gerçek veritabanına ve canlı önizleme adresine karşı çalışır.
// Kullanım: PANEL_KEY=<anahtar> node scripts/verify-nabiz.mjs
// Bu dosya yayınlanmaz (scripts/ Vercel tarafından servis edilmez).

const BASE    = process.env.BASE_URL || 'https://mfk-web-git-nabiz-fuat-kocabicaks-projects.vercel.app';
const PKEY    = process.env.PANEL_KEY || '';
const BYPASS  = process.env.BYPASS_TOKEN || '';   // Vercel Protection Bypass for Automation
const SID     = 'zz-dogrulama-sid-' + Date.now();
const COMPANY = 'ZZ_Dogrulama A.S.';

let submissionId = null;
let pass = 0, fail = 0;

function ok(label, detail = '') {
  console.log(`  ✓  ${label}${detail ? ' — ' + detail : ''}`);
  pass++;
}
function ko(label, detail = '') {
  console.error(`  ✗  ${label}${detail ? ' — ' + detail : ''}`);
  fail++;
}
function section(title) {
  console.log(`\n── ${title}`);
}

// Bypass header tüm isteklere eklenir (değer yoksa başlık eklenmez)
function bypassHeaders(extra = {}) {
  const h = { ...extra };
  if (BYPASS) h['x-vercel-protection-bypass'] = BYPASS;
  return h;
}

async function post(path, body, headers = {}) {
  return fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...bypassHeaders(headers) },
    body: JSON.stringify(body)
  });
}

async function get(path, headers = {}) {
  return fetch(BASE + path, { headers: bypassHeaders(headers) });
}

async function patch(path, body, headers = {}) {
  return fetch(BASE + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...bypassHeaders(headers) },
    body: JSON.stringify(body)
  });
}

// ── TEST 1: /api/track olayları
section('TEST 1 — /api/track (view, start, step)');
try {
  for (const [type, extra] of [['view', {}], ['start', {}], ['step', { step: 3 }]]) {
    const r = await post('/api/track', { sid: SID, type, ref: 'dogrulama.test', device: 'desktop', ...extra });
    if (r.status === 204) ok(`track ${type}`);
    else ko(`track ${type}`, `HTTP ${r.status}`);
  }
} catch (e) { ko('track', e.message); }

// ── TEST 2: /api/nabiz — ZZ_ şirketiyle tam gönderim
section('TEST 2 — /api/nabiz (ZZ_ şirketi)');
try {
  const answers = [3, 2, 4, 1, 3, 2, 3, 4, 2, -1];
  const dims = [
    { name: 'Organizasyon Yapısı ve Yönetim', score: 60 },
    { name: 'Süreç Yönetimi',                 score: 40 },
    { name: 'İnsan Kaynakları',                score: 80 },
    { name: 'Finans ve Raporlama',             score: 20 },
    { name: 'Müşteri ve Pazar Yönetimi',       score: 60 }
  ];
  const r = await post('/api/nabiz', {
    name: 'ZZ Test Kullanıcısı',
    title: 'Genel Müdür',
    email: 'zz-test@example.com',
    company: COMPANY,
    sector: 'Üretim',
    size: '50-249',
    answers,
    total: 52,
    dims,
    band: 'Gelişmekte',
    unknown: 1,
    kvkk: true
  });
  if (r.status === 200) {
    const data = await r.json();
    submissionId = data.id;
    if (submissionId) ok('nabiz gönderim', `id=${submissionId}`);
    else ko('nabiz gönderim — id dönmedi', JSON.stringify(data).slice(0, 200));
    if (data.rapor || data.gzft) ok('rapor içeriği (Claude yanıtı)');
    else ko('rapor içeriği eksik', JSON.stringify(data).slice(0, 200));
  } else {
    const txt = await r.text();
    ko('nabiz gönderim', `HTTP ${r.status} — ${txt.slice(0, 300)}`);
  }
} catch (e) { ko('nabiz gönderim', e.message); }

// ── TEST 3: /api/intent — görüşme talebi
section('TEST 3 — /api/intent');
if (!submissionId) {
  ko('intent — submissionId yok, TEST 2 başarısız');
} else {
  try {
    const r = await post('/api/intent', {
      id: submissionId,
      phone: '+90 500 000 00 00',
      preferredTime: 'Sabah 09-12',
      message: 'ZZ_ doğrulama testi'
    });
    if (r.status === 200) {
      const data = await r.json();
      if (data.ok) ok('intent kaydedildi');
      else ko('intent yanıt beklentisi', JSON.stringify(data));
    } else {
      ko('intent', `HTTP ${r.status} — ${(await r.text()).slice(0, 200)}`);
    }
  } catch (e) { ko('intent', e.message); }
}

// ── TEST 4: /api/panel — yanlış anahtarla 401
section('TEST 4 — /api/panel yetki kontrolleri');
try {
  const r401 = await get('/api/panel', { 'x-panel-key': 'yanlis-anahtar-xxxx' });
  if (r401.status === 401) ok('panel — yanlış anahtar → 401');
  else ko('panel — 401 beklendi', `HTTP ${r401.status}`);
} catch (e) { ko('panel 401', e.message); }

// ── TEST 4b: /api/panel — doğru anahtarla liste ve huni
if (!PKEY) {
  console.log('  ℹ  PANEL_KEY ortam değişkeni verilmedi — doğru anahtar testleri atlandı.');
  console.log('     Çalıştırmak için: PANEL_KEY=<anahtar> node scripts/verify-nabiz.mjs');
} else {
  try {
    const rList = await get('/api/panel', { 'x-panel-key': PKEY });
    if (rList.status === 200) {
      const data = await rList.json();
      const found = (data.rows || []).some(r => r.company === COMPANY);
      if (found) ok('panel GET — ZZ_ kaydı listede görünüyor');
      else ko('panel GET — ZZ_ kaydı bulunamadı', `${data.rows?.length} kayıt döndü`);
    } else ko('panel GET', `HTTP ${rList.status}`);

    const rFunnel = await get('/api/panel?view=funnel', { 'x-panel-key': PKEY });
    if (rFunnel.status === 200) {
      const fd = await rFunnel.json();
      if (fd.funnel && fd.steps && fd.sources !== undefined) ok('panel GET funnel — veri yapısı doğru');
      else ko('panel GET funnel — eksik alan', JSON.stringify(fd).slice(0, 200));
    } else ko('panel funnel', `HTTP ${rFunnel.status}`);

    // TEST 5: izinsiz kolon güncelleme denemesi (email)
    if (submissionId) {
      const rPatch = await patch('/api/panel', { id: submissionId, email: 'hacked@evil.com' }, { 'x-panel-key': PKEY });
      if (rPatch.status === 200) {
        const pd = await rPatch.json();
        // API email'i hiç işlemiyor — dönen row'da email değişmemiş olmalı
        if (!pd.row || pd.row.email !== 'hacked@evil.com') ok('panel PATCH — izinsiz email kolonu reddedildi');
        else ko('panel PATCH — email değiştirilebildi (GÜVENLİK AÇIĞI)');
      } else if (rPatch.status === 400) {
        ok('panel PATCH — izinsiz email → 400 (değişiklik yok)');
      } else {
        ko('panel PATCH', `HTTP ${rPatch.status}`);
      }
    }
  } catch (e) { ko('panel doğru anahtar', e.message); }
}

// ── TEST 6: nabiz_app ile DELETE denemesi (yetki hatası beklenir)
section('TEST 6 — nabiz_app DELETE yetkisi');
console.log('  ℹ  Bu test doğrudan veritabanına karşı çalışır (aşağıda SSH ile yapılacak).');

// ── ÖZET
section('ÖZET');
console.log(`  Geçti: ${pass}   Kaldı/Atlandı: ${fail}`);
if (submissionId) console.log(`  ZZ_ submission id: ${submissionId}`);
console.log('  → Temizlik: postgres kullanıcısıyla nabiz_submissions ve nabiz_events silinecek.');
