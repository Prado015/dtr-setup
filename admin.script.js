// ═══════════════════════════════════════════════════════════════
//  admin.script.js
//  Admin Panel — SA DTR System
//  Procurement Department | University of Baguio
// ═══════════════════════════════════════════════════════════════

// ─── State ───────────────────────────────────────────────────
let currentUser     = null;
let currentStaff    = null;
let liveUnsub       = null;
let elapsedTimers   = {};
let pendingCheckout = null; // { collection, docId, record }

// ─── Clock ───────────────────────────────────────────────────
setInterval(() => {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('en-PH', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  });
}, 1000);

// ─── Auth Guard ───────────────────────────────────────────────
auth.onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUser = user;
  try {
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (!userDoc.exists) { await auth.signOut(); return; }
    const data = userDoc.data();
    if (data.role !== 'staff' && data.role !== 'admin') {
      window.location.href = 'sa-dtr-checkin.html'; return;
    }
    const staffDoc  = await db.collection('staff').doc(data.personId).get();
    currentStaff    = { ...staffDoc.data(), id: data.personId, role: data.role };

    const initials = (currentStaff.first_name[0] + currentStaff.last_name[0]).toUpperCase();
    document.getElementById('sidebar-avatar').textContent = initials;
    document.getElementById('sidebar-name').textContent   = `${currentStaff.first_name} ${currentStaff.last_name}`;
    document.getElementById('sidebar-role').textContent   =
      currentStaff.position || (data.role === 'admin' ? 'Department Admin' : 'Procurement Staff');

    await loadDashboard();
    document.getElementById('loading-overlay').style.display = 'none';
  } catch (err) {
    console.error(err);
    document.getElementById('loading-overlay').innerHTML =
      '<p style="color:#fca5a5;font-weight:700">Error loading admin panel. Please refresh.</p>';
  }
});

// ─── Navigation ──────────────────────────────────────────────
function showView(view) {
  document.querySelectorAll('.view-container').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item[data-view]').forEach(el => el.classList.remove('active'));
  document.getElementById(view + '-view').classList.add('active');
  document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add('active');

  const titles = {
    'dashboard':          'Dashboard',
    'all-records':        'All DTR Records',
    'sa-records':         'Student Assistant Records',
    'staff-records':      'Staff DTR Records',
    'student-assistants': 'Student Assistants',
    'procurement-staff':  'Procurement Staff',
    'reports':            'Reports',
  };
  document.getElementById('page-title').textContent = titles[view] || view;

  // Lazy load
  if (view === 'all-records')         loadAllRecords();
  if (view === 'sa-records')          loadSARecords();
  if (view === 'staff-records')       loadStaffDTRRecords();
  if (view === 'student-assistants')  loadSAList();
  if (view === 'procurement-staff')   loadStaffList();
  if (view === 'reports')             loadReports();
}

async function refreshAll() {
  const active = document.querySelector('.view-container.active')?.id?.replace('-view', '');
  if (active === 'dashboard') await loadDashboard();
  else showView(active);
  toast('Refreshed!', 'info');
}

