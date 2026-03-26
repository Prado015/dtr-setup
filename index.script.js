// ═══════════════════════════════════════════════════════════════
//  index.script.js
//  Login Page — SA DTR System
//  Procurement Department | University of Baguio
// ═══════════════════════════════════════════════════════════════

// ─── State ───────────────────────────────────────────────────
let selectedRole = 'sa';

// ─── Auth: Redirect if already logged in ─────────────────────
auth.onAuthStateChanged(async (user) => {
  if (user) {
    await redirectByRole(user.uid);
  }
});

// ─── Role Toggle ──────────────────────────────────────────────
function setRole(role) {
  selectedRole = role;
  document.getElementById('role-sa').classList.toggle('active',    role === 'sa');
  document.getElementById('role-staff').classList.toggle('active', role === 'staff');
  document.getElementById('email').placeholder =
    role === 'sa' ? 'your.email@s.ubaguio.edu' : 'staff.email@ubaguio.edu';
  hideAlerts();
}

// ─── Login Handler ────────────────────────────────────────────
async function handleLogin() {
  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  hideAlerts();

  if (!email || !password) {
    showError('Please enter your email and password.');
    return;
  }

  setLoading(true);
  try {
    const cred = await auth.signInWithEmailAndPassword(email, password);
    await redirectByRole(cred.user.uid);
  } catch (err) {
    console.error('[Login Error]', err.code, err.message);
    let msg = 'Login failed. Please check your credentials.';
    if (
      err.code === 'auth/user-not-found' ||
      err.code === 'auth/wrong-password' ||
      err.code === 'auth/invalid-credential'
    ) {
      msg = 'Invalid email or password. Please try again.';
    } else if (err.code === 'auth/too-many-requests') {
      msg = 'Too many failed attempts. Please try again later.';
    } else if (err.code === 'auth/user-disabled') {
      msg = 'Your account has been disabled. Contact admin.';
    } else if (err.code === 'auth/network-request-failed') {
      msg = 'Network error. Please check your connection.';
    } else if (err.code === 'auth/invalid-email') {
      msg = 'Invalid email format. Please check your email.';
    }
    showError(msg);
  } finally {
    setLoading(false);
  }
}

// ─── Role-based Redirect ──────────────────────────────────────
async function redirectByRole(uid) {
  try {
    showInfo('Verifying account...');

    let userDoc;
    try {
      userDoc = await db.collection('users').doc(uid).get();
    } catch (firestoreErr) {
      console.error('[Firestore Error]', firestoreErr.code, firestoreErr.message);
      if (firestoreErr.code === 'permission-denied') {
        await auth.signOut();
        showError('Access denied. Please contact your admin to check Firestore security rules.');
      } else if (firestoreErr.code === 'unavailable' || firestoreErr.code === 'failed-precondition') {
        showError('Cannot reach the database. Please check your internet connection and try again.');
      } else {
        showError('Database error (' + firestoreErr.code + '). Please try again or contact admin.');
      }
      return;
    }

    if (!userDoc.exists) {
      await auth.signOut();
      showError('Your account exists but has not been set up in the system yet. Please contact your admin to complete your profile setup.');
      return;
    }

    const data = userDoc.data();
    const role = data.role;

    if (!role) {
      await auth.signOut();
      showError('Your account profile is incomplete (missing role). Please contact your admin.');
      return;
    }

    if (role === 'staff' || role === 'admin') {
      showInfo('Welcome! Redirecting to Admin Panel...');
      setTimeout(() => (window.location.href = 'sa-dtr-admin.html'), 800);
    } else if (role === 'sa') {
      showInfo('Welcome! Redirecting to DTR Check-In...');
      setTimeout(() => (window.location.href = 'sa-dtr-checkin.html'), 800);
    } else {
      showError('Unrecognized account role "' + role + '". Please contact your admin.');
      await auth.signOut();
    }
  } catch (err) {
    console.error('[redirectByRole Error]', err.code, err.message);
    showError('Unexpected error: ' + (err.message || 'Please try again.'));
  }
}

// ─── Password Toggle ──────────────────────────────────────────
function togglePassword() {
  const input = document.getElementById('password');
  input.type  = input.type === 'password' ? 'text' : 'password';
}

// ─── Enter Key Listener ───────────────────────────────────────
document.getElementById('password').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleLogin();
});

// ─── Loading State ────────────────────────────────────────────
function setLoading(on) {
  const btn  = document.getElementById('login-btn');
  btn.disabled = on;
  btn.classList.toggle('loading', on);
}

// ─── Alert Helpers ────────────────────────────────────────────
function showError(msg) {
  const el = document.getElementById('error-alert');
  el.textContent = '⚠️ ' + msg;
  el.classList.add('show');
  document.getElementById('info-alert').classList.remove('show');
}

function showInfo(msg) {
  const el = document.getElementById('info-alert');
  el.textContent = '⏳ ' + msg;
  el.classList.add('show');
  document.getElementById('error-alert').classList.remove('show');
}

function hideAlerts() {
  document.getElementById('error-alert').classList.remove('show');
  document.getElementById('info-alert').classList.remove('show');
}
