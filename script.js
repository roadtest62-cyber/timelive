/**
 * Quản lý thời gian livestream
 * Đồng bộ dữ liệu real-time qua Firebase Firestore.
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

  // ===== FIREBASE =====
  firebase.initializeApp(FIREBASE_CONFIG);
  const db = firebase.firestore();

  // ===== STATE =====
  const now = new Date();
  const state = {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    days: []
  };

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

    $('todayBtn').addEventListener('click', () => {
      const n = new Date();
      state.year = n.getFullYear();
      state.month = n.getMonth() + 1;
      yearSelect.value = state.year;
      monthSelect.value = state.month;
      loadMonth();
    });

    $('saveBtn').addEventListener('click', async () => {
      await saveToFirestore();
      showSaveStatus('Đã lưu lúc ' + new Date().toLocaleTimeString('vi-VN'));
    });

    $('clearMonthBtn').addEventListener('click', async () => {
      if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ dữ liệu livestream của tháng này không?')) return;
      state.days = createEmptyDays(state.year, state.month);
      await saveToFirestore();
      render();
      showSaveStatus('Đã xóa dữ liệu tháng');
    });

    $('exportCsvBtn').addEventListener('click', exportCsv);
    $('backupJsonBtn').addEventListener('click', backupJson);
    $('restoreJsonBtn').addEventListener('click', () => restoreFileInput.click());
    restoreFileInput.addEventListener('change', restoreJson);

    tbody.addEventListener('click', onTableClick);
    tbody.addEventListener('input', onTableInput);
    tbody.addEventListener('change', onTableInput);
    tbody.addEventListener('blur', onTableBlur, true);
  }

  // ===== FIRESTORE =====
  function docId(y, m) {
    return `${y}_${String(m).padStart(2, '0')}`;
  }

  async function saveToFirestore() {
    try {
      await db.collection('livestream').doc(docId(state.year, state.month)).set({
        year: state.year,
        month: state.month,
        days: state.days
      });
    } catch (e) {
      console.error('Lỗi lưu Firebase:', e);
      showSaveStatus('Có lỗi khi lưu dữ liệu');
    }
  }

  async function loadMonth() {
    try {
      const snap = await db.collection('livestream').doc(docId(state.year, state.month)).get();
      const fullDays = createEmptyDays(state.year, state.month);

      if (snap.exists && Array.isArray(snap.data().days)) {
        const savedMap = new Map(snap.data().days.map(d => [d.date, d]));
        state.days = fullDays.map(d => savedMap.has(d.date) ? mergeDay(d, savedMap.get(d.date)) : d);
      } else {
        state.days = fullDays;
      }

      await saveToFirestore();
    } catch (e) {
      console.error('Lỗi đọc Firebase:', e);
      state.days = createEmptyDays(state.year, state.month);
    }
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
    if (cleaned === '') return { valid: false, minutes: 0, normalized: '' };
    const match = cleaned.match(/^(\d+)h(\d{1,2})$/i);
    if (!match) return { valid: false, minutes: 0, normalized: '' };
    const hours = Number(match[1]);
    const mins = Number(match[2]);
    if (mins > 59) return { valid: false, minutes: 0, normalized: '' };
    const normalized = `${hours}h${String(mins).padStart(2, '0')}`;
    return { valid: true, minutes: hours * 60 + mins, normalized };
  }

  function formatMinutes(total) {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${h} giờ ${m} phút`;
  }

  function summarizeDay(day) {
    let count = 0, mins = 0;
    for (const s of day.sessions) {
      const r = parseLiveDuration(s.value);
      if (r.valid) { count++; mins += r.minutes; }
    }
    return { count, mins, text: formatMinutes(mins) };
  }

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
        const isEmpty = s.value.trim() === '';
        const inputClass = isEmpty ? '' : (r.valid ? '' : ' invalid');
        const errorMsg = (!r.valid && !isEmpty) ? '<div class="session-error">Sai định dạng. Vui lòng nhập theo dạng 2h15.</div>' : '';
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
  async function onTableClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const a = btn.dataset.a;
    const di = +btn.dataset.di;

    if (a === 'add-session') {
      const day = state.days[di];
      if (!day) return;
      const n = day.sessions.length + 1;
      day.sessions.push({ id: `${day.date}-${n}`, label: `Ca ${n}`, value: '' });
      await saveToFirestore();
      render();
      showSaveStatus('Đã lưu lúc ' + new Date().toLocaleTimeString('vi-VN'));
    }

    if (a === 'rm-session') {
      const sid = btn.dataset.sid;
      const day = state.days[di];
      if (!day) return;
      if (!confirm('Bạn có chắc chắn muốn xóa ca livestream này không?')) return;
      day.sessions = day.sessions.filter(s => s.id !== sid);
      day.sessions.forEach((s, i) => { s.label = `Ca ${i + 1}`; });
      if (day.sessions.length === 0) {
        day.sessions.push({ id: `${day.date}-1`, label: 'Ca 1', value: '' });
      }
      await saveToFirestore();
      render();
      showSaveStatus('Đã lưu lúc ' + new Date().toLocaleTimeString('vi-VN'));
    }

    if (a === 'clear-day') {
      const day = state.days[di];
      if (!day) return;
      if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ các ca livestream của ngày này không?')) return;
      day.sessions = [{ id: `${day.date}-1`, label: 'Ca 1', value: '' }];
      await saveToFirestore();
      render();
      showSaveStatus('Đã lưu lúc ' + new Date().toLocaleTimeString('vi-VN'));
    }
  }

  async function onTableInput(e) {
    const input = e.target;
    if (!input.dataset.sid) return;
    const di = +input.dataset.di;
    const session = state.days[di]?.sessions.find(s => s.id === input.dataset.sid);
    if (!session) return;

    session.value = input.value;

    const r = parseLiveDuration(session.value);
    const isEmpty = session.value.trim() === '';
    if (isEmpty || r.valid) {
      input.classList.remove('invalid');
      const errEl = input.parentElement.nextElementSibling;
      if (errEl && errEl.classList.contains('session-error')) errEl.remove();
    } else {
      input.classList.add('invalid');
      if (!input.parentElement.nextElementSibling?.classList.contains('session-error')) {
        const err = document.createElement('div');
        err.className = 'session-error';
        err.textContent = 'Sai định dạng. Vui lòng nhập theo dạng 2h15.';
        input.parentElement.after(err);
      }
    }

    updateRow(di);
    renderSummary();
    await saveToFirestore();
  }

  async function onTableBlur(e) {
    const input = e.target;
    if (!input.dataset.sid) return;
    const di = +input.dataset.di;
    const session = state.days[di]?.sessions.find(s => s.id === input.dataset.sid);
    if (!session) return;

    const r = parseLiveDuration(session.value);
    if (r.valid && session.value !== r.normalized) {
      session.value = r.normalized;
      input.value = r.normalized;
      input.classList.remove('invalid');
      const errEl = input.parentElement.nextElementSibling;
      if (errEl && errEl.classList.contains('session-error')) errEl.remove();
      updateRow(di);
      renderSummary();
      await saveToFirestore();
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

  // ===== BACKUP JSON (toàn bộ Firebase) =====
  async function backupJson() {
    try {
      const snapshot = await db.collection('livestream').get();
      const data = {};
      snapshot.forEach(doc => { data[doc.id] = doc.data(); });
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `livestream-backup-${dateStr}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      showSaveStatus('Đã sao lưu JSON');
    } catch (e) {
      console.error(e);
      showSaveStatus('Lỗi khi sao lưu');
    }
  }

  // ===== RESTORE JSON =====
  async function restoreJson(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm('Bạn có chắc chắn muốn khôi phục dữ liệu từ file JSON này không?\nDữ liệu hiện tại sẽ bị ghi đè.')) {
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        if (typeof data !== 'object' || data === null) throw new Error();
        // Xóa dữ liệu cũ trên Firebase
        const snapshot = await db.collection('livestream').get();
        const batch = db.batch();
        snapshot.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        // Ghi dữ liệu mới
        const batch2 = db.batch();
        Object.entries(data).forEach(([key, val]) => {
          if (typeof key === 'string' && typeof val === 'object') {
            batch2.set(db.collection('livestream').doc(key), val);
          }
        });
        await batch2.commit();
        await loadMonth();
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

  init();
});
