document.addEventListener('DOMContentLoaded', () => {
  const monthSelect = document.getElementById('monthSelect');
  const yearSelect = document.getElementById('yearSelect');
  const daysTableBody = document.getElementById('daysTableBody');
  const summarySection = document.getElementById('summarySection');
  const importFileInput = document.getElementById('importFileInput');
  const loadingOverlay = document.getElementById('loadingOverlay');

  // Initialize Firebase
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
    document.getElementById('showMonthBtn').addEventListener('click', () => {
      state.year = Number(yearSelect.value);
      state.month = Number(monthSelect.value);
      loadMonth();
    });

    document.getElementById('addDayBtn').addEventListener('click', () => {
      state.year = Number(yearSelect.value);
      state.month = Number(monthSelect.value);
      addDay();
    });

    document.getElementById('clearMonthBtn').addEventListener('click', async () => {
      const confirmed = window.confirm('Bạn có chắc chắn muốn xóa toàn bộ dữ liệu livestream của tháng này không?');
      if (!confirmed) {
        return;
      }
      state.year = Number(yearSelect.value);
      state.month = Number(monthSelect.value);
      state.days = [];
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
    state.year = Number(yearSelect.value);
    state.month = Number(monthSelect.value);
    showLoading();
    try {
      const docRef = db.collection('livestream').doc(getDocId(state.year, state.month));
      const doc = await docRef.get();
      if (doc.exists) {
        const data = doc.data();
        state.days = Array.isArray(data.days) ? data.days.map(normalizeDay) : [];
      } else {
        state.days = [];
      }
    } catch (error) {
      console.error('Lỗi khi đọc dữ liệu từ Firebase:', error);
      window.alert('Không thể tải dữ liệu. Vui lòng thử lại.');
      state.days = [];
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
      window.alert('Không thể lưu dữ liệu. Vui lòng thử lại.');
    }
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

  async function addDay() {
    const daysInMonth = getDaysInMonth(state.year, state.month);
    const existingDates = new Set(state.days.map((day) => day.date));

    let newDate = null;
    for (let day = 1; day <= daysInMonth; day += 1) {
      const candidateDate = `${state.year}-${String(state.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (!existingDates.has(candidateDate)) {
        newDate = candidateDate;
        break;
      }
    }

    if (!newDate) {
      window.alert('Tháng này đã đủ ngày rồi!');
      return;
    }

    state.days.push({
      date: newDate,
      sessions: [{ id: `${newDate}-1`, label: 'Ca 1', value: '' }]
    });

    state.days.sort((a, b) => a.date.localeCompare(b.date));
    await saveMonth();
    render();
  }

  function render() {
    renderTable();
    renderSummary();
  }

  function renderTable() {
    if (state.days.length === 0) {
      daysTableBody.innerHTML = '<tr><td colspan="7">Chưa có dữ liệu. Nhấn "Thêm ngày" để bắt đầu.</td></tr>';
      return;
    }

    const rows = state.days.map((day, dayIndex) => {
      const summary = summarizeDay(day);
      const sessionsMarkup = day.sessions
        .map((session) => {
          const parseResult = parseLiveDuration(session.value);
          const errorText = session.value.trim() === '' ? '' : parseResult.valid ? '' : 'Vui lòng nhập đúng định dạng, ví dụ: 2h15';
          return `
            <div class="live-item">
              <div class="live-item-header">
                <span class="live-label">${escapeHtml(session.label)}</span>
                <button type="button" class="icon-btn" data-action="remove-session" data-day-index="${dayIndex}" data-session-id="${session.id}">×</button>
              </div>
              <input
                type="text"
                class="live-input ${parseResult.valid || session.value.trim() === '' ? '' : 'input-invalid'}"
                data-action="edit-session"
                data-day-index="${dayIndex}"
                data-session-id="${session.id}"
                value="${escapeHtml(session.value)}"
                placeholder="Ví dụ: 2h15"
              />
              <div class="input-error ${errorText ? '' : 'empty'}">${escapeHtml(errorText)}</div>
            </div>`;
        })
        .join('');

      return `
        <tr>
          <td>${dayIndex + 1}</td>
          <td class="day-date">${formatDate(day.date)}</td>
          <td>
            <div class="live-stack">
              ${sessionsMarkup}
            </div>
          </td>
          <td>${summary.validCount}</td>
          <td>${summary.totalMinutes}</td>
          <td>${summary.totalTime}</td>
          <td>
            <div class="day-actions">
              <button type="button" class="btn-primary" data-action="add-session" data-day-index="${dayIndex}">Thêm ca live</button>
              <button type="button" class="btn-danger" data-action="remove-day" data-day-index="${dayIndex}">Xóa ngày</button>
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
          <span>Số ngày có livestream</span>
          <strong>${summary.dayCount} ngày</strong>
        </div>
        <div class="summary-card">
          <span>Tổng số ca livestream</span>
          <strong>${summary.validSessionCount} ca</strong>
        </div>
        <div class="summary-card">
          <span>Tổng số phút livestream</span>
          <strong>${summary.totalMinutes} phút</strong>
        </div>
        <div class="summary-card">
          <span>Tổng thời gian livestream</span>
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
      if (summary.validCount > 0) {
        dayCount += 1;
      }
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
    if (typeof value !== 'string') {
      return { valid: false, totalMinutes: null, normalized: '' };
    }

    const trimmed = value.trim();
    if (trimmed === '') {
      return { valid: false, totalMinutes: null, normalized: '' };
    }

    const cleaned = trimmed.replace(/\s+/g, '').toLowerCase();
    const match = cleaned.match(/^(\d+)h(\d{1,2})$/i);

    if (!match) {
      return { valid: false, totalMinutes: null, normalized: '' };
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);

    if (minutes > 59) {
      return { valid: false, totalMinutes: null, normalized: '' };
    }

    const normalized = `${hours}h${String(minutes).padStart(2, '0')}`;
    return {
      valid: true,
      totalMinutes: hours * 60 + minutes,
      normalized
    };
  }

  function formatMinutes(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours} giờ ${minutes} phút`;
  }

  function formatDate(dateString) {
    const [year, month, day] = dateString.split('-').map(Number);
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
  }

  async function handleTableClick(event) {
    const button = event.target.closest('button');
    if (!button) {
      return;
    }

    const { action, dayIndex, sessionId } = button.dataset;
    if (action === 'add-session') {
      const day = state.days[Number(dayIndex)];
      if (!day) {
        return;
      }

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
      if (!day) {
        return;
      }

      day.sessions = day.sessions.filter((session) => session.id !== sessionId);
      day.sessions = normalizeSessions(day.sessions);
      await saveMonth();
      render();
      return;
    }

    if (action === 'remove-day') {
      const confirmed = window.confirm('Bạn có chắc chắn muốn xóa ngày này khỏi danh sách?');
      if (!confirmed) {
        return;
      }

      state.days.splice(Number(dayIndex), 1);
      await saveMonth();
      render();
    }
  }

  async function handleTableInput(event) {
    const input = event.target;
    if (!input.dataset.action || input.dataset.action !== 'edit-session') {
      return;
    }

    const dayIndex = Number(input.dataset.dayIndex);
    const sessionId = input.dataset.sessionId;
    const day = state.days[dayIndex];
    const session = day?.sessions.find((item) => item.id === sessionId);

    if (!session) {
      return;
    }

    session.value = input.value;

    const parseResult = parseLiveDuration(session.value);
    if (parseResult.valid) {
      input.classList.remove('input-invalid');
      input.parentElement.querySelector('.input-error').textContent = '';
      input.parentElement.querySelector('.input-error').classList.add('empty');
    } else if (session.value.trim() === '') {
      input.classList.remove('input-invalid');
      input.parentElement.querySelector('.input-error').textContent = '';
      input.parentElement.querySelector('.input-error').classList.add('empty');
    } else {
      input.classList.add('input-invalid');
      input.parentElement.querySelector('.input-error').textContent = 'Vui lòng nhập đúng định dạng, ví dụ: 2h15';
      input.parentElement.querySelector('.input-error').classList.remove('empty');
    }

    saveMonth();
    renderSummary();
    updateDaySummaryCell(dayIndex);
  }

  async function handleTableBlur(event) {
    const input = event.target;
    if (!input.dataset.action || input.dataset.action !== 'edit-session') {
      return;
    }

    const dayIndex = Number(input.dataset.dayIndex);
    const sessionId = input.dataset.sessionId;
    const day = state.days[dayIndex];
    const session = day?.sessions.find((item) => item.id === sessionId);

    if (!session) {
      return;
    }

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
    if (!row) {
      return;
    }

    const summary = summarizeDay(state.days[dayIndex]);
    row.cells[3].textContent = summary.validCount;
    row.cells[4].textContent = summary.totalMinutes;
    row.cells[5].textContent = summary.totalTime;
  }

  function normalizeSessions(sessions = []) {
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return [{ id: `${Date.now()}-1`, label: 'Ca 1', value: '' }];
    }

    return sessions.map((session, index) => ({
      id: session.id || `${Date.now()}-${index + 1}`,
      label: `Ca ${index + 1}`,
      value: session.value || ''
    }));
  }

  function exportCsv() {
    const rows = [['STT', 'Ngày', 'Ca livestream', 'Thời lượng nhập', 'Số phút', 'Tổng số phút trong ngày', 'Tổng thời gian trong ngày']];

    state.days.forEach((day, dayIndex) => {
      const daySummary = summarizeDay(day);
      day.sessions.forEach((session) => {
        const result = parseLiveDuration(session.value);
        const minutes = result.valid ? result.totalMinutes : '';
        rows.push([
          dayIndex + 1,
          formatDate(day.date),
          `${session.label}`,
          session.value,
          minutes,
          daySummary.validCount > 0 ? daySummary.totalMinutes : '',
          daySummary.validCount > 0 ? daySummary.totalTime : ''
        ]);
      });
    });

    const csv = rows
      .map((row) => row.map(escapeCsvValue).join(','))
      .join('\n');

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
    if (!file) {
      return;
    }

    const confirmed = window.confirm('Bạn có chắc chắn muốn ghi đè dữ liệu hiện tại bằng file JSON đã chọn không?');
    if (!confirmed) {
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const raw = reader.result;
        const payload = JSON.parse(raw);

        if (payload.days && Array.isArray(payload.days)) {
          state.days = payload.days.map(normalizeDay);
          if (payload.year) state.year = payload.year;
          if (payload.month) state.month = payload.month;
          yearSelect.value = String(state.year);
          monthSelect.value = String(state.month);
        } else if (typeof payload === 'object' && payload !== null) {
          const firstKey = Object.keys(payload).find((k) => k.startsWith('livestream_'));
          if (firstKey) {
            const data = payload[firstKey];
            state.days = Array.isArray(data) ? data.map(normalizeDay) : [];
          }
        }

        await saveMonth();
        render();
      } catch (error) {
        window.alert('File JSON không hợp lệ.');
        console.error(error);
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
    const stringValue = String(value ?? '');
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  init();
});
