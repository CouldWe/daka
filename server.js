const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 确保 uploads 目录存在
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// 配置文件上传（使用磁盘存储）
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadsDir),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname);
            const name = `${req.session.userId}_${Date.now()}${ext}`;
            cb(null, name);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB限制
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
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30天
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
            req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30天
        } else {
            req.session.cookie.maxAge = 24 * 60 * 60 * 1000; // 1天
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username
            }
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
            user: {
                id: req.session.userId,
                username: req.session.username
            }
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

// 路由 - 每日打卡（照片存为文件）
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
            // 删除刚上传的文件
            fs.unlink(req.file.path, () => {});
            return res.status(400).json({ error: '今天已经打卡过了' });
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

        // 存储文件名到数据库（不再存 base64）
        const photoFilename = req.file.filename;

        const result = await db.query(
            'INSERT INTO check_ins (user_id, check_in_date, day_count, photo_data) VALUES ($1, $2, $3, $4) RETURNING id, check_in_date, day_count',
            [req.session.userId, today, dayCount, photoFilename]
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
            // 无论 pg 返回 Date 还是字符串，都转成本地 YYYY-MM-DD
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

// 路由 - 获取打卡照片（从文件读取）
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

        // 判断是旧格式（base64）还是新格式（文件名）
        if (photoData.startsWith('data:')) {
            // 旧格式：直接返回 base64
            res.type('text/plain').send(photoData);
        } else {
            // 新格式：从文件读取
            const filePath = path.join(uploadsDir, photoData);
            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ error: '照片文件不存在' });
            }
            res.sendFile(filePath);
        }
    } catch (error) {
        console.error('获取照片错误:', error);
        res.status(500).json({ error: '获取照片失败' });
    }
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
});
