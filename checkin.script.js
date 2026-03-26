// ═══════════════════════════════════════════════════════════════
//  checkin.script.js
//  Check-In / Out Page — SA DTR System
//  Procurement Department | University of Baguio
// ═══════════════════════════════════════════════════════════════

// ─── State ───────────────────────────────────────────────────
let currentUser     = null;
let currentPerson   = null; // { id, first_name, last_name, type: 'sa'|'staff', role }
let shifts          = {};
let activeRecord    = null;
let elapsedInterval = null;
let recordsUnsub    = null;

// ─── Clock ───────────────────────────────────────────────────
function updateClock() {
  const now  = new Date();
  const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  document.getElementById('current-date').textContent =
    now.toLocaleDateString('en-PH', opts);
  document.getElementById('top-clock').textContent =
    now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}
setInterval(updateClock, 1000);
updateClock();

// ─── Auth Guard ───────────────────────────────────────────────
auth.onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUser = user;
  try {
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (!userDoc.exists) { await auth.signOut(); return; }
    const data = userDoc.data();

    // Show admin link if staff or admin
    if (data.role === 'staff' || data.role === 'admin') {
      document.getElementById('admin-link-btn').style.display = 'block';
    }

    // Load person profile
    if (data.role === 'sa') {
      const saDoc   = await db.collection('studentAssistants').doc(data.personId).get();
      currentPerson = { ...saDoc.data(), id: data.personId, type: 'sa', role: data.role };
      document.getElementById('card-title-text').textContent = 'DTR Check-In / Out';
    } else {
      const staffDoc = await db.collection('staff').doc(data.personId).get();
      currentPerson  = { ...staffDoc.data(), id: data.personId, type: 'staff', role: data.role };
      document.getElementById('card-title-text').textContent = 'Staff DTR Check-In / Out';
    }

    // Update top bar
    const initials = (currentPerson.first_name[0] + currentPerson.last_name[0]).toUpperCase();
    document.getElementById('user-avatar').textContent       = initials;
    document.getElementById('user-display-name').textContent = `${currentPerson.first_name} ${currentPerson.last_name}`;
    document.getElementById('user-display-id').textContent   = currentPerson.id + ' • Procurement';
    document.getElementById('person-id').value               = currentPerson.id;

    await loadShifts();
    await loadTodayRecords();
    document.getElementById('loading-overlay').style.display = 'none';
  } catch (err) {
    console.error(err);
    document.getElementById('loading-overlay').innerHTML =
      '<p style="color:#fca5a5;font-weight:700">Error loading profile. Please refresh.</p>';
  }
});

// ─── Load Shifts ──────────────────────────────────────────────
async function loadShifts() {
  const snap = await db.collection('shifts').get();
  const sel  = document.getElementById('shift-type');
  snap.forEach(doc => {
    shifts[doc.id] = doc.data();
    const opt      = document.createElement('option');
    opt.value      = doc.id;
    opt.textContent = doc.data().label;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    const shift = shifts[sel.value];
    document.getElementById('custom-schedule').classList.toggle('show', !!(shift && shift.allows_custom));
  });
}

// ─── Load Today's Records ─────────────────────────────────────
async function loadTodayRecords() {
  const today = getTodayStr();
  const col   = currentPerson.type === 'sa' ? 'dtrRecords' : 'staffDtrRecords';

  if (recordsUnsub) recordsUnsub();
  recordsUnsub = db.collection(col)
    .where('personId', '==', currentPerson.id)
    .where('record_date', '==', today)
    .orderBy('time_in', 'desc')
    .onSnapshot(snap => {
      const records = [];
      snap.forEach(doc => records.push({ id: doc.id, ...doc.data() }));
      renderRecords(records);

      activeRecord = records.find(r => r.status === 'On Duty') || null;
      renderActivePanel();
    });
}

// ─── Render Today's Records ───────────────────────────────────
function renderRecords(records) {
  const container = document.getElementById('records-list');
  if (!records.length) {
    container.innerHTML = '<div class="no-records">No DTR records today.</div>';
    return;
  }
  container.innerHTML = records.map(r => {
    const tin  = r.time_in  ? new Date(r.time_in).toLocaleTimeString('en-PH',  { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
    const tout = r.time_out ? new Date(r.time_out).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true }) : 'Ongoing';
    const hrs  = r.hours_worked != null ? r.hours_worked.toFixed(2) + ' hrs' : '—';
    return `
      <div class="record-item">
        <div class="record-left">
          <div class="record-shift">${r.shift_type}</div>
          <div class="record-times">In: ${tin} | Out: ${tout} | ${hrs}</div>
        </div>
        <span class="record-status ${r.status === 'On Duty' ? 'status-on-duty' : 'status-completed'}">${r.status}</span>
      </div>`;
  }).join('');
}