// ─── Dashboard ────────────────────────────────────────────────
async function loadDashboard() {
  const today = getTodayStr();
  const ym    = today.slice(0, 7);

  if (liveUnsub) liveUnsub();
  Object.values(elapsedTimers).forEach(clearInterval);
  elapsedTimers = {};

  const saOnDuty    = db.collection('dtrRecords').where('record_date', '==', today).where('status', '==', 'On Duty');
  const staffOnDuty = db.collection('staffDtrRecords').where('record_date', '==', today).where('status', '==', 'On Duty');

  // One-time counts
  const [saCnt, staffCnt] = await Promise.all([
    db.collection('studentAssistants').where('status', '==', 'Active').get(),
    db.collection('staff').where('status', '==', 'Active').get(),
  ]);
  document.getElementById('stat-total-people').textContent = saCnt.size + staffCnt.size;
  document.getElementById('stat-total-sub').textContent    = `${saCnt.size} SAs • ${staffCnt.size} Staff`;

  // Month hours
  const [saMonth, staffMonth] = await Promise.all([
    db.collection('dtrRecords').where('record_date', '>=', ym + '-01').where('record_date', '<=', ym + '-31').where('status', '==', 'Completed').get(),
    db.collection('staffDtrRecords').where('record_date', '>=', ym + '-01').where('record_date', '<=', ym + '-31').where('status', '==', 'Completed').get(),
  ]);
  let totalHours = 0;
  saMonth.forEach(d => totalHours += d.data().hours_worked || 0);
  staffMonth.forEach(d => totalHours += d.data().hours_worked || 0);
  document.getElementById('stat-month-hours').textContent = totalHours.toFixed(1);
  document.getElementById('stat-month-sub').textContent   = `${saMonth.size + staffMonth.size} records this month`;

  // Today counts
  const [saToday, staffToday] = await Promise.all([
    db.collection('dtrRecords').where('record_date', '==', today).get(),
    db.collection('staffDtrRecords').where('record_date', '==', today).get(),
  ]);
  document.getElementById('stat-today-count').textContent = saToday.size + staffToday.size;

  // Real-time live list
  let liveItems = [];

  function renderLive() {
    document.getElementById('stat-on-duty').textContent = liveItems.length;
    document.getElementById('stat-on-duty-sub').textContent =
      liveItems.length
        ? liveItems.map(x => x.personName.split(' ')[0]).join(', ')
        : 'No one currently on duty';

    const container = document.getElementById('live-on-duty-list');
    if (!liveItems.length) {
      container.innerHTML = '<div class="empty-state">No one currently on duty.</div>';
      return;
    }
    container.innerHTML = liveItems.map(r => {
      const tin = new Date(r.time_in).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
      return `<div class="live-item">
        <div class="live-item-left">
          <div class="live-item-name">${r.personName}</div>
          <div class="live-item-meta">${r.shift_type} • In: ${tin}</div>
        </div>
        <div class="live-item-right">
          <div class="live-elapsed" id="elapsed-${r.id}">00:00:00</div>
          <div class="live-type"><span class="badge ${r.personType === 'sa' ? 'badge-sa' : 'badge-staff'}">${r.personType.toUpperCase()}</span></div>
        </div>
      </div>`;
    }).join('');

    Object.values(elapsedTimers).forEach(clearInterval);
    elapsedTimers = {};
    liveItems.forEach(r => {
      elapsedTimers[r.id] = setInterval(() => {
        const el = document.getElementById('elapsed-' + r.id);
        if (!el) return;
        const sec = Math.floor((Date.now() - new Date(r.time_in).getTime()) / 1000);
        el.textContent = formatElapsed(sec);
      }, 1000);
    });
  }

  async function refreshCompleted() {
    const [saComp, staffComp] = await Promise.all([
      db.collection('dtrRecords').where('record_date', '==', today).where('status', '==', 'Completed').get(),
      db.collection('staffDtrRecords').where('record_date', '==', today).where('status', '==', 'Completed').get(),
    ]);
    const all = [];
    saComp.forEach(d => all.push({ id: d.id, ...d.data() }));
    staffComp.forEach(d => all.push({ id: d.id, ...d.data() }));
    document.getElementById('completed-count').textContent = all.length;

    all.sort((a, b) => new Date(b.time_out) - new Date(a.time_out));
    const container = document.getElementById('completed-today-list');
    if (!all.length) { container.innerHTML = '<div class="empty-state">No completed shifts today.</div>'; return; }
    container.innerHTML = all.slice(0, 15).map(r => {
      const tout = new Date(r.time_out).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
      const hrs  = (r.hours_worked || 0).toFixed(2);
      return `<div class="live-item">
        <div class="live-item-left">
          <div class="live-item-name">${r.personName}</div>
          <div class="live-item-meta">${r.shift_type} • Out: ${tout}</div>
        </div>
        <div class="live-item-right">
          <div class="live-elapsed" style="color:var(--text-dim);font-size:1rem">${hrs}h</div>
          <div class="live-type"><span class="badge ${r.personType === 'sa' ? 'badge-sa' : 'badge-staff'}">${r.personType.toUpperCase()}</span></div>
        </div>
      </div>`;
    }).join('');
  }

  let saItems = [], staffItems = [];
  const unsubSA    = saOnDuty.onSnapshot(snap => {
    saItems = []; snap.forEach(d => saItems.push({ id: d.id, ...d.data() }));
    liveItems = [...saItems, ...staffItems]; renderLive(); refreshCompleted();
  });
  const unsubStaff = staffOnDuty.onSnapshot(snap => {
    staffItems = []; snap.forEach(d => staffItems.push({ id: d.id, ...d.data() }));
    liveItems = [...saItems, ...staffItems]; renderLive(); refreshCompleted();
  });
  liveUnsub = () => { unsubSA(); unsubStaff(); };
}

