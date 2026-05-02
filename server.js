const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const db = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase 客户端（service_role 密钥，仅服务端使用）
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 文件上传（内存缓存，上传到 Supabase Storage）
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png/;
        const extname = allowedTypes.test(file.originalname.toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('只允许上传 JPG/JPEG/PNG 格式的图片'));
        }
    }
});

// 中间件
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(session({
    store: new pgSession({
        pool: db.pool,
        tableName: 'session',
        createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true
    }
}));

// 静态文件
app.use(express.static('public'));

// 认证中间件
const requireAuth = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).json({ error: '请先登录' });
    }
};

// ========== 路由 ==========

// 路由 - 注册（已禁用）
app.post('/api/register', async (req, res) => {
    res.status(403).json({ error: '注册功能已关闭' });
});

// 路由 - 登录
app.post('/api/login', async (req, res) => {
    try {
        const { username, password, rememberMe } = req.body;

        const result = await db.query(
            'SELECT id, username, password_hash FROM users WHERE username = $1',
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }

        req.session.userId = user.id;
        req.session.username = user.username;

        if (rememberMe) {
            req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
        } else {
            req.session.cookie.maxAge = 24 * 60 * 60 * 1000;
        }

        res.json({
            success: true,
            user: { id: user.id, username: user.username }
        });
    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ error: '登录失败' });
    }
});

// 路由 - 登出
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: '登出失败' });
        }
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

// 路由 - 检查登录状态
app.get('/api/check-auth', (req, res) => {
    if (req.session.userId) {
        res.json({
            authenticated: true,
            user: { id: req.session.userId, username: req.session.username }
        });
    } else {
        res.json({ authenticated: false });
    }
});

// 路由 - 获取打卡统计
app.get('/api/stats', requireAuth, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT MAX(day_count) as max_days, COUNT(*) as total_checkins FROM check_ins WHERE user_id = $1',
            [req.session.userId]
        );

        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const todayResult = await db.query(
            'SELECT day_count FROM check_ins WHERE user_id = $1 AND check_in_date = $2',
            [req.session.userId, today]
        );

        res.json({
            maxDays: result.rows[0].max_days || 0,
            totalCheckins: parseInt(result.rows[0].total_checkins) || 0,
            checkedInToday: todayResult.rows.length > 0,
            currentDayCount: todayResult.rows[0]?.day_count || 0
        });
    } catch (error) {
        console.error('获取统计错误:', error);
        res.status(500).json({ error: '获取统计失败' });
    }
});

// 路由 - 每日打卡（照片上传到 Supabase Storage）
app.post('/api/checkin', requireAuth, upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '请上传照片' });
        }

        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        // 检查今天是否已打卡
        const existingCheckin = await db.query(
            'SELECT id FROM check_ins WHERE user_id = $1 AND check_in_date = $2',
            [req.session.userId, today]
        );

        if (existingCheckin.rows.length > 0) {
            return res.status(400).json({ error: '今天已经打卡过了' });
        }

        // 上传到 Supabase Storage
        const ext = path.extname(req.file.originalname);
        const storagePath = `${req.session.userId}/${Date.now()}${ext}`;

        const { error: uploadError } = await supabase
            .storage
            .from('photos')
            .upload(storagePath, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: false
            });

        if (uploadError) {
            console.error('Supabase 上传错误:', uploadError);
            return res.status(500).json({ error: '照片上传失败' });
        }

        // 获取昨天的打卡记录
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

        const yesterdayCheckin = await db.query(
            'SELECT day_count FROM check_ins WHERE user_id = $1 AND check_in_date = $2',
            [req.session.userId, yesterdayStr]
        );

        let dayCount = 1;
        if (yesterdayCheckin.rows.length > 0) {
            dayCount = yesterdayCheckin.rows[0].day_count + 1;
        }

        const result = await db.query(
            'INSERT INTO check_ins (user_id, check_in_date, day_count, photo_data) VALUES ($1, $2, $3, $4) RETURNING id, check_in_date, day_count',
            [req.session.userId, today, dayCount, storagePath]
        );

        res.json({
            success: true,
            checkin: {
                id: result.rows[0].id,
                date: result.rows[0].check_in_date,
                dayCount: result.rows[0].day_count
            }
        });
    } catch (error) {
        console.error('打卡错误:', error);
        res.status(500).json({ error: '打卡失败' });
    }
});

// 路由 - 获取所有打卡记录（不含照片数据）
app.get('/api/checkins', requireAuth, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id, check_in_date, day_count, created_at FROM check_ins WHERE user_id = $1 ORDER BY check_in_date DESC',
            [req.session.userId]
        );

        const checkins = result.rows.map(row => {
            let dateStr;
            if (row.check_in_date instanceof Date) {
                const d = row.check_in_date;
                dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            } else {
                dateStr = row.check_in_date;
            }

            return {
                id: row.id,
                date: dateStr,
                dayCount: row.day_count,
                createdAt: row.created_at
            };
        });

        res.json({ checkins });
    } catch (error) {
        console.error('获取打卡记录错误:', error);
        res.status(500).json({ error: '获取打卡记录失败' });
    }
});

// 路由 - 获取打卡照片（从 Supabase Storage 生成签名 URL 并重定向）
app.get('/api/checkins/:id/photo', requireAuth, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT photo_data FROM check_ins WHERE id = $1 AND user_id = $2',
            [req.params.id, req.session.userId]
        );

        if (result.rows.length === 0 || !result.rows[0].photo_data) {
            return res.status(404).json({ error: '照片不存在' });
        }

        const photoData = result.rows[0].photo_data;

        // 旧格式 base64，直接返回
        if (photoData.startsWith('data:')) {
            res.type('text/plain').send(photoData);
            return;
        }

        // 旧格式：本地文件名（不含 /），尝试从 uploads 目录读取
        if (!photoData.includes('/')) {
            const fs = require('fs');
            const filePath = path.join(__dirname, 'uploads', photoData);
            if (fs.existsSync(filePath)) {
                res.sendFile(filePath);
            } else {
                res.status(404).json({ error: '照片文件不存在' });
            }
            return;
        }

        // 新格式：Supabase Storage 路径，生成签名 URL
        const { data, error } = await supabase
            .storage
            .from('photos')
            .createSignedUrl(photoData, 3600);

        if (error || !data?.signedUrl) {
            console.error('生成签名URL错误:', error);
            return res.status(404).json({ error: '照片不存在' });
        }

        res.redirect(data.signedUrl);
    } catch (error) {
        console.error('获取照片错误:', error);
        res.status(500).json({ error: '获取照片失败' });
    }
});

app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
});
