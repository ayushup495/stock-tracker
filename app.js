
const firebaseConfig = {
  apiKey: "AIzaSyBRDzHMYrc__PkzE0pK3Jpxxwy5t31suJE",
  authDomain: "inventory-managment-f0176.firebaseapp.com",
  databaseURL: "https://inventory-managment-f0176-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "inventory-managment-f0176",
  storageBucket: "inventory-managment-f0176.firebasestorage.app",
  messagingSenderId: "436868904074",
  appId: "1:436868904074:web:4bba8ffb374236c17ba973",
};
firebase.initializeApp(firebaseConfig);
const secondaryApp = firebase.initializeApp(firebaseConfig, "Secondary");
const auth = firebase.auth();
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(function () {});
const secondaryAuth = secondaryApp.auth();
const db = firebase.database();
const EMAIL_SUFFIX = '@stocktrack.local';

let currentUser = null; // { uid, shopId, shopName, username, name, role }
let items = {}, transactions = {}, shopMembers = {}, pendingQueue = [], presenceData = {};
let isConnected = false, pendingPhotoData = null, pendingEditPhotoData = null, editingItemId = null;
let lastCheckedUsername = null, usernameAvailable = false;

/* ---------- theme ---------- */
(function initTheme() {
  let saved = 'light';
  try { saved = localStorage.getItem('st_theme') || 'light'; } catch (e) {}
  if (saved === 'dark') document.body.setAttribute('data-theme', 'dark');
})();
function toggleTheme() {
  const isDark = document.body.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  if (next === 'dark') document.body.setAttribute('data-theme', 'dark');
  else document.body.removeAttribute('data-theme');
  const label = next === 'dark' ? 'Light' : 'Dark';
  ['themeToggleBtn', 'themeToggleBtnLogin'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  });
  try { localStorage.setItem('st_theme', next); } catch (e) {}
}
document.addEventListener('DOMContentLoaded', () => {
  const isDark = document.body.getAttribute('data-theme') === 'dark';
  const label = isDark ? 'Light' : 'Dark';
  ['themeToggleBtn', 'themeToggleBtnLogin'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  });
});

/* ---------- auth mode switch (login vs signup) ---------- */
function switchAuthMode(mode) {
  document.getElementById('loginForm').style.display = mode === 'login' ? 'block' : 'none';
  document.getElementById('signupForm').style.display = mode === 'signup' ? 'block' : 'none';
  document.getElementById('loginTabBtn').classList.toggle('active', mode === 'login');
  document.getElementById('signupTabBtn').classList.toggle('active', mode === 'signup');
}

/* ---------- session persistence: Firebase Auth handles this natively ---------- */
let signupInProgress = false;
auth.onAuthStateChanged(function (user) {
  if (signupInProgress) return; // signup writes its own records first, then enters the app itself
  if (user) {
    loadMembershipAndEnter(user.uid);
  } else {
    currentUser = null;
    document.getElementById('appView').style.display = 'none';
    document.getElementById('loginView').style.display = 'flex';
  }
});

function loadMembershipAndEnter(uid) {
  db.ref('userShop/' + uid).once('value').then(function (snap) {
    const shopId = snap.val();
    if (!shopId) {
      document.getElementById('loginError').textContent = 'Account exists but is not linked to a shop yet.';
      auth.signOut();
      return;
    }
    return db.ref('shopMembers/' + shopId + '/' + uid).once('value').then(function (mSnap) {
      const m = mSnap.val() || {};
      return db.ref('shops/' + shopId + '/name').once('value').then(function (nSnap) {
        currentUser = { uid: uid, shopId: shopId, shopName: nSnap.val() || '', username: m.username || '', name: m.name || '', role: m.role || 'viewer' };
        syncRecoveryEmailIfChanged(uid, shopId);
        enterApp();
      });
    });
  }).catch(function (err) {
    const errEl = document.getElementById('loginError');
    if (errEl) errEl.textContent = 'Could not load your shop (' + err.message + '). Check your connection and try again.';
  });
}

/* Firebase only actually changes the account's email once the person clicks the link in the
   verification email (see saveRecoveryEmail below) — this quietly catches that up in our own
   records the next time they successfully log in with the new one. */
function syncRecoveryEmailIfChanged(uid, shopId) {
  const realEmail = auth.currentUser && auth.currentUser.email;
  if (!realEmail || realEmail.endsWith(EMAIL_SUFFIX)) return;
  /* A successful email login is the source of truth. This heals legacy accounts
     whose old memberEmail record was missing or incorrect, without Console edits. */
  const updates = {};
  updates['memberEmail/' + uid] = realEmail;
  updates['shopMembers/' + shopId + '/' + uid + '/email'] = realEmail;
  db.ref().update(updates).catch(function () {});
}

function enterApp() {
  document.getElementById('userName').textContent = currentUser.name + ' · ' + currentUser.shopName + ' · ' + (currentUser.role === 'admin' ? 'admin' : 'viewer');
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('appView').style.display = 'block';
  applyRoleVisibility();
  loadData();
}