// ─── All Records ──────────────────────────────────────────────
async function loadAllRecords() {
  const dateVal   = document.getElementById('filter-date').value || getTodayStr();
  const typeVal   = document.getElementById('filter-person-type').value;
  const statusVal = document.getElementById('filter-status').value;

  let saQ    = db.collection('dtrRecords').where('record_date', '==', dateVal);
  let staffQ = db.collection('staffDtrRecords').where('record_date', '==', dateVal);
  if (statusVal) {
    saQ    = saQ.where('status', '==', statusVal);
    staffQ = staffQ.where('status', '==', statusVal);
  }

  const [saSnap, staffSnap] = await Promise.all([saQ.get(), staffQ.get()]);
  let all = [];
  if (!typeVal || typeVal === 'sa')    saSnap.forEach(d => all.push({ id: d.id, ...d.data() }));
  if (!typeVal || typeVal === 'staff') staffSnap.forEach(d => all.push({ id: d.id, ...d.data() }));
  all.sort((a, b) => new Date(b.time_in) - new Date(a.time_in));

  const tbody = document.getElementById('all-records-tbody');
  if (!all.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text-dim);padding:2rem">No records found.</td></tr>';
    return;
  }
  tbody.innerHTML = all.map(r => buildRecordRow(r, r.personType === 'sa' ? 'dtrRecords' : 'staffDtrRecords')).join('');
}

// ─── SA Records ───────────────────────────────────────────────
async function loadSARecords() {
  const monthVal = document.getElementById('sa-filter-month').value || getTodayStr().slice(0, 7);
  const snap = await db.collection('dtrRecords')
    .where('record_date', '>=', monthVal + '-01')
    .where('record_date', '<=', monthVal + '-31')
    .orderBy('record_date', 'desc')
    .get();
  const rows = [];
  snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
  const tbody = document.getElementById('sa-records-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text-dim);padding:2rem">No records found.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => buildRecordRow(r, 'dtrRecords')).join('');
}

// ─── Staff DTR Records ────────────────────────────────────────
async function loadStaffDTRRecords() {
  const monthVal = document.getElementById('staff-filter-month').value || getTodayStr().slice(0, 7);
  const snap = await db.collection('staffDtrRecords')
    .where('record_date', '>=', monthVal + '-01')
    .where('record_date', '<=', monthVal + '-31')
    .orderBy('record_date', 'desc')
    .get();
  const rows = [];
  snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
  const tbody = document.getElementById('staff-records-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text-dim);padding:2rem">No records found.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => buildRecordRow(r, 'staffDtrRecords')).join('');
}

// ─── Build Record Row ─────────────────────────────────────────
function buildRecordRow(r, col) {
  const tin  = r.time_in
    ? new Date(r.time_in).toLocaleString('en-PH', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true })
    : '—';
  const tout = r.time_out
    ? new Date(r.time_out).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true })
    : '—';
  const hrs  = r.hours_worked != null
    ? r.hours_worked.toFixed(2)
    : (r.status === 'On Duty' ? '<span style="color:var(--success)">▶ Live</span>' : '—');
  const typeBadge   = r.personType === 'sa'
    ? `<span class="badge badge-sa">SA</span>`
    : `<span class="badge badge-staff">STAFF</span>`;
  const statusBadge = r.status === 'On Duty'
    ? `<span class="badge badge-on-duty">On Duty</span>`
    : `<span class="badge badge-completed">Done</span>`;
  const actionBtn   = r.status === 'On Duty'
    ? `<button class="btn-warn" onclick="openCheckoutModal('${col}','${r.id}',${JSON.stringify(r).replace(/"/g, '&quot;')})">⏱ Checkout</button>`
    : '—';
  return `<tr>
    <td class="name-cell">${r.personName}</td>
    <td>${typeBadge}</td>
    <td>${r.personId}</td>
    <td>${r.shift_type}</td>
    <td style="font-family:'JetBrains Mono',monospace;font-size:0.8rem">${tin}</td>
    <td>${tout}</td>
    <td>${hrs}</td>
    <td>${r.late_minutes || 0}m</td>
    <td>${statusBadge}</td>
    <td>${actionBtn}</td>
  </tr>`;
}

