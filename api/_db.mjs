// Ortak PostgreSQL bağlantı havuzu.
// Alt çizgi öneki Vercel'in bunu uç nokta olarak yayınlamasını engeller.
// Havuz modül düzeyinde bir kez oluşturulur (sıcak başlatmada tekrar kullanılır).
//
// Bağlantı dizesi yerine bireysel parametreler kullanılır; bu yöntem,
// pg'nin eski url.parse() bağımlılığını ve sslmode çakışmalarını önler.
// (Aynı sunucuya bağlanan inspira360x/lib/supabase/turkey-db.ts ile aynı yaklaşım.)

import pg from 'pg';
const { Pool } = pg;

// NABIZ_DATABASE_URL'i WHATWG URL API ile ayrıştır (url.parse() kullanılmaz)
const dbUrl = new URL(process.env.NABIZ_DATABASE_URL || 'postgres://localhost/postgres');

const pool = new Pool({
  host:     dbUrl.hostname,
  port:     parseInt(dbUrl.port || '5432'),
  database: dbUrl.pathname.slice(1),   // başındaki "/" kaldırılır
  user:     dbUrl.username,
  password: dbUrl.password,
  ssl:      { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis:      10000,
  connectionTimeoutMillis: 8000,
});

export async function query(text, params) {
  return pool.query(text, params);
}
