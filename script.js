/**
 * Quản lý thời gian livestream
 * Lưu trữ trên localStorage, chạy hoàn toàn trên trình duyệt.
 */

document.addEventListener('DOMContentLoaded', () => {
  // ===== DOM =====
  const $ = (id) => document.getElementById(id);
  const monthSelect = $('monthSelect');
  const yearSelect = $('yearSelect');
  const tbody = $('tbody');
  const summaryEl = $('summary');
  const saveStatusEl = $('saveStatus');
  const restoreFileInput = $('restoreFileInput');

  // ===== STATE =====
  const now = new Date();
  const state = {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    days: [] // [{date:'2026-08-01', sessions:[{id,label,value}]}]
  };

  const STORAGE_PREFIX = 'livestream_';

  // ===== INIT =====
  function init() {
    populateSelects();
    bindEvents();
    loadMonth();
  }

  // ===== POPULATE SELECTS =====
  function populateSelects() {
    monthSelect.innerHTML = '';
    for (let m = 1; m <= 12; m++) {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = `Tháng ${String(m).padStart(2, '0')}`;
      monthSelect.appendChild(o);
    }
    yearSelect.innerHTML = '';
    const cy = now.getFullYear();
    for (let y = cy - 5; y <= cy + 2; y++) {
      const o = document.createElement('option');
      o.value = y;
      o.textContent = y;
      yearSelect.appendChild(o);
    }
    monthSelect.value = state.month;
    yearSelect.value = state.year;
  }

  // ===== EVENTS =====
  function bindEvents() {
    // Tự load khi đổi tháng/năm
    monthSelect.addEventListener('change', () => {
      state.month = +monthSelect.value;
      state.year = +yearSelect.value;
      loadMonth();
    });
    yearSelect.addEventListener('change', () => {
      state.month = +monthSelect.value;
      state.year = +yearSelect.value;
      loadMonth();
    });

    // Nút tháng hiện tại
    $('todayBtn').addEventListener('click', () => {
      const n = new Date();
      state.year = n.getFullYear();
      state.month = n.getMonth() + 1;
      yearSelect.value = state.year;
      monthSelect.value = state.month;
      loadMonth();
    });

    // Nút lưu thủ công
    $('saveBtn').addEventListener('click', () => {
      saveToStorage();
      showSaveStatus('Đã lưu thủ công lúc ' + new Date().toLocaleTimeString('vi-VN'));
    });

    // Xóa tháng
    $('clearMonthBtn').addEventListener('click', () => {
      if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ dữ liệu livestream của tháng này không?')) return;
      state.days = createEmptyDays(state.year, state.month);
      saveToStorage();
      render();
      showSaveStatus('Đã xóa dữ liệu tháng');
    });

    // Xuất CSV
    $('exportCsvBtn').addEventListener('click', exportCsv);

    // Sao lưu JSON
    $('backupJsonBtn').addEventListener('click', backupJson);

    // Khôi phục JSON
    $('restoreJsonBtn').addEventListener('click', () => restoreFileInput.click());
    restoreFileInput.addEventListener('change', restoreJson);

    // Delegate events trên tbody
    tbody.addEventListener('click', onTableClick);
    tbody.addEventListener('input', onTableInput);
    tbody.addEventListener('change', onTableInput); // backup cho mobile
    tbody.addEventListener('blur', onTableBlur, true);
  }

  // ===== STORAGE =====
  function storageKey(y, m) {
    return STORAGE_PREFIX + y + '_' + String(m).padStart(2, '0');
  }

  function saveToStorage() {
    try {
      localStorage.setItem(storageKey(state.year, state.month), JSON.stringify(state.days));
    } catch (e) {
      console.error('Lỗi lưu dữ liệu:', e);
      showSaveStatus('Có lỗi khi lưu dữ liệu');
    }
  }

  function loadFromStorage(y, m) {
    try {
      const raw = localStorage.getItem(storageKey(y, m));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  // ===== LOAD MONTH =====
  function loadMonth() {
    const saved = loadFromStorage(state.year, state.month);
    if (saved && saved.length > 0) {
      // Dùng dữ cũ, nhưng bổ sung ngày thiếu nếu số lượng chưa đủ
      const fullDays = createEmptyDays(state.year, state.month);
      const savedMap = new Map(saved.map(d => [d.date, d]));
      state.days = fullDays.map(d => savedMap.has(d.date) ? mergeDay(d, savedMap.get(d.date)) : d);
    } else {
      state.days = createEmptyDays(state.year, state.month);
    }
    saveToStorage();
    render();
    showSaveStatus('Đã tải dữ liệu');
  }

  // ===== CREATE EMPTY DAYS =====
  function createEmptyDays(y, m) {
    const total = new Date(y, m, 0).getDate();
    const days = [];
    for (let d = 1; d <= total; d++) {
      const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({
        date,
        sessions: [{ id: `${date}-1`, label: 'Ca 1', value: '' }]
      });
    }
    return days;
  }

  // ===== MERGE: giữ data cũ, bổ sung ngày mới =====
  function mergeDay(empty, saved) {
    const sessions = (Array.isArray(saved.sessions) && saved.sessions.length > 0)
      ? saved.sessions.map((s, i) => ({
          id: s.id || `${empty.date}-${i + 1}`,
          label: s.label || `Ca ${i + 1}`,
          value: s.value || ''
        }))
      : [{ id: `${empty.date}-1`, label: 'Ca 1', value: '' }];
    return { date: empty.date, sessions };
  }

  // ===== PARSE LIVE DURATION =====
  function parseLiveDuration(value) {
    if (typeof value !== 'string') return { valid: false, minutes: 0, normalized: '' };
    const cleaned = value.trim().replace(/\s+/g, '').toLowerCase();
    if (cleaned === '') return { valid: false, minutes: 0, normalized: '' }; // rỗng = chưa nhập
    const match = cleaned.match(/^(\d+)h(\d{1,2})$/i);
    if (!match) return { valid: false, minutes: 0, normalized: '' };
    const hours = Number(match[1]);
    const mins = Number(match[2]);
    if (mins > 59) return { valid: false, minutes: 0, normalized: '' };
    const normalized = `${hours}h${String(mins).padStart(2, '0')}`;
    return { valid: true, minutes: hours * 60 + mins, normalized };
  }

  // ===== FORMAT MINUTES =====
  function formatMinutes(total) {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${h} giờ ${m} phút`;
  }

  // ===== SUMMARIZE DAY =====
  function summarizeDay(day) {
    let count = 0, mins = 0;
    for (const s of day.sessions) {
      const r = parseLiveDuration(s.value);
      if (r.valid) { count++; mins += r.minutes; }
    }
    return { count, mins, text: formatMinutes(mins) };
  }

  // ===== SUMMARIZE MONTH =====
  function summarizeMonth() {
    let totalMins = 0, totalCount = 0, dayCount = 0;
    for (const day of state.days) {
      const s = summarizeDay(day);
      if (s.count > 0) dayCount++;
      totalMins += s.mins;
      totalCount += s.count;
    }
    return { dayCount, totalCount, totalMins, totalText: formatMinutes(totalMins) };
  }

  // ===== RENDER =====
  function render() {
    renderTable();
    renderSummary();
  }

  function renderTable() {
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    tbody.innerHTML = state.days.map((day, i) => {
      const sum = summarizeDay(day);
      const isToday = day.date === todayStr;
      const sessionsHtml = day.sessions.map(s => {
        const r = parseLiveDuration(s.value);
        const isValid = r.valid;
        const isEmpty = s.value.trim() === '';
        const inputClass = isEmpty ? '' : (isValid ? '' : ' invalid');
        const errorMsg = (!isValid && !isEmpty) ? '<div class="session-error">Sai định dạng. Vui lòng nhập theo dạng 2h15.</div>' : '';
        return `
          <div class="session-item">
            <span class="session-label">${esc(s.label)}</span>
            <input type="text" class="session-input${inputClass}"
              data-di="${i}" data-sid="${s.id}"
              value="${esc(s.value)}" placeholder="Ví dụ: 2h15" />
            <button type="button" class="btn-icon" data-a="rm-session" data-di="${i}" data-sid="${s.id}">&times;</button>
          </div>
          ${errorMsg}`;
      }).join('');

      const [y, m, d] = day.date.split('-');
      const displayDate = `${d}/${m}/${y}`;

      return `
        <tr class="${isToday ? 'today' : ''}">
          <td>${i + 1}</td>
          <td class="day-date">${displayDate}</td>
          <td class="c-sessions">
            <div class="session-stack">${sessionsHtml}</div>
          </td>
          <td>${sum.count}</td>
          <td>${sum.mins}</td>
          <td>${sum.text}</td>
          <td>
            <div class="row-actions">
              <button type="button" class="btn-add" data-a="add-session" data-di="${i}">Thêm ca live</button>
              <button type="button" class="btn-del-day" data-a="clear-day" data-di="${i}">Xóa ngày</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  function renderSummary() {
    const s = summarizeMonth();
    summaryEl.innerHTML = `
      <h2>TỔNG KẾT THÁNG ${String(state.month).padStart(2, '0')}/${state.year}</h2>
      <div class="summary-grid">
        <div class="summary-item"><div class="label">Số ngày có livestream</div><div class="value">${s.dayCount} ngày</div></div>
        <div class="summary-item"><div class="label">Tổng số ca livestream</div><div class="value">${s.totalCount} ca</div></div>
        <div class="summary-item"><div class="label">Tổng số phút livestream</div><div class="value">${s.totalMins} phút</div></div>
        <div class="summary-item"><div class="label">Tổng thời gian livestream</div><div class="value">${s.totalText}</div></div>
      </div>`;
  }

  // ===== UPDATE SINGLE ROW (không render lại toàn bộ bảng) =====
  function updateRow(dayIndex) {
    const row = tbody.rows[dayIndex];
    if (!row) return;
    const day = state.days[dayIndex];
    const sum = summarizeDay(day);
    row.cells[3].textContent = sum.count;
    row.cells[4].textContent = sum.mins;
    row.cells[5].textContent = sum.text;
  }

  // ===== TABLE EVENTS =====
  function onTableClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const a = btn.dataset.a;
    const di = +btn.dataset.di;

    if (a === 'add-session') {
      const day = state.days[di];
      if (!day) return;
      const n = day.sessions.length + 1;
      day.sessions.push({ id: `${day.date}-${n}`, label: `Ca ${n}`, value: '' });
      saveToStorage();
      render(); // Render lại khi thêm/xóa để cập nhật DOM
      showSaveStatus('Đã lưu lúc ' + new Date().toLocaleTimeString('vi-VN'));
    }

    if (a === 'rm-session') {
      const sid = btn.dataset.sid;
      const day = state.days[di];
      if (!day) return;
      if (!confirm('Bạn có chắc chắn muốn xóa ca livestream này không?')) return;
      day.sessions = day.sessions.filter(s => s.id !== sid);
      // Đánh lại label
      day.sessions.forEach((s, i) => { s.label = `Ca ${i + 1}`; });
      if (day.sessions.length === 0) {
        day.sessions.push({ id: `${day.date}-1`, label: 'Ca 1', value: '' });
      }
      saveToStorage();
      render();
      showSaveStatus('Đã lưu lúc ' + new Date().toLocaleTimeString('vi-VN'));
    }

    if (a === 'clear-day') {
      const day = state.days[di];
      if (!day) return;
      if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ các ca livestream của ngày này không?')) return;
      day.sessions = [{ id: `${day.date}-1`, label: 'Ca 1', value: '' }];
      saveToStorage();
      render();
      showSaveStatus('Đã lưu lúc ' + new Date().toLocaleTimeString('vi-VN'));
    }
  }

  // input: chỉ cập nhật data + validate, KHÔNG render lại bảng
  function onTableInput(e) {
    const input = e.target;
    if (!input.dataset.sid) return;
    const di = +input.dataset.di;
    const session = state.days[di]?.sessions.find(s => s.id === input.dataset.sid);
    if (!session) return;

    session.value = input.value;

    // Validate realtime
    const r = parseLiveDuration(session.value);
    const isEmpty = session.value.trim() === '';
    if (isEmpty || r.valid) {
      input.classList.remove('invalid');
      // Xóa thông báo lỗi nếu có
      const errEl = input.parentElement.nextElementSibling;
      if (errEl && errEl.classList.contains('session-error')) errEl.remove();
    } else {
      input.classList.add('invalid');
      // Thêm thông báo lỗi nếu chưa có
      if (!input.parentElement.nextElementSibling?.classList.contains('session-error')) {
        const err = document.createElement('div');
        err.className = 'session-error';
        err.textContent = 'Sai định dạng. Vui lòng nhập theo dạng 2h15.';
        input.parentElement.after(err);
      }
    }

    // Cập nhật tổng ngày (không render lại bảng)
    updateRow(di);
    // Cập nhật tổng tháng
    renderSummary();
    // Lưu
    saveToStorage();
  }

  // blur: chuẩn hóa giá trị
  function onTableBlur(e) {
    const input = e.target;
    if (!input.dataset.sid) return;
    const di = +input.dataset.di;
    const session = state.days[di]?.sessions.find(s => s.id === input.dataset.sid);
    if (!session) return;

    const r = parseLiveDuration(session.value);
    if (r.valid && session.value !== r.normalized) {
      // Chuẩn hóa: 2 H 15 → 2h15
      session.value = r.normalized;
      input.value = r.normalized;
      input.classList.remove('invalid');
      const errEl = input.parentElement.nextElementSibling;
      if (errEl && errEl.classList.contains('session-error')) errEl.remove();
      updateRow(di);
      renderSummary();
      saveToStorage();
      showSaveStatus('Đã lưu lúc ' + new Date().toLocaleTimeString('vi-VN'));
    }
  }

  // ===== EXPORT CSV =====
  function exportCsv() {
    const rows = [['STT', 'Ngày', 'Tên ca', 'Thời lượng', 'Số phút', 'Tổng ca ngày', 'Tổng phút ngày', 'Tổng thời gian ngày']];
    state.days.forEach((day, i) => {
      const ds = summarizeDay(day);
      const [, mm, dd] = day.date.split('-');
      const displayDate = `${dd}/${mm}/${day.date.split('-')[0]}`;
      day.sessions.forEach(s => {
        const r = parseLiveDuration(s.value);
        rows.push([
          i + 1, displayDate, s.label, s.value,
          r.valid ? r.minutes : '',
          ds.count, ds.mins, ds.text
        ]);
      });
    });
    const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
    download(`livestream-thang-${String(state.month).padStart(2, '0')}-${state.year}.csv`, '﻿' + csv);
  }

  // ===== BACKUP JSON (toàn bộ localStorage) =====
  function backupJson() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(STORAGE_PREFIX)) {
        try { data[key] = JSON.parse(localStorage.getItem(key)); }
        catch { data[key] = localStorage.getItem(key); }
      }
    }
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `livestream-backup-${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showSaveStatus('Đã sao lưu JSON');
  }

  // ===== RESTORE JSON =====
  function restoreJson(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm('Bạn có chắc chắn muốn khôi phục dữ liệu từ file JSON này không?\nDữ liệu hiện tại sẽ bị ghi đè.')) {
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (typeof data !== 'object' || data === null) throw new Error();
        // Kiểm tra cấu trúc: mỗi key phải bắt đầu bằng STORAGE_PREFIX
        const validKeys = Object.keys(data).filter(k => k.startsWith(STORAGE_PREFIX));
        if (validKeys.length === 0) { alert('File không hợp lệ hoặc không có dữ liệu livestream.'); return; }
        // Xóa dữ liệu cũ
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k.startsWith(STORAGE_PREFIX)) keysToRemove.push(k);
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
        // Ghi dữ liệu mới
        validKeys.forEach(k => {
          localStorage.setItem(k, JSON.stringify(data[k]));
        });
        // Tải lại tháng hiện tại
        loadMonth();
        showSaveStatus('Đã khôi phục dữ liệu thành công');
      } catch {
        alert('File JSON không hợp lệ.');
      }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  // ===== UTILS =====
  function esc(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function csvEscape(v) {
    const s = String(v ?? '');
    return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function download(name, content) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function showSaveStatus(msg) {
    saveStatusEl.textContent = msg;
  }

  // ===== START =====
  init();
});
