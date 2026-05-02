const { Pool } = require('pg');
require('dotenv').config();

// Render 不支持 IPv6，强制 DNS 解析为 IPv4
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const pool = new Pool({
    host: 'db.saxevoyxbwkksglzpiov.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.DATA_BASE_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool
};
