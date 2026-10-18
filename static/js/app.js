/**
 * ═══════════════════════════════════════════════════════════
 * NexusTalent — Candidate Portal JavaScript Engine
 * Handles: Auth (Sign Up / Sign In / Sign Out), Session
 *          persistence, Profile CRUD, Job browsing,
 *          Skill-match search, and Applications tracking.
 * ═══════════════════════════════════════════════════════════
 */

// ── API Base ─────────────────────────────────────────────────
const API = '';

// ── Session State ────────────────────────────────────────────
let sessionToken = localStorage.getItem('nexustalent_token') || null;
let currentUser  = null;   // full profile object from /auth/me
let allJobs      = [];

// ═══════════════════════════════════════════════════════════
// BOOT — DOM Ready
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  initNavigation();
  initAuthModal();
  initProfileForm();
  initJobSearch();
  initApplyModal();
  loadJobs();

  // Restore session if token exists in localStorage
  if (sessionToken) {
    await restoreSession();
  }
});

// ═══════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════
function showToast(type, title, message) {
  const container = document.getElementById('toast-container');
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.classList.add('toast-exit'); setTimeout(() => this.parentElement.remove(), 300);">&times;</button>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    }
  }, 4500);
}

// ═══════════════════════════════════════════════════════════
// AUTH HELPERS — Token / Headers
// ═══════════════════════════════════════════════════════════
function getAuthHeaders() {
  return sessionToken
    ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` }
    : { 'Content-Type': 'application/json' };
}

function saveToken(token) {
  sessionToken = token;
  localStorage.setItem('nexustalent_token', token);
}

function clearToken() {
  sessionToken = null;
  localStorage.removeItem('nexustalent_token');
}

// ═══════════════════════════════════════════════════════════
// SESSION RESTORE — On page load
// ═══════════════════════════════════════════════════════════
async function restoreSession() {
  try {
    const res = await fetch(`${API}/api/talent/auth/me`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      currentUser = data.profile;
      onLoginSuccess(currentUser, false); // false = no toast on page load
    } else {
      // Token expired or invalid
      clearToken();
    }
  } catch (err) {
    // Network error — silently fail, keep as guest
    console.warn('Session restore failed:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// AUTH MODAL — Sign In / Sign Up
// ═══════════════════════════════════════════════════════════
function initAuthModal() {
  const overlay  = document.getElementById('auth-modal-overlay');
  const closeBtn = document.getElementById('auth-modal-close');

  closeBtn.addEventListener('click', () => overlay.classList.remove('active'));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('active');
  });

  // Sign In submit
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-login');
    btn.disabled = true;
    btn.textContent = 'Signing in…';

    const email    = document.getElementById('login-email').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;

    try {
      const res = await fetch(`${API}/api/talent/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);

      saveToken(data.token);
      currentUser = data.profile;
      onLoginSuccess(currentUser, true);
      overlay.classList.remove('active');
    } catch (err) {
      showToast('error', 'Sign In Failed', err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '🔐 Sign In';
    }
  });

  // Sign Up submit
  document.getElementById('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-signup');
    btn.disabled = true;
    btn.textContent = 'Creating account…';

    const skillsRaw = document.getElementById('signup-skills').value;
    const skills = skillsRaw.split(',').map(s => s.trim()).filter(s => s.length > 0);

    const payload = {
      name:       document.getElementById('signup-name').value.trim(),
      email:      document.getElementById('signup-email').value.trim().toLowerCase(),
      password:   document.getElementById('signup-password').value,
      skills,
      experience: parseInt(document.getElementById('signup-experience').value) || 0,
      location:   document.getElementById('signup-location').value.trim(),
      bio:        document.getElementById('signup-bio').value.trim()
    };

    try {
      const res = await fetch(`${API}/api/talent/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);

      saveToken(data.token);
      currentUser = data.profile;
      onLoginSuccess(currentUser, true, true);
      overlay.classList.remove('active');
    } catch (err) {
      showToast('error', 'Sign Up Failed', err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '✨ Create Account';
    }
  });
}

function openAuthModal(tab = 'login') {
  switchAuthTab(tab);
  document.getElementById('auth-modal-overlay').classList.add('active');
}

function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('login-form').style.display  = isLogin ? '' : 'none';
  document.getElementById('signup-form').style.display = isLogin ? 'none' : '';
  document.getElementById('tab-login').classList.toggle('active', isLogin);
  document.getElementById('tab-signup').classList.toggle('active', !isLogin);
  document.getElementById('auth-modal-title').textContent =
    isLogin ? 'Welcome Back' : 'Create Your Account';
}

// ═══════════════════════════════════════════════════════════
// POST-AUTH UI UPDATE
// ═══════════════════════════════════════════════════════════
function onLoginSuccess(profile, showWelcomeToast = true, isNew = false) {
  currentUser = profile;

  // ── Navbar ──
  document.getElementById('nav-guest').style.display = 'none';
  const navUser = document.getElementById('nav-user');
  navUser.style.display = 'flex';
  document.getElementById('nav-avatar').textContent = profile.name.charAt(0).toUpperCase();
  document.getElementById('nav-username').textContent = profile.name.split(' ')[0];

  // ── Hero ──
  document.getElementById('hero-cta').style.display   = 'none';
  document.getElementById('hero-welcome').style.display = '';
  document.getElementById('hero-name').textContent    = profile.name.split(' ')[0];

  // ── Profile Section ──
  document.getElementById('profile-guest-wall').style.display = 'none';
  document.getElementById('profile-logged-in').style.display  = '';
  renderProfilePreview(profile);

  // ── Applications Section ──
  document.getElementById('applications-guest-wall').style.display = 'none';
  document.getElementById('applications-logged-in').style.display  = '';
  loadApplications();

  // ── Apply modal email ──
  document.getElementById('apply-email').value = profile.email;
  document.getElementById('apply-email-hint').textContent = `Applying as: ${profile.email}`;

  if (showWelcomeToast) {
    const msg = isNew
      ? `Your account is all set, ${profile.name.split(' ')[0]}!`
      : `Good to see you again, ${profile.name.split(' ')[0]}!`;
    showToast('success', isNew ? '🎉 Account Created' : '👋 Welcome Back', msg);
  }
}

// ═══════════════════════════════════════════════════════════
// LOGOUT
// ═══════════════════════════════════════════════════════════
async function logout() {
  try {
    await fetch(`${API}/api/talent/auth/logout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
  } catch (_) {}

  clearToken();
  currentUser = null;

  // Reset UI to guest state
  document.getElementById('nav-guest').style.display = '';
  document.getElementById('nav-user').style.display  = 'none';
  document.getElementById('hero-cta').style.display   = '';
  document.getElementById('hero-welcome').style.display = 'none';
  document.getElementById('profile-guest-wall').style.display = '';
  document.getElementById('profile-logged-in').style.display  = 'none';
  document.getElementById('applications-guest-wall').style.display = '';
  document.getElementById('applications-logged-in').style.display  = 'none';

  showToast('info', 'Signed Out', 'You have been signed out successfully.');
}

