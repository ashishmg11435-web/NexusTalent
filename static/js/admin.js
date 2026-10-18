/**
 * ═══════════════════════════════════════════════════════════
 * NexusTalent — Admin Portal JavaScript Handler
 * Handles: HTTP Basic Auth login, Job CRUD, Applicant review,
 *          Dashboard stats, and admin-specific DOM management.
 * ═══════════════════════════════════════════════════════════
 */

// ── State ───────────────────────────────────────────────────
let adminCredentials = null; // { username, password } for HTTP Basic Auth
let adminJobs = [];

// ── DOM Ready ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initLogin();
  initTabs();
  initJobModal();
  initLogout();
});

// ═══════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS (shared pattern with app.js)
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
// AUTHENTICATION (HTTP Basic Auth)
// ═══════════════════════════════════════════════════════════
function initLogin() {
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();

    if (!username || !password) {
      showToast('warning', 'Missing Credentials', 'Please enter both username and password.');
      return;
    }

    // Attempt auth by calling verification endpoint
    try {
      const res = await fetch('/api/admin/verify', {
        headers: {
          'Authorization': 'Basic ' + btoa(`${username}:${password}`)
        }
      });

      if (res.status === 401) {
        showToast('error', 'Login Failed', 'Invalid username or password.');
        return;
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${res.status}`);
      }

      // Credentials valid — store and switch views
      adminCredentials = { username, password };
      showDashboard();
      showToast('success', 'Welcome Back', `Logged in as ${username}.`);
    } catch (err) {
      showToast('error', 'Login Error', err.message);
    }
  });
}

function getAuthHeaders() {
  if (!adminCredentials) return {};
  return {
    'Authorization': 'Basic ' + btoa(`${adminCredentials.username}:${adminCredentials.password}`)
  };
}

function showDashboard() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('admin-dashboard').classList.add('active');
  loadDashboardData();
}

function initLogout() {
  document.getElementById('btn-logout').addEventListener('click', (e) => {
    e.preventDefault();
    adminCredentials = null;
    document.getElementById('admin-dashboard').classList.remove('active');
    document.getElementById('login-view').style.display = '';
    document.getElementById('login-form').reset();
    showToast('info', 'Logged Out', 'You have been signed out.');
  });
}

// ═══════════════════════════════════════════════════════════
// DASHBOARD DATA
// ═══════════════════════════════════════════════════════════
async function loadDashboardData() {
  await Promise.all([
    loadAdminJobs(),
    loadAdminApplicants(),
    loadStats()
  ]);
}

async function loadStats() {
  try {
    // Fetch job count
    const jobsRes = await fetch('/api/admin/jobs', { headers: getAuthHeaders() });
    if (jobsRes.ok) {
      const jobs = await jobsRes.json();
      document.getElementById('stat-total-jobs').textContent = jobs.length || 0;
    }

    // Fetch applicant count
    const appsRes = await fetch('/api/admin/applicants', { headers: getAuthHeaders() });
    if (appsRes.ok) {
      const apps = await appsRes.json();
      document.getElementById('stat-total-applicants').textContent = apps.length || 0;
    }

    // Profiles stat (try to fetch, fallback to 0)
    try {
      const profilesRes = await fetch('/api/admin/stats', { headers: getAuthHeaders() });
      if (profilesRes.ok) {
        const stats = await profilesRes.json();
        document.getElementById('stat-total-profiles').textContent = stats.profiles || 0;
      }
    } catch {
      // Stats endpoint may not exist yet
    }
  } catch (err) {
    console.warn('Stats load failed:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// TAB SYSTEM
// ═══════════════════════════════════════════════════════════
function initTabs() {
  const tabBtns = document.querySelectorAll('#admin-tabs .tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;

      // Update buttons
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update content
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
    });
  });
}

// ═══════════════════════════════════════════════════════════
// JOB MANAGEMENT
// ═══════════════════════════════════════════════════════════
async function loadAdminJobs() {
  const tbody = document.getElementById('admin-jobs-tbody');
  const empty = document.getElementById('admin-jobs-empty');
  const loading = document.getElementById('admin-jobs-loading');

  loading.classList.add('active');

  try {
    const res = await fetch('/api/admin/jobs', { headers: getAuthHeaders() });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `HTTP ${res.status}`);
    }

    adminJobs = await res.json();
    tbody.innerHTML = '';

    if (!adminJobs || adminJobs.length === 0) {
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';

    adminJobs.forEach(job => {
      const tr = document.createElement('tr');
      const skills = (job.skills || []).map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`).join(' ');
      const posted = job.posted_date ? formatDate(job.posted_date) : '—';
      const jobId = job._id || job.id || '';

      tr.innerHTML = `
        <td><strong>${escapeHtml(job.title || '—')}</strong></td>
        <td>${escapeHtml(job.company || '—')}</td>
        <td>${escapeHtml(job.location || '—')}</td>
        <td><div style="display:flex; flex-wrap:wrap; gap:0.2rem;">${skills}</div></td>
        <td style="white-space:nowrap;">${posted}</td>
        <td>
          <div style="display:flex; gap:0.35rem;">
            <button class="btn btn-secondary btn-sm" onclick="editJob('${escapeAttr(jobId)}')">✏️</button>
            <button class="btn btn-danger btn-sm" onclick="deleteJob('${escapeAttr(jobId)}')">🗑️</button>
          </div>
        </td>
      `;

      tbody.appendChild(tr);
    });
  } catch (err) {
    showToast('error', 'Failed to Load Jobs', err.message);
  } finally {
    loading.classList.remove('active');
  }
}

