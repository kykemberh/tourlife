(function () {
  const TOKEN_KEY = "tourlife_token";

  let me = null;
  let posts = [];
  let openCommentId = null;
  let openMenuId = null;
  let pendingAttachment = null;
  let pendingLocation = null;
  let activeConvUserId = null;
  let chatPollTimer = null;

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

  function timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return "Щойно";
    if (diff < 3600) return Math.floor(diff / 60) + " хв тому";
    if (diff < 86400) return Math.floor(diff / 3600) + " год тому";
    return Math.floor(diff / 86400) + " дн тому";
  }

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
    document.getElementById("avatarBtn").textContent = initials(me.name);
    document.getElementById("avatarBtn").style.background = me.avatarColor;
    document.getElementById("composerAvatar").textContent = initials(me.name);
    document.getElementById("composerAvatar").style.background = me.avatarColor;
    document.getElementById("overviewAvatar").textContent = initials(me.name);
    document.getElementById("overviewAvatar").style.background = me.avatarColor;
    document.getElementById("overviewName").textContent = me.name;
    document.getElementById("overviewEmail").textContent = me.email;
    document.getElementById("adminTabBtn").style.display = me.isAdmin ? "" : "none";
    loadFeed();
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
      });
    });
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
    pendingAttachment = { type: kind, name: file.name };
    renderChips();
    showToast((kind === "photo" ? "Фото" : "Відео") + " додано до поста (демо — без реального завантаження файлу)");
    e.target.value = "";
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
          <div class="avatar" style="background:${post.author ? post.author.avatarColor : '#999'}">${post.author ? post.author.initials : "?"}</div>
          <div class="post-author">
            <span class="post-name">${escapeHtml(post.author ? post.author.name : "Користувач видалений")}</span>${post.author && post.author.isAdmin ? `<span class="founder-tag">✦ Founder</span>` : ""}
            <div class="post-time">${timeAgo(post.createdAt)}</div>
          </div>
          <div class="post-menu-wrap">
            <div class="post-menu" data-menu-id="${post.id}">⋯</div>
            <div class="post-dropdown" id="menu-${post.id}">
              ${canDelete
                ? `<div class="dropdown-item danger" data-act="delete" data-id="${post.id}">🗑 Видалити пост</div>`
                : `<div class="dropdown-item danger" data-act="report" data-id="${post.id}">⚠️ Поскаржитися</div>`}
            </div>
          </div>
        </div>
        <div class="post-text">${escapeHtml(post.text)}</div>
        <div class="post-actions">
          <div class="action like-action ${post.likedByMe ? "liked" : ""}" data-id="${post.id}">
            <span>${post.likedByMe ? "❤️" : "🤍"}</span><span class="like-count">${post.likeCount}</span>
          </div>
          <div class="action comment-action" data-id="${post.id}"><span>💬</span><span>${post.commentCount}</span></div>
        </div>
        <div class="comments-section ${openCommentId === post.id ? "open" : ""}" id="comments-${post.id}">
          <div class="comment-list" id="comment-list-${post.id}"><div class="comment-empty">Завантаження...</div></div>
          <div class="comment-input-row">
            <div class="avatar sm" style="background:${me.avatarColor}">${initials(me.name)}</div>
            <input type="text" placeholder="Написати коментар..." data-comment-input="${post.id}">
            <button class="comment-send" data-comment-send="${post.id}">➤</button>
          </div>
        </div>
      `;
      feedEl.appendChild(card);
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
          <div class="avatar sm" style="background:${c.author ? c.author.avatarColor : '#999'}">${c.author ? c.author.initials : "?"}</div>
          <div class="comment-bubble">
            <span class="comment-author">${escapeHtml(c.author ? c.author.name : "Користувач")}</span>${escapeHtml(c.text)}
            <div class="comment-time">${timeAgo(c.createdAt)}</div>
          </div>
        </div>
      `).join("");
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
    publishBtn.disabled = postInput.value.trim().length === 0;
    postInput.style.height = "auto";
    postInput.style.height = postInput.scrollHeight + "px";
  });

  publishBtn.addEventListener("click", async () => {
    let text = postInput.value.trim();
    if (!text) return;
    if (pendingLocation) text += "\n📍 " + pendingLocation;
    if (pendingAttachment) text += "\n" + (pendingAttachment.type === "photo" ? "📷" : "🎥") + " " + pendingAttachment.name;
    try {
      await api("/api/posts", { method: "POST", body: JSON.stringify({ text }) });
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

  const viewMap = { feed: "view-feed", overview: "view-overview", notifications: "view-notifications", messages: "view-messages", admin: "view-admin" };
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      Object.values(viewMap).forEach(id => document.getElementById(id).classList.remove("active"));
      document.getElementById(viewMap[tab.dataset.tab]).classList.add("active");
      if (tab.dataset.tab === "notifications") document.getElementById("bellDot").classList.add("hidden");
      if (tab.dataset.tab === "messages") loadConversations();
      if (tab.dataset.tab === "admin") loadAdminPanel();
      if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
    });
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
          <div class="avatar sm" style="background:${u.avatarColor}">${initials(u.name)}</div>
          <div style="flex:1;">
            <div class="conv-name">${escapeHtml(u.name)}${u.isAdmin ? `<span class="founder-tag">✦ Founder</span>` : ""}</div>
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

  document.getElementById("logoBtn").addEventListener("click", () => {
    document.querySelector('.tab[data-tab="feed"]').click();
  });

  /* ---------------- Bell & avatar dropdowns ---------------- */

  const bellDropdown = document.getElementById("bellDropdown");
  const avatarDropdown = document.getElementById("avatarDropdown");

  document.getElementById("bellBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    avatarDropdown.classList.remove("open");
    bellDropdown.classList.toggle("open");
    document.getElementById("bellDot").classList.add("hidden");
  });
  document.getElementById("avatarBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    bellDropdown.classList.remove("open");
    avatarDropdown.classList.toggle("open");
  });
  avatarDropdown.querySelectorAll(".dropdown-item").forEach(item => {
    item.addEventListener("click", () => {
      const act = item.dataset.action;
      if (act === "profile") document.querySelector('.tab[data-tab="overview"]').click();
      if (act === "settings") showToast("Налаштування поки в розробці");
      if (act === "logout") {
        clearToken();
        me = null;
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
    openMenuId = null;
  });

  /* ---------------- Messages ---------------- */

  const convListEl = document.getElementById("convList");
  const chatPlaceholder = document.getElementById("chatPlaceholder");
  const chatActive = document.getElementById("chatActive");
  const chatMessagesEl = document.getElementById("chatMessages");

  async function loadConversations() {
    try {
      const data = await api("/api/conversations");
      convListEl.innerHTML = "";
      if (!data.conversations.length) {
        convListEl.innerHTML = `<div class="comment-empty" style="padding:12px;">Немає розмов. Натисніть "+ Нове".</div>`;
        return;
      }
      data.conversations.forEach(c => {
        const item = document.createElement("div");
        item.className = "conv-item" + (activeConvUserId === c.user.id ? " active" : "");
        item.innerHTML = `
          <div class="avatar sm" style="background:${c.user.avatarColor}">${c.user.initials}</div>
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

  function openChat(user) {
    activeConvUserId = user.id;
    chatPlaceholder.style.display = "none";
    chatActive.style.display = "flex";
    document.getElementById("chatAvatar").textContent = user.initials;
    document.getElementById("chatAvatar").style.background = user.avatarColor;
    document.getElementById("chatName").textContent = user.name;
    loadConversations();
    loadMessages();
    if (chatPollTimer) clearInterval(chatPollTimer);
    chatPollTimer = setInterval(loadMessages, 4000);
  }

  async function loadMessages() {
    if (!activeConvUserId) return;
    try {
      const data = await api(`/api/messages/${activeConvUserId}`);
      chatMessagesEl.innerHTML = data.messages.map(m => `
        <div class="msg-bubble ${m.fromMe ? "mine" : "theirs"}">${escapeHtml(m.text)}</div>
      `).join("");
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    } catch (err) {
      // silent fail on poll
    }
  }

  document.getElementById("chatSendBtn").addEventListener("click", sendChatMessage);
  document.getElementById("chatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChatMessage();
  });

  async function sendChatMessage() {
    const input = document.getElementById("chatInput");
    const text = input.value.trim();
    if (!text || !activeConvUserId) return;
    try {
      await api(`/api/messages/${activeConvUserId}`, { method: "POST", body: JSON.stringify({ text }) });
      input.value = "";
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