// ═══════════════════════════════════════════════════════════
// SMOOTH SCROLL NAVIGATION
// ═══════════════════════════════════════════════════════════
function initNavigation() {
  const navLinks = document.querySelectorAll('.navbar-nav a[data-nav]');
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const sectionId = link.getAttribute('href').substring(1);
      const section   = document.getElementById(sectionId);
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      navLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
    });
  });

  const sections = document.querySelectorAll('.section[id]');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        navLinks.forEach(l => {
          l.classList.toggle('active', l.getAttribute('href') === `#${id}`);
        });
      }
    });
  }, { threshold: 0.3 });
  sections.forEach(s => observer.observe(s));
}

// ═══════════════════════════════════════════════════════════
// PROFILE MANAGEMENT
// ═══════════════════════════════════════════════════════════
function toggleEditForm() {
  const editCard = document.getElementById('profile-edit-card');
  const isHidden = editCard.style.display === 'none';

  if (isHidden) {
    // Populate form from current user data
    if (currentUser) {
      document.getElementById('input-name').value = currentUser.name || '';
      document.getElementById('input-skills').value = (currentUser.skills || []).join(', ');
      document.getElementById('input-experience').value = currentUser.experience || 0;
      document.getElementById('input-location').value = currentUser.location || '';
      document.getElementById('input-bio').value = currentUser.bio || '';
    }
    editCard.style.display = '';
    editCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    editCard.style.display = 'none';
  }
}

function initProfileForm() {
  const form = document.getElementById('profile-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveProfile();
  });
}

