document.addEventListener('DOMContentLoaded', () => {
  const monthSelect = document.getElementById('monthSelect');
  const yearSelect = document.getElementById('yearSelect');
  const daysTableBody = document.getElementById('daysTableBody');
  const summarySection = document.getElementById('summarySection');
  const importFileInput = document.getElementById('importFileInput');
  const loadingOverlay = document.getElementById('loadingOverlay');

  firebase.initializeApp(FIREBASE_CONFIG);
  const db = firebase.firestore();

  const state = {
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    days: []
  };

  // ==================== INIT ====================

  function init() {
    populateMonthSelect();
    populateYearSelect();
    bindEvents();
    loadMonth();
  }

  function populateMonthSelect() {
    monthSelect.innerHTML = '';
    for (let m = 1; m <= 12; m++) {
      const opt = document.createElement('option');
      opt.value = String(m);
      opt.textContent = `Tháng ${String(m).padStart(2, '0')}`;
      monthSelect.appendChild(opt);
    }
    monthSelect.value = String(state.month);
  }

  function populateYearSelect() {
    yearSelect.innerHTML = '';
    const cy = new Date().getFullYear();
    for (let y = cy - 5; y <= cy + 2; y++) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      yearSelect.appendChild(opt);
    }
    yearSelect.value = String(state.year);
  }

  // ==================== EVENTS ====================

  function bindEvents() {
    // Auto-switch when dropdown changes
    monthSelect.addEventListener('change', () => {
      state.month = Number(monthSelect.value);
      loadMonth();
    });

    yearSelect.addEventListener('change', () => {
      state.year = Number(yearSelect.value);
      loadMonth();
    });

    document.getElementById('showMonthBtn').addEventListener('click', () => {
      state.year = Number(yearSelect.value);
      state.month = Number(monthSelect.value);
      loadMonth();
    });

    document.getElementById('clearMonthBtn').addEventListener('click', async () => {
      if (!confirm('Xóa toàn bộ dữ liệu livestream của tháng này?')) return;
      state.days = createEmptyDays(state.year, state.month);
      await saveToFirebase();
      render();
    });

    document.getElementById('clearAllBtn').addEventListener('click', clearAllMonths);

    document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);
    document.getElementById('exportJsonBtn').addEventListener('click', exportJson);
    document.getElementById('importJsonBtn').addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', handleImportJson);

    daysTableBody.addEventListener('click', handleTableClick);
    daysTableBody.addEventListener('input', handleTableInput);
  }

  // ==================== FIREBASE ====================

  function getDocId(year, month) {
    return `${year}_${String(month).padStart(2, '0')}`;
  }

  async function loadMonth() {
    showLoading();
    try {
      const docRef = db.collection('livestream').doc(getDocId(state.year, state.month));
      const doc = await docRef.get();

      // Full month structure (all 28-31 days)
      const allDays = createEmptyDays(state.year, state.month);

      if (doc.exists && Array.isArray(doc.data().days)) {
        // Merge: saved data takes priority, missing days get empty defaults
        const savedMap = new Map(doc.data().days.map((d) => [d.date, d]));
        state.days = allDays.map((emptyDay) => {
          const saved = savedMap.get(emptyDay.date);
          return saved ? mergeDayData(emptyDay, saved) : emptyDay;
        });
      } else {
        state.days = allDays;
      }

      // Always save back to ensure full month is stored
      await saveToFirebase();
    } catch (err) {
      console.error('Firebase read error:', err);
      state.days = createEmptyDays(state.year, state.month);
    }
    hideLoading();
    render();
  }

  async function saveToFirebase() {
    try {
      await db.collection('livestream').doc(getDocId(state.year, state.month)).set({
        year: state.year,
        month: state.month,
        days: state.days
      });
    } catch (err) {
      console.error('Firebase write error:', err);
    }
  }

  async function clearAllMonths() {
    if (!confirm('Xóa TOÀN BỘ dữ liệu livestream của TẤT CẢ các tháng?\nHành động này không thể hoàn tác!')) return;
    if (!confirm('Bạn chắc chắn chưa? Tất cả dữ liệu sẽ mất!')) return;

    showLoading();
    try {
      const snapshot = await db.collection('livestream').get();
      const batch = db.batch();
      snapshot.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    } catch (err) {
      console.error('Firebase clear error:', err);
    }
    state.days = createEmptyDays(state.year, state.month);
    await saveToFirebase();
    hideLoading();
    render();
  }

  // ==================== DATA HELPERS ====================

  function createEmptyDays(year, month) {
    const total = getDaysInMonth(year, month);
    const days = [];
    for (let d = 1; d <= total; d++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({
        date,
        sessions: [{ id: `${date}-1`, label: 'Ca 1', value: '' }]
      });
    }
    return days;
  }

  function mergeDayData(emptyDay, savedDay) {
    const sessions = Array.isArray(savedDay.sessions) && savedDay.sessions.length > 0
      ? savedDay.sessions.map((s, i) => ({
          id: s.id || `${emptyDay.date}-${i + 1}`,
          label: s.label || `Ca ${i + 1}`,
          value: s.value || ''
        }))
      : [{ id: `${emptyDay.date}-1`, label: 'Ca 1', value: '' }];
    return { date: emptyDay.date, sessions };
  }

  // ==================== RENDER ====================

  function render() {
    renderTable();
    renderSummary();
  }

  function renderTable() {
    if (state.days.length === 0) {
      daysTableBody.innerHTML = '<tr><td colspan="7">Không có dữ liệu.</td></tr>';
      return;
    }

    daysTableBody.innerHTML = state.days.map((day, idx) => {
      const sum = summarizeDay(day);
      const sessionsHtml = day.sessions.map((s) => {
        const ok = parseLiveDuration(s.value).valid || s.value.trim() === '';
        return `
          <div class="live-item">
            <span class="live-label">${esc(s.label)}</span>
            <input type="text"
              class="live-input${ok ? '' : ' input-invalid'}"
              data-action="edit-session"
              data-day-index="${idx}"
              data-session-id="${s.id}"
              value="${esc(s.value)}"
              placeholder="2h15"
            />
            <button type="button" class="icon-btn" data-action="remove-session"
              data-day-index="${idx}" data-session-id="${s.id}">&times;</button>
          </div>`;
      }).join('');

      return `<tr>
        <td>${idx + 1}</td>
        <td class="day-date">${fmtDate(day.date)}</td>
        <td class="col-sessions"><div class="live-stack">${sessionsHtml}</div></td>
        <td>${sum.validCount}</td>
        <td>${sum.totalMinutes}</td>
        <td>${sum.totalTime}</td>
        <td>
          <div class="day-actions">
            <button type="button" class="btn-primary" data-action="add-session" data-day-index="${idx}">+ Ca</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  function renderSummary() {
    const s = summarizeMonth(state.days);
    summarySection.innerHTML = `
      <h2>TỔNG KẾT THÁNG ${String(state.month).padStart(2, '0')}/${state.year}</h2>
      <div class="summary-grid">
        <div class="summary-card"><span>Ngày có livestream</span><strong>${s.dayCount} ngày</strong></div>
        <div class="summary-card"><span>Tổng ca livestream</span><strong>${s.validSessionCount} ca</strong></div>
        <div class="summary-card"><span>Tổng phút livestream</span><strong>${s.totalMinutes} phút</strong></div>
        <div class="summary-card"><span>Tổng thời gian</span><strong>${s.totalTime}</strong></div>
      </div>`;
  }

  // ==================== TABLE ACTIONS ====================

  async function handleTableClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const { action, dayIndex, sessionId } = btn.dataset;
    const day = state.days[Number(dayIndex)];
    if (!day) return;

    if (action === 'add-session') {
      const n = day.sessions.length + 1;
      day.sessions.push({ id: `${day.date}-${n}`, label: `Ca ${n}`, value: '' });
      await saveToFirebase();
      render();
    }

    if (action === 'remove-session') {
      day.sessions = day.sessions.filter((s) => s.id !== sessionId);
      // Re-label remaining sessions
      day.sessions.forEach((s, i) => { s.label = `Ca ${i + 1}`; });
      if (day.sessions.length === 0) {
        day.sessions.push({ id: `${day.date}-1`, label: 'Ca 1', value: '' });
      }
      await saveToFirebase();
      render();
    }
  }

  function handleTableInput(e) {
    const input = e.target;
    if (input.dataset.action !== 'edit-session') return;

    const dayIndex = Number(input.dataset.dayIndex);
    const sessionId = input.dataset.sessionId;
    const session = state.days[dayIndex]?.sessions.find((s) => s.id === sessionId);
    if (!session) return;

    // Save raw value — user can freely edit
    session.value = input.value;

    // Visual feedback only
    const result = parseLiveDuration(session.value);
    if (result.valid || session.value.trim() === '') {
      input.classList.remove('input-invalid');
    } else {
      input.classList.add('input-invalid');
    }

    saveToFirebase();
    renderSummary();
    updateDaySummaryCell(dayIndex);
  }

  function updateDaySummaryCell(dayIndex) {
    const row = daysTableBody.rows[dayIndex];
    if (!row) return;
    const sum = summarizeDay(state.days[dayIndex]);
    row.cells[3].textContent = sum.validCount;
    row.cells[4].textContent = sum.totalMinutes;
    row.cells[5].textContent = sum.totalTime;
  }

  // ==================== CALCULATIONS ====================

  function summarizeDay(day) {
    let validCount = 0;
    let totalMinutes = 0;
    day.sessions.forEach((s) => {
      const r = parseLiveDuration(s.value);
      if (r.valid) { validCount++; totalMinutes += r.totalMinutes; }
    });
    return { validCount, totalMinutes, totalTime: fmtMinutes(totalMinutes) };
  }

  function summarizeMonth(days) {
    let totalMinutes = 0, validSessionCount = 0, dayCount = 0;
    days.forEach((day) => {
      const s = summarizeDay(day);
      if (s.validCount > 0) dayCount++;
      totalMinutes += s.totalMinutes;
      validSessionCount += s.validCount;
    });
    return { dayCount, validSessionCount, totalMinutes, totalTime: fmtMinutes(totalMinutes) };
  }

  function parseLiveDuration(value) {
    if (typeof value !== 'string') return { valid: false, totalMinutes: null };
    const cleaned = value.trim().replace(/\s+/g, '').toLowerCase();
    if (!cleaned) return { valid: false, totalMinutes: null };
    const m = cleaned.match(/^(\d+)h(\d{1,2})$/i);
    if (!m) return { valid: false, totalMinutes: null };
    const hours = Number(m[1]), mins = Number(m[2]);
    if (mins > 59) return { valid: false, totalMinutes: null };
    return { valid: true, totalMinutes: hours * 60 + mins };
  }

  // ==================== EXPORT / IMPORT ====================

  function exportCsv() {
    const rows = [['STT', 'Ngày', 'Ca', 'Thời lượng', 'Phút', 'Tổng phút', 'Tổng thời gian']];
    state.days.forEach((day, i) => {
      const ds = summarizeDay(day);
      day.sessions.forEach((s) => {
        const r = parseLiveDuration(s.value);
        rows.push([i + 1, fmtDate(day.date), s.label, s.value,
          r.valid ? r.totalMinutes : '',
          ds.validCount > 0 ? ds.totalMinutes : '',
          ds.validCount > 0 ? ds.totalTime : '']);
      });
    });
    const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
    download(`livestream_${state.year}_${String(state.month).padStart(2, '0')}.csv`, '﻿' + csv);
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({
      exportedAt: new Date().toISOString(),
      year: state.year, month: state.month, days: state.days
    }, null, 2)], { type: 'application/json;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `livestream_${state.year}_${String(state.month).padStart(2, '0')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function handleImportJson(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm('Ghi đè dữ liệu hiện tại bằng file JSON?')) { e.target.value = ''; return; }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const payload = JSON.parse(reader.result);
        if (payload.days && Array.isArray(payload.days)) {
          if (payload.year) state.year = payload.year;
          if (payload.month) state.month = payload.month;
          yearSelect.value = String(state.year);
          monthSelect.value = String(state.month);
          // Merge imported days with full month
          const allDays = createEmptyDays(state.year, state.month);
          const importMap = new Map(payload.days.map((d) => [d.date, d]));
          state.days = allDays.map((d) => importMap.has(d.date) ? mergeDayData(d, importMap.get(d.date)) : d);
        }
        await saveToFirebase();
        render();
      } catch { alert('File JSON không hợp lệ.'); }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  // ==================== UTILS ====================

  function fmtMinutes(total) {
    return `${Math.floor(total / 60)}g ${total % 60}p`;
  }

  function fmtDate(ds) {
    const [y, m, d] = ds.split('-').map(Number);
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  }

  function getDaysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
  }

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

  function showLoading() { loadingOverlay.style.display = 'flex'; }
  function hideLoading() { loadingOverlay.style.display = 'none'; }

  init();
});
