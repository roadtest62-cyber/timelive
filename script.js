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

  function init() {
    populateMonthSelect();
    populateYearSelect();
    monthSelect.value = String(state.month);
    yearSelect.value = String(state.year);
    bindEvents();
    loadMonth();
  }

  function populateMonthSelect() {
    monthSelect.innerHTML = '';
    for (let month = 1; month <= 12; month += 1) {
      const option = document.createElement('option');
      option.value = String(month);
      option.textContent = `Tháng ${String(month).padStart(2, '0')}`;
      monthSelect.appendChild(option);
    }
  }

  function populateYearSelect() {
    yearSelect.innerHTML = '';
    const currentYear = new Date().getFullYear();
    for (let year = currentYear - 3; year <= currentYear + 3; year += 1) {
      const option = document.createElement('option');
      option.value = String(year);
      option.textContent = String(year);
      yearSelect.appendChild(option);
    }
  }

  function showLoading() {
    loadingOverlay.style.display = 'flex';
  }

  function hideLoading() {
    loadingOverlay.style.display = 'none';
  }

  function bindEvents() {
    document.getElementById('showMonthBtn').addEventListener('click', async () => {
      state.year = Number(yearSelect.value);
      state.month = Number(monthSelect.value);
      await loadMonth();
    });

    document.getElementById('clearMonthBtn').addEventListener('click', async () => {
      const confirmed = window.confirm('Xóa toàn bộ dữ liệu livestream của tháng này?');
      if (!confirmed) return;
      state.year = Number(yearSelect.value);
      state.month = Number(monthSelect.value);
      state.days = buildMonthDays(state.year, state.month);
      await saveMonth();
      render();
    });

    document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);
    document.getElementById('exportJsonBtn').addEventListener('click', exportJson);
    document.getElementById('importJsonBtn').addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', handleImportJson);

    daysTableBody.addEventListener('click', handleTableClick);
    daysTableBody.addEventListener('input', handleTableInput);
    daysTableBody.addEventListener('blur', handleTableBlur, true);
  }

  function getDocId(year, month) {
    return `${year}_${String(month).padStart(2, '0')}`;
  }

  async function loadMonth() {
    showLoading();
    try {
      const docRef = db.collection('livestream').doc(getDocId(state.year, state.month));
      const doc = await docRef.get();
      const savedDays = doc.exists && Array.isArray(doc.data().days)
        ? doc.data().days.map(normalizeDay)
        : [];

      const allDays = buildMonthDays(state.year, state.month);
      const savedMap = new Map(savedDays.map((d) => [d.date, d]));

      state.days = allDays.map((d) => savedMap.has(d.date) ? savedMap.get(d.date) : d);

      await saveMonth();
    } catch (error) {
      console.error('Lỗi khi đọc dữ liệu từ Firebase:', error);
      state.days = buildMonthDays(state.year, state.month);
    }
    hideLoading();
    render();
  }

  async function saveMonth() {
    try {
      const docRef = db.collection('livestream').doc(getDocId(state.year, state.month));
      await docRef.set({
        year: state.year,
        month: state.month,
        days: state.days
      });
    } catch (error) {
      console.error('Lỗi khi lưu dữ liệu lên Firebase:', error);
    }
  }

  function buildMonthDays(year, month) {
    const daysInMonth = getDaysInMonth(year, month);
    const days = [];
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      days.push({
        date,
        sessions: [{ id: `${date}-1`, label: 'Ca 1', value: '' }]
      });
    }
    return days;
  }

  function normalizeDay(day) {
    return {
      date: day.date,
      sessions: Array.isArray(day.sessions)
        ? day.sessions.map((session, index) => ({
            id: session.id || `${day.date}-${index + 1}`,
            label: session.label || `Ca ${index + 1}`,
            value: session.value || ''
          }))
        : [{ id: `${day.date}-1`, label: 'Ca 1', value: '' }]
    };
  }

  function normalizeSessions(sessions) {
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return [{ id: `${Date.now()}-1`, label: 'Ca 1', value: '' }];
    }
    return sessions.map((s, i) => ({
      id: s.id || `${Date.now()}-${i + 1}`,
      label: `Ca ${i + 1}`,
      value: s.value || ''
    }));
  }

  function render() {
    renderTable();
    renderSummary();
  }

  function renderTable() {
    if (state.days.length === 0) {
      daysTableBody.innerHTML = '<tr><td colspan="7">Chọn tháng và nhấn "Hiển thị tháng" để bắt đầu.</td></tr>';
      return;
    }

    const rows = state.days.map((day, dayIndex) => {
      const summary = summarizeDay(day);
      const sessionsMarkup = day.sessions.map((session) => {
        const parseResult = parseLiveDuration(session.value);
        const valid = parseResult.valid || session.value.trim() === '';
        return `
          <div class="live-item">
            <span class="live-label">${escapeHtml(session.label)}</span>
            <input
              type="text"
              class="live-input${valid ? '' : ' input-invalid'}"
              data-action="edit-session"
              data-day-index="${dayIndex}"
              data-session-id="${session.id}"
              value="${escapeHtml(session.value)}"
              placeholder="2h15"
            />
            <button type="button" class="icon-btn" data-action="remove-session" data-day-index="${dayIndex}" data-session-id="${session.id}">&times;</button>
          </div>`;
      }).join('');

      return `
        <tr>
          <td class="col-stt">${dayIndex + 1}</td>
          <td class="day-date">${formatDate(day.date)}</td>
          <td>
            <div class="live-stack">${sessionsMarkup}</div>
          </td>
          <td class="col-count">${summary.validCount}</td>
          <td class="col-minutes">${summary.totalMinutes}</td>
          <td>${summary.totalTime}</td>
          <td>
            <div class="day-actions">
              <button type="button" class="btn-primary" data-action="add-session" data-day-index="${dayIndex}">+ Ca</button>
              <button type="button" class="btn-danger" data-action="remove-day" data-day-index="${dayIndex}">&times;</button>
            </div>
          </td>
        </tr>`;
    });

    daysTableBody.innerHTML = rows.join('');
  }

  function renderSummary() {
    const summary = summarizeMonth(state.days);
    summarySection.innerHTML = `
      <h2>TỔNG KẾT THÁNG ${String(state.month).padStart(2, '0')}/${state.year}</h2>
      <div class="summary-grid">
        <div class="summary-card">
          <span>Ngày có livestream</span>
          <strong>${summary.dayCount} ngày</strong>
        </div>
        <div class="summary-card">
          <span>Tổng ca livestream</span>
          <strong>${summary.validSessionCount} ca</strong>
        </div>
        <div class="summary-card">
          <span>Tổng phút livestream</span>
          <strong>${summary.totalMinutes} phút</strong>
        </div>
        <div class="summary-card">
          <span>Tổng thời gian</span>
          <strong>${summary.totalTime}</strong>
        </div>
      </div>`;
  }

  function summarizeDay(day) {
    let validCount = 0;
    let totalMinutes = 0;
    day.sessions.forEach((session) => {
      const result = parseLiveDuration(session.value);
      if (result.valid) {
        validCount += 1;
        totalMinutes += result.totalMinutes;
      }
    });
    return {
      validCount,
      totalMinutes,
      totalTime: formatMinutes(totalMinutes)
    };
  }

  function summarizeMonth(days) {
    let totalMinutes = 0;
    let validSessionCount = 0;
    let dayCount = 0;
    days.forEach((day) => {
      const summary = summarizeDay(day);
      if (summary.validCount > 0) dayCount += 1;
      totalMinutes += summary.totalMinutes;
      validSessionCount += summary.validCount;
    });
    return {
      dayCount,
      validSessionCount,
      totalMinutes,
      totalTime: formatMinutes(totalMinutes)
    };
  }

  function parseLiveDuration(value) {
    if (typeof value !== 'string') return { valid: false, totalMinutes: null, normalized: '' };
    const trimmed = value.trim();
    if (trimmed === '') return { valid: false, totalMinutes: null, normalized: '' };
    const cleaned = trimmed.replace(/\s+/g, '').toLowerCase();
    const match = cleaned.match(/^(\d+)h(\d{1,2})$/i);
    if (!match) return { valid: false, totalMinutes: null, normalized: '' };
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (minutes > 59) return { valid: false, totalMinutes: null, normalized: '' };
    const normalized = `${hours}h${String(minutes).padStart(2, '0')}`;
    return { valid: true, totalMinutes: hours * 60 + minutes, normalized };
  }

  function formatMinutes(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}g ${minutes}p`;
  }

  function formatDate(dateString) {
    const [year, month, day] = dateString.split('-').map(Number);
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
  }

  async function handleTableClick(event) {
    const button = event.target.closest('button');
    if (!button) return;

    const { action, dayIndex, sessionId } = button.dataset;

    if (action === 'add-session') {
      const day = state.days[Number(dayIndex)];
      if (!day) return;
      day.sessions.push({
        id: `${day.date}-${day.sessions.length + 1}`,
        label: `Ca ${day.sessions.length + 1}`,
        value: ''
      });
      await saveMonth();
      render();
      return;
    }

    if (action === 'remove-session') {
      const day = state.days[Number(dayIndex)];
      if (!day) return;
      day.sessions = day.sessions.filter((s) => s.id !== sessionId);
      day.sessions = normalizeSessions(day.sessions);
      await saveMonth();
      render();
      return;
    }

    if (action === 'remove-day') {
      state.days.splice(Number(dayIndex), 1);
      await saveMonth();
      render();
    }
  }

  async function handleTableInput(event) {
    const input = event.target;
    if (input.dataset.action !== 'edit-session') return;

    const dayIndex = Number(input.dataset.dayIndex);
    const sessionId = input.dataset.sessionId;
    const session = state.days[dayIndex]?.sessions.find((s) => s.id === sessionId);
    if (!session) return;

    session.value = input.value;

    const parseResult = parseLiveDuration(session.value);
    if (parseResult.valid) {
      input.classList.remove('input-invalid');
    } else if (session.value.trim() === '') {
      input.classList.remove('input-invalid');
    } else {
      input.classList.add('input-invalid');
    }

    saveMonth();
    renderSummary();
    updateDaySummaryCell(dayIndex);
  }

  async function handleTableBlur(event) {
    const input = event.target;
    if (input.dataset.action !== 'edit-session') return;

    const dayIndex = Number(input.dataset.dayIndex);
    const sessionId = input.dataset.sessionId;
    const session = state.days[dayIndex]?.sessions.find((s) => s.id === sessionId);
    if (!session) return;

    const parseResult = parseLiveDuration(session.value);
    if (parseResult.valid && session.value !== parseResult.normalized) {
      session.value = parseResult.normalized;
      input.value = parseResult.normalized;
      await saveMonth();
      renderSummary();
      updateDaySummaryCell(dayIndex);
    }
  }

  function updateDaySummaryCell(dayIndex) {
    const row = daysTableBody.rows[dayIndex];
    if (!row) return;
    const summary = summarizeDay(state.days[dayIndex]);
    row.cells[3].textContent = summary.validCount;
    row.cells[4].textContent = summary.totalMinutes;
    row.cells[5].textContent = summary.totalTime;
  }

  function exportCsv() {
    const rows = [['STT', 'Ngày', 'Ca', 'Thời lượng', 'Phút', 'Tổng phút ngày', 'Tổng thời gian ngày']];
    state.days.forEach((day, dayIndex) => {
      const ds = summarizeDay(day);
      day.sessions.forEach((session) => {
        const r = parseLiveDuration(session.value);
        rows.push([
          dayIndex + 1,
          formatDate(day.date),
          session.label,
          session.value,
          r.valid ? r.totalMinutes : '',
          ds.validCount > 0 ? ds.totalMinutes : '',
          ds.validCount > 0 ? ds.totalTime : ''
        ]);
      });
    });
    const csv = rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n');
    downloadFile(`livestream_${state.year}_${String(state.month).padStart(2, '0')}.csv`, `﻿${csv}`);
  }

  function exportJson() {
    const payload = {
      exportedAt: new Date().toISOString(),
      year: state.year,
      month: state.month,
      days: state.days
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `livestream_${state.year}_${String(state.month).padStart(2, '0')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportJson(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const confirmed = window.confirm('Ghi đè dữ liệu hiện tại bằng file JSON?');
    if (!confirmed) { event.target.value = ''; return; }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const payload = JSON.parse(reader.result);
        if (payload.days && Array.isArray(payload.days)) {
          state.days = payload.days.map(normalizeDay);
          if (payload.year) state.year = payload.year;
          if (payload.month) state.month = payload.month;
          yearSelect.value = String(state.year);
          monthSelect.value = String(state.month);
        }
        await saveMonth();
        render();
      } catch (error) {
        window.alert('File JSON không hợp lệ.');
      }
    };
    reader.readAsText(file, 'utf-8');
    event.target.value = '';
  }

  function downloadFile(fileName, content) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function escapeCsvValue(value) {
    const s = String(value ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  init();
});