async function saveProfile() {
  if (!sessionToken) {
    showToast('warning', 'Not Signed In', 'Please sign in to save your profile.');
    return;
  }

  const loading = document.getElementById('profile-loading');
  loading.classList.add('active');

  const skillsRaw = document.getElementById('input-skills').value;
  const skills    = skillsRaw.split(',').map(s => s.trim()).filter(s => s.length > 0);

  const profileData = {
    name:       document.getElementById('input-name').value.trim(),
    skills,
    experience: parseInt(document.getElementById('input-experience').value) || 0,
    location:   document.getElementById('input-location').value.trim(),
    bio:        document.getElementById('input-bio').value.trim()
  };

  try {
    const res = await fetch(`${API}/api/talent/profile`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(profileData)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    const data = await res.json();
    currentUser = data.profile;

    renderProfilePreview(currentUser);
    document.getElementById('profile-edit-card').style.display = 'none';
    showToast('success', '✅ Profile Saved', 'Your profile has been updated successfully.');
  } catch (err) {
    showToast('error', 'Save Failed', err.message);
  } finally {
    loading.classList.remove('active');
  }
}

function renderProfilePreview(profile) {
  if (!profile) return;

  document.getElementById('preview-avatar').textContent    = profile.name.charAt(0).toUpperCase();
  document.getElementById('preview-name').textContent      = profile.name;
  document.getElementById('preview-email').textContent     = profile.email;
  document.getElementById('preview-location').textContent  = profile.location || 'Location not set';
  document.getElementById('preview-bio').textContent       = profile.bio || 'No bio provided.';
  document.getElementById('preview-experience').textContent = `${profile.experience} yrs exp.`;

  const skillsContainer = document.getElementById('preview-skills');
  skillsContainer.innerHTML = (profile.skills || [])
    .map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`)
    .join(' ');
}

// ═══════════════════════════════════════════════════════════
// JOB LISTING
// ═══════════════════════════════════════════════════════════
async function loadJobs() {
  const empty = document.getElementById('jobs-empty');

  try {
    const res = await fetch(`${API}/api/talent/jobs`);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.detail || `HTTP ${res.status}`);
    }
    allJobs = await res.json();
    renderJobs(allJobs);
  } catch (err) {
    empty.style.display = 'block';
    console.warn('Failed to load jobs:', err.message);
  }
}

function renderJobs(jobs) {
  const grid  = document.getElementById('job-grid');
  const empty = document.getElementById('jobs-empty');

  grid.querySelectorAll('.job-card').forEach(c => c.remove());

  if (!jobs || jobs.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  jobs.forEach((job, i) => {
    const card = document.createElement('div');
    card.className = 'job-card';
    card.style.animationDelay = `${i * 0.05}s`;
    card.style.animation = 'fadeSlideUp 0.4s var(--ease-out) forwards';
    card.style.opacity = '0';

    const skills     = (job.skills || []).map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`).join('');
    const postedDate = job.posted_date ? formatDate(job.posted_date) : 'Recently';

    card.innerHTML = `
      <div class="job-card-header">
        <div>
          <div class="job-card-title">${escapeHtml(job.title || 'Untitled')}</div>
          <div class="job-card-company">${escapeHtml(job.company || '—')}</div>
        </div>
      </div>
      <div class="job-card-meta">
        ${job.location ? `<span class="meta-tag location">📍 ${escapeHtml(job.location)}</span>` : ''}
        ${job.job_type ? `<span class="meta-tag type">🏷️ ${escapeHtml(job.job_type)}</span>` : ''}
        ${job.salary   ? `<span class="meta-tag salary">💰 ${escapeHtml(job.salary)}</span>` : ''}
      </div>
      <div class="job-card-skills">${skills}</div>
      <div class="job-card-footer">
        <span class="job-date">📅 ${postedDate}</span>
        <button class="btn btn-primary btn-sm" onclick="openApplyModal('${escapeAttr(job._id || job.id || '')}', '${escapeAttr(job.title || '')}')">
          Apply →
        </button>
      </div>
    `;

    grid.appendChild(card);
  });
}

// ── Job Search ──────────────────────────────────────────────
function initJobSearch() {
  const searchInput = document.getElementById('search-input');
  const btnSearch   = document.getElementById('btn-search-jobs');
  const btnMatch    = document.getElementById('btn-match-jobs');

  searchInput.addEventListener('input', debounce(() => {
    const query = searchInput.value.toLowerCase().trim();
    if (!query) { renderJobs(allJobs); return; }
    const filtered = allJobs.filter(job => {
      const text = `${job.title} ${job.company} ${(job.skills || []).join(' ')}`.toLowerCase();
      return text.includes(query);
    });
    renderJobs(filtered);
  }, 300));

  btnSearch.addEventListener('click', () => searchInput.dispatchEvent(new Event('input')));

  // Skill Match — calls backend
  btnMatch.addEventListener('click', async () => {
    if (!currentUser || !currentUser.skills || currentUser.skills.length === 0) {
      showToast('warning', 'Profile Required', 'Sign in and add skills to your profile to use Skill Match.');
      return;
    }

    try {
      const skillsParam = currentUser.skills.join(',');
      const res = await fetch(`${API}/api/talent/jobs/match?skills=${encodeURIComponent(skillsParam)}`);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail || `HTTP ${res.status}`);
      }
      const matched = await res.json();
      renderJobs(matched);
      showToast('success', '⚡ Skill Match', `Found ${matched.length} job(s) matching your skills.`);
    } catch (err) {
      showToast('error', 'Match Failed', err.message);
    }
  });
}