// ─── Table Filters ────────────────────────────────────────────
function filterSATable() {
  const q = document.getElementById('sa-filter-name').value.toLowerCase();
  document.querySelectorAll('#sa-records-tbody tr').forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

function filterStaffTable() {
  const q = document.getElementById('staff-filter-name').value.toLowerCase();
  document.querySelectorAll('#staff-records-tbody tr').forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

// ─── SA List ──────────────────────────────────────────────────
async function loadSAList() {
  const snap  = await db.collection('studentAssistants').orderBy('id').get();
  const tbody = document.getElementById('sa-list-tbody');
  if (snap.empty) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-dim)">No SAs registered.</td></tr>';
    return;
  }
  const rows = [];
  snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
  tbody.innerHTML = rows.map(sa => `
    <tr>
      <td>${sa.id}</td>
      <td class="name-cell">${sa.first_name} ${sa.last_name}</td>
      <td>${sa.student_number}</td>
      <td>${sa.email}</td>
      <td>${sa.duty_hours}h/wk</td>
      <td><span class="badge ${sa.status === 'Active' ? 'badge-active' : 'badge-inactive'}">${sa.status}</span></td>
      <td>
        <button class="btn-warn" onclick="toggleSAStatus('${sa.id}','${sa.status === 'Active' ? 'Inactive' : 'Active'}')">
          ${sa.status === 'Active' ? '🚫 Deactivate' : '✓ Activate'}
        </button>
      </td>
    </tr>`).join('');
}

function filterSAList() {
  const q = document.getElementById('sa-search').value.toLowerCase();
  document.querySelectorAll('#sa-list-tbody tr').forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

async function toggleSAStatus(saId, newStatus) {
  await db.collection('studentAssistants').doc(saId).update({ status: newStatus });
  toast(`SA ${saId} set to ${newStatus}`, 'success');
  loadSAList();
}

// ─── Staff List ───────────────────────────────────────────────
async function loadStaffList() {
  const snap  = await db.collection('staff').orderBy('id').get();
  const tbody = document.getElementById('staff-list-tbody');
  if (snap.empty) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-dim)">No staff registered.</td></tr>';
    return;
  }
  const rows = [];
  snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
  tbody.innerHTML = rows.map(s => `
    <tr>
      <td>${s.id}</td>
      <td class="name-cell">${s.first_name} ${s.last_name}</td>
      <td>${s.position || '—'}</td>
      <td>${s.email}</td>
      <td><span class="badge ${(s.status || 'Active') === 'Active' ? 'badge-active' : 'badge-inactive'}">${s.status || 'Active'}</span></td>
      <td>
        <button class="btn-warn" onclick="toggleStaffStatus('${s.id}','${(s.status || 'Active') === 'Active' ? 'Inactive' : 'Active'}')">
          ${(s.status || 'Active') === 'Active' ? '🚫 Deactivate' : '✓ Activate'}
        </button>
      </td>
    </tr>`).join('');
}