// ── Job Modal ───────────────────────────────────────────────
function initJobModal() {
  const overlay = document.getElementById('job-modal-overlay');
  const closeBtn = document.getElementById('job-modal-close');
  const openBtn = document.getElementById('btn-open-job-modal');
  const form = document.getElementById('job-form');

  openBtn.addEventListener('click', () => {
    resetJobForm();
    document.getElementById('job-modal-title').textContent = 'Create Job Posting';
    document.getElementById('btn-submit-job').textContent = '🚀 Publish Job';
    overlay.classList.add('active');
  });

  closeBtn.addEventListener('click', () => overlay.classList.remove('active'));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('active');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await submitJob();
  });
}

function resetJobForm() {
  document.getElementById('job-form').reset();
  document.getElementById('job-edit-id').value = '';
}

function editJob(jobId) {
  const job = adminJobs.find(j => (j._id || j.id) === jobId);
  if (!job) return;

  document.getElementById('job-edit-id').value = jobId;
  document.getElementById('job-title').value = job.title || '';
  document.getElementById('job-company').value = job.company || '';
  document.getElementById('job-location').value = job.location || '';
  document.getElementById('job-type').value = job.job_type || 'Full-time';
  document.getElementById('job-salary').value = job.salary || '';
  document.getElementById('job-skills').value = (job.skills || []).join(', ');
  document.getElementById('job-description').value = job.description || '';

  document.getElementById('job-modal-title').textContent = 'Edit Job Posting';
  document.getElementById('btn-submit-job').textContent = '💾 Update Job';
  document.getElementById('job-modal-overlay').classList.add('active');
}

async function submitJob() {
  const editId = document.getElementById('job-edit-id').value;
  const isEdit = !!editId;

  const skillsRaw = document.getElementById('job-skills').value;
  const skills = skillsRaw.split(',').map(s => s.trim()).filter(s => s.length > 0);

  const jobData = {
    title: document.getElementById('job-title').value.trim(),
    company: document.getElementById('job-company').value.trim(),
    location: document.getElementById('job-location').value.trim(),
    job_type: document.getElementById('job-type').value,
    salary: document.getElementById('job-salary').value.trim(),
    skills: skills,
    description: document.getElementById('job-description').value.trim()
  };

  try {
    const url = isEdit ? `/api/admin/jobs/${editId}` : '/api/admin/jobs';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify(jobData)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    showToast('success', isEdit ? 'Job Updated' : 'Job Published', `"${jobData.title}" has been ${isEdit ? 'updated' : 'published'}.`);
    document.getElementById('job-modal-overlay').classList.remove('active');
    resetJobForm();
    await loadDashboardData();
  } catch (err) {
    showToast('error', 'Error', err.message);
  }
}