// ═══════════════════════════════════════════════════════════
// JOB APPLICATION MODAL
// ═══════════════════════════════════════════════════════════
function initApplyModal() {
  const overlay  = document.getElementById('apply-modal-overlay');
  const closeBtn = document.getElementById('apply-modal-close');
  const form     = document.getElementById('apply-form');

  closeBtn.addEventListener('click', () => overlay.classList.remove('active'));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('active');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await submitApplication();
  });
}

function openApplyModal(jobId, jobTitle) {
  document.getElementById('apply-job-id').value = jobId;
  document.getElementById('apply-job-title').textContent = jobTitle;

  const emailGroup = document.getElementById('apply-email-group');
  const emailInput = document.getElementById('apply-email');
  const emailHint  = document.getElementById('apply-email-hint');

  if (currentUser) {
    // Logged in — pre-fill and show as read-only info
    emailInput.value   = currentUser.email;
    emailInput.readOnly = true;
    emailInput.style.opacity = '0.6';
    emailHint.textContent = `Applying as ${currentUser.email}`;
  } else {
    emailInput.value    = '';
    emailInput.readOnly = false;
    emailInput.style.opacity = '1';
    emailHint.textContent = 'Sign in for faster applications with your saved profile.';
  }

  document.getElementById('apply-modal-overlay').classList.add('active');
}

async function submitApplication() {
  const jobId       = document.getElementById('apply-job-id').value;
  const email       = document.getElementById('apply-email').value.trim();
  const coverLetter = document.getElementById('apply-cover').value.trim();

  if (!email && !currentUser) {
    showToast('warning', 'Email Required', 'Please enter your email address or sign in.');
    return;
  }

  const body = { cover_letter: coverLetter };
  if (!currentUser) body.email = email;  // only send email if not logged in

  const headers = currentUser
    ? getAuthHeaders()
    : { 'Content-Type': 'application/json' };

  try {
    const res = await fetch(`${API}/api/talent/jobs/${jobId}/apply`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    showToast('success', '🚀 Application Sent!', 'Your application has been submitted successfully.');
    document.getElementById('apply-modal-overlay').classList.remove('active');
    document.getElementById('apply-form').reset();

    // Refresh applications list if logged in
    if (currentUser) loadApplications();
  } catch (err) {
    showToast('error', 'Application Failed', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// MY APPLICATIONS
// ═══════════════════════════════════════════════════════════
async function loadApplications() {
  if (!sessionToken) return;

  const list    = document.getElementById('application-list');
  const empty   = document.getElementById('applications-empty');
  const loading = document.getElementById('applications-loading');

  loading.classList.add('active');

  try {
    const res = await fetch(`${API}/api/talent/applications/my`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    const applications = await res.json();

    // Clear old items
    list.querySelectorAll('.application-item').forEach(el => el.remove());

    if (!applications || applications.length === 0) {
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';

    applications.forEach(app => {
      const item = document.createElement('div');
      item.className = 'application-item';
      item.innerHTML = `
        <div class="app-info">
          <div class="app-title">${escapeHtml(app.job_title || 'Position')}</div>
          <div class="app-company">${escapeHtml(app.company || '—')}</div>
        </div>
        <span class="badge badge-${getStatusBadge(app.status)}">${escapeHtml(app.status || 'Pending')}</span>
        <span class="app-date">${app.applied_date ? formatDate(app.applied_date) : '—'}</span>
      `;
      list.appendChild(item);
    });
  } catch (err) {
    console.warn('Failed to load applications:', err.message);
  } finally {
    loading.classList.remove('active');
  }
}

function getStatusBadge(status) {
  if (!status) return 'info';
  const s = status.toLowerCase();
  if (s === 'accepted' || s === 'hired') return 'success';
  if (s === 'rejected')  return 'danger';
  if (s === 'reviewing') return 'warning';
  return 'info';
}

// ═══════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str || '');
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
