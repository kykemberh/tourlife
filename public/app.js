(function () {
  const TOKEN_KEY = "tourlife_token";

  let me = null;
  let posts = [];
  let openCommentId = null;
  let openMenuId = null;
  let pendingAttachment = null;
  let pendingLocation = null;
  let activeConvUserId = null;
  let activeConvUser = null;
  let chatPollTimer = null;
  let notifPollTimer = null;
  let pendingChatImage = null;
  let chatViewOnceOn = false;
  let lastConversations = [];
  let viewedProfileId = null;
  let searchDebounce = null;

  /* ---------------- helpers ---------------- */

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

  async function api(path, options = {}) {
    const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
    const token = getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
    const res = await fetch(path, Object.assign({}, options, { headers }));
    let data = {};
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) throw new Error(data.error || "Помилка запиту");
    return data;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.innerText = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function initials(name) {
    return (name || "?").trim().split(/\s+/).slice(0, 2).map(p => p[0]).join("").toUpperCase();
  }

  function avatarHtml(user, extraClass) {
    extraClass = extraClass || "";
    if (!user) return `<div class="avatar ${extraClass}" style="background:#999">?</div>`;
    const ini = user.initials || initials(user.name);
    if (user.avatarUrl) {
      return `<div class="avatar ${extraClass}"><img src="${escapeHtml(user.avatarUrl)}" alt=""></div>`;
    }
    return `<div class="avatar ${extraClass}" style="background:${user.avatarColor}">${ini}</div>`;
  }

  function setAvatarEl(el, user) {
    if (!el) return;
    el.innerHTML = "";
    if (user && user.avatarUrl) {
      el.style.background = "transparent";
      const img = document.createElement("img");
      img.src = user.avatarUrl;
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";
      img.style.borderRadius = "50%";
      el.appendChild(img);
    } else {
      el.style.background = user ? user.avatarColor : "#999";
      el.textContent = user ? initials(user.name) : "?";
    }
  }

  function timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return "Щойно";
    if (diff < 3600) return Math.floor(diff / 60) + " хв тому";
    if (diff < 86400) return Math.floor(diff / 3600) + " год тому";
    return Math.floor(diff / 86400) + " дн тому";
  }

  const ICONS = {
    heart: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5 4.6 13a4.6 4.6 0 0 1 6.9-6.1l.5.5.5-.5a4.6 4.6 0 0 1 6.9 6.1Z"/></svg>`,
    heartFill: `<svg class="icon-svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><path d="M12 20.5 4.6 13a4.6 4.6 0 0 1 6.9-6.1l.5.5.5-.5a4.6 4.6 0 0 1 6.9 6.1Z"/></svg>`,
    comment: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></svg>`,
    handshake: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12l4-4 4 4-4 4Z"/><path d="M6 8l4.5-4 4 1 1.5 1.5"/><path d="M10 12l3 3a2 2 0 1 0 3-3l-3.5-3.5"/><path d="M13 9l1.5-1.5a2 2 0 1 1 3 3L16 12"/><path d="M22 12l-4 4-4-4 4-4Z"/></svg>`,
    bell: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 3.5-1 5.5-2 7h16c-1-1.5-2-3.5-2-7Z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>`,
    trash: `<svg class="icon-svg sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/></svg>`,
    warning: `<svg class="icon-svg sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20Z"/><path d="M12 10v4"/><path d="M12 17h.01"/></svg>`,
    fire: `<svg class="icon-svg sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c2 3-2 4-2 7a4 4 0 0 0 8 0c0-1-.5-2-1-2.5.5 2-1 3-2 2 1-2-1-4-3-4.5Z"/><path d="M7 14a5 5 0 0 0 10 0c0-2-1-3-2-4 .5 2.5-1 4-3 4.5-1.5.5-3-1-3-2.5-1 .5-2 1.5-2 2Z"/></svg>`,
    photo: `<svg class="icon-svg sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><circle cx="12" cy="13" r="3.5"/></svg>`
  };

  const toastEl = document.getElementById("toast");
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  /* ---------------- Auth screen ---------------- */

  const authScreen = document.getElementById("auth-screen");
  const appRoot = document.getElementById("app-root");

  document.getElementById("tabLogin").addEventListener("click", () => switchAuthTab("login"));
  document.getElementById("tabRegister").addEventListener("click", () => switchAuthTab("register"));

  function switchAuthTab(which) {
    document.getElementById("tabLogin").classList.toggle("active", which === "login");
    document.getElementById("tabRegister").classList.toggle("active", which === "register");
    document.getElementById("loginForm").classList.toggle("active", which === "login");
    document.getElementById("registerForm").classList.toggle("active", which === "register");
  }

  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("loginError");
    errEl.textContent = "";
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    try {
      const data = await api("/api/login", { method: "POST", body: JSON.stringify({ email, password }) });
      setToken(data.token);
      me = data.user;
      enterApp();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  document.getElementById("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("regError");
    errEl.textContent = "";
    const name = document.getElementById("regName").value.trim();
    const email = document.getElementById("regEmail").value.trim();
    const password = document.getElementById("regPassword").value;
    try {
      const data = await api("/api/register", { method: "POST", body: JSON.stringify({ name, email, password }) });
      setToken(data.token);
      me = data.user;
      enterApp();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  async function tryAutoLogin() {
    const token = getToken();
    if (!token) return showAuth();
    try {
      const data = await api("/api/me");
      me = data.user;
      enterApp();
    } catch (err) {
      clearToken();
      showAuth();
    }
  }

  function showAuth() {
    authScreen.style.display = "flex";
    appRoot.style.display = "none";
  }

  function enterApp() {
    authScreen.style.display = "none";
    appRoot.style.display = "block";
    refreshMeUi();
    document.getElementById("adminTabBtn").style.display = me.isAdmin ? "" : "none";
    loadFeed();
    loadNotifications();
    if (notifPollTimer) clearInterval(notifPollTimer);
    notifPollTimer = setInterval(loadNotifications, 15000);
  }

  function refreshMeUi() {
    setAvatarEl(document.getElementById("avatarBtn"), me);
    setAvatarEl(document.getElementById("composerAvatar"), me);
    setAvatarEl(document.getElementById("overviewAvatar"), me);
    document.getElementById("overviewName").innerHTML = escapeHtml(me.name) + (me.isAdmin ? `<span class="founder-crown">👑 Founder</span>` : "");
    document.getElementById("overviewEmail").textContent = me.email;
    document.getElementById("overviewBio").textContent = me.bio || "";
    loadMyFriendsCount();
  }

  async function loadMyFriendsCount() {
    try {
      const data = await api(`/api/users/${me.id}/friends`);
      document.getElementById("overviewFriendsCount").textContent = data.friends.length;
    } catch (err) { /* silent */ }
  }

  /* ---------------- Feed ---------------- */

  const feedEl = document.getElementById("feed");
  const postInput = document.getElementById("postInput");
  const publishBtn = document.getElementById("publishBtn");
  const chipsEl = document.getElementById("chips");

  async function loadFeed() {
    try {
      const data = await api("/api/posts");
      posts = data.posts;
      renderFeed();
      document.getElementById("overviewPostCount").textContent = posts.filter(p => p.author && p.author.id === me.id).length;
    } catch (err) {
      showToast(err.message);
    }
  }

  function renderChips() {
    chipsEl.innerHTML = "";
    if (pendingAttachment) {
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.innerHTML = `<span>${pendingAttachment.type === "photo" ? "📷" : "🎥"} ${escapeHtml(pendingAttachment.name)}</span><span class="x" data-clear="attachment">✕</span>`;
      chipsEl.appendChild(chip);
    }
    if (pendingLocation) {
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.innerHTML = `<span>📍 ${escapeHtml(pendingLocation)}</span><span class="x" data-clear="location">✕</span>`;
      chipsEl.appendChild(chip);
    }
    chipsEl.querySelectorAll("[data-clear]").forEach(el => {
      el.addEventListener("click", () => {
        if (el.dataset.clear === "attachment") pendingAttachment = null;
        if (el.dataset.clear === "location") pendingLocation = null;
        renderChips();
        updatePublishState();
      });
    });
    updatePublishState();
  }

  function updatePublishState() {
    const hasText = postInput.value.trim().length > 0;
    const hasImage = !!(pendingAttachment && pendingAttachment.dataUrl);
    publishBtn.disabled = !hasText && !hasImage;
  }

  document.getElementById("photoBtn").addEventListener("click", () => {
    document.getElementById("fileInput").setAttribute("data-kind", "photo");
    document.getElementById("fileInput").click();
  });
  document.getElementById("videoBtn").addEventListener("click", () => {
    document.getElementById("fileInput").setAttribute("data-kind", "video");
    document.getElementById("fileInput").click();
  });
  document.getElementById("fileInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const kind = e.target.getAttribute("data-kind") || "photo";
    e.target.value = "";

    if (kind === "video") {
      // Real video upload/streaming isn't supported yet — keep as a placeholder chip.
      pendingAttachment = { type: kind, name: file.name, dataUrl: null };
      renderChips();
      showToast("Відео додано як позначка (демо — без реального завантаження файлу)");
      return;
    }

    if (file.size > 6_000_000) {
      showToast("Фото занадто велике (максимум 6 МБ)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      pendingAttachment = { type: kind, name: file.name, dataUrl: reader.result };
      renderChips();
      showToast("Фото додано до поста");
    };
    reader.onerror = () => showToast("Не вдалося прочитати файл");
    reader.readAsDataURL(file);
  });
  document.getElementById("locationBtn").addEventListener("click", () => {
    const loc = prompt("Вкажіть місце:");
    if (loc && loc.trim()) {
      pendingLocation = loc.trim();
      renderChips();
    }
  });

  const EMOJIS = ["😀", "😂", "😍", "🤩", "🥳", "😊", "👍", "❤️", "🔥", "🚀", "🙌", "💜", "🤔", "😎", "🙏", "✈️", "🌍", "📍"];
  const emojiPicker = document.getElementById("emojiPicker");
  EMOJIS.forEach(e => {
    const span = document.createElement("span");
    span.textContent = e;
    span.addEventListener("click", (ev) => {
      ev.stopPropagation();
      postInput.value += e;
      postInput.dispatchEvent(new Event("input"));
      postInput.focus();
    });
    emojiPicker.appendChild(span);
  });
  document.getElementById("emojiBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    emojiPicker.classList.toggle("open");
  });

  function renderFeed() {
    feedEl.innerHTML = "";
    posts.forEach(post => {
      const card = document.createElement("div");
      card.className = "card";
      const isMine = post.author && post.author.id === me.id;
      const canDelete = isMine || me.isAdmin;
      card.innerHTML = `
        <div class="post-header">
          <div class="${post.author ? 'clickable-user' : ''}" data-open-profile="${post.author ? post.author.id : ''}">${avatarHtml(post.author)}</div>
          <div class="post-author ${post.author ? 'clickable-user' : ''}" data-open-profile="${post.author ? post.author.id : ''}">
            <span class="post-name">${escapeHtml(post.author ? post.author.name : "Користувач видалений")}</span>${post.author && post.author.isAdmin ? `<span class="founder-crown">👑 Founder</span>` : ""}
            <div class="post-time">${timeAgo(post.createdAt)}</div>
          </div>
          <div class="post-menu-wrap">
            <div class="post-menu" data-menu-id="${post.id}">⋯</div>
            <div class="post-dropdown" id="menu-${post.id}">
              ${canDelete
                ? `<div class="dropdown-item danger" data-act="delete" data-id="${post.id}">${ICONS.trash} Видалити пост</div>`
                : `<div class="dropdown-item danger" data-act="report" data-id="${post.id}">${ICONS.warning} Поскаржитися</div>`}
            </div>
          </div>
        </div>
        ${post.text ? `<div class="post-text">${escapeHtml(post.text)}</div>` : ""}
        ${post.imageUrl ? `<img src="${escapeHtml(post.imageUrl)}" class="post-image" alt="Фото до поста">` : ""}
        <div class="post-actions">
          <div class="action like-action ${post.likedByMe ? "liked" : ""}" data-id="${post.id}">
            <span>${post.likedByMe ? ICONS.heartFill : ICONS.heart}</span><span class="like-count">${post.likeCount}</span>
          </div>
          <div class="action comment-action" data-id="${post.id}"><span>${ICONS.comment}</span><span>${post.commentCount}</span></div>
        </div>
        <div class="comments-section ${openCommentId === post.id ? "open" : ""}" id="comments-${post.id}">
          <div class="comment-list" id="comment-list-${post.id}"><div class="comment-empty">Завантаження...</div></div>
          <div class="comment-input-row">
            ${avatarHtml(me, "sm")}
            <input type="text" placeholder="Написати коментар..." data-comment-input="${post.id}">
            <button class="comment-send" data-comment-send="${post.id}">➤</button>
          </div>
        </div>
      `;
      feedEl.appendChild(card);
    });

    feedEl.querySelectorAll("[data-open-profile]").forEach(el => {
      if (!el.dataset.openProfile) return;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        openProfile(parseInt(el.dataset.openProfile, 10));
      });
    });
    feedEl.querySelectorAll(".like-action").forEach(el => {
      el.addEventListener("click", () => toggleLike(parseInt(el.dataset.id, 10)));
    });
    feedEl.querySelectorAll(".comment-action").forEach(el => {
      el.addEventListener("click", () => {
        const id = parseInt(el.dataset.id, 10);
        openCommentId = (openCommentId === id) ? null : id;
        renderFeed();
        if (openCommentId === id) loadComments(id);
      });
    });
    feedEl.querySelectorAll(".post-menu").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = parseInt(el.dataset.menuId, 10);
        openMenuId = (openMenuId === id) ? null : id;
        document.querySelectorAll(".post-dropdown").forEach(d => d.classList.remove("open"));
        if (openMenuId !== null) {
          const d = document.getElementById("menu-" + openMenuId);
          if (d) d.classList.add("open");
        }
      });
    });
    feedEl.querySelectorAll("[data-act]").forEach(el => {
      el.addEventListener("click", async () => {
        const id = parseInt(el.dataset.id, 10);
        const act = el.dataset.act;
        if (act === "delete") {
          if (confirm("Видалити цей пост?")) {
            try {
              await api(`/api/posts/${id}`, { method: "DELETE" });
              showToast("Пост видалено");
              loadFeed();
            } catch (err) { showToast(err.message); }
          }
        } else if (act === "report") {
          showToast("Дякуємо за скаргу. Ми перевіримо цей пост.");
        }
        openMenuId = null;
      });
    });
    feedEl.querySelectorAll("[data-comment-send]").forEach(btn => {
      btn.addEventListener("click", () => submitComment(parseInt(btn.dataset.commentSend, 10)));
    });
    feedEl.querySelectorAll("[data-comment-input]").forEach(input => {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submitComment(parseInt(input.dataset.commentInput, 10));
      });
    });

    if (openCommentId !== null) loadComments(openCommentId);
  }

  async function loadComments(postId) {
    const listEl = document.getElementById(`comment-list-${postId}`);
    if (!listEl) return;
    try {
      const data = await api(`/api/posts/${postId}/comments`);
      if (!data.comments.length) {
        listEl.innerHTML = `<div class="comment-empty">Поки немає коментарів. Будьте першим!</div>`;
        return;
      }
      listEl.innerHTML = data.comments.map(c => `
        <div class="comment-item">
          <div class="clickable-user" data-open-profile="${c.author ? c.author.id : ''}">${avatarHtml(c.author, "sm")}</div>
          <div class="comment-bubble">
            <span class="comment-author clickable-user" data-open-profile="${c.author ? c.author.id : ''}">${escapeHtml(c.author ? c.author.name : "Користувач")}</span>${escapeHtml(c.text)}
            <div class="comment-time">${timeAgo(c.createdAt)}</div>
          </div>
        </div>
      `).join("");
      listEl.querySelectorAll("[data-open-profile]").forEach(el => {
        if (!el.dataset.openProfile) return;
        el.addEventListener("click", (e) => { e.stopPropagation(); openProfile(parseInt(el.dataset.openProfile, 10)); });
      });
    } catch (err) {
      listEl.innerHTML = `<div class="comment-empty">Не вдалося завантажити коментарі</div>`;
    }
  }

  async function submitComment(postId) {
    const input = feedEl.querySelector(`[data-comment-input="${postId}"]`);
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    try {
      await api(`/api/posts/${postId}/comments`, { method: "POST", body: JSON.stringify({ text }) });
      input.value = "";
      await loadFeed();
      openCommentId = postId;
      renderFeed();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function toggleLike(id) {
    try {
      await api(`/api/posts/${id}/like`, { method: "POST" });
      await loadFeed();
    } catch (err) {
      showToast(err.message);
    }
  }

  postInput.addEventListener("input", () => {
    updatePublishState();
    postInput.style.height = "auto";
    postInput.style.height = postInput.scrollHeight + "px";
  });

  publishBtn.addEventListener("click", async () => {
    let text = postInput.value.trim();
    if (!text && !(pendingAttachment && pendingAttachment.dataUrl)) return;
    if (pendingLocation) text += (text ? "\n" : "") + "📍 " + pendingLocation;
    if (pendingAttachment && !pendingAttachment.dataUrl) {
      // video placeholder — no real upload yet
      text += (text ? "\n" : "") + "🎥 " + pendingAttachment.name;
    }
    const payload = { text };
    if (pendingAttachment && pendingAttachment.dataUrl) {
      payload.image = pendingAttachment.dataUrl;
    }
    try {
      await api("/api/posts", { method: "POST", body: JSON.stringify(payload) });
      postInput.value = "";
      postInput.style.height = "auto";
      publishBtn.disabled = true;
      pendingAttachment = null;
      pendingLocation = null;
      renderChips();
      await loadFeed();
      showToast("Пост опубліковано");
    } catch (err) {
      showToast(err.message);
    }
  });

  /* ---------------- Nav tabs / views ---------------- */

  const viewMap = { feed: "view-feed", overview: "view-overview", profile: "view-profile", notifications: "view-notifications", messages: "view-messages", admin: "view-admin" };

  function switchTab(tabName) {
    document.querySelectorAll(".tab, .bn-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tabName));
    Object.values(viewMap).forEach(id => document.getElementById(id).classList.remove("active"));
    const viewId = viewMap[tabName];
    if (viewId) document.getElementById(viewId).classList.add("active");
    if (tabName === "notifications") { markNotificationsRead(); loadFullNotifications(); loadFriendRequests(); }
    if (tabName === "messages") { loadConversations(); document.getElementById("messagesLayout").classList.remove("chat-open"); }
    if (tabName === "admin") loadAdminPanel();
    if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
  }

  document.querySelectorAll(".tab, .bn-tab").forEach(tab => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  /* ---------------- Admin panel ---------------- */

  async function loadAdminPanel() {
    try {
      const statsData = await api("/api/admin/stats");
      document.getElementById("adminUserCount").textContent = statsData.stats.userCount;
      document.getElementById("adminPostCount").textContent = statsData.stats.postCount;
      document.getElementById("adminCommentCount").textContent = statsData.stats.commentCount;
      document.getElementById("adminMessageCount").textContent = statsData.stats.messageCount;

      const usersData = await api("/api/admin/users");
      const listEl = document.getElementById("adminUserList");
      listEl.innerHTML = usersData.users.map(u => `
        <div class="conv-item" style="cursor:default;">
          ${avatarHtml(u, "sm")}
          <div style="flex:1;">
            <div class="conv-name">${escapeHtml(u.name)}${u.isAdmin ? `<span class="founder-crown">👑 Founder</span>` : ""}</div>
            <div class="conv-preview">${escapeHtml(u.email)}</div>
          </div>
          ${u.id !== me.id ? `<div class="dropdown-item danger" style="cursor:pointer;" data-admin-del-user="${u.id}">🗑 Видалити</div>` : ""}
        </div>
      `).join("");
      listEl.querySelectorAll("[data-admin-del-user]").forEach(btn => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.adminDelUser;
          if (!confirm("Видалити цього користувача та весь його контент?")) return;
          try {
            await api(`/api/admin/users/${id}`, { method: "DELETE" });
            showToast("Користувача видалено");
            loadAdminPanel();
          } catch (err) { showToast(err.message); }
        });
      });
    } catch (err) {
      showToast(err.message);
    }
  }

  document.getElementById("logoBtn").addEventListener("click", () => switchTab("feed"));

  /* ---------------- Bell & avatar dropdowns ---------------- */

  const bellDropdown = document.getElementById("bellDropdown");
  const avatarDropdown = document.getElementById("avatarDropdown");

  document.getElementById("bellBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    avatarDropdown.classList.remove("open");
    bellDropdown.classList.toggle("open");
    if (bellDropdown.classList.contains("open")) markNotificationsRead();
  });
  document.getElementById("avatarBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    bellDropdown.classList.remove("open");
    avatarDropdown.classList.toggle("open");
  });
  avatarDropdown.querySelectorAll(".dropdown-item").forEach(item => {
    item.addEventListener("click", () => {
      const act = item.dataset.action;
      if (act === "profile") switchTab("overview");
      if (act === "settings") openSettingsModal();
      if (act === "logout") {
        clearToken();
        me = null;
        if (notifPollTimer) { clearInterval(notifPollTimer); notifPollTimer = null; }
        showAuth();
      }
      avatarDropdown.classList.remove("open");
    });
  });

  document.addEventListener("click", () => {
    bellDropdown.classList.remove("open");
    avatarDropdown.classList.remove("open");
    emojiPicker.classList.remove("open");
    document.querySelectorAll(".post-dropdown").forEach(d => d.classList.remove("open"));
    document.getElementById("searchResults").classList.remove("open");
    openMenuId = null;
  });

  /* ---------------- Profiles ---------------- */

  async function openProfile(userId) {
    if (!userId) return;
    if (userId === me.id) { switchTab("overview"); return; }
    viewedProfileId = userId;
    Object.values(viewMap).forEach(id => document.getElementById(id).classList.remove("active"));
    document.querySelectorAll(".tab, .bn-tab").forEach(t => t.classList.remove("active"));
    document.getElementById("view-profile").classList.add("active");
    document.getElementById("profileName").textContent = "Завантаження...";
    document.getElementById("profileBio").textContent = "";
    document.getElementById("profilePosts").innerHTML = "";
    try {
      const data = await api(`/api/users/${userId}`);
      const u = data.user;
      setAvatarEl(document.getElementById("profileAvatar"), u);
      document.getElementById("profileName").innerHTML = escapeHtml(u.name) + (u.isAdmin ? `<span class="founder-crown">👑 Founder</span>` : "");
      document.getElementById("profileMeta").textContent = u.email;
      document.getElementById("profileBio").textContent = u.bio || "";
      document.getElementById("profilePostCount").textContent = u.postCount || 0;
      document.getElementById("profileFriendsCount").textContent = u.friendsCount || 0;
      renderFriendActions(userId, u.friendStatus);
      const postsData = await api(`/api/users/${userId}/posts`);
      const container = document.getElementById("profilePosts");
      if (!postsData.posts.length) {
        container.innerHTML = `<div class="placeholder-card"><div class="big">📭</div>Поки немає постів</div>`;
        return;
      }
      container.innerHTML = postsData.posts.map(p => `
        <div class="card">
          <div class="post-text">${escapeHtml(p.text)}</div>
          ${p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" class="post-image" alt="">` : ""}
          <div class="post-actions">
            <div class="action ${p.likedByMe ? "liked" : ""}"><span>${p.likedByMe ? ICONS.heartFill : ICONS.heart}</span><span>${p.likeCount}</span></div>
            <div class="action"><span>${ICONS.comment}</span><span>${p.commentCount}</span></div>
          </div>
        </div>
      `).join("");
    } catch (err) {
      showToast(err.message);
    }
  }

  document.getElementById("profileBackLink").addEventListener("click", () => switchTab("feed"));

  /* ---------------- Friends ---------------- */

  function renderFriendActions(userId, status) {
    const el = document.getElementById("profileFriendActions");
    if (!el) return;
    let html = "";
    if (status === "friends") {
      html = `<button class="friend-btn remove" data-friend-act="remove">✓ Друзі — видалити</button>`;
    } else if (status === "request_sent") {
      html = `<button class="friend-btn pending" data-friend-act="cancel">⏳ Запит надіслано — скасувати</button>`;
    } else if (status === "request_received") {
      html = `<button class="friend-btn accept" data-friend-act="accept">✓ Прийняти запит</button><button class="friend-btn decline" data-friend-act="decline">✕ Відхилити</button>`;
    } else {
      html = `<button class="friend-btn add" data-friend-act="add">+ Додати в друзі</button>`;
    }
    el.innerHTML = html;
    el.querySelectorAll("[data-friend-act]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const act = btn.dataset.friendAct;
        try {
          if (act === "add") await api(`/api/friends/${userId}/request`, { method: "POST" });
          else if (act === "cancel" || act === "remove") await api(`/api/friends/${userId}`, { method: "DELETE" });
          else if (act === "accept") await api(`/api/friends/${userId}/accept`, { method: "POST" });
          else if (act === "decline") await api(`/api/friends/${userId}/decline`, { method: "POST" });
          showToast("Готово");
          openProfile(userId);
        } catch (err) { showToast(err.message); }
      });
    });
  }

  async function loadFriendRequests() {
    try {
      const data = await api("/api/friends/requests");
      const card = document.getElementById("friendRequestsCard");
      const listEl = document.getElementById("friendRequestsList");
      if (!data.requests.length) {
        card.style.display = "none";
        return;
      }
      card.style.display = "";
      listEl.innerHTML = data.requests.map(r => `
        <div class="friend-req-item">
          <div class="clickable-user" data-open-profile="${r.from.id}">${avatarHtml(r.from, "sm")}</div>
          <div class="friend-req-name clickable-user" data-open-profile="${r.from.id}">${escapeHtml(r.from.name)}</div>
          <div class="friend-req-actions">
            <button class="acc" data-fr-accept="${r.from.id}">Прийняти</button>
            <button class="dec" data-fr-decline="${r.from.id}">Відхилити</button>
          </div>
        </div>
      `).join("");
      listEl.querySelectorAll("[data-open-profile]").forEach(el => {
        el.addEventListener("click", () => openProfile(parseInt(el.dataset.openProfile, 10)));
      });
      listEl.querySelectorAll("[data-fr-accept]").forEach(btn => {
        btn.addEventListener("click", async () => {
          try { await api(`/api/friends/${btn.dataset.frAccept}/accept`, { method: "POST" }); showToast("Тепер ви друзі"); loadFriendRequests(); }
          catch (err) { showToast(err.message); }
        });
      });
      listEl.querySelectorAll("[data-fr-decline]").forEach(btn => {
        btn.addEventListener("click", async () => {
          try { await api(`/api/friends/${btn.dataset.frDecline}/decline`, { method: "POST" }); loadFriendRequests(); }
          catch (err) { showToast(err.message); }
        });
      });
    } catch (err) { /* silent */ }
  }

  /* ---------------- Settings modal ---------------- */

  const settingsModal = document.getElementById("settingsModal");
  let pendingAvatarDataUrl = null;

  function openSettingsModal() {
    document.getElementById("settingsName").value = me.name;
    document.getElementById("settingsBio").value = me.bio || "";
    setAvatarEl(document.getElementById("settingsAvatarPreview"), me);
    pendingAvatarDataUrl = null;
    refreshVerifyUi();
    settingsModal.classList.add("open");
  }

  function refreshVerifyUi() {
    const badge = document.getElementById("verifyBadge");
    const sendBtn = document.getElementById("verifySendBtn");
    document.getElementById("verifyCodeRow").classList.remove("open");
    document.getElementById("verifyHint").textContent = "";
    document.getElementById("verifyCodeInput").value = "";
    if (me.emailVerified) {
      badge.textContent = "Підтверджено";
      badge.className = "verify-badge yes";
      sendBtn.style.display = "none";
    } else {
      badge.textContent = "Не підтверджено";
      badge.className = "verify-badge no";
      sendBtn.style.display = "";
      sendBtn.textContent = "Підтвердити";
    }
  }

  document.getElementById("verifySendBtn").addEventListener("click", async () => {
    try {
      const data = await api("/api/me/send-verification", { method: "POST" });
      document.getElementById("verifyCodeRow").classList.add("open");
      document.getElementById("verifyHint").textContent = `Демо-режим (без реальної пошти): ваш код — ${data.code}`;
      showToast("Код підтвердження згенеровано");
    } catch (err) { showToast(err.message); }
  });
  document.getElementById("verifyConfirmBtn").addEventListener("click", async () => {
    const code = document.getElementById("verifyCodeInput").value.trim();
    if (!code) return;
    try {
      const data = await api("/api/me/verify-email", { method: "POST", body: JSON.stringify({ code }) });
      me = data.user;
      refreshVerifyUi();
      showToast("Email підтверджено!");
    } catch (err) { showToast(err.message); }
  });
  document.getElementById("settingsCancelBtn").addEventListener("click", () => settingsModal.classList.remove("open"));
  document.getElementById("changePhotoBtn").addEventListener("click", () => document.getElementById("avatarFileInput").click());
  document.getElementById("avatarFileInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 6_000_000) { showToast("Фото занадто велике (максимум 6 МБ)"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      pendingAvatarDataUrl = reader.result;
      const preview = document.getElementById("settingsAvatarPreview");
      preview.innerHTML = "";
      const img = document.createElement("img");
      img.src = pendingAvatarDataUrl;
      img.style.width = "100%"; img.style.height = "100%"; img.style.objectFit = "cover"; img.style.borderRadius = "50%";
      preview.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
  document.getElementById("settingsSaveBtn").addEventListener("click", async () => {
    const name = document.getElementById("settingsName").value.trim();
    const bio = document.getElementById("settingsBio").value.trim();
    if (!name) { showToast("Ім'я не може бути порожнім"); return; }
    const payload = { name, bio };
    if (pendingAvatarDataUrl) payload.avatar = pendingAvatarDataUrl;
    try {
      const data = await api("/api/me", { method: "PUT", body: JSON.stringify(payload) });
      me = data.user;
      refreshMeUi();
      settingsModal.classList.remove("open");
      showToast("Профіль оновлено");
      loadFeed();
    } catch (err) {
      showToast(err.message);
    }
  });

  /* ---------------- Notifications ---------------- */

  function notifText(n) {
    const name = n.actor ? n.actor.name : "Хтось";
    if (n.type === "like") return `<b>${escapeHtml(name)}</b> вподобав(ла) ваш пост`;
    if (n.type === "comment") return `<b>${escapeHtml(name)}</b> прокоментував(ла) ваш пост`;
    if (n.type === "friend_request") return `<b>${escapeHtml(name)}</b> надіслав(ла) запит у друзі`;
    if (n.type === "friend_accept") return `<b>${escapeHtml(name)}</b> прийняв(ла) ваш запит у друзі`;
    return `<b>${escapeHtml(name)}</b> взаємодіяв(ла) з вашим контентом`;
  }
  function notifIcon(n) { return n.type === "like" ? ICONS.heartFill : n.type === "comment" ? ICONS.comment : (n.type === "friend_request" || n.type === "friend_accept") ? ICONS.handshake : ICONS.bell; }

  async function loadNotifications() {
    if (!me) return;
    try {
      const data = await api("/api/notifications");
      const dot = !!data.unreadCount;
      document.getElementById("bellDot").classList.toggle("hidden", !dot);
      document.getElementById("bnDot").classList.toggle("show", dot);
      const listEl = document.getElementById("bellNotifList");
      if (!data.notifications.length) {
        listEl.innerHTML = `<div class="notif-list-empty">Тут з'являтимуться лайки, коментарі та підписки.</div>`;
        return;
      }
      listEl.innerHTML = data.notifications.slice(0, 8).map(n => `
        <div class="notif-item clickable" data-open-profile="${n.actor ? n.actor.id : ''}">
          <span class="nf-icon">${notifIcon(n)}</span>${notifText(n)}
          <div class="notif-time">${timeAgo(n.createdAt)}</div>
        </div>
      `).join("");
      listEl.querySelectorAll("[data-open-profile]").forEach(el => {
        el.addEventListener("click", (e) => { e.stopPropagation(); bellDropdown.classList.remove("open"); openProfile(parseInt(el.dataset.openProfile, 10)); });
      });
    } catch (err) { /* silent */ }
  }

  async function loadFullNotifications() {
    try {
      const data = await api("/api/notifications");
      const container = document.getElementById("fullNotifList");
      if (!data.notifications.length) {
        container.innerHTML = `<div class="placeholder-card"><div class="big">🔔</div>Сповіщення про лайки, коментарі та підписки з'являться тут.</div>`;
        return;
      }
      container.innerHTML = data.notifications.map(n => `
        <div class="notif-item clickable" data-open-profile="${n.actor ? n.actor.id : ''}">
          <span class="nf-icon">${notifIcon(n)}</span>${notifText(n)}
          <div class="notif-time">${timeAgo(n.createdAt)}</div>
        </div>
      `).join("");
      container.querySelectorAll("[data-open-profile]").forEach(el => {
        el.addEventListener("click", () => openProfile(parseInt(el.dataset.openProfile, 10)));
      });
    } catch (err) { showToast(err.message); }
  }

  async function markNotificationsRead() {
    document.getElementById("bellDot").classList.add("hidden");
    document.getElementById("bnDot").classList.remove("show");
    try { await api("/api/notifications/read", { method: "POST" }); } catch (e) { /* silent */ }
  }

  /* ---------------- User search ---------------- */

  const userSearchInput = document.getElementById("userSearchInput");
  const searchResultsEl = document.getElementById("searchResults");
  userSearchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    const q = userSearchInput.value.trim();
    if (!q) { searchResultsEl.classList.remove("open"); return; }
    searchDebounce = setTimeout(async () => {
      try {
        const data = await api(`/api/users?q=${encodeURIComponent(q)}`);
        if (!data.users.length) {
          searchResultsEl.innerHTML = `<div class="notif-list-empty">Нікого не знайдено</div>`;
        } else {
          searchResultsEl.innerHTML = data.users.map(u => `
            <div class="user-pick-item" data-open-profile="${u.id}">
              ${avatarHtml(u, "sm")}
              <div>
                <div class="conv-name">${escapeHtml(u.name)}${u.isAdmin ? `<span class="founder-crown">👑 Founder</span>` : ""}</div>
                <div class="conv-preview">${escapeHtml(u.email)}</div>
              </div>
            </div>
          `).join("");
          searchResultsEl.querySelectorAll("[data-open-profile]").forEach(el => {
            el.addEventListener("click", () => {
              openProfile(parseInt(el.dataset.openProfile, 10));
              searchResultsEl.classList.remove("open");
              userSearchInput.value = "";
            });
          });
        }
        searchResultsEl.classList.add("open");
      } catch (err) { /* silent */ }
    }, 300);
  });
  userSearchInput.addEventListener("click", (e) => e.stopPropagation());

  /* ---------------- Messages ---------------- */

  const convListEl = document.getElementById("convList");
  const chatPlaceholder = document.getElementById("chatPlaceholder");
  const chatActive = document.getElementById("chatActive");
  const chatMessagesEl = document.getElementById("chatMessages");

  async function loadConversations(q) {
    try {
      const data = await api(`/api/conversations${q ? "?q=" + encodeURIComponent(q) : ""}`);
      lastConversations = data.conversations;
      convListEl.innerHTML = "";
      if (!data.conversations.length) {
        convListEl.innerHTML = `<div class="comment-empty" style="padding:12px;">Немає розмов. Натисніть "+ Нове".</div>`;
        return;
      }
      data.conversations.forEach(c => {
        const item = document.createElement("div");
        item.className = "conv-item" + (activeConvUserId === c.user.id ? " active" : "");
        item.innerHTML = `
          ${avatarHtml(c.user, "sm")}
          <div>
            <div class="conv-name">${escapeHtml(c.user.name)}</div>
            <div class="conv-preview">${c.lastMessage.fromMe ? "Ви: " : ""}${escapeHtml(c.lastMessage.text)}</div>
          </div>
        `;
        item.addEventListener("click", () => openChat(c.user));
        convListEl.appendChild(item);
      });
    } catch (err) {
      showToast(err.message);
    }
  }

  document.getElementById("convSearchInput").addEventListener("input", (e) => {
    loadConversations(e.target.value.trim());
  });

  function openChat(user) {
    activeConvUserId = user.id;
    activeConvUser = user;
    chatPlaceholder.style.display = "none";
    chatActive.style.display = "flex";
    setAvatarEl(document.getElementById("chatAvatar"), user);
    document.getElementById("chatName").textContent = user.name;
    document.getElementById("messagesLayout").classList.add("chat-open");
    clearPendingChatImage();
    chatViewOnceOn = false;
    document.getElementById("chatViewOnceBtn").classList.remove("active");
    loadConversations();
    loadMessages();
    if (chatPollTimer) clearInterval(chatPollTimer);
    chatPollTimer = setInterval(loadMessages, 4000);
  }

  document.getElementById("chatBackBtn").addEventListener("click", () => {
    document.getElementById("messagesLayout").classList.remove("chat-open");
  });

  function renderMessageBubble(m) {
    if (m.viewOnceConsumed) {
      return `<div class="view-once-gone">${ICONS.fire} Фото переглянуто</div>`;
    }
    let inner = "";
    if (m.imageUrl) {
      inner += `<img src="${escapeHtml(m.imageUrl)}" class="msg-image" alt="">`;
      if (m.viewOnce) inner += `<div class="view-once-tag">${ICONS.fire} Перегляд один раз</div>`;
    }
    if (m.text) inner += `<div${m.imageUrl ? ' style="margin-top:6px;"' : ''}>${escapeHtml(m.text)}</div>`;
    const bubbleClass = "msg-bubble " + (m.fromMe ? "mine" : "theirs") + (m.imageUrl && !m.text ? " image-bubble" : "");
    return `<div class="${bubbleClass}">${inner}</div>`;
  }

  async function loadMessages() {
    if (!activeConvUserId) return;
    try {
      const data = await api(`/api/messages/${activeConvUserId}`);
      chatMessagesEl.innerHTML = data.messages.map(renderMessageBubble).join("");
      chatMessagesEl.querySelectorAll(".msg-image").forEach(img => {
        img.addEventListener("click", () => window.open(img.src, "_blank"));
      });
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    } catch (err) {
      // silent fail on poll
    }
  }

  document.getElementById("chatSendBtn").addEventListener("click", sendChatMessage);
  document.getElementById("chatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChatMessage();
  });

  document.getElementById("chatPhotoBtn").addEventListener("click", () => document.getElementById("chatFileInput").click());
  document.getElementById("chatFileInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 6_000_000) { showToast("Фото занадто велике (максимум 6 МБ)"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      pendingChatImage = reader.result;
      const preview = document.getElementById("pendingImagePreview");
      preview.style.display = "flex";
      document.getElementById("pendingImagePreviewImg").src = pendingChatImage;
      document.getElementById("pendingImageLabel").textContent = chatViewOnceOn ? "🔥 Перегляд один раз" : "Фото готове до відправки";
    };
    reader.readAsDataURL(file);
  });
  document.getElementById("pendingImageClear").addEventListener("click", clearPendingChatImage);
  function clearPendingChatImage() {
    pendingChatImage = null;
    document.getElementById("pendingImagePreview").style.display = "none";
  }
  document.getElementById("chatViewOnceBtn").addEventListener("click", () => {
    chatViewOnceOn = !chatViewOnceOn;
    document.getElementById("chatViewOnceBtn").classList.toggle("active", chatViewOnceOn);
    if (pendingChatImage) document.getElementById("pendingImageLabel").textContent = chatViewOnceOn ? "🔥 Перегляд один раз" : "Фото готове до відправки";
    showToast(chatViewOnceOn ? "Наступне фото зникне після перегляду" : "Режим одного перегляду вимкнено");
  });

  async function sendChatMessage() {
    const input = document.getElementById("chatInput");
    const text = input.value.trim();
    if ((!text && !pendingChatImage) || !activeConvUserId) return;
    const payload = { text };
    if (pendingChatImage) { payload.image = pendingChatImage; payload.viewOnce = chatViewOnceOn; }
    try {
      await api(`/api/messages/${activeConvUserId}`, { method: "POST", body: JSON.stringify(payload) });
      input.value = "";
      clearPendingChatImage();
      chatViewOnceOn = false;
      document.getElementById("chatViewOnceBtn").classList.remove("active");
      await loadMessages();
      await loadConversations();
    } catch (err) {
      showToast(err.message);
    }
  }

  document.getElementById("newMsgBtn").addEventListener("click", async () => {
    try {
      const data = await api("/api/users");
      if (!data.users.length) {
        showToast("Поки немає інших користувачів TourLife");
        return;
      }
      const names = data.users.map((u, i) => `${i + 1}. ${u.name} (${u.email})`).join("\n");
      const choice = prompt("Кому написати? Введіть номер:\n" + names);
      const idx = parseInt(choice, 10) - 1;
      if (idx >= 0 && idx < data.users.length) {
        openChat(data.users[idx]);
      }
    } catch (err) {
      showToast(err.message);
    }
  });

  renderChips();
  tryAutoLogin();
})();