function filterStaffList() {
  const q = document.getElementById('pstaff-search').value.toLowerCase();
  document.querySelectorAll('#staff-list-tbody tr').forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

async function toggleStaffStatus(staffId, newStatus) {
  await db.collection('staff').doc(staffId).update({ status: newStatus });
  toast(`Staff ${staffId} set to ${newStatus}`, 'success');
  loadStaffList();
}

// ─── Add Student Assistant ────────────────────────────────────
function openAddSAModal() { openModal('add-sa-modal'); }

async function addSA() {
  const fn   = document.getElementById('sa-fname').value.trim();
  const ln   = document.getElementById('sa-lname').value.trim();
  const sn   = document.getElementById('sa-stnum').value.trim();
  const em   = document.getElementById('sa-email').value.trim();
  const ph   = document.getElementById('sa-phone').value.trim();
  const dh   = parseInt(document.getElementById('sa-duty-hrs').value) || 5;
  const pass = document.getElementById('sa-pass').value;

  if (!fn || !ln || !sn || !em || !pass) {
    toast('Please fill in all required fields.', 'error');
    return;
  }

  try {
    const snap   = await db.collection('studentAssistants').orderBy('id', 'desc').limit(1).get();
    let nextNum  = 1;
    if (!snap.empty) nextNum = parseInt(snap.docs[0].id.replace('SA', '')) + 1;
    const newId  = 'SA' + String(nextNum).padStart(3, '0');

    const cred = await auth.createUserWithEmailAndPassword(em, pass);
    const uid  = cred.user.uid;

    await db.collection('studentAssistants').doc(newId).set({
      id: newId, first_name: fn, last_name: ln,
      student_number: sn, department: 'Procurement',
      duty_hours: dh, email: em, phone: ph,
      status: 'Active', created_at: new Date().toISOString(),
    });
    await db.collection('users').doc(uid).set({
      role: 'sa', personId: newId, name: fn + ' ' + ln, email: em,
    });

    toast(`✅ SA ${newId} (${fn} ${ln}) created successfully!`, 'success');
    closeModal('add-sa-modal');
    loadSAList();
    toast('⚠️ You were logged out. Please log in again as admin.', 'info');
    setTimeout(() => { auth.signOut(); window.location.href = 'index.html'; }, 3000);
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

// ─── Add Procurement Staff ────────────────────────────────────
function openAddStaffModal() { openModal('add-staff-modal'); }

async function addStaff() {
  const fn   = document.getElementById('staff-fname').value.trim();
  const ln   = document.getElementById('staff-lname').value.trim();
  const pos  = document.getElementById('staff-position').value.trim();
  const em   = document.getElementById('staff-email').value.trim();
  const ph   = document.getElementById('staff-phone').value.trim();
  const role = document.getElementById('staff-role').value;
  const pass = document.getElementById('staff-pass').value;

  if (!fn || !ln || !em || !pass) {
    toast('Please fill in all required fields.', 'error');
    return;
  }

  try {
    const snap  = await db.collection('staff').orderBy('id', 'desc').limit(1).get();
    let nextNum = 1;
    if (!snap.empty) nextNum = parseInt(snap.docs[0].id.replace('STF', '')) + 1;
    const newId = 'STF' + String(nextNum).padStart(3, '0');

    const cred = await auth.createUserWithEmailAndPassword(em, pass);
    const uid  = cred.user.uid;

    await db.collection('staff').doc(newId).set({
      id: newId, first_name: fn, last_name: ln,
      position: pos, department: 'Procurement',
      email: em, phone: ph, status: 'Active',
      created_at: new Date().toISOString(),
    });
    await db.collection('users').doc(uid).set({
      role, personId: newId, name: fn + ' ' + ln, email: em,
    });

    toast(`✅ Staff ${newId} (${fn} ${ln}) created!`, 'success');
    closeModal('add-staff-modal');
    loadStaffList();
    toast('⚠️ You were logged out. Please log in again as admin.', 'info');
    setTimeout(() => { auth.signOut(); window.location.href = 'index.html'; }, 3000);
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

// ─── Admin Checkout ───────────────────────────────────────────
function openCheckoutModal(col, docId, record) {
  pendingCheckout = { col, docId, record };
  const tin = new Date(record.time_in).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
  const sec = Math.floor((Date.now() - new Date(record.time_in).getTime()) / 1000);
  document.getElementById('checkout-info-box').innerHTML = `
    <div class="info-row"><span class="info-label">Name</span><span class="info-value">${record.personName}</span></div>
    <div class="info-row"><span class="info-label">ID</span><span class="info-value">${record.personId}</span></div>
    <div class="info-row"><span class="info-label">Shift</span><span class="info-value">${record.shift_type}</span></div>
    <div class="info-row"><span class="info-label">Time In</span><span class="info-value">${tin}</span></div>
    <div class="info-row"><span class="info-label">Time Elapsed</span><span class="info-value" style="color:var(--success)">${formatElapsed(sec)}</span></div>`;
  openModal('checkout-modal');
}

async function confirmAdminCheckout() {
  if (!pendingCheckout) return;
  const { col, docId, record } = pendingCheckout;
  try {
    const now = new Date();
    const tin = new Date(record.time_in);
    await db.collection(col).doc(docId).update({
      time_out:     now.toISOString(),
      status:       'Completed',
      hours_worked: parseFloat(((now - tin) / 3600000).toFixed(4)),
    });
    toast(`✅ ${record.personName} checked out.`, 'success');
    closeModal('checkout-modal');
    pendingCheckout = null;
  } catch (err) {
    toast('Checkout failed: ' + err.message, 'error');
  }
}

// ─── Reports ──────────────────────────────────────────────────
async function loadReports() {
  const ym = getTodayStr().slice(0, 7);
  document.getElementById('export-month').value = ym;

  const [saSnap, staffSnap] = await Promise.all([
    db.collection('dtrRecords').where('record_date', '>=', ym + '-01').where('record_date', '<=', ym + '-31').where('status', '==', 'Completed').get(),
    db.collection('staffDtrRecords').where('record_date', '>=', ym + '-01').where('record_date', '<=', ym + '-31').where('status', '==', 'Completed').get(),
  ]);

  const saSummary = {}, staffSummary = {};
  saSnap.forEach(d => {
    const r = d.data();
    if (!saSummary[r.personId]) saSummary[r.personId] = { name: r.personName, hours: 0, records: 0 };
    saSummary[r.personId].hours   += r.hours_worked || 0;
    saSummary[r.personId].records += 1;
  });
  staffSnap.forEach(d => {
    const r = d.data();
    if (!staffSummary[r.personId]) staffSummary[r.personId] = { name: r.personName, hours: 0, records: 0 };
    staffSummary[r.personId].hours   += r.hours_worked || 0;
    staffSummary[r.personId].records += 1;
  });

  function buildSummaryHTML(summary) {
    const entries = Object.entries(summary);
    if (!entries.length) return '<div class="empty-state">No records this month.</div>';
    return `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Name</th><th>ID</th><th>Records</th><th>Total Hours</th></tr></thead>
      <tbody>${entries.map(([id, v]) => `<tr>
        <td class="name-cell">${v.name}</td>
        <td>${id}</td>
        <td>${v.records}</td>
        <td>${v.hours.toFixed(2)}h</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }

  document.getElementById('sa-monthly-summary').innerHTML    = buildSummaryHTML(saSummary);
  document.getElementById('staff-monthly-summary').innerHTML = buildSummaryHTML(staffSummary);
}

// ─── Export CSV ───────────────────────────────────────────────
async function exportMonthlyCSV(type) {
  const ym = document.getElementById('export-month').value || getTodayStr().slice(0, 7);
  let rows = [];
  if (type === 'sa' || type === 'all') {
    const snap = await db.collection('dtrRecords').where('record_date', '>=', ym + '-01').where('record_date', '<=', ym + '-31').get();
    snap.forEach(d => rows.push({ personType: 'SA', ...d.data() }));
  }
  if (type === 'staff' || type === 'all') {
    const snap = await db.collection('staffDtrRecords').where('record_date', '>=', ym + '-01').where('record_date', '<=', ym + '-31').get();
    snap.forEach(d => rows.push({ personType: 'Staff', ...d.data() }));
  }
  rows.sort((a, b) => a.record_date.localeCompare(b.record_date));

  const lines = ['Type,ID,Name,Department,Shift,Date,Time In,Time Out,Hours,Late (min),Undertime (min),Status'];
  rows.forEach(r => lines.push([
    r.personType, r.personId, `"${r.personName}"`, r.department || 'Procurement',
    `"${r.shift_type}"`, r.record_date,
    r.time_in  ? new Date(r.time_in).toLocaleTimeString('en-PH',  { hour: '2-digit', minute: '2-digit', hour12: true }) : '',
    r.time_out ? new Date(r.time_out).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true }) : 'Ongoing',
    r.hours_worked != null ? r.hours_worked.toFixed(2) : 'Ongoing',
    r.late_minutes || 0, r.undertime_minutes || 0, r.status,
  ].join(',')));

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `DTR-Procurement-${type}-${ym}.csv`;
  a.click();
  toast('CSV exported!', 'success');
}

function exportCSV() { exportMonthlyCSV('all'); }

// ─── Helpers ──────────────────────────────────────────────────
function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatElapsed(sec) {
  return [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60]
    .map(n => String(n).padStart(2, '0'))
    .join(':');
}

function openModal(id)  { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast toast-${type} show`;
  setTimeout(() => el.classList.remove('show'), 4000);
}

async function handleLogout() {
  if (liveUnsub) liveUnsub();
  Object.values(elapsedTimers).forEach(clearInterval);
  await auth.signOut();
  window.location.href = 'index.html';
}

// ─── Init date filters on DOM load ───────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const today = getTodayStr();
  const ym    = today.slice(0, 7);
  document.getElementById('filter-date').value        = today;
  document.getElementById('sa-filter-month').value    = ym;
  document.getElementById('staff-filter-month').value = ym;
  document.getElementById('export-month').value       = ym;
});
