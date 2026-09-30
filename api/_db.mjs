// Ortak PostgreSQL bağlantı havuzu.
// Alt çizgi öneki Vercel'in bunu uç nokta olarak yayınlamasını engeller.
// Havuz modül düzeyinde bir kez oluşturulur (sıcak başlatmada tekrar kullanılır).

import pg from 'pg';
const { Pool } = pg;

// Strip sslmode from URL — the ssl object below is the sole authority.
// checkServerIdentity override is required when connecting to a bare IP address
// because Node.js 24+ still runs hostname validation even with rejectUnauthorized:false.
const connStr = (process.env.NABIZ_DATABASE_URL || '')
  .replace(/([?&])sslmode=[^&]*/g, '$1')
  .replace(/[?&]$/, '');

const pool = new Pool({
  connectionString: connStr,
  max: 1,
  idleTimeoutMillis: 10000,
  ssl: {
    rejectUnauthorized: false,
    checkServerIdentity: () => undefined   // skip hostname/IP match on self-signed cert
  }
});

export function query(text, params) {
  return pool.query(text, params);
}
