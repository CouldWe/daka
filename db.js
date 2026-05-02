const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: `postgresql://postgres:${process.env.DATA_BASE_PASSWORD}@db.saxevoyxbwkksglzpiov.supabase.co:5432/postgres`,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool
};