// ─── Render Active Shift Panel ────────────────────────────────
function renderActivePanel() {
  const panel = document.getElementById('active-panel');
  if (!activeRecord) {
    panel.classList.remove('show');
    if (elapsedInterval) { clearInterval(elapsedInterval); elapsedInterval = null; }
    return;
  }
  panel.classList.add('show');
  document.getElementById('active-shift-name').textContent = activeRecord.shift_type;
  const tin = new Date(activeRecord.time_in).toLocaleTimeString('en-PH', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  });
  document.getElementById('active-shift-meta').textContent = `Checked in at ${tin}`;

  if (elapsedInterval) clearInterval(elapsedInterval);
  elapsedInterval = setInterval(() => {
    const sec = Math.floor((Date.now() - new Date(activeRecord.time_in).getTime()) / 1000);
    const h   = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m   = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s   = String(sec % 60).padStart(2, '0');
    document.getElementById('elapsed-timer').textContent = `${h}:${m}:${s}`;
  }, 1000);
}

// ─── Action Handler (Check In / Check Out) ────────────────────
async function handleAction(action) {
  const shiftType   = document.getElementById('shift-type').value;
  const customStart = document.getElementById('custom-start').value;
  const customEnd   = document.getElementById('custom-end').value;
  hideAlert();

  if (action === 'checkin') {
    if (!shiftType) { showAlert('Please select a shift type.', 'error'); return; }
    if (shifts[shiftType]?.allows_custom && (!customStart || !customEnd)) {
      showAlert('Please enter custom start and end times for broken schedule.', 'error'); return;
    }
    if (activeRecord) { showAlert('You are already checked in for a shift today. Please check out first.', 'error'); return; }
    await doCheckin(shiftType, customStart, customEnd);
  } else {
    if (!activeRecord) { showAlert('No active shift found. Please check in first.', 'error'); return; }
    await doCheckout();
  }
}

// ─── Check In ─────────────────────────────────────────────────
async function doCheckin(shiftType, customStart, customEnd) {
  setBtns(true);
  try {
    const today  = getTodayStr();
    const now    = new Date();
    const nowISO = now.toISOString();
    const shift  = shifts[shiftType];

    // Duplicate check
    const dup = await db.collection(getCollection())
      .where('personId',    '==', currentPerson.id)
      .where('record_date', '==', today)
      .where('shift_type',  '==', shiftType)
      .where('status',      '==', 'On Duty')
      .get();
    if (!dup.empty) {
      showAlert(`Already checked in for ${shift.label} today.`, 'error');
      setBtns(false);
      return;
    }

    // Late calculation
    const startStr = customStart || shift.expected_start;
    const expStart = new Date(`${today}T${startStr}:00`);
    const lateMin  = now > expStart ? Math.floor((now - expStart) / 60000) : 0;

    const recId = `DTR${Date.now()}`;
    await db.collection(getCollection()).doc(recId).set({
      personId:          currentPerson.id,
      personName:        `${currentPerson.first_name} ${currentPerson.last_name}`,
      personType:        currentPerson.type,
      department:        'Procurement',
      shift_type:        shiftType,
      record_date:       today,
      time_in:           nowISO,
      time_out:          null,
      status:            'On Duty',
      hours_worked:      null,
      late_minutes:      lateMin,
      undertime_minutes: 0,
      custom_start:      customStart || null,
      custom_end:        customEnd   || null,
      created_at:        nowISO,
    });

    const tin = now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
    showAlert(
      `✅ Checked in for ${shift.label} at ${tin}${lateMin > 0 ? ` (${lateMin} min late)` : ''}`,
      'success'
    );
  } catch (err) {
    showAlert('Check-in failed: ' + err.message, 'error');
  } finally {
    setBtns(false);
  }
}

// ─── Check Out ────────────────────────────────────────────────
async function doCheckout() {
  setBtns(true);
  try {
    const now    = new Date();
    const nowISO = now.toISOString();
    const tin    = new Date(activeRecord.time_in);
    const shift  = shifts[activeRecord.shift_type];

    const hoursWorked = (now - tin) / 3600000;

    // Undertime calculation
    const today      = getTodayStr();
    const endStr     = activeRecord.custom_end || shift?.expected_end || '17:00';
    const expEnd     = new Date(`${today}T${endStr}:00`);
    const undertimeMin = now < expEnd ? Math.floor((expEnd - now) / 60000) : 0;

    await db.collection(getCollection()).doc(activeRecord.id).update({
      time_out:          nowISO,
      status:            'Completed',
      hours_worked:      parseFloat(hoursWorked.toFixed(4)),
      undertime_minutes: undertimeMin,
    });

    const tout = now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
    showAlert(`✅ Checked out at ${tout} — ${hoursWorked.toFixed(2)} hours worked.`, 'success');
  } catch (err) {
    showAlert('Check-out failed: ' + err.message, 'error');
  } finally {
    setBtns(false);
  }
}

// ─── Helpers ──────────────────────────────────────────────────
function getCollection() {
  return currentPerson.type === 'sa' ? 'dtrRecords' : 'staffDtrRecords';
}

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function setBtns(disabled) {
  document.getElementById('checkin-btn').disabled  = disabled;
  document.getElementById('checkout-btn').disabled = disabled;
}

function showAlert(msg, type) {
  const el    = document.getElementById('alert-box');
  el.textContent = msg;
  el.className   = `alert alert-${type} show`;
  setTimeout(() => el.classList.remove('show'), 6000);
}

function hideAlert() {
  document.getElementById('alert-box').classList.remove('show');
}

async function handleLogout() {
  if (recordsUnsub) recordsUnsub();
  if (elapsedInterval) clearInterval(elapsedInterval);
  await auth.signOut();
  window.location.href = 'index.html';
}
