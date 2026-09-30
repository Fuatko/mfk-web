# NABIZ_TR_DB_SPEC.md — Kurumsal Nabız'ı Türkiye PostgreSQL'e taşıma

Sürüm: v1 (30 Eylül 2026)
Repo: `Fuatko/mfk-web` (mfkdanismanlik.com, Vercel)
Dal: `nabiz`
Kural: main'e birleştirme yalnızca Fuat'ın açık "go" onayıyla. Veritabanında her DDL adımı uygulanmadan önce Fuat'a gösterilir. Faz raporlarında gerçek veritabanına yapılmış çağrıların sonuçları yer alır, yalnızca birim testi yetmez.

## 0. Amaç ve kapsam

Kurumsal Nabız Teşhisi (mfkdanismanlik.com/nabiz) Ağustos 2026'da Supabase'e göre yazıldı ve hiç yayına alınmadı. Fuat'ın ilkesi gereği kişisel veriler Türkiye'de saklanacak: Nabız, Inspira360X ile aynı Türkiye sunucusunda **ayrı bir veritabanına** taşınır. Supabase hiç kullanılmayacak.

Bu pakette gelen dosyalar:
```
deploy/nabiz/index.html   → sayfa (KVKK metni düzeltilmiş, dokunma)
deploy/panel/index.html   → takip paneli (dokunma)
deploy/api/nabiz.mjs      → rapor + kayıt       ┐
deploy/api/intent.mjs     → görüşme talebi      │ Supabase REST çağrıları
deploy/api/panel.mjs      → panel verisi        │ pg ile değiştirilecek
deploy/api/track.mjs      → isimsiz huni ölçümü ┘
schema.sql                → Supabase için yazılmış şema, uyarlanacak
kvkk-nabiz-bolumu.html    → kvkk.html'e eklenecek bölüm (Türkiye saklama haliyle güncel)
```

Inspira360X veritabanına (`inspira360x_prod`) ve kodlarına hiçbir şekilde dokunulmaz.

## 1. Faz A — Veritabanı (önce Fuat'a göster, sonra uygula)

Sunucu: `ssh -p 35342 root@185.149.102.72` → `sudo -u postgres psql`

1. Veritabanı: `CREATE DATABASE mfk_nabiz OWNER postgres;`
2. Uygulama rolü: `nabiz_app` (LOGIN, güçlü parola, `CONNECTION LIMIT 10`). Parola Fuat'a ayrıca iletilir, repoya yazılmaz.
3. `schema.sql` uyarlaması:
   - `enable row level security` satırları ve `revoke ... from anon, authenticated` satırları kaldırılır (bu roller burada yok).
   - `gen_random_uuid()` için PostgreSQL 13+ yeterli; sürüm eskiyse `pgcrypto` eklentisi açılır.
   - Tüm tablo, görünüm ve fonksiyonların sahibi `postgres` olur.
   - `security definer` fonksiyonlara `SET search_path = public` korunur.
4. Yetkiler (en az yetki):
   - `nabiz_submissions`: SELECT, INSERT, UPDATE. **DELETE yok.**
   - `nabiz_events`: INSERT. Gerekli sequence için USAGE.
   - Fonksiyonlar `nabiz_benchmark`, `nabiz_funnel`, `nabiz_steps`, `nabiz_sources`: EXECUTE.
   - Görünümler (`nabiz_oncelik`, `nabiz_sicak_liste`, `nabiz_gorunurluk`, `nabiz_sektor_doluluk`): SELECT.
   - `REVOKE ALL ON DATABASE mfk_nabiz FROM PUBLIC; GRANT CONNECT ON DATABASE mfk_nabiz TO nabiz_app;`
   - `nabiz_app` rolünün `inspira360x_prod` veritabanına CONNECT yetkisi olmadığı doğrulanır.
5. `pg_hba.conf`: `inspira_app` için Vercel'den gelen bağlantılara hangi kural uygulanıyorsa aynı kural `mfk_nabiz` / `nabiz_app` için eklenir (SSL zorunlu, `scram-sha-256`). Mevcut kural değiştirilmez, yalnızca yeni satır eklenir. `pg_ctl reload` / `SELECT pg_reload_conf();`
6. Yedekleme: Sunucudaki mevcut yedekleme rutini `mfk_nabiz`i de kapsayacak şekilde güncellenir. Rutin yoksa durum Fuat'a raporlanır, kendiliğinden yeni rutin kurulmaz.

## 2. Faz B — Kod (dal: `nabiz`)

### 2.1 Bağımlılık
Repo kökünde henüz `package.json` yok. Eklenir:
```json
{
  "private": true,
  "dependencies": { "pg": "^8" }
}
```
Vercel proje ayarlarında Build Command boş, Output Directory kök kalmalı; statik sayfaların (ana sayfa, blog, kvkk.html) yayınının etkilenmediği önizlemede kontrol edilir.

### 2.2 Ortak bağlantı modülü: `api/_db.mjs`
Alt çizgiyle başladığı için Vercel bunu ayrı bir uç nokta olarak yayınlamaz.
- `new URL(process.env.NABIZ_DATABASE_URL)` ile bağlantı parametreleri ayrıştırılır; `pg.Pool`'a `host`, `port`, `database`, `user`, `password` ayrı ayrı verilir. `connectionString` yerine bireysel parametre kullanılır (pg'nin `url.parse()` bağımlılığından ve sslmode çakışmasından kaçınmak için). `max: 1`, `idleTimeoutMillis: 10000`, `connectionTimeoutMillis: 8000`, `ssl: { rejectUnauthorized: false }`. Port: **5432** (TLS sertifikalı port; 35342 SSL sunmuyor).
- Havuz modül düzeyinde bir kez oluşturulur (sıcak başlatmada tekrar kullanılır).
- Dışa aktarılan tek yardımcı: `query(text, params)`.

