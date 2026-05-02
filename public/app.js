// 全局状态
let currentUser = null;
let allCheckins = [];
let checkinPhotos = {}; // 按 checkin id 缓存照片数据
let currentView = 'grid';
let comparisonSlots = [null, null];
let currentCalendarDate = new Date();

// 页面加载时检查登录状态
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    setupEventListeners();
});

// 设置事件监听器
function setupEventListeners() {
    // 登录表单
    document.getElementById('loginForm').addEventListener('submit', handleLogin);

    // 注册表单
    document.getElementById('registerForm').addEventListener('submit', handleRegister);

    // 打卡表单
    document.getElementById('checkinForm').addEventListener('submit', handleCheckin);

    // 照片预览
    document.getElementById('photoUpload').addEventListener('change', handlePhotoPreview);
}

// 检查认证状态
async function checkAuth() {
    try {
        const response = await fetch('/api/check-auth');
        const data = await response.json();

        if (data.authenticated) {
            currentUser = data.user;
            await showMainPage();
        } else {
            showLoginPage();
        }
    } catch (error) {
        console.error('检查认证失败:', error);
        showLoginPage();
    }
}

// 显示登录页面
function showLoginPage() {
    document.getElementById('loginPage').classList.remove('hidden');
    document.getElementById('registerPage').classList.add('hidden');
    document.getElementById('mainPage').classList.add('hidden');
}

// 显示注册页面
function showRegister() {
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('registerPage').classList.remove('hidden');
    document.getElementById('mainPage').classList.add('hidden');
}

// 显示登录页面（从注册返回）
function showLogin() {
    document.getElementById('loginPage').classList.remove('hidden');
    document.getElementById('registerPage').classList.add('hidden');
    document.getElementById('mainPage').classList.add('hidden');
}

// 显示主页面
async function showMainPage() {
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('registerPage').classList.add('hidden');
    document.getElementById('mainPage').classList.remove('hidden');

    document.getElementById('usernameDisplay').textContent = currentUser.username;

    await loadStats();
    await loadCheckins();
    await loadPhotos();
    renderCurrentView();
}

// 处理登录
async function handleLogin(e) {
    e.preventDefault();

    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    const rememberMe = document.getElementById('rememberMe').checked;

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, rememberMe })
        });

        const data = await response.json();

        if (response.ok) {
            currentUser = data.user;
            await showMainPage();
        } else {
            document.getElementById('loginError').textContent = data.error || '登录失败';
        }
    } catch (error) {
        console.error('登录错误:', error);
        document.getElementById('loginError').textContent = '登录失败，请重试';
    }
}

// 处理注册
async function handleRegister(e) {
    e.preventDefault();

    const username = document.getElementById('registerUsername').value;
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (password !== confirmPassword) {
        document.getElementById('registerError').textContent = '两次密码输入不一致';
        return;
    }

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok) {
            currentUser = data.user;
            await showMainPage();
        } else {
            document.getElementById('registerError').textContent = data.error || '注册失败';
        }
    } catch (error) {
        console.error('注册错误:', error);
        document.getElementById('registerError').textContent = '注册失败，请重试';
    }
}

// 登出
async function logout() {
    try {
        // 释放所有 blob URL
        Object.values(checkinPhotos).forEach(url => {
            if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
        });
        await fetch('/api/logout', { method: 'POST' });
        currentUser = null;
        allCheckins = [];
        checkinPhotos = {};
        showLoginPage();
    } catch (error) {
        console.error('登出错误:', error);
    }
}

// 加载统计数据
async function loadStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();

        document.getElementById('currentStreak').textContent = data.checkedInToday ? data.currentDayCount : 0;
        document.getElementById('maxStreak').textContent = data.maxDays;
        document.getElementById('totalCheckins').textContent = data.totalCheckins;

        const checkinStatus = document.getElementById('checkinStatus');
        const checkinForm = document.getElementById('checkinForm');

        if (data.checkedInToday) {
            checkinStatus.textContent = `✅ 今天已打卡！连续 ${data.currentDayCount} 天`;
            checkinForm.classList.add('hidden');
        } else {
            checkinStatus.textContent = '';
            checkinForm.classList.remove('hidden');
        }
    } catch (error) {
        console.error('加载统计失败:', error);
    }
}

// 加载打卡记录
async function loadCheckins() {
    try {
        const response = await fetch('/api/checkins?t=' + Date.now());
        if (!response.ok) {
            console.error('获取打卡记录失败:', response.status);
            return;
        }
        const data = await response.json();
        allCheckins = data.checkins || [];
        console.log('加载的打卡记录:', allCheckins);
    } catch (error) {
        console.error('加载打卡记录失败:', error);
    }
}