/* ---------- login ---------- */
function handleLogin() {
  const username = document.getElementById('loginUsername').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  if (!username || !password) { errEl.textContent = 'Enter your username or email and password'; return; }
  errEl.textContent = 'Logging in…';
  const timeoutId = setTimeout(function () {
    errEl.textContent = 'Taking too long — check your internet connection and try again';
  }, 12000);
  const isCredError = function (err) { return err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential'; };
  /* Let every legacy user repair their own mapping without a Firebase Console edit.
     After this successful email login, syncRecoveryEmailIfChanged() stores the right email. */
  if (username.indexOf('@') !== -1) {
    auth.signInWithEmailAndPassword(username, password).then(function () {
      clearTimeout(timeoutId);
    }).catch(function (err) {
      clearTimeout(timeoutId);
      errEl.textContent = isCredError(err) ? 'Incorrect email or password' : err.message;
    });
    return;
  }
  db.ref('usernames/' + username).once('value').then(function (snap) {
    if (!snap.exists()) { throw { code: 'auth/user-not-found' }; }
    const uid = snap.val();
    return db.ref('memberEmail/' + uid).once('value').then(function (emailSnap) {
      const email = emailSnap.exists() ? emailSnap.val() : (username + EMAIL_SUFFIX);
      return auth.signInWithEmailAndPassword(email, password).catch(function (err) {
        // The email on file may be stale if they've just confirmed a new recovery email —
        // try the pending one before giving up, and if it works, adopt it as the real one.
        if (!isCredError(err)) throw err;
        return db.ref('memberEmailPending/' + uid).once('value').then(function (pendingSnap) {
          if (!pendingSnap.exists()) throw err;
          const pendingEmail = pendingSnap.val();
          return auth.signInWithEmailAndPassword(pendingEmail, password).then(function (cred) {
            return db.ref('memberEmail/' + uid).set(pendingEmail)
              .then(function () { return db.ref('memberEmailPending/' + uid).remove(); })
              .then(function () { return cred; });
          });
        });
      });
    });
  }).then(function () {
    clearTimeout(timeoutId);
  }).catch(function (err) {
    clearTimeout(timeoutId);
    errEl.textContent = isCredError(err) ? 'Incorrect username or password' : err.message;
  });
}

/* ---------- signup (creates a brand new, separate shop) ---------- */
function checkUsernameAvailability() {
  const username = document.getElementById('signupUsername').value.trim().toLowerCase();
  const statusEl = document.getElementById('usernameCheckStatus');
  if (!username) { statusEl.textContent = 'Enter a username first'; statusEl.style.color = ''; return; }
  statusEl.textContent = 'Checking…'; statusEl.style.color = '';
  db.ref('usernames/' + username).once('value').then(function (snap) {
    lastCheckedUsername = username;
    usernameAvailable = !snap.exists();
    statusEl.textContent = usernameAvailable ? 'Available' : 'Not available — try another';
    statusEl.style.color = usernameAvailable ? 'var(--signal-green)' : 'var(--signal-red)';
  }).catch(function () {
    statusEl.textContent = 'Could not check right now — try again';
  });
}

function submitSignup() {
  const shopName = document.getElementById('signupShopName').value.trim();
  const ownerName = document.getElementById('signupOwnerName').value.trim();
  const username = document.getElementById('signupUsername').value.trim().toLowerCase();
  const email = document.getElementById('signupEmail').value.trim().toLowerCase();
  const password = document.getElementById('signupPassword').value;
  const errEl = document.getElementById('signupError');
  if (!shopName || !ownerName || !username || !email || !password) { errEl.textContent = 'Fill in every field'; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errEl.textContent = 'Enter a valid email — this is what a "forgot password" code goes to'; return; }
  if (password.length < 6) { errEl.textContent = 'Password needs at least 6 characters'; return; }
  if (lastCheckedUsername !== username || !usernameAvailable) { errEl.textContent = 'Please check username availability first'; return; }
  errEl.textContent = 'Creating your shop…';
  signupInProgress = true;
  auth.createUserWithEmailAndPassword(email, password).then(function (cred) {
    const uid = cred.user.uid;
    const shopId = db.ref('shops').push().key;
    /* The shop must be created before its first member: the database rule checks
       the already-created ownerUid when the membership is written. */
    return db.ref('usernames/' + username).set(uid)
      .then(function () { return db.ref('memberEmail/' + uid).set(email); })
      .then(function () { return db.ref('shops/' + shopId).set({ name: shopName, ownerUid: uid, createdAt: Date.now() }); })
      .then(function () { return db.ref('shopMembers/' + shopId + '/' + uid).set({ username: username, name: ownerName, role: 'admin', email: email, createdAt: Date.now() }); })
      .then(function () { return db.ref('userShop/' + uid).set(shopId); })
      .then(function () {
        signupInProgress = false;
        errEl.textContent = '';
        currentUser = { uid: uid, shopId: shopId, shopName: shopName, username: username, name: ownerName, role: 'admin' };
        enterApp();
      });
  }).catch(function (err) {
    signupInProgress = false;
    errEl.textContent = err.code === 'auth/email-already-in-use' ? 'That email is already registered to another account' : err.message;
  });
}

function handleLogout() {
  if (currentUser) {
    db.ref('shops/' + currentUser.shopId + '/presence/' + currentUser.uid).set({ online: false, name: currentUser.name, lastChanged: firebase.database.ServerValue.TIMESTAMP }).catch(function () {});
    db.ref('shops/' + currentUser.shopId + '/items').off();
    db.ref('shops/' + currentUser.shopId + '/transactions').off();
    db.ref('shops/' + currentUser.shopId + '/settings').off();
    db.ref('shops/' + currentUser.shopId + '/presence').off();
    db.ref('userShop/' + currentUser.uid).off();
    db.ref('shopMembers/' + currentUser.shopId).off();
  }
  db.ref('.info/connected').off();
  auth.signOut();
}

function applyRoleVisibility() {
  const isAdmin = currentUser && currentUser.role === 'admin';
  document.getElementById('stockInBtn').style.display = isAdmin ? '' : 'none';
  document.getElementById('stockOutBtn').style.display = isAdmin ? '' : 'none';
  document.getElementById('addItemBtn').style.display = isAdmin ? '' : 'none';
  document.getElementById('usersTabBtn').style.display = isAdmin ? '' : 'none';
  document.getElementById('clearHistoryBtn').style.display = isAdmin ? '' : 'none';
}

/* ---------- local cache, scoped per shop (works even with no internet) ---------- */
function cacheKey(name) { return 'st_' + name + '_' + (currentUser ? currentUser.shopId : 'x'); }
function saveCache() {
  try {
    localStorage.setItem(cacheKey('items'), JSON.stringify(items));
    localStorage.setItem(cacheKey('transactions'), JSON.stringify(transactions));
  } catch (e) {}
}
function loadCache() {
  try { items = JSON.parse(localStorage.getItem(cacheKey('items')) || '{}'); } catch (e) { items = {}; }
  try { transactions = JSON.parse(localStorage.getItem(cacheKey('transactions')) || '{}'); } catch (e) { transactions = {}; }
}
function loadPendingQueue() {
  try { pendingQueue = JSON.parse(localStorage.getItem(cacheKey('pending')) || '[]'); } catch (e) { pendingQueue = []; }
}
function savePendingQueue() {
  try { localStorage.setItem(cacheKey('pending'), JSON.stringify(pendingQueue)); } catch (e) {}
}
function mergePendingIntoTransactions() {
  pendingQueue.forEach(p => { transactions[p.localId] = Object.assign({}, p.data, { pending: true }); });
}

/* ---------- data loading + offline sync (all scoped under the current shop) ---------- */
function loadData() {
  const shopId = currentUser.shopId;
  loadPendingQueue();
  loadCache();
  mergePendingIntoTransactions();
  renderDashboard(); renderItemsManage(); renderHistory(); populateItemDropdowns(); renderTopUsedChart();

  db.ref('.info/connected').on('value', snap => {
    isConnected = snap.val() === true;
    updateConnBadge();
    if (isConnected) {
      flushPendingQueue();
      const presRef = db.ref('shops/' + shopId + '/presence/' + currentUser.uid);
      presRef.onDisconnect().set({ online: false, name: currentUser.name, lastChanged: firebase.database.ServerValue.TIMESTAMP })
        .then(() => presRef.set({ online: true, name: currentUser.name, lastChanged: firebase.database.ServerValue.TIMESTAMP }));
    }
  });
  db.ref('shops/' + shopId + '/presence').on('value', snap => {
    presenceData = snap.val() || {};
    if (currentUser.role === 'admin') renderMembersManage();
  });
  db.ref('userShop/' + currentUser.uid).on('value', snap => {
    if (!snap.exists() && currentUser) {
      showToast('Your access to this shop has been removed by the owner.', 'error');
      handleLogout();
    }
  });
  db.ref('shops/' + shopId + '/items').on('value', snap => {
    items = snap.val() || {};
    saveCache();
    renderDashboard(); renderItemsManage(); populateItemDropdowns(); renderTopUsedChart();
  });
  db.ref('shops/' + shopId + '/transactions').on('value', snap => {
    transactions = snap.val() || {};
    mergePendingIntoTransactions();
    saveCache();
    renderDashboard(); renderHistory(); renderItemsManage(); renderTopUsedChart();
  });
  db.ref('shopMembers/' + shopId).on('value', snap => {
    shopMembers = snap.val() || {};
    if (currentUser.role === 'admin') renderMembersManage();
  });
  db.ref('shops/' + shopId + '/settings').on('value', snap => {
    const s = snap.val() || {};
    const emailInput = document.getElementById('reportEmailInput');
    if (emailInput && s.reportEmail && document.activeElement !== emailInput) emailInput.value = s.reportEmail;
  });
}

function updateConnBadge() {
  const badge = document.getElementById('connBadge');
  const note = document.getElementById('offlineNote');
  if (badge) {
    badge.textContent = isConnected ? 'Online' : 'Offline';
    badge.className = 'conn-badge ' + (isConnected ? 'online' : 'offline');
  }
  if (note) note.className = 'offline-note' + (isConnected ? '' : ' show');
}

function queueTransaction(data) {
  const localId = 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  pendingQueue.push({ localId, data });
  savePendingQueue();
  transactions[localId] = Object.assign({}, data, { pending: true });
  renderDashboard(); renderHistory(); renderItemsManage(); renderTopUsedChart();
}

function flushPendingQueue() {
  if (!isConnected || pendingQueue.length === 0 || !currentUser) return;
  const shopId = currentUser.shopId;
  const queue = pendingQueue.slice();
  queue.forEach(p => {
    db.ref('shops/' + shopId + '/transactions').push(p.data).then(() => {
      pendingQueue = pendingQueue.filter(x => x.localId !== p.localId);
      savePendingQueue();
      delete transactions[p.localId];
      renderDashboard(); renderHistory(); renderItemsManage(); renderTopUsedChart();
    }).catch(() => { /* stays queued, retried on next reconnect */ });
  });
}

/* ---------- stock math ---------- */
function getCurrentStock(itemId) {
  const item = items[itemId];
  if (!item) return 0;
  let stock = Number(item.openingStock) || 0;
  for (const key in transactions) {
    const t = transactions[key];
    if (t.itemId !== itemId) continue;
    stock += t.type === 'in' ? Number(t.quantity) : -Number(t.quantity);
  }
  return stock;
}
function formatNumber(n) { return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
function todayStr() { return new Date().toISOString().split('T')[0]; }

function getTopUsedThisWeek(limit) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const counts = {};
  for (const key in transactions) {
    const t = transactions[key];
    if (t.type !== 'out') continue;
    if ((t.createdAt || 0) < weekAgo) continue;
    counts[t.itemId] = (counts[t.itemId] || 0) + Number(t.quantity);
  }
  return Object.keys(counts)
    .map(id => ({ id, name: items[id] ? items[id].name : 'Deleted item', unit: items[id] ? items[id].unit : '', qty: counts[id] }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, limit || 5);
}

/* ---------- rendering ---------- */
function renderTopUsedChart() {
  const el = document.getElementById('topUsedChart');
  if (!el) return;
  const top = getTopUsedThisWeek(5);
  if (top.length === 0) { el.innerHTML = '<p class="empty-state" style="padding:8px 0;">No stock-out entries yet this week.</p>'; return; }
  const max = Math.max.apply(null, top.map(t => t.qty));
  el.innerHTML = top.map(t => {
    const pct = Math.max(6, Math.round((t.qty / max) * 100));
    return `<div class="bar-row">
      <div class="bar-label">${t.name}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="bar-value">${formatNumber(t.qty)} ${t.unit}</div>
    </div>`;
  }).join('');
}

function itemThumbHtml(item) {
  return item.photo ? `<img src="${item.photo}" class="item-thumb">` : `<div class="item-thumb-placeholder"></div>`;
}

function renderDashboard() {
  const list = document.getElementById('itemsList');
  const ids = Object.keys(items);
  if (ids.length === 0) { list.innerHTML = '<p class="empty-state">No items yet. Add one from the Items tab.</p>'; return; }
  list.innerHTML = ids.map(id => {
    const item = items[id];
    const stock = getCurrentStock(id);
    const low = stock <= (Number(item.reorderLevel) || 0);
    return `<div class="item-row${low ? ' low-stock' : ''}">
      <div class="item-left">
        ${itemThumbHtml(item)}
        <div>
          <div class="item-name">${item.name}${item.modelNumber ? ` <span class="model-tag">#${item.modelNumber}</span>` : ''}</div>
          <div class="item-category">${item.category || ''}</div>
        </div>
      </div>
      <div class="item-stock">
        <div class="stock-value">${formatNumber(stock)} ${item.unit}</div>
        <div class="stock-status">${low ? 'Low stock' : 'In stock'}</div>
      </div>
    </div>`;
  }).join('');
}

function renderItemsManage() {
  const list = document.getElementById('itemsManageList');
  const ids = Object.keys(items);
  if (ids.length === 0) { list.innerHTML = '<p class="empty-state">No items yet.</p>'; return; }
  const isAdmin = currentUser && currentUser.role === 'admin';
  list.innerHTML = ids.map(id => {
    const item = items[id];
    const stock = getCurrentStock(id);
    return `<div class="item-row">
      <div class="item-left">
        ${itemThumbHtml(item)}
        <div>
          <div class="item-name">${item.name}${item.modelNumber ? ` <span class="model-tag">#${item.modelNumber}</span>` : ''}</div>
          <div class="item-category">${item.category || ''} · reorder below ${formatNumber(item.reorderLevel || 0)} ${item.unit}</div>
        </div>
      </div>
      <div class="item-stock">
        <div class="stock-value">${formatNumber(stock)} ${item.unit}</div>
        ${isAdmin ? `<div class="item-actions">
          <button class="ghost-btn" onclick="openEditItemModal('${id}')">Edit</button>
          <button class="ghost-btn" style="border-color:var(--signal-red); color:var(--signal-red);" onclick="deleteItem('${id}')">Delete</button>
        </div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function renderMembersManage() {
  const list = document.getElementById('usersManageList');
  if (!list) return;
  const ids = Object.keys(shopMembers).filter(uid => !shopMembers[uid].removed);
  const badge = document.getElementById('onlineCountBadge');
  if (badge) {
    const onlineCount = ids.filter(uid => presenceData[uid] && presenceData[uid].online).length;
    badge.textContent = ids.length ? ('● ' + onlineCount + ' of ' + ids.length + ' online') : '';
  }
  if (ids.length === 0) { list.innerHTML = '<p class="empty-state">No team members yet.</p>'; return; }
  list.innerHTML = ids.map(uid => {
    const m = shopMembers[uid];
    const online = presenceData[uid] && presenceData[uid].online;
    const isSelf = currentUser && uid === currentUser.uid;
    return `<div class="item-row">
      <div>
        <div class="item-name"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;background:${online ? 'var(--signal-green)' : 'var(--ink-soft)'};"></span>${m.name} <span class="model-tag">@${m.username}</span></div>
        <div class="item-category">${(m.role || 'viewer') === 'admin' ? 'Admin — can edit' : 'Viewer — can only see'} · ${online ? 'Online now' : 'Offline'}</div>
      </div>
      ${isSelf ? '' : `<button class="ghost-btn" style="border-color:var(--signal-red); color:var(--signal-red);" onclick="removeMember('${uid}')">Remove</button>`}
    </div>`;
  }).join('');
}

function removeMember(uid) {
  const m = shopMembers[uid];
  if (!m || !currentUser) return;
  showAppDialog('Remove person', 'Remove ' + m.name + ' from the team? They will lose access right away.', 'Remove', function () {
    const shopId = currentUser.shopId;
    db.ref('userShop/' + uid).remove()
      .then(function () { return db.ref('shopMembers/' + shopId + '/' + uid).update({ removed: true, removedAt: Date.now() }); })
      .then(function () { showToast(m.name + ' was removed from the team.', 'success'); })
      .catch(function (err) { showToast('Could not remove: ' + err.message, 'error'); });
  }, true);
}

function populateItemDropdowns() {
  const optsHtml = Object.keys(items).map(id => `<option value="${id}">${items[id].name}</option>`).join('');
  document.getElementById('stockInItem').innerHTML = optsHtml;
  document.getElementById('stockOutItem').innerHTML = optsHtml;
  document.getElementById('historyFilter').innerHTML = '<option value="">All items</option>' + optsHtml;
}

function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

/* ---------- themed confirmations and notifications (never use browser pop-ups) ---------- */
let appDialogAction = null;
let appToastTimer = null;

function showAppDialog(title, message, confirmLabel, onConfirm, isDanger) {
  document.getElementById('appDialogTitle').textContent = title || 'Please confirm';
  document.getElementById('appDialogMessage').textContent = message || '';
  document.getElementById('appDialogConfirm').textContent = confirmLabel || 'Confirm';
  document.getElementById('appDialogConfirm').className = isDanger ? 'secondary-btn' : 'primary-btn';
  document.getElementById('appDialogConfirm').style.marginTop = '0';
  appDialogAction = onConfirm || null;
  document.getElementById('appDialogModal').style.display = 'flex';
}

function closeAppDialog() {
  document.getElementById('appDialogModal').style.display = 'none';
  appDialogAction = null;
}

function confirmAppDialog() {
  const action = appDialogAction;
  closeAppDialog();
  if (action) action();
}

function showToast(message, type) {
  const toast = document.getElementById('appToast');
  clearTimeout(appToastTimer);
  toast.textContent = message;
  toast.className = 'app-toast show ' + (type || '');
  appToastTimer = setTimeout(function () { toast.className = 'app-toast'; }, 4600);
}

function adjustQty(id, delta) {
  const el = document.getElementById(id);
  const val = (Number(el.value) || 0) + delta;
  el.value = Math.max(0, Math.round(val * 100) / 100);
}

/* ---------- item photo (resized client-side, stored as small base64) ---------- */
function resizeItemPhoto(file, onReady) {
  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = function () {
      const maxSize = 200;
      let w = img.width, h = img.height;
      if (w > h) { if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; } }
      else { if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; } }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      onReady(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function previewItemPhoto(event) {
  const file = event.target.files[0];
  if (!file) { pendingPhotoData = null; return; }
  resizeItemPhoto(file, function (photo) {
    pendingPhotoData = photo;
    const preview = document.getElementById('newItemPhotoPreview');
    preview.src = photo;
    preview.style.display = 'block';
  });
}

function previewEditItemPhoto(event) {
  const file = event.target.files[0];
  if (!file) { pendingEditPhotoData = null; return; }
  resizeItemPhoto(file, function (photo) {
    pendingEditPhotoData = photo;
    document.getElementById('editItemRemovePhoto').checked = false;
    const preview = document.getElementById('editItemPhotoPreview');
    preview.src = photo;
    preview.style.display = 'block';
  });
}

/* ---------- stock in / out (queues automatically when offline) ---------- */
function submitStockIn() {
  const itemId = document.getElementById('stockInItem').value;
  const qty = Number(document.getElementById('stockInQty').value);
  const source = document.getElementById('stockInSource').value.trim();
  const date = document.getElementById('stockInDate').value || todayStr();
  const errEl = document.getElementById('stockInError');
  if (!itemId) { errEl.textContent = 'Add an item first, from the Items tab'; return; }
  if (!qty || qty <= 0) { errEl.textContent = 'Enter a valid quantity'; return; }
  const data = { itemId, type: 'in', quantity: qty, party: source, date, loggedBy: currentUser.name, createdAt: Date.now() };
  const finish = () => {
    errEl.textContent = '';
    closeModal('stockInModal');
    document.getElementById('stockInQty').value = '';
    document.getElementById('stockInSource').value = '';
  };
  if (isConnected) { db.ref('shops/' + currentUser.shopId + '/transactions').push(data).then(finish); }
  else { queueTransaction(data); finish(); }
}

function submitStockOut() {
  const itemId = document.getElementById('stockOutItem').value;
  const qty = Number(document.getElementById('stockOutQty').value);
  const purpose = document.getElementById('stockOutPurpose').value.trim();
  const date = document.getElementById('stockOutDate').value || todayStr();
  const errEl = document.getElementById('stockOutError');
  if (!itemId) { errEl.textContent = 'Add an item first, from the Items tab'; return; }
  if (!qty || qty <= 0) { errEl.textContent = 'Enter a valid quantity'; return; }
  const available = getCurrentStock(itemId);
  if (qty > available) { errEl.textContent = `Only ${formatNumber(available)} available`; return; }
  const data = { itemId, type: 'out', quantity: qty, party: purpose, date, loggedBy: currentUser.name, createdAt: Date.now() };
  const finish = () => {
    errEl.textContent = '';
    closeModal('stockOutModal');
    document.getElementById('stockOutQty').value = '';
    document.getElementById('stockOutPurpose').value = '';
  };
  if (isConnected) { db.ref('shops/' + currentUser.shopId + '/transactions').push(data).then(finish); }
  else { queueTransaction(data); finish(); }
}

function submitNewItem() {
  const name = document.getElementById('newItemName').value.trim();
  const modelNumber = document.getElementById('newItemModel').value.trim();
  const unit = document.getElementById('newItemUnit').value;
  const category = document.getElementById('newItemCategory').value.trim();
  const opening = Number(document.getElementById('newItemOpening').value) || 0;
  const reorder = Number(document.getElementById('newItemReorder').value) || 0;
  const errEl = document.getElementById('addItemError');
  if (!name) { errEl.textContent = 'Enter an item name'; return; }
  if (!isConnected) { errEl.textContent = 'Needs internet to add a new item'; return; }
  const payload = { name, unit, category, openingStock: opening, reorderLevel: reorder, createdAt: Date.now() };
  if (modelNumber) payload.modelNumber = modelNumber;
  if (pendingPhotoData) payload.photo = pendingPhotoData;
  db.ref('shops/' + currentUser.shopId + '/items').push(payload).then(() => {
    errEl.textContent = '';
    closeModal('addItemModal');
    document.getElementById('newItemName').value = '';
    document.getElementById('newItemModel').value = '';
    document.getElementById('newItemCategory').value = '';
    document.getElementById('newItemOpening').value = '0';
    document.getElementById('newItemReorder').value = '0';
    document.getElementById('newItemPhotoFile').value = '';
    document.getElementById('newItemPhotoPreview').style.display = 'none';
    pendingPhotoData = null;
  }).catch(err => { errEl.textContent = err.message; });
}

/* ---------- edit / delete items (admin only) ---------- */
function openEditItemModal(itemId) {
  const item = items[itemId];
  if (!item || !currentUser || currentUser.role !== 'admin') return;
  editingItemId = itemId;
  pendingEditPhotoData = null;
  document.getElementById('editItemError').textContent = '';
  document.getElementById('editItemName').value = item.name || '';
  document.getElementById('editItemModel').value = item.modelNumber || '';
  document.getElementById('editItemUnit').value = item.unit || 'pieces';
  document.getElementById('editItemCategory').value = item.category || '';
  document.getElementById('editItemOpening').value = Number(item.openingStock) || 0;
  document.getElementById('editItemReorder').value = Number(item.reorderLevel) || 0;
  document.getElementById('editItemPhotoFile').value = '';
  document.getElementById('editItemRemovePhoto').checked = false;
  const preview = document.getElementById('editItemPhotoPreview');
  if (item.photo) {
    preview.src = item.photo;
    preview.style.display = 'block';
  } else {
    preview.removeAttribute('src');
    preview.style.display = 'none';
  }
  openModal('editItemModal');
}

function submitEditItem() {
  const errEl = document.getElementById('editItemError');
  if (!editingItemId || !items[editingItemId]) { errEl.textContent = 'This item no longer exists'; return; }
  if (!currentUser || currentUser.role !== 'admin') { errEl.textContent = 'Only an admin can edit items'; return; }
  if (!isConnected) { errEl.textContent = 'Needs internet to save changes'; return; }
  const name = document.getElementById('editItemName').value.trim();
  if (!name) { errEl.textContent = 'Enter an item name'; return; }
  const modelNumber = document.getElementById('editItemModel').value.trim();
  const updates = {
    name: name,
    unit: document.getElementById('editItemUnit').value,
    category: document.getElementById('editItemCategory').value.trim(),
    openingStock: Number(document.getElementById('editItemOpening').value) || 0,
    reorderLevel: Number(document.getElementById('editItemReorder').value) || 0,
    modelNumber: modelNumber || null
  };
  if (pendingEditPhotoData) updates.photo = pendingEditPhotoData;
  if (document.getElementById('editItemRemovePhoto').checked) updates.photo = null;
  db.ref('shops/' + currentUser.shopId + '/items/' + editingItemId).update(updates).then(function () {
    errEl.textContent = '';
    closeModal('editItemModal');
    editingItemId = null;
    pendingEditPhotoData = null;
  }).catch(function (err) { errEl.textContent = err.message; });
}

function deleteItem(itemId) {
  const item = items[itemId];
  if (!item || !currentUser || currentUser.role !== 'admin') return;
  const stock = getCurrentStock(itemId);
  const message = 'Delete "' + item.name + '"? This removes it from the current Items list. '
    + 'Past stock history stays saved. Current stock: ' + formatNumber(stock) + ' ' + item.unit + '.';
  showAppDialog('Delete item', message, 'Delete', function () {
    if (!isConnected) { showToast('Needs internet to delete an item.', 'error'); return; }
    db.ref('shops/' + currentUser.shopId + '/items/' + itemId).remove().then(function () {
      showToast(item.name + ' was deleted.', 'success');
    }).catch(function (err) {
      showToast('Could not delete: ' + err.message, 'error');
    });
  }, true);
}

/* ---------- team members (owner creates a login for each person) ---------- */
function submitNewMember() {
  const name = document.getElementById('newMemberName').value.trim();
  const username = document.getElementById('newMemberUsername').value.trim().toLowerCase();
  const email = document.getElementById('newMemberEmail').value.trim().toLowerCase();
  const password = document.getElementById('newMemberPassword').value;
  const role = document.getElementById('newMemberRole').value;
  const errEl = document.getElementById('addMemberError');
  if (!name || !username || !email || !password) { errEl.textContent = 'Fill in every field'; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errEl.textContent = 'Enter a valid email'; return; }
  if (password.length < 6) { errEl.textContent = 'Password needs at least 6 characters'; return; }
  if (!isConnected) { errEl.textContent = 'Needs internet to add a person'; return; }
  errEl.textContent = 'Checking username…';
  db.ref('usernames/' + username).once('value').then(function (snap) {
    if (snap.exists()) { errEl.textContent = 'That username is already taken'; return; }
    errEl.textContent = 'Creating…';
    const shopId = currentUser.shopId;
    secondaryAuth.createUserWithEmailAndPassword(email, password).then(function (cred) {
      const newUid = cred.user.uid;
      const createdAt = Date.now();
      const updates = {};
      updates['usernames/' + username] = newUid;
      updates['userShop/' + newUid] = shopId;
      updates['memberEmail/' + newUid] = email;
      updates['shopMembers/' + shopId + '/' + newUid] = { username: username, name: name, role: role, email: email, createdAt: createdAt };
      return db.ref().update(updates)
        .then(function () { return secondaryAuth.signOut(); });
    }).then(function () {
      errEl.textContent = '';
      closeModal('addUserModal');
      document.getElementById('newMemberName').value = '';
      document.getElementById('newMemberUsername').value = '';
      document.getElementById('newMemberEmail').value = '';
      document.getElementById('newMemberPassword').value = '';
    }).catch(function (err) {
      errEl.textContent = err.code === 'auth/email-already-in-use' ? 'That email is already registered to another account' : err.message;
    });
  });
}

function submitChangePassword() {
  const newPassword = document.getElementById('newPasswordValue').value;
  const errEl = document.getElementById('changePinError');
  if (!newPassword || newPassword.length < 6) { errEl.textContent = 'Needs at least 6 characters'; return; }
  const user = auth.currentUser;
  if (!user) { errEl.textContent = 'Please log in again'; return; }
  user.updatePassword(newPassword).then(function () {
    errEl.textContent = '';
    closeModal('changePinModal');
    document.getElementById('newPasswordValue').value = '';
  }).catch(function (err) {
    errEl.textContent = err.code === 'auth/requires-recent-login' ? 'Please log out, log back in, then try again' : err.message;
  });
}

/* ---------- account: recovery email (needed for "forgot password" to work) ---------- */
function openAccountModal() {
  document.getElementById('recoveryEmailStatus').textContent = '';
  const email = auth.currentUser ? auth.currentUser.email : '';
  document.getElementById('myRecoveryEmail').value = (email && !email.endsWith(EMAIL_SUFFIX)) ? email : '';
  openModal('changePinModal');
}

function saveRecoveryEmail() {
  const email = document.getElementById('myRecoveryEmail').value.trim().toLowerCase();
  const statusEl = document.getElementById('recoveryEmailStatus');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { statusEl.textContent = 'Enter a valid email'; statusEl.style.color = ''; return; }
  const user = auth.currentUser;
  if (!user || !currentUser) { statusEl.textContent = 'Please log in again'; statusEl.style.color = ''; return; }
  if (user.email === email) { statusEl.textContent = 'That\'s already your recovery email'; statusEl.style.color = ''; return; }
  statusEl.textContent = 'Sending a confirmation link to that address…'; statusEl.style.color = '';
  user.verifyBeforeUpdateEmail(email, { url: APP_URL, handleCodeInApp: false }).then(function () {
    return db.ref('memberEmailPending/' + currentUser.uid).set(email);
  }).then(function () {
    statusEl.textContent = 'Almost there — open ' + email + ' and click the confirmation link. Keep logging in with your current details until you do; it switches over the moment you click it.';
    statusEl.style.color = 'var(--signal-green)';
  }).catch(function (err) {
    statusEl.textContent = err.code === 'auth/requires-recent-login' ? 'Please log out, log back in, then try again'
      : err.code === 'auth/email-already-in-use' ? 'That email is already on another account' : err.message;
    statusEl.style.color = '';
  });
}

/* ---------- forgot password — real Firebase reset email, not a custom OTP ----------
   Needs one Firebase Console step to land back on THIS app instead of Firebase's
   generic page: Authentication → Templates → Password reset → pencil icon →
   Customize action URL → set it to your GitHub Pages URL. */
const APP_URL = 'https://ayushup495.github.io/stock-tracker/'; // ⚠ confirm this is your actual Pages URL
let pendingResetCode = null;

function submitForgotPassword() {
  const identifier = document.getElementById('forgotUsername').value.trim().toLowerCase();
  const statusEl = document.getElementById('forgotPasswordStatus');
  if (identifier.indexOf('@') !== -1) {
    auth.sendPasswordResetEmail(identifier, { url: APP_URL, handleCodeInApp: true }).then(function () {
      statusEl.textContent = 'Reset link sent. Check that inbox and spam folder.';
      statusEl.style.color = 'var(--signal-green)';
    }).catch(function (err) {
      statusEl.textContent = err.code === 'auth/too-many-requests' ? 'Too many attempts. Try again later.' : err.message;
      statusEl.style.color = '';
    });
    return;
  }
  const username = identifier;
  if (!username) { statusEl.textContent = 'Enter your username'; statusEl.style.color = ''; return; }
  if (username.indexOf('@') !== -1) { statusEl.textContent = 'Enter your username, not your email — the username you picked (or were given) when your account was created.'; statusEl.style.color = ''; return; }
  statusEl.textContent = 'Looking up your account…'; statusEl.style.color = '';
  try {
    db.ref('usernames/' + username).once('value').then(function (snap) {
      if (!snap.exists()) { statusEl.textContent = 'No account with that username'; return; }
      const uid = snap.val();
      return db.ref('memberEmail/' + uid).once('value').then(function (emailSnap) {
        if (!emailSnap.exists()) {
          statusEl.textContent = 'No recovery email on file for this account — ask your shop admin, or add one from Account after logging in.';
          return;
        }
        return auth.sendPasswordResetEmail(emailSnap.val(), { url: APP_URL, handleCodeInApp: true }).then(function () {
          statusEl.textContent = 'Reset link sent — check that inbox (and spam folder).';
          statusEl.style.color = 'var(--signal-green)';
        });
      });
    }).catch(function (err) {
      statusEl.textContent = err.code === 'auth/too-many-requests' ? 'Too many attempts — try again later' : err.message;
    });
  } catch (err) {
    statusEl.textContent = 'Something went wrong looking that up — try again.';
  }
}

/* landing back here from the emailed link (?mode=resetPassword&oobCode=...) */
(function checkForResetLink() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('mode') === 'resetPassword' && params.get('oobCode')) {
    const oobCode = params.get('oobCode');
    auth.verifyPasswordResetCode(oobCode).then(function (email) {
      pendingResetCode = oobCode;
      document.getElementById('resetPasswordEmailLine').textContent = 'Resetting the password for ' + email;
      document.getElementById('resetPasswordModal').style.display = 'flex';
    }).catch(function () {
      showToast('That reset link is invalid or has expired. Request a new one from the login screen.', 'error');
    });
  }
})();

function submitConfirmReset() {
  const newPassword = document.getElementById('resetPasswordValue').value;
  const errEl = document.getElementById('resetPasswordError');
  if (!newPassword || newPassword.length < 6) { errEl.textContent = 'Needs at least 6 characters'; return; }
  if (!pendingResetCode) { errEl.textContent = 'This link is no longer valid — request a new one'; return; }
  auth.confirmPasswordReset(pendingResetCode, newPassword).then(function () {
    document.getElementById('resetPasswordModal').style.display = 'none';
    window.history.replaceState({}, '', window.location.pathname);
    showToast('Password updated. Log in with your new password.', 'success');
  }).catch(function (err) {
    errEl.textContent = err.code === 'auth/expired-action-code' ? 'This link expired — request a new one' : err.message;
  });
}

function saveReportEmail() {
  const email = document.getElementById('reportEmailInput').value.trim();
  const statusEl = document.getElementById('reportEmailStatus');
  if (!email) { statusEl.textContent = 'Enter an email'; statusEl.style.color = ''; return; }
  if (!isConnected) { statusEl.textContent = 'Needs internet to save'; statusEl.style.color = ''; return; }
  db.ref('shops/' + currentUser.shopId + '/settings/reportEmail').set(email).then(() => {
    statusEl.textContent = 'Saved';
    statusEl.style.color = 'var(--signal-green)';
  }).catch(err => { statusEl.textContent = err.message; statusEl.style.color = ''; });
}

/* ---------- history ---------- */
function renderHistory() {
  const list = document.getElementById('historyList');
  if (!list) return;
  const filterVal = document.getElementById('historyFilter').value;
  const rows = Object.keys(transactions)
    .map(key => Object.assign({ id: key }, transactions[key]))
    .filter(t => !filterVal || t.itemId === filterVal)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (rows.length === 0) { list.innerHTML = '<p class="empty-state">No transactions yet.</p>'; return; }
  list.innerHTML = rows.map(t => {
    const item = items[t.itemId] || { name: 'Deleted item', unit: '' };
    return `<div class="history-row${t.pending ? ' pending' : ''}">
      <div class="history-type ${t.type === 'in' ? 'type-in' : 'type-out'}">${t.type === 'in' ? 'IN' : 'OUT'}</div>
      <div class="history-details">
        <div class="history-item-name">${item.name}${t.pending ? '<span class="pending-tag">syncing</span>' : ''}</div>
        <div class="history-meta">${t.date || ''} · ${t.party || '—'}</div>
      </div>
      <div class="history-qty">${t.type === 'in' ? '+' : '−'}${formatNumber(t.quantity)} ${item.unit}</div>
    </div>`;
  }).join('');
}

/* ---------- clear old history (folds removed entries into opening stock, so totals never shift) ---------- */
function openClearHistoryModal() {
  document.getElementById('clearHistoryDays').value = '';
  document.getElementById('clearHistoryStatus').textContent = '';
  document.getElementById('clearHistoryStatus').style.color = '';
  document.getElementById('confirmClearHistoryBtn').style.display = 'none';
  openModal('clearHistoryModal');
}

function setClearDays(n) {
  document.getElementById('clearHistoryDays').value = n;
}

let clearHistoryCutoff = null;

function previewClearHistory() {
  const days = Number(document.getElementById('clearHistoryDays').value);
  const statusEl = document.getElementById('clearHistoryStatus');
  const confirmBtn = document.getElementById('confirmClearHistoryBtn');
  confirmBtn.style.display = 'none';
  if (!days || days <= 0) { statusEl.textContent = 'Enter a valid number of days'; statusEl.style.color = ''; return; }
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const toDelete = Object.keys(transactions).filter(key => !transactions[key].pending && (transactions[key].createdAt || 0) < cutoff);
  if (toDelete.length === 0) {
    statusEl.textContent = 'No transactions older than ' + days + ' day(s) — nothing to clear.';
    statusEl.style.color = '';
    return;
  }
  clearHistoryCutoff = cutoff;
  statusEl.textContent = 'This will permanently remove ' + toDelete.length + ' transaction(s) older than ' + days + ' day(s). Stock totals will stay accurate.';
  statusEl.style.color = 'var(--signal-amber)';
  confirmBtn.style.display = 'block';
}

function confirmClearHistory() {
  const statusEl = document.getElementById('clearHistoryStatus');
  if (!isConnected) { statusEl.textContent = 'Needs internet to clear history'; statusEl.style.color = ''; return; }
  if (clearHistoryCutoff === null) return;
  const cutoff = clearHistoryCutoff;
  statusEl.textContent = 'Clearing…';
  statusEl.style.color = '';

  const newOpeningByItem = {};
  Object.keys(items).forEach(id => { newOpeningByItem[id] = Number(items[id].openingStock) || 0; });
  const idsToDelete = [];
  Object.keys(transactions).forEach(key => {
    const t = transactions[key];
    if (t.pending) return;
    if ((t.createdAt || 0) < cutoff) {
      if (newOpeningByItem.hasOwnProperty(t.itemId)) {
        newOpeningByItem[t.itemId] += t.type === 'in' ? Number(t.quantity) : -Number(t.quantity);
      }
      idsToDelete.push(key);
    }
  });

  const updates = {};
  Object.keys(newOpeningByItem).forEach(id => {
    const oldVal = Number(items[id].openingStock) || 0;
    if (newOpeningByItem[id] !== oldVal) {
      updates['shops/' + currentUser.shopId + '/items/' + id + '/openingStock'] = newOpeningByItem[id];
    }
  });
  idsToDelete.forEach(key => {
    updates['shops/' + currentUser.shopId + '/transactions/' + key] = null;
  });

  db.ref().update(updates).then(function () {
    statusEl.textContent = 'Cleared ' + idsToDelete.length + ' old transaction(s).';
    statusEl.style.color = 'var(--signal-green)';
    document.getElementById('confirmClearHistoryBtn').style.display = 'none';
    clearHistoryCutoff = null;
  }).catch(function (err) {
    statusEl.textContent = err.message;
    statusEl.style.color = '';
  });
}

function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(tab + 'Tab').style.display = 'block';
  document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
  if (tab === 'history') renderHistory();
  if (tab === 'users') renderMembersManage();
}

function exportExcel() {
  const rows = Object.keys(items).map(id => {
    const item = items[id];
    return { Item: item.name, 'Model number': item.modelNumber || '', Category: item.category || '', Unit: item.unit, 'Current stock': getCurrentStock(id), 'Reorder level': item.reorderLevel || 0 };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Current Stock');
  XLSX.writeFile(wb, `stock-report-${todayStr()}.xlsx`);
}

document.getElementById('stockInDate').value = todayStr();
document.getElementById('stockOutDate').value = todayStr();

/* ---------- offline app shell (only activates once served over https, e.g. GitHub Pages) ---------- */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* ================================================================
   FREE UPGRADE: suppliers, barcode, history paging, modern dashboard
   Existing Firebase items, transactions, users, and shops are untouched.
   ================================================================ */
let suppliers = {};
let editingSupplierId = null;
let historyVisibleCount = 30;
let scannerTargetSelectId = null;
let scannerStream = null;
let scannerDetector = null;
let scannerActive = false;
let scannerFrameId = null;

function safeText(value) {
  return String(value || '').replace(/[&<>"']/g, function (character) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character];
  });
}

function renderDashboardSummary() {
  const target = document.getElementById('dashboardSummary');
  if (!target) return;
  const ids = Object.keys(items);
  const lowCount = ids.filter(function (id) { return getCurrentStock(id) <= (Number(items[id].reorderLevel) || 0); }).length;
  const transactionCount = Object.keys(transactions).filter(function (id) { return !transactions[id].pending; }).length;
  target.innerHTML = '<div class="metric-card"><div class="metric-value">' + ids.length + '</div><div class="metric-label">Items</div></div>'
    + '<div class="metric-card"><div class="metric-value">' + lowCount + '</div><div class="metric-label">Low stock</div></div>'
    + '<div class="metric-card"><div class="metric-value">' + transactionCount + '</div><div class="metric-label">Entries</div></div>';
}

function renderDashboard() {
  renderDashboardSummary();
  const list = document.getElementById('itemsList');
  const ids = Object.keys(items);
  if (ids.length === 0) { list.innerHTML = '<p class="empty-state">No items yet. Add one from the Items tab.</p>'; return; }
  list.innerHTML = ids.map(function (id) {
    const item = items[id];
    const stock = getCurrentStock(id);
    const low = stock <= (Number(item.reorderLevel) || 0);
    return '<div class="item-row' + (low ? ' low-stock' : '') + '"><div class="item-left">'
      + itemThumbHtml(item) + '<div><div class="item-name">' + item.name
      + (item.modelNumber ? ' <span class="model-tag">#' + item.modelNumber + '</span>' : '')
      + '</div><div class="item-category">' + (item.category || '') + '</div></div></div>'
      + '<div class="item-stock"><div class="stock-value">' + formatNumber(stock) + ' ' + item.unit + '</div>'
      + '<div class="stock-status">' + (low ? 'Low stock' : 'In stock') + '</div></div></div>';
  }).join('');
}

function applyRoleVisibility() {
  const isAdmin = currentUser && currentUser.role === 'admin';
  document.getElementById('stockInBtn').style.display = isAdmin ? '' : 'none';
  document.getElementById('stockOutBtn').style.display = isAdmin ? '' : 'none';
  document.getElementById('addItemBtn').style.display = isAdmin ? '' : 'none';
  document.getElementById('suppliersTabBtn').style.display = isAdmin ? '' : 'none';
  document.getElementById('usersTabBtn').style.display = isAdmin ? '' : 'none';
  document.getElementById('clearHistoryBtn').style.display = isAdmin ? '' : 'none';
}

function handleLogout() {
  if (currentUser) {
    const shopId = currentUser.shopId;
    db.ref('shops/' + shopId + '/presence/' + currentUser.uid).set({ online: false, name: currentUser.name, lastChanged: firebase.database.ServerValue.TIMESTAMP }).catch(function () {});
    ['items', 'transactions', 'settings', 'presence', 'suppliers'].forEach(function (node) { db.ref('shops/' + shopId + '/' + node).off(); });
    db.ref('userShop/' + currentUser.uid).off();
    db.ref('shopMembers/' + shopId).off();
  }
  db.ref('.info/connected').off();
  auth.signOut();
}

function loadData() {
  const shopId = currentUser.shopId;
  loadPendingQueue(); loadCache(); mergePendingIntoTransactions();
  renderDashboard(); renderItemsManage(); renderHistory(); populateItemDropdowns(); renderTopUsedChart(); renderSuppliers();
  db.ref('.info/connected').on('value', function (snap) {
    isConnected = snap.val() === true; updateConnBadge();
    if (isConnected) {
      flushPendingQueue();
      const presRef = db.ref('shops/' + shopId + '/presence/' + currentUser.uid);
      presRef.onDisconnect().set({ online: false, name: currentUser.name, lastChanged: firebase.database.ServerValue.TIMESTAMP })
        .then(function () { return presRef.set({ online: true, name: currentUser.name, lastChanged: firebase.database.ServerValue.TIMESTAMP }); });
    }
  });
  db.ref('shops/' + shopId + '/presence').on('value', function (snap) { presenceData = snap.val() || {}; if (currentUser.role === 'admin') renderMembersManage(); });
  db.ref('userShop/' + currentUser.uid).on('value', function (snap) { if (!snap.exists() && currentUser) { showToast('Your access to this shop has been removed by the owner.', 'error'); handleLogout(); } });
  db.ref('shops/' + shopId + '/items').on('value', function (snap) { items = snap.val() || {}; saveCache(); renderDashboard(); renderItemsManage(); populateItemDropdowns(); renderTopUsedChart(); });
  db.ref('shops/' + shopId + '/transactions').on('value', function (snap) { transactions = snap.val() || {}; mergePendingIntoTransactions(); saveCache(); renderDashboard(); renderHistory(); renderItemsManage(); renderTopUsedChart(); });
  db.ref('shops/' + shopId + '/shopMembers').off();
  db.ref('shopMembers/' + shopId).on('value', function (snap) { shopMembers = snap.val() || {}; if (currentUser.role === 'admin') renderMembersManage(); });
  db.ref('shops/' + shopId + '/suppliers').on('value', function (snap) { suppliers = snap.val() || {}; renderSuppliers(); renderSupplierDatalist(); });
  db.ref('shops/' + shopId + '/settings').on('value', function (snap) { const settings = snap.val() || {}; const emailInput = document.getElementById('reportEmailInput'); if (emailInput && settings.reportEmail && document.activeElement !== emailInput) emailInput.value = settings.reportEmail; });
}

function renderSupplierDatalist() {
  const list = document.getElementById('supplierDatalist');
  if (list) list.innerHTML = Object.keys(suppliers).map(function (id) { return '<option value="' + safeText(suppliers[id].name) + '"></option>'; }).join('');
}

function populateItemDropdowns() {
  const optsHtml = Object.keys(items).map(function (id) { return '<option value="' + id + '">' + safeText(items[id].name) + '</option>'; }).join('');
  document.getElementById('stockInItem').innerHTML = optsHtml;
  document.getElementById('stockOutItem').innerHTML = optsHtml;
  document.getElementById('historyFilter').innerHTML = '<option value="">All items</option>' + optsHtml;
  renderSupplierDatalist();
}

function submitStockIn() {
  const itemId = document.getElementById('stockInItem').value;
  const qty = Number(document.getElementById('stockInQty').value);
  const source = document.getElementById('stockInSource').value.trim();
  const date = document.getElementById('stockInDate').value || todayStr();
  const reason = document.getElementById('stockInReason').value;
  const errEl = document.getElementById('stockInError');
  if (!itemId) { errEl.textContent = 'Add an item first, from the Items tab'; return; }
  if (!qty || qty <= 0) { errEl.textContent = 'Enter a valid quantity'; return; }
  const data = { itemId: itemId, type: 'in', reason: reason, quantity: qty, party: source, date: date, loggedBy: currentUser.name, createdAt: Date.now() };
  const finish = function () { errEl.textContent = ''; closeModal('stockInModal'); document.getElementById('stockInQty').value = ''; document.getElementById('stockInSource').value = ''; };
  if (isConnected) { db.ref('shops/' + currentUser.shopId + '/transactions').push(data).then(finish).catch(function (err) { errEl.textContent = err.message; }); } else { queueTransaction(data); finish(); }
}

function submitStockOut() {
  const itemId = document.getElementById('stockOutItem').value;
  const qty = Number(document.getElementById('stockOutQty').value);
  const purpose = document.getElementById('stockOutPurpose').value.trim();
  const date = document.getElementById('stockOutDate').value || todayStr();
  const reason = document.getElementById('stockOutReason').value;
  const errEl = document.getElementById('stockOutError');
  if (!itemId) { errEl.textContent = 'Add an item first, from the Items tab'; return; }
  if (!qty || qty <= 0) { errEl.textContent = 'Enter a valid quantity'; return; }
  const available = getCurrentStock(itemId);
  if (qty > available) { errEl.textContent = 'Only ' + formatNumber(available) + ' available'; return; }
  const data = { itemId: itemId, type: 'out', reason: reason, quantity: qty, party: purpose, date: date, loggedBy: currentUser.name, createdAt: Date.now() };
  const finish = function () { errEl.textContent = ''; closeModal('stockOutModal'); document.getElementById('stockOutQty').value = ''; document.getElementById('stockOutPurpose').value = ''; };
  if (isConnected) { db.ref('shops/' + currentUser.shopId + '/transactions').push(data).then(finish).catch(function (err) { errEl.textContent = err.message; }); } else { queueTransaction(data); finish(); }
}

function submitNewItem() {
  const name = document.getElementById('newItemName').value.trim();
  const modelNumber = document.getElementById('newItemModel').value.trim();
  const barcode = document.getElementById('newItemBarcode').value.trim();
  const unit = document.getElementById('newItemUnit').value;
  const category = document.getElementById('newItemCategory').value.trim();
  const opening = Number(document.getElementById('newItemOpening').value) || 0;
  const reorder = Number(document.getElementById('newItemReorder').value) || 0;
  const errEl = document.getElementById('addItemError');
  if (!name) { errEl.textContent = 'Enter an item name'; return; }
  if (!isConnected) { errEl.textContent = 'Needs internet to add a new item'; return; }
  const payload = { name: name, unit: unit, category: category, openingStock: opening, reorderLevel: reorder, createdAt: Date.now() };
  if (modelNumber) payload.modelNumber = modelNumber;
  if (barcode) payload.barcode = barcode;
  if (pendingPhotoData) payload.photo = pendingPhotoData;
  db.ref('shops/' + currentUser.shopId + '/items').push(payload).then(function () {
    errEl.textContent = ''; closeModal('addItemModal');
    ['newItemName', 'newItemModel', 'newItemBarcode', 'newItemCategory'].forEach(function (id) { document.getElementById(id).value = ''; });
    document.getElementById('newItemOpening').value = '0'; document.getElementById('newItemReorder').value = '0'; document.getElementById('newItemPhotoFile').value = ''; document.getElementById('newItemPhotoPreview').style.display = 'none'; pendingPhotoData = null;
  }).catch(function (err) { errEl.textContent = err.message; });
}

function openEditItemModal(itemId) {
  const item = items[itemId];
  if (!item || !currentUser || currentUser.role !== 'admin') return;
  editingItemId = itemId; pendingEditPhotoData = null; document.getElementById('editItemError').textContent = '';
  document.getElementById('editItemName').value = item.name || ''; document.getElementById('editItemModel').value = item.modelNumber || ''; document.getElementById('editItemBarcode').value = item.barcode || '';
  document.getElementById('editItemUnit').value = item.unit || 'pieces'; document.getElementById('editItemCategory').value = item.category || ''; document.getElementById('editItemOpening').value = Number(item.openingStock) || 0; document.getElementById('editItemReorder').value = Number(item.reorderLevel) || 0;
  document.getElementById('editItemPhotoFile').value = ''; document.getElementById('editItemRemovePhoto').checked = false;
  const preview = document.getElementById('editItemPhotoPreview');
  if (item.photo) { preview.src = item.photo; preview.style.display = 'block'; } else { preview.removeAttribute('src'); preview.style.display = 'none'; }
  openModal('editItemModal');
}

function submitEditItem() {
  const errEl = document.getElementById('editItemError');
  if (!editingItemId || !items[editingItemId]) { errEl.textContent = 'This item no longer exists'; return; }
  if (!currentUser || currentUser.role !== 'admin') { errEl.textContent = 'Only an admin can edit items'; return; }
  if (!isConnected) { errEl.textContent = 'Needs internet to save changes'; return; }
  const name = document.getElementById('editItemName').value.trim();
  if (!name) { errEl.textContent = 'Enter an item name'; return; }
  const updates = { name: name, unit: document.getElementById('editItemUnit').value, category: document.getElementById('editItemCategory').value.trim(), openingStock: Number(document.getElementById('editItemOpening').value) || 0, reorderLevel: Number(document.getElementById('editItemReorder').value) || 0, modelNumber: document.getElementById('editItemModel').value.trim() || null, barcode: document.getElementById('editItemBarcode').value.trim() || null };
  if (pendingEditPhotoData) updates.photo = pendingEditPhotoData;
  if (document.getElementById('editItemRemovePhoto').checked) updates.photo = null;
  db.ref('shops/' + currentUser.shopId + '/items/' + editingItemId).update(updates).then(function () { errEl.textContent = ''; closeModal('editItemModal'); editingItemId = null; pendingEditPhotoData = null; showToast('Item updated.', 'success'); }).catch(function (err) { errEl.textContent = err.message; });
}

function transactionLabel(transaction) {
  const labels = { purchase: 'PURCHASE', return: 'RETURN', sale: 'SALE', usage: 'USED', adjustment: 'ADJUST' };
  return labels[transaction.reason] || (transaction.type === 'in' ? 'IN' : 'OUT');
}

function resetHistoryPagination() { historyVisibleCount = 30; renderHistory(); }
function loadMoreHistory() { historyVisibleCount += 30; renderHistory(); }
function renderHistory() {
  const list = document.getElementById('historyList');
  const footer = document.getElementById('historyFooter');
  const count = document.getElementById('historyCount');
  const loadMore = document.getElementById('historyLoadMoreBtn');
  if (!list) return;
  const filterVal = document.getElementById('historyFilter').value;
  const rows = Object.keys(transactions).map(function (key) { return Object.assign({ id: key }, transactions[key]); }).filter(function (transaction) { return !filterVal || transaction.itemId === filterVal; }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  if (rows.length === 0) { list.innerHTML = '<p class="empty-state">No transactions yet.</p>'; if (footer) footer.style.display = 'none'; return; }
  const visibleRows = rows.slice(0, historyVisibleCount);
  list.innerHTML = visibleRows.map(function (transaction) {
    const item = items[transaction.itemId] || { name: 'Deleted item', unit: '' };
    const direction = transaction.type === 'in' ? '+' : '-';
    return '<div class="history-row' + (transaction.pending ? ' pending' : '') + '"><div class="history-type ' + (transaction.type === 'in' ? 'type-in' : 'type-out') + '">' + transactionLabel(transaction) + '</div><div class="history-details"><div class="history-item-name">' + safeText(item.name) + (transaction.pending ? '<span class="pending-tag">syncing</span>' : '') + '</div><div class="history-meta">' + safeText(transaction.date || '') + ' - ' + safeText(transaction.party || '-') + '</div></div><div class="history-qty">' + direction + formatNumber(transaction.quantity) + ' ' + safeText(item.unit) + '</div></div>';
  }).join('');
  if (footer) { footer.style.display = 'flex'; count.textContent = 'Showing ' + visibleRows.length + ' of ' + rows.length + ' entries'; loadMore.style.display = visibleRows.length < rows.length ? '' : 'none'; }
}

function renderSuppliers() {
  const list = document.getElementById('suppliersManageList');
  if (!list) return;
  const isAdmin = currentUser && currentUser.role === 'admin';
  const ids = Object.keys(suppliers).sort(function (a, b) { return String(suppliers[a].name || '').localeCompare(String(suppliers[b].name || '')); });
  if (!ids.length) { list.innerHTML = '<p class="empty-state">No suppliers yet. Add one to use it in Stock In.</p>'; return; }
  list.innerHTML = ids.map(function (id) {
    const supplier = suppliers[id] || {};
    const info = [supplier.phone, supplier.notes].filter(Boolean).map(safeText).join(' - ');
    return '<div class="supplier-row"><div class="supplier-icon">S</div><div class="supplier-details"><div class="item-name">' + safeText(supplier.name) + '</div><div class="item-category">' + (info || 'Supplier details not added') + '</div></div>' + (isAdmin ? '<div class="item-actions"><button class="ghost-btn" onclick="openSupplierModal(\'' + id + '\')">Edit</button><button class="ghost-btn" style="border-color:var(--signal-red);color:var(--signal-red);" onclick="deleteSupplier(\'' + id + '\')">Delete</button></div>' : '') + '</div>';
  }).join('');
}

function openSupplierModal(id) {
  const supplier = id ? suppliers[id] : null;
  if (!currentUser || currentUser.role !== 'admin') return;
  editingSupplierId = id || null;
  document.getElementById('supplierModalTitle').textContent = supplier ? 'Edit supplier' : 'Add supplier';
  document.getElementById('supplierName').value = supplier ? supplier.name || '' : '';
  document.getElementById('supplierPhone').value = supplier ? supplier.phone || '' : '';
  document.getElementById('supplierNotes').value = supplier ? supplier.notes || '' : '';
  document.getElementById('supplierError').textContent = '';
  openModal('supplierModal');
}

function submitSupplier() {
  const name = document.getElementById('supplierName').value.trim();
  const phone = document.getElementById('supplierPhone').value.trim();
  const notes = document.getElementById('supplierNotes').value.trim();
  const error = document.getElementById('supplierError');
  if (!name) { error.textContent = 'Enter a supplier name'; return; }
  if (!isConnected) { error.textContent = 'Needs internet to save a supplier'; return; }
  const data = { name: name, phone: phone, notes: notes, updatedAt: Date.now() };
  const ref = editingSupplierId ? db.ref('shops/' + currentUser.shopId + '/suppliers/' + editingSupplierId) : db.ref('shops/' + currentUser.shopId + '/suppliers').push();
  if (!editingSupplierId) data.createdAt = Date.now();
  ref.update(data).then(function () { closeModal('supplierModal'); showToast('Supplier saved.', 'success'); }).catch(function (err) { error.textContent = err.message; });
}

function deleteSupplier(id) {
  const supplier = suppliers[id];
  if (!supplier || !currentUser || currentUser.role !== 'admin') return;
  showAppDialog('Delete supplier', 'Delete ' + supplier.name + '? Existing stock history will stay saved.', 'Delete', function () {
    db.ref('shops/' + currentUser.shopId + '/suppliers/' + id).remove().then(function () { showToast('Supplier deleted.', 'success'); }).catch(function (err) { showToast('Could not delete supplier: ' + err.message, 'error'); });
  }, true);
}

function openBarcodeScanner(targetSelectId) {
  scannerTargetSelectId = targetSelectId;
  document.getElementById('manualBarcodeValue').value = '';
  document.getElementById('barcodeScannerModal').style.display = 'flex';
  const status = document.getElementById('scannerStatus');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { status.textContent = 'Camera scanning is not available in this browser. Type the barcode below instead.'; return; }
  if (!('BarcodeDetector' in window)) { status.textContent = 'This browser cannot scan automatically. Type the barcode below instead.'; return; }
  try { scannerDetector = new BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code'] }); } catch (error) { status.textContent = 'This barcode format is not supported here. Type the barcode below instead.'; return; }
  navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(function (stream) {
    scannerStream = stream; scannerActive = true;
    const video = document.getElementById('barcodeVideo'); video.srcObject = stream; video.play(); status.textContent = 'Point the camera at a barcode.'; scanBarcodeFrame();
  }).catch(function () { status.textContent = 'Camera permission was not allowed. Type the barcode below instead.'; });
}

function scanBarcodeFrame() {
  if (!scannerActive || !scannerDetector) return;
  const video = document.getElementById('barcodeVideo');
  scannerDetector.detect(video).then(function (codes) {
    if (codes.length && codes[0].rawValue) { selectItemFromBarcode(codes[0].rawValue); return; }
    scannerFrameId = requestAnimationFrame(scanBarcodeFrame);
  }).catch(function () { scannerFrameId = requestAnimationFrame(scanBarcodeFrame); });
}

function useManualBarcode() { selectItemFromBarcode(document.getElementById('manualBarcodeValue').value); }
function selectItemFromBarcode(value) {
  const barcode = String(value || '').trim();
  const status = document.getElementById('scannerStatus');
  if (!barcode) { status.textContent = 'Enter or scan a barcode first.'; return; }
  const itemId = Object.keys(items).find(function (id) { return String(items[id].barcode || '').trim() === barcode; });
  if (!itemId) { status.textContent = 'No item has this barcode. Add the barcode in Items > Edit first.'; return; }
  const select = document.getElementById(scannerTargetSelectId);
  if (select) select.value = itemId;
  stopBarcodeScanner(); showToast('Selected ' + items[itemId].name + '.', 'success');
}

function stopBarcodeScanner() {
  scannerActive = false; if (scannerFrameId) cancelAnimationFrame(scannerFrameId); scannerFrameId = null;
  if (scannerStream) { scannerStream.getTracks().forEach(function (track) { track.stop(); }); scannerStream = null; }
  const video = document.getElementById('barcodeVideo'); if (video) video.srcObject = null;
  document.getElementById('barcodeScannerModal').style.display = 'none';
}

function closeModal(id) { if (id === 'barcodeScannerModal') { stopBarcodeScanner(); return; } document.getElementById(id).style.display = 'none'; }
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(function (element) { element.style.display = 'none'; });
  document.querySelectorAll('.tab-btn').forEach(function (element) { element.classList.remove('active'); });
  document.getElementById(tab + 'Tab').style.display = 'block';
  document.querySelector('.tab-btn[data-tab="' + tab + '"]').classList.add('active');
  if (tab === 'history') renderHistory();
  if (tab === 'users') renderMembersManage();
  if (tab === 'suppliers') renderSuppliers();
}