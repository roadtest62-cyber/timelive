document.addEventListener('DOMContentLoaded', () => {
  const monthSelect = document.getElementById('monthSelect');
  const yearSelect = document.getElementById('yearSelect');
  const daysTableBody = document.getElementById('daysTableBody');
  const summarySection = document.getElementById('summarySection');
  const importFileInput = document.getElementById('importFileInput');
  const loadingOverlay = document.getElementById('loadingOverlay');

  firebase.initializeApp(FIREBASE_CONFIG);
  const db = firebase.firestore();

  const S = { year: new Date().getFullYear(), month: new Date().getMonth() + 1, days: [] };

  // ==================== INIT ====================

  (function init() {
    fillSelect(monthSelect, 12, (i) => `Tháng ${String(i).padStart(2, '0')}`);
    fillSelect(yearSelect, 0, (i) => String(i), new Date().getFullYear() - 5, new Date().getFullYear() + 2);
    monthSelect.value = String(S.month);
    yearSelect.value = String(S.year);

    monthSelect.addEventListener('change', () => { S.month = +monthSelect.value; load(); });
    yearSelect.addEventListener('change', () => { S.year = +yearSelect.value; load(); });

    document.getElementById('showMonthBtn')?.addEventListener('click', () => {
      S.year = +yearSelect.value; S.month = +monthSelect.value; load();
    });
    document.getElementById('clearMonthBtn').addEventListener('click', clearMonth);
    document.getElementById('clearAllBtn').addEventListener('click', clearAll);
    document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);
    document.getElementById('exportJsonBtn').addEventListener('click', exportJson);
    document.getElementById('importJsonBtn').addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', importJson);
    daysTableBody.addEventListener('click', onTableClick);
    daysTableBody.addEventListener('input', onTableInput);

    load();
  })();

  // ==================== FIREBASE ====================

  function docId() { return `${S.year}_${String(S.month).padStart(2, '0')}`; }

  async function load() {
    showLoad();
    try {
      const snap = await db.collection('livestream').doc(docId()).get();
      const all = emptyMonth(S.year, S.month);
      if (snap.exists && Array.isArray(snap.data().days)) {
        const map = new Map(snap.data().days.map((d) => [d.date, d]));
        S.days = all.map((d) => map.has(d.date) ? mergeDay(d, map.get(d.date)) : d);
      } else {
        S.days = all;
      }
      await save();
    } catch (e) { console.error(e); S.days = emptyMonth(S.year, S.month); }
    hideLoad();
    render();
  }

  async function save() {
    try {
      await db.collection('livestream').doc(docId()).set({ year: S.year, month: S.month, days: S.days });
    } catch (e) { console.error(e); }
  }

  async function clearMonth() {
    if (!confirm('Xóa dữ liệu tháng này?')) return;
    S.days = emptyMonth(S.year, S.month);
    await save(); render();
  }

  async function clearAll() {
    if (!confirm('Xóa TOÀN BỘ dữ liệu mọi tháng?\nKhông thể hoàn tác!')) return;
    if (!confirm('Chắc chắn xóa?')) return;
    showLoad();
    try {
      const snap = await db.collection('livestream').get();
      const batch = db.batch();
      snap.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    } catch (e) { console.error(e); }
    S.days = emptyMonth(S.year, S.month);
    await save();
    hideLoad(); render();
  }

  // ==================== DATA ====================

  function emptyMonth(y, m) {
    const n = new Date(y, m, 0).getDate();
    return Array.from({ length: n }, (_, i) => {
      const d = `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
      return { date: d, sessions: [{ id: `${d}-1`, label: 'Ca 1', value: '' }] };
    });
  }

  function mergeDay(empty, saved) {
    const sessions = Array.isArray(saved.sessions) && saved.sessions.length > 0
      ? saved.sessions.map((s, i) => ({ id: s.id || `${empty.date}-${i + 1}`, label: s.label || `Ca ${i + 1}`, value: s.value || '' }))
      : [{ id: `${empty.date}-1`, label: 'Ca 1', value: '' }];
    return { date: empty.date, sessions };
  }

  // ==================== RENDER ====================

  function render() {
    renderTable();
    renderSummary();
  }

  function renderTable() {
    daysTableBody.innerHTML = S.days.map((day, i) => {
      const sum = daySum(day);
      const sHtml = day.sessions.map((s) => {
        const ok = parse(s.value).valid || s.value.trim() === '';
        return `<div class="live-item">
          <span class="live-label">${h(s.label)}</span>
          <input type="text" class="live-input${ok ? '' : ' input-invalid'}"
            data-di="${i}" data-si="${s.id}" value="${h(s.value)}" placeholder="2h15" />
          <button type="button" class="icon-btn" data-a="rm" data-di="${i}" data-si="${s.id}">&times;</button>
        </div>`;
      }).join('');
      return `<tr>
        <td>${i + 1}</td>
        <td class="day-date">${fDate(day.date)}</td>
        <td class="col-sessions">
          <div class="live-stack">${sHtml}
            <button type="button" class="add-session-btn" data-a="add" data-di="${i}">+</button>
          </div>
        </td>
        <td>${sum.totalTime}</td>
      </tr>`;
    }).join('');
  }

  function renderSummary() {
    const s = monthSum(S.days);
    summarySection.innerHTML = `<div class="summary-grid">
      <div class="summary-card"><span>Ngày live</span><strong>${s.days} ngày</strong></div>
      <div class="summary-card"><span>Tổng ca</span><strong>${s.sessions} ca</strong></div>
      <div class="summary-card"><span>Tổng phút</span><strong>${s.minutes} phút</strong></div>
      <div class="summary-card"><span>Tổng giờ</span><strong>${s.total}</strong></div>
    </div>`;
  }

  // ==================== ACTIONS ====================

  async function onTableClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const a = btn.dataset.a, di = +btn.dataset.di, sid = btn.dataset.si;
    const day = S.days[di];
    if (!day) return;

    if (a === 'add') {
      const n = day.sessions.length + 1;
      day.sessions.push({ id: `${day.date}-${n}`, label: `Ca ${n}`, value: '' });
      await save(); render();
    }
    if (a === 'rm') {
      day.sessions = day.sessions.filter((s) => s.id !== sid);
      day.sessions.forEach((s, i) => { s.label = `Ca ${i + 1}`; });
      if (!day.sessions.length) day.sessions.push({ id: `${day.date}-1`, label: 'Ca 1', value: '' });
      await save(); render();
    }
  }

  async function onTableInput(e) {
    if (!e.target.dataset.si) return;
    const di = +e.target.dataset.di;
    const session = S.days[di]?.sessions.find((s) => s.id === e.target.dataset.si);
    if (!session) return;
    session.value = e.target.value;
    const ok = parse(session.value).valid || session.value.trim() === '';
    e.target.classList.toggle('input-invalid', !ok);
    await save();
    const row = daysTableBody.rows[di];
    if (row) row.cells[3].textContent = daySum(S.days[di]).totalTime;
    renderSummary();
  }

  // ==================== CALC ====================

  function parse(v) {
    if (typeof v !== 'string') return { valid: false, totalMinutes: 0 };
    const c = v.trim().replace(/\s+/g, '').toLowerCase();
    if (!c) return { valid: false, totalMinutes: 0 };
    const m = c.match(/^(\d+)h(\d{1,2})$/i);
    if (!m) return { valid: false, totalMinutes: 0 };
    const h = +m[1], min = +m[2];
    if (min > 59) return { valid: false, totalMinutes: 0 };
    return { valid: true, totalMinutes: h * 60 + min };
  }

  function daySum(day) {
    let min = 0, cnt = 0;
    day.sessions.forEach((s) => { const r = parse(s.value); if (r.valid) { cnt++; min += r.totalMinutes; } });
    return { sessions: cnt, minutes: min, total: fmt(min) };
  }

  function monthSum(days) {
    let min = 0, sessions = 0, d = 0;
    days.forEach((day) => { const s = daySum(day); if (s.sessions) d++; min += s.minutes; sessions += s.sessions; });
    return { days: d, sessions, minutes: min, total: fmt(min) };
  }

  function fmt(m) { return `${Math.floor(m / 60)}g ${m % 60}p`; }

  // ==================== EXPORT / IMPORT ====================

  function exportCsv() {
    const rows = [['#', 'Ngày', 'Ca', 'Thời lượng', 'Tổng ngày']];
    S.days.forEach((day, i) => {
      const ds = daySum(day);
      day.sessions.forEach((s) => {
        const r = parse(s.value);
        rows.push([i + 1, fDate(day.date), s.label, s.value, ds.total]);
      });
    });
    dl(`livestream_${S.year}_${String(S.month).padStart(2, '0')}.csv`,
      '﻿' + rows.map((r) => r.map(csvEsc).join(',')).join('\n'));
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), year: S.year, month: S.month, days: S.days }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `livestream_${S.year}_${String(S.month).padStart(2, '0')}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  async function importJson(e) {
    const file = e.target.files?.[0];
    if (!file || !confirm('Nhập dữ liệu từ file JSON?')) { e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const p = JSON.parse(reader.result);
        if (p.days && Array.isArray(p.days)) {
          if (p.year) S.year = p.year; if (p.month) S.month = p.month;
          yearSelect.value = String(S.year); monthSelect.value = String(S.month);
          const all = emptyMonth(S.year, S.month);
          const map = new Map(p.days.map((d) => [d.date, d]));
          S.days = all.map((d) => map.has(d.date) ? mergeDay(d, map.get(d.date)) : d);
          await save(); render();
        }
      } catch { alert('File không hợp lệ.'); }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  // ==================== UTILS ====================

  function fillSelect(el, count, fn, start, end) {
    el.innerHTML = '';
    const s = start ?? 1, e = end ?? count;
    for (let i = s; i <= e; i++) {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = fn ? fn(i - s + 1) : String(i);
      el.appendChild(o);
    }
  }

  function fDate(ds) { const [, m, d] = ds.split('-'); return `${d}/${m}`; }
  function h(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function csvEsc(v) { const s = String(v ?? ''); return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s; }
  function dl(name, content) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' })); a.download = name; a.click(); URL.revokeObjectURL(a.href); }
  function showLoad() { loadingOverlay.style.display = 'flex'; }
  function hideLoad() { loadingOverlay.style.display = 'none'; }
});
