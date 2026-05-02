-- 创建用户表
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建打卡记录表
-- photo_data 存储照片文件名（照片文件保存在服务器的 uploads/ 目录下）
CREATE TABLE IF NOT EXISTS check_ins (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    check_in_date DATE NOT NULL,
    day_count INTEGER NOT NULL,
    photo_data TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, check_in_date)
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_check_ins_user_date ON check_ins(user_id, check_in_date DESC);
CREATE INDEX IF NOT EXISTS idx_check_ins_user_id ON check_ins(user_id);

-- 插入示例用户（密码是 'password123' 的bcrypt哈希值）
-- 你需要在首次运行后通过应用的注册功能创建自己的账号