// 加载所有打卡记录的照片
async function loadPhotos() {
    const promises = allCheckins.map(async (checkin) => {
        if (checkinPhotos[checkin.id]) return; // 已缓存则跳过
        try {
            const response = await fetch(`/api/checkins/${checkin.id}/photo`);
            if (!response.ok) return;
            const contentType = response.headers.get('Content-Type') || '';
            if (contentType.startsWith('image/')) {
                // 新格式：图片文件，创建 blob URL
                const blob = await response.blob();
                checkinPhotos[checkin.id] = URL.createObjectURL(blob);
            } else {
                // 旧格式：base64 数据
                checkinPhotos[checkin.id] = await response.text();
            }
        } catch (error) {
            console.error('加载照片失败:', checkin.id, error);
        }
    });
    await Promise.all(promises);
}

// 处理照片预览
function handlePhotoPreview(e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('previewImage').src = e.target.result;
            document.getElementById('photoPreview').classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }
}

// 处理打卡
async function handleCheckin(e) {
    e.preventDefault();

    const fileInput = document.getElementById('photoUpload');
    const file = fileInput.files[0];

    if (!file) {
        document.getElementById('checkinError').textContent = '请选择照片';
        return;
    }

    const formData = new FormData();
    formData.append('photo', file);

    try {
        const response = await fetch('/api/checkin', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('checkinError').textContent = '';
            document.getElementById('photoPreview').classList.add('hidden');
            fileInput.value = '';

            await loadStats();
            await loadCheckins();
            await loadPhotos();
            renderCurrentView();
        } else {
            document.getElementById('checkinError').textContent = data.error || '打卡失败';
        }
    } catch (error) {
        console.error('打卡错误:', error);
        document.getElementById('checkinError').textContent = '打卡失败，请重试';
    }
}

// 切换视图
function switchView(view, e) {
    currentView = view;

    // 更新按钮状态
    document.querySelectorAll('.btn-view').forEach(btn => {
        btn.classList.remove('active');
    });
    if (e && e.target) {
        e.target.classList.add('active');
    }

    // 隐藏所有视图
    document.querySelectorAll('.view-container').forEach(container => {
        container.classList.add('hidden');
    });

    // 显示当前视图
    const viewMap = {
        'grid': 'gridView',
        'timeline': 'timelineView',
        'comparison': 'comparisonView',
        'calendar': 'calendarView'
    };

    document.getElementById(viewMap[view]).classList.remove('hidden');

    renderCurrentView();
}

// 渲染当前视图
function renderCurrentView() {
    switch (currentView) {
        case 'grid':
            renderGridView();
            break;
        case 'timeline':
            renderTimelineView();
            break;
        case 'comparison':
            renderComparisonView();
            break;
        case 'calendar':
            renderCalendarView();
            break;
    }
}

// 渲染网格视图
function renderGridView() {
    const container = document.getElementById('gridContent');
    container.innerHTML = '';

    console.log('渲染网格视图，记录数量:', allCheckins.length);

    if (allCheckins.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">暂无打卡记录</p>';
        return;
    }

    allCheckins.forEach(checkin => {
        const photoData = checkinPhotos[checkin.id];
        const item = document.createElement('div');
        item.className = 'grid-item';
        if (photoData) {
            item.innerHTML = `
                <img src="${photoData}" alt="打卡照片">
                <div class="grid-item-info">
                    <div class="grid-item-date">${formatDate(checkin.date)}</div>
                    <div class="grid-item-day">第 ${checkin.dayCount} 天</div>
                </div>
            `;
        } else {
            item.innerHTML = `
                <div style="width:100%;height:250px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;color:#999;">加载中...</div>
                <div class="grid-item-info">
                    <div class="grid-item-date">${formatDate(checkin.date)}</div>
                    <div class="grid-item-day">第 ${checkin.dayCount} 天</div>
                </div>
            `;
        }
        container.appendChild(item);
    });
}

// 渲染时间线视图
function renderTimelineView() {
    const container = document.getElementById('timelineContent');
    container.innerHTML = '';

    if (allCheckins.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">暂无打卡记录</p>';
        return;
    }

    allCheckins.forEach(checkin => {
        const photoData = checkinPhotos[checkin.id];
        const item = document.createElement('div');
        item.className = 'timeline-item';
        item.innerHTML = `
            <div class="timeline-content">
                <div class="timeline-photo">
                    ${photoData ? `<img src="${photoData}" alt="打卡照片">` : '<div style="width:200px;height:200px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;color:#999;border-radius:8px;">加载中...</div>'}
                </div>
                <div class="timeline-info">
                    <div class="timeline-date">${formatDate(checkin.date)}</div>
                    <div class="timeline-day">第 ${checkin.dayCount} 天打卡</div>
                </div>
            </div>
        `;
        container.appendChild(item);
    });
}