### 2.3 Dosya bazında değişiklik
Her sorgu **parametreli** yazılır, string birleştirme ile SQL kurulmaz. Supabase başlıkları (`apikey`, `Authorization`) ve `SUPABASE_*` referansları tamamen kaldırılır.

| Dosya | Eski (Supabase REST) | Yeni (pg) |
|---|---|---|
| `nabiz.mjs` | `POST /rpc/nabiz_benchmark` | `SELECT * FROM nabiz_benchmark($1)` |
| `nabiz.mjs` | `POST /nabiz_submissions?select=id` | `INSERT ... RETURNING id` (tüm kolonlar parametreli) |
| `intent.mjs` | `PATCH /nabiz_submissions?id=eq.X` | `UPDATE nabiz_submissions SET ... WHERE id = $1` (`id` UUID biçimi önce doğrulanır) |
| `panel.mjs` | `POST /rpc/{fn}` | Yalnızca izinli liste: `nabiz_funnel`, `nabiz_steps`, `nabiz_sources`; fonksiyon adı kullanıcı girdisinden SQL'e yazılmaz, sabit eşleme tablosundan seçilir |
| `panel.mjs` | `GET /nabiz_submissions?select=...&kvkk_consent=eq.true&order=...&limit=500` | Aynı kolonlarla `SELECT ... WHERE kvkk_consent = true ORDER BY created_at DESC LIMIT 500` |
| `panel.mjs` | `PATCH /nabiz_submissions?id=eq.X` | `UPDATE` yalnızca izinli kolonlar: `status`, `notes`, `contacted_at`, `next_action_at` |
| `track.mjs` | `POST /nabiz_events` | `INSERT INTO nabiz_events (sid, type, step, ref, device) VALUES (...)` |

Davranış değişmez: yanıt gövdeleri, hata mesajları ve durum kodları mevcut sayfaların beklediği biçimde kalır. `panel.mjs` içindeki `PANEL_KEY` kontrolü (sabit zamanlı karşılaştırma) aynen korunur.

### 2.4 Bölge
Vercel fonksiyonları için `vercel.json` içinde bölge `fra1` (Frankfurt) olarak ayarlanır; bu hem Türkiye sunucusuna gecikmeyi azaltır hem de verinin ABD'den dolaşmasını önler. Mevcut bir `vercel.json` varsa yalnızca bu alan eklenir. Planın izin vermediği bir ayar çıkarsa Fuat'a raporlanır.

### 2.5 Ortam değişkenleri (Vercel → mfk-web → Production ve Preview)
| Anahtar | Değer |
|---|---|
| `NABIZ_DATABASE_URL` | `postgres://nabiz_app:<parola>@185.149.102.72:5432/mfk_nabiz?sslmode=require` |
| `ANTHROPIC_API_KEY` | Nabız'a özel ayrı anahtar (Claude Code bakiyesinden bağımsız) |
| `PANEL_KEY` | uzun rastgele dize |
| `RESEND_API_KEY` | Resend anahtarı (mfkdanismanlik.com alan adı doğrulandıktan sonra) |
| `MAIL_FROM` | `MFK Danışmanlık <iletisim@mfkdanismanlik.com>` |
| `MAIL_BCC` | `iletisim@mfkdanismanlik.com` |

`SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` eklenmez.

## 3. Faz C — KVKK sayfası

`kvkk-nabiz-bolumu.html` içindeki `<section id="nabiz">` bloğu, `kvkk.html` içinde "I) KVKK 11'inci Maddede Sayılan Diğer Haklar" başlığının hemen önüne eklenir. Sayfanın geri kalanına dokunulmaz.

## 4. Faz D — Doğrulama

`scripts/verify-nabiz.mjs` (repoya eklenir, yayınlanmaz) gerçek veritabanına karşı şunları çalıştırır ve sonuçları rapora yazar:
1. `/api/track` → `view`, `start`, `step` olayları eklenir, tabloda görülür.
2. `/api/nabiz` → `ZZ_` önekli test şirketiyle tam gönderim; kayıt oluşur, rapor döner, e-posta Resend'de "Delivered" görünür.
3. `/api/intent` → aynı kayıt için görüşme talebi; `meeting_requested = true` olur.
4. `/api/panel` → yanlış anahtarla 401, doğru anahtarla liste ve huni verisi döner.
5. `/api/panel` PATCH → izinsiz kolon (`email`) güncellenmeye çalışılır, reddedilir.
6. `nabiz_app` ile `DELETE` denenir, yetki hatası alınır.
7. Temizlik: `ZZ_` kayıtları ve test olayları `postgres` kullanıcısıyla silinir.

Ardından Fuat /nabiz sayfasını tarayıcıdan kendi bilgileriyle doldurur; raporun Gmail ve Outlook'a spam'e düşmeden geldiği kontrol edilir; test kaydı silinir.

## 5. Sonra (bu işin kapsamı dışında, not olarak)
- Saklama süresi (2 yıl) için otomatik silme işi: ilk kayıtlar biriktiğinde ele alınır.
- Meta Pixel'in /nabiz sayfasına eklenmesi: Inspira360X LANDING_SPEC Faz D ile birlikte, çerez onayı şeridiyle yapılır.
- Sunucuya art arda başarısız SSH denemelerinde fail2ban devreye giriyor; Claude Code IP'si engellenirse Fuat'a haber verilir.
