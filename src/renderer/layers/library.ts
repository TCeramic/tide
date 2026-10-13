import type { ApiFailure, SearchHit, SearchResult, SessionSnapshot } from "../../shared/contract";

/** Search, login, and playlist list inside #chrome. */
export function mountLibrary(root: HTMLElement): {
  setApiReady: (ready: boolean) => void;
  destroy: () => void;
} {
  const panel = document.createElement("aside");
  panel.className = "library";
  panel.setAttribute("aria-label", "网易云歌单");

  const searchHeading = document.createElement("h2");
  searchHeading.textContent = "搜索";

  const searchForm = document.createElement("form");
  searchForm.className = "search";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "search-input";
  searchInput.placeholder = "歌名";
  searchInput.maxLength = 80;
  searchInput.setAttribute("aria-label", "搜索");
  const searchButton = button("搜索");
  searchButton.type = "submit";
  searchButton.disabled = true;
  searchInput.disabled = true;
  searchForm.append(searchInput, searchButton);

  const searchNote = document.createElement("p");
  searchNote.className = "library-note";
  searchNote.hidden = true;

  const hits = document.createElement("ul");
  hits.className = "hits";

  const tideHeading = document.createElement("h2");
  tideHeading.textContent = "今日潮汐";
  const tideButton = button("查看今日潮汐");
  const tideActions = document.createElement("div");
  tideActions.className = "library-actions";
  tideActions.append(tideButton);

  const recommendHeading = document.createElement("h2");
  recommendHeading.textContent = "推荐";
  recommendHeading.hidden = true;
  const dailyButton = button("每日推荐");
  const radarButton = button("私人雷达");
  const recommend = document.createElement("div");
  recommend.className = "library-actions";
  recommend.hidden = true;
  recommend.append(dailyButton, radarButton);

  const heading = document.createElement("h2");
  heading.textContent = "登录网易云";

  const note = document.createElement("p");
  note.className = "library-note";
  note.textContent = "正在连接本地 API…";

  const list = document.createElement("ul");
  list.className = "playlist";

  const actions = document.createElement("div");
  actions.className = "library-actions";

  const refresh = button("刷新");
  const qrButton = button("显示二维码");
  const logout = button("退出登录");
  logout.hidden = true;
  actions.append(refresh, logout);

  const qr = document.createElement("img");
  qr.className = "qr";
  qr.alt = "登录二维码";
  qr.hidden = true;

  const qrNote = document.createElement("p");
  qrNote.className = "library-note";
  qrNote.hidden = true;

  const cookieInput = document.createElement("textarea");
  cookieInput.className = "cookie-input";
  cookieInput.placeholder = "或粘贴 Cookie，需要包含 MUSIC_U";
  cookieInput.spellcheck = false;
  cookieInput.autocomplete = "off";
  cookieInput.setAttribute("aria-label", "Cookie");

  const save = button("保存 Cookie");

  const form = document.createElement("div");
  form.className = "library-form";
  form.append(qrButton, qr, qrNote, cookieInput, save);

  panel.append(
    searchHeading,
    searchForm,
    searchNote,
    hits,
    tideHeading,
    tideActions,
    recommendHeading,
    recommend,
    heading,
    note,
    actions,
    list,
    form,
  );
  root.append(panel);

  let pollTimer = 0;
  let apiReady = false;
  let searching = false;
  let opening = false;
  let sawReady = false;
  let disposed = false;

  const stopPoll = () => {
    if (pollTimer !== 0) window.clearTimeout(pollTimer);
    pollTimer = 0;
  };

  const showFailure = (failure: ApiFailure) => {
    note.textContent = failure.message;
    note.classList.add("warn");
  };

  const render = (session: SessionSnapshot) => {
    heading.textContent = session.user?.nickname
      ?? (session.state === "invalid" ? "需要重新登录" : "登录网易云");
    note.textContent = session.message ?? "";
    note.classList.toggle("warn", session.state === "invalid");
    list.replaceChildren();
    for (const playlist of session.playlists) {
      const item = document.createElement("li");
      const row = document.createElement("button");
      row.type = "button";
      row.className = "playlist-row";
      const name = document.createElement("span");
      name.textContent = playlist.name;
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = String(playlist.trackCount);
      row.append(name, count);
      row.addEventListener("click", () => {
        void openHits(() => window.tide.playlistTracks(playlist.id), playlist.name);
      });
      item.append(row);
      list.append(item);
    }
    const signedIn = session.state === "logged_in";
    recommendHeading.hidden = !signedIn;
    recommend.hidden = !signedIn;
    dailyButton.disabled = !apiReady;
    radarButton.disabled = !apiReady;
    form.hidden = signedIn;
    logout.hidden = session.state === "signed_out";
    logout.textContent = session.state === "invalid" ? "清除登录" : "退出登录";
    if (signedIn) {
      stopPoll();
      qr.hidden = true;
      qrNote.hidden = true;
      cookieInput.value = "";
    }
  };

  const refreshSession = async () => {
    if (!apiReady || disposed) return;
    const result = await window.tide.getSession();
    if (disposed) return;
    if (!result.ok) {
      showFailure(result);
      return;
    }
    render(result);
  };

  const checkQr = async (key: string) => {
    const result = await window.tide.checkQr(key);
    if (disposed) return;
    if (!result.ok) {
      showFailure(result);
      return;
    }
    qrNote.hidden = false;
    qrNote.textContent = result.message;
    if (result.session) render(result.session);
    if (result.code === 800 || result.code === 803) return;
    pollTimer = window.setTimeout(() => void checkQr(key), 2000);
  };

  qrButton.addEventListener("click", () => {
    void (async () => {
      stopPoll();
      const ticket = await window.tide.startQr();
      if (!ticket.ok) {
        showFailure(ticket);
        return;
      }
      if (!ticket.qrimg.startsWith("data:image/")) {
        showFailure({ ok: false, error: "qr", message: "二维码图片无效，请重试" });
        return;
      }
      qr.hidden = true;
      qr.onload = () => {
        qr.hidden = false;
      };
      qr.onerror = () => {
        qr.hidden = true;
        showFailure({ ok: false, error: "qr", message: "二维码图片无效，请重试" });
      };
      qr.src = ticket.qrimg;
      qrNote.hidden = false;
      qrNote.textContent = "等待扫码";
      void checkQr(ticket.key);
    })();
  });

  save.addEventListener("click", () => {
    void (async () => {
      const result = await window.tide.saveCookie(cookieInput.value);
      if (!result.ok) {
        showFailure(result);
        return;
      }
      cookieInput.value = "";
      render(result);
    })();
  });

  logout.addEventListener("click", () => {
    void (async () => {
      stopPoll();
      const result = await window.tide.logout();
      if (!result.ok) {
        showFailure(result);
        return;
      }
      qr.hidden = true;
      qr.removeAttribute("src");
      render(result);
    })();
  });

  refresh.addEventListener("click", () => {
    void refreshSession();
  });

  const renderHits = (rows: SearchHit[]) => {
    hits.replaceChildren();
    rows.forEach((hit, index) => {
      const item = document.createElement("li");
      const row = document.createElement("button");
      row.type = "button";
      row.className = hit.playable ? "hit" : "hit unavailable";
      row.disabled = !hit.playable;
      if (!hit.playable) row.title = "没有可播放的地址";
      const title = document.createElement("span");
      title.className = "hit-title";
      title.textContent = hit.title;
      const meta = document.createElement("span");
      meta.className = "hit-meta";
      meta.textContent = hit.playable ? hit.artist : `${hit.artist} · 没有可播放的地址`;
      row.append(title, meta);
      if (hit.playable) {
        row.addEventListener("click", () => {
          void window.tide.playHits(rows, index);
        });
      }
      item.append(row);
      hits.append(item);
    });
  };

  const openHits = async (load: () => Promise<SearchResult | ApiFailure>, label: string) => {
    if (opening || !apiReady || disposed) return;
    opening = true;
    dailyButton.disabled = true;
    radarButton.disabled = true;
    showSearchNote(`正在读取${label}…`, false);
    const result = await load();
    opening = false;
    if (disposed) return;
    dailyButton.disabled = !apiReady;
    radarButton.disabled = !apiReady;
    if (!result.ok) {
      hits.replaceChildren();
      showSearchNote(result.message, true);
      return;
    }
    showSearchNote(label, false);
    renderHits(result.hits);
    const index = result.hits.findIndex((hit) => hit.playable);
    if (index < 0) {
      showSearchNote(result.hits.length === 0 ? `${label}是空的` : `${label}里没有可播放的曲目`, true);
      return;
    }
    void window.tide.playHits(result.hits, index);
  };

  dailyButton.addEventListener("click", () => {
    void openHits(() => window.tide.dailyRecommend(), "每日推荐");
  });
  radarButton.addEventListener("click", () => {
    void openHits(() => window.tide.radar(), "私人雷达");
  });

  tideButton.addEventListener("click", () => {
    void (async () => {
      if (opening || disposed) return;
      opening = true;
      tideButton.disabled = true;
      showSearchNote("正在整理今日潮汐…", false);
      const result = await window.tide.tideToday();
      opening = false;
      if (disposed) return;
      tideButton.disabled = false;
      if (!result.ok) {
        hits.replaceChildren();
        showSearchNote(result.message, true);
        return;
      }
      showSearchNote(result.message ?? "今日潮汐", false);
      renderHits(result.hits);
    })();
  });

  const showSearchNote = (message: string, warn: boolean) => {
    searchNote.textContent = message;
    searchNote.classList.toggle("warn", warn);
    searchNote.hidden = message.length === 0;
  };

  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (searching || !apiReady) return;
    const keywords = searchInput.value.trim();
    if (keywords.length === 0) {
      showSearchNote("请输入要搜索的歌名", true);
      return;
    }
    searching = true;
    searchButton.disabled = true;
    void window.tide.search(keywords).then((result) => {
      searching = false;
      if (disposed) return;
      searchButton.disabled = !apiReady;
      if (!result.ok) {
        hits.replaceChildren();
        showSearchNote(result.message, true);
        return;
      }
      showSearchNote(result.hits.length === 0 ? "没有找到歌曲" : "", false);
      renderHits(result.hits);
    });
  });

  return {
    setApiReady(ready) {
      apiReady = ready;
      refresh.disabled = !ready;
      qrButton.disabled = !ready;
      save.disabled = !ready;
      searchButton.disabled = !ready;
      searchInput.disabled = !ready;
      dailyButton.disabled = !ready;
      radarButton.disabled = !ready;
      if (!ready) {
        sawReady = false;
        stopPoll();
        note.textContent = "本地 API 未就绪，登录暂不可用";
        note.classList.add("warn");
        return;
      }
      if (!sawReady) {
        sawReady = true;
        void refreshSession();
      }
    },
    destroy() {
      disposed = true;
      stopPoll();
      panel.remove();
    },
  };
}

function button(label: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "text-button";
  element.textContent = label;
  return element;
}