// 渲染对比视图
function renderComparisonView() {
    const container = document.getElementById('comparisonGrid');
    container.innerHTML = '';

    if (allCheckins.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">暂无打卡记录</p>';
        return;
    }

    allCheckins.forEach((checkin, index) => {
        const photoData = checkinPhotos[checkin.id];
        const item = document.createElement('div');
        item.className = 'grid-item';
        if (photoData) {
            item.innerHTML = `
                <img src="${photoData}" alt="打卡照片">
                <div class="grid-item-info">
                    <div class="grid-item-date">${formatDate(checkin.date)}</div>
                    <div class="grid-item-day">第 ${checkin.dayCount} 天</div>
                </div>
            `;
        } else {
            item.innerHTML = `
                <div style="width:100%;height:250px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;color:#999;">加载中...</div>
                <div class="grid-item-info">
                    <div class="grid-item-date">${formatDate(checkin.date)}</div>
                    <div class="grid-item-day">第 ${checkin.dayCount} 天</div>
                </div>
            `;
        }

        item.addEventListener('click', () => selectForComparison(checkin, item));

        if (comparisonSlots[0]?.id === checkin.id || comparisonSlots[1]?.id === checkin.id) {
            item.classList.add('selected');
        }

        container.appendChild(item);
    });
}

// 选择照片进行对比
function selectForComparison(checkin, element) {
    if (comparisonSlots[0] === null) {
        comparisonSlots[0] = checkin;
        updateComparisonSlot(0, checkin);
    } else if (comparisonSlots[1] === null && comparisonSlots[0].id !== checkin.id) {
        comparisonSlots[1] = checkin;
        updateComparisonSlot(1, checkin);
    } else if (comparisonSlots[0].id === checkin.id) {
        comparisonSlots[0] = null;
        updateComparisonSlot(0, null);
    } else if (comparisonSlots[1]?.id === checkin.id) {
        comparisonSlots[1] = null;
        updateComparisonSlot(1, null);
    } else {
        comparisonSlots[0] = comparisonSlots[1];
        comparisonSlots[1] = checkin;
        updateComparisonSlot(0, comparisonSlots[0]);
        updateComparisonSlot(1, checkin);
    }

    renderComparisonView();
}

// 更新对比槽
function updateComparisonSlot(slotIndex, checkin) {
    const slot = document.getElementById(`compareSlot${slotIndex + 1}`);

    if (checkin) {
        const photoData = checkinPhotos[checkin.id];
        slot.innerHTML = `
            ${photoData ? `<img src="${photoData}" alt="对比照片">` : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#999;">加载中...</div>'}
            <div style="position: absolute; bottom: 10px; left: 10px; right: 10px; background: rgba(0,0,0,0.7); color: white; padding: 10px; border-radius: 5px;">
                <div>${formatDate(checkin.date)}</div>
                <div>第 ${checkin.dayCount} 天</div>
            </div>
        `;
        slot.classList.add('compare-slot-filled');
    } else {
        slot.innerHTML = '点击下方照片选择';
        slot.classList.remove('compare-slot-filled');
    }
}

// 清除对比选择
function clearComparison() {
    comparisonSlots = [null, null];
    updateComparisonSlot(0, null);
    updateComparisonSlot(1, null);
    renderComparisonView();
}

// 渲染日历视图
function renderCalendarView() {
    const container = document.getElementById('calendarContent');
    container.innerHTML = '';

    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();

    document.getElementById('calendarMonth').textContent = `${year}年${month + 1}月`;

    // 添加星期标题
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    weekdays.forEach(day => {
        const header = document.createElement('div');
        header.className = 'calendar-day-header';
        header.textContent = day;
        container.appendChild(header);
    });

    // 获取当月第一天是星期几
    const firstDay = new Date(year, month, 1).getDay();

    // 获取当月天数
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // 创建日历格子
    for (let i = 0; i < firstDay; i++) {
        const emptyDay = document.createElement('div');
        emptyDay.className = 'calendar-day';
        container.appendChild(emptyDay);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const checkin = allCheckins.find(c => c.date === dateStr);

        const dayElement = document.createElement('div');
        dayElement.className = 'calendar-day';

        if (checkin) {
            const photoData = checkinPhotos[checkin.id];
            dayElement.classList.add('calendar-day-checkin');
            if (photoData) {
                dayElement.innerHTML = `
                    <img src="${photoData}" alt="打卡照片">
                    <div class="calendar-day-badge">${checkin.dayCount}</div>
                `;
            } else {
                dayElement.innerHTML = `
                    <div style="width:100%;height:100%;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:bold;color:#667eea;">${checkin.dayCount}</div>
                    <div class="calendar-day-badge">${checkin.dayCount}</div>
                `;
            }
        } else {
            dayElement.innerHTML = `<div class="calendar-day-number">${day}</div>`;
        }

        container.appendChild(dayElement);
    }
}

// 切换月份
function changeMonth(delta) {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + delta);
    renderCalendarView();
}

// 格式化日期
function formatDate(dateStr) {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${year}年${month}月${day}日`;
}