async function deleteJob(jobId) {
  if (!confirm('Are you sure you want to delete this job posting?')) return;

  try {
    const res = await fetch(`/api/admin/jobs/${jobId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `HTTP ${res.status}`);
    }

    showToast('success', 'Job Deleted', 'The job posting has been removed.');
    await loadDashboardData();
  } catch (err) {
    showToast('error', 'Delete Failed', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// APPLICANT MANAGEMENT
// ═══════════════════════════════════════════════════════════
async function loadAdminApplicants() {
  const list    = document.getElementById('admin-applicants-list');
  const empty   = document.getElementById('admin-applicants-empty');
  const loading = document.getElementById('admin-applicants-loading');

  loading.classList.add('active');

  try {
    const res = await fetch('/api/admin/applicants', { headers: getAuthHeaders() });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `HTTP ${res.status}`);
    }

    const applicants = await res.json();

    // Clear existing items
    list.querySelectorAll('.applicant-card').forEach(el => el.remove());

    if (!applicants || applicants.length === 0) {
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';

    applicants.forEach(app => {
      const card = document.createElement('div');
      card.className = 'applicant-card';
      card.dataset.appId = app._id;

      const initials  = (app.name || app.email || '?').charAt(0).toUpperCase();
      const skills    = (app.skills || []).map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`).join(' ');
      const appId     = escapeAttr(app._id || '');
      const curStatus = app.status || 'Pending';
      const badgeClass = getStatusBadge(curStatus);
      const appliedDate = app.applied_date ? formatDate(app.applied_date) : '—';

      card.innerHTML = `
        <div class="applicant-avatar">${initials}</div>
        <div class="applicant-info">
          <div class="applicant-name">${escapeHtml(app.name || app.email || 'Unknown')}</div>
          <div class="applicant-email">
            ${escapeHtml(app.email || '—')} &nbsp;·&nbsp; Applied for: <strong>${escapeHtml(app.job_title || '—')}</strong>
            &nbsp;·&nbsp; <span style="color:var(--clr-text-muted);">${appliedDate}</span>
          </div>
          ${skills ? `<div class="applicant-skills" style="margin-top:0.4rem;">${skills}</div>` : ''}
          ${app.cover_letter ? `<div style="margin-top:0.4rem; color:var(--clr-text-muted); font-size:0.83rem; font-style:italic;">"${escapeHtml(app.cover_letter.slice(0, 120))}${app.cover_letter.length > 120 ? '…' : ''}"</div>` : ''}
        </div>
        <div class="applicant-actions">
          <span class="badge badge-${badgeClass}" id="badge-${appId}">${escapeHtml(curStatus)}</span>
          <div style="display:flex; gap:0.4rem; align-items:center; margin-top:0.5rem; flex-wrap:wrap;">
            <select class="status-select" id="select-${appId}" onchange="previewStatusChange('${appId}')">
              <option value="Pending"   ${curStatus === 'Pending'   ? 'selected' : ''}>⏳ Pending</option>
              <option value="Reviewing" ${curStatus === 'Reviewing' ? 'selected' : ''}>🔍 Reviewing</option>
              <option value="Accepted"  ${curStatus === 'Accepted'  ? 'selected' : ''}>✅ Accepted</option>
              <option value="Rejected"  ${curStatus === 'Rejected'  ? 'selected' : ''}>❌ Rejected</option>
              <option value="Hired"     ${curStatus === 'Hired'     ? 'selected' : ''}>🎉 Hired</option>
            </select>
            <button class="btn btn-primary btn-sm" id="btn-update-${appId}" onclick="updateApplicationStatus('${appId}')">
              Update
            </button>
          </div>
        </div>
      `;

      list.appendChild(card);
    });
  } catch (err) {
    showToast('error', 'Failed to Load Applicants', err.message);
  } finally {
    loading.classList.remove('active');
  }
}

function previewStatusChange(appId) {
  const select    = document.getElementById(`select-${appId}`);
  const badge     = document.getElementById(`badge-${appId}`);
  if (!select || !badge) return;
  const newStatus = select.value;
  badge.className = `badge badge-${getStatusBadge(newStatus)}`;
  badge.textContent = newStatus;
}

async function updateApplicationStatus(appId) {
  const select    = document.getElementById(`select-${appId}`);
  const btn       = document.getElementById(`btn-update-${appId}`);
  const badge     = document.getElementById(`badge-${appId}`);
  if (!select) return;

  const newStatus = select.value;
  btn.disabled    = true;
  btn.textContent = '…';

  try {
    const res = await fetch(`/api/admin/applicants/${appId}/status?new_status=${encodeURIComponent(newStatus)}`, {
      method: 'PUT',
      headers: getAuthHeaders()
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `HTTP ${res.status}`);
    }

    // Update badge in-place
    badge.className   = `badge badge-${getStatusBadge(newStatus)}`;
    badge.textContent = newStatus;

    showToast('success', 'Status Updated', `Application status set to "${newStatus}".`);
  } catch (err) {
    showToast('error', 'Update Failed', err.message);
    // Revert badge to server value
    badge.textContent = select.value;
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Update';
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
  div.textContent = str || '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}
