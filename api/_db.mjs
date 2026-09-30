// Ortak PostgreSQL bağlantı havuzu.
// Alt çizgi öneki Vercel'in bunu uç nokta olarak yayınlamasını engeller.
// Havuz modül düzeyinde bir kez oluşturulur (sıcak başlatmada tekrar kullanılır).

import pg from 'pg';
const { Pool } = pg;

// sslmode=require in the URL conflicts with the ssl object in pg ≥8;
// strip it so the ssl config below is the sole authority.
const connStr = (process.env.NABIZ_DATABASE_URL || '')
  .replace(/([?&])sslmode=[^&]*/g, '$1')
  .replace(/[?&]$/, '');

const pool = new Pool({
  connectionString: connStr,
  max: 1,
  idleTimeoutMillis: 10000,
  ssl: { rejectUnauthorized: false }
});

export function query(text, params) {
  return pool.query(text, params);
}
