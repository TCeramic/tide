import { AUDIO_LEVELS, AUDIO_LEVEL_LABEL, type AudioLevel } from "../../core/audio-level";
import { MEDIA_ACTION_LABEL, MEDIA_CUSTOM_ACTIONS, type MediaShortcutMap } from "../../core/media-keys";
import type { ApiFailure, Appearance, PlaybackSnapshot, PlaylistSummary, SearchHit, SearchResult, SessionSnapshot } from "../../shared/contract";
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Compass,
  Heart,
  House,
  Keyboard,
  List,
  ListMusic,
  LogIn,
  Radio,
  Search,
  Settings,
  Waypoints,
  X,
} from "lucide";
import type { IconNode } from "../icons";
import { ICON_SIZE, iconButton, prependIcon, setIcon } from "../icons";
import { openNowPlaying, showHome } from "../view";
import { mountDeskForm } from "./desk-form";
import { mountHome } from "./home";
import { mountPresetForm } from "./preset-form";
import { applyLike, isLiked, onLiked, setLikedIds } from "../liked";
import { fillTrackList } from "../track-row";

/** Search, login, and playlist list inside #chrome. */
export function mountLibrary(root: HTMLElement): {
  setApiReady: (ready: boolean) => void;
  setBusPort: (port: number | undefined) => void;
  setPlayback: (status: string) => void;
  setQueue: (snapshot: PlaybackSnapshot) => void;
  notify: (message: string) => void;
  setLattice: (on: boolean) => void;
  setAppearance: (appearance: Appearance) => void;
  showHome: () => void;
  destroy: () => void;
} {
  const panel = document.createElement("aside");
  panel.className = "library";
  panel.setAttribute("aria-label", "网易云歌单");

  const searchHeading = heading("搜索", "Search", Search);

  const searchForm = document.createElement("form");
  searchForm.className = "search";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "search-input";
  searchInput.placeholder = "关键词";
  searchInput.maxLength = 80;
  searchInput.setAttribute("aria-label", "搜索");
  const searchButton = iconButton("搜索", "Search", Search, ICON_SIZE.control);
  searchButton.type = "submit";
  searchButton.disabled = true;
  searchInput.disabled = true;
  const tabs = document.createElement("div");
  tabs.className = "search-tabs";
  const tabSong = button("单曲");
  const tabArtist = button("歌手");
  const tabAlbum = button("专辑");
  const tabLyric = button("歌词");
  tabs.append(tabSong, tabArtist, tabAlbum, tabLyric);
  searchForm.append(searchInput, searchButton, tabs);

  const searchNote = document.createElement("p");
  searchNote.className = "library-note";
  searchNote.hidden = true;

  const hits = document.createElement("ul");
  hits.className = "hits";

  const viewBar = document.createElement("div");
  viewBar.className = "view-bar";
  viewBar.hidden = true;
  const back = button("返回");
  prependIcon(back, "ChevronLeft", ChevronLeft, ICON_SIZE.row);
  const viewTitle = document.createElement("span");
  prependIcon(viewBar, "List", List, ICON_SIZE.row);
  viewBar.append(back, viewTitle);

  const tideHeading = heading("今日潮汐 · 探索", "Compass", Compass);
  const tideButton = button("查看探索");
  const tideActions = document.createElement("div");
  tideActions.className = "library-actions";
  tideActions.append(tideButton);

  const recommendHeading = heading("推荐", "Radio", Radio);
  recommendHeading.hidden = true;
  const dailyButton = button("每日推荐");
  const radarButton = button("私人雷达");
  const fmButton = button("私人 FM");
  const recommend = document.createElement("div");
  recommend.className = "library-actions";
  recommend.hidden = true;
  recommend.append(dailyButton, radarButton, fmButton);

  const queueDetails = document.createElement("details");
  queueDetails.className = "queue-panel";
  const queueSummary = document.createElement("summary");
  const queueLabel = document.createElement("span");
  queueLabel.textContent = "播放队列";
  prependIcon(queueSummary, "ListMusic", ListMusic, ICON_SIZE.row);
  queueSummary.append(queueLabel);
  const queueTools = document.createElement("div");
  queueTools.className = "library-actions";
  const clearQueue = button("清空");
  const dislike = button("不喜欢");
  queueTools.append(clearQueue, dislike);
  const qualityLabel = document.createElement("label");
  qualityLabel.className = "quality";
  qualityLabel.append("音质");
  const quality = document.createElement("select");
  quality.setAttribute("aria-label", "音质");
  for (const level of AUDIO_LEVELS) {
    const option = document.createElement("option");
    option.value = level;
    option.textContent = AUDIO_LEVEL_LABEL[level];
    quality.append(option);
  }
  qualityLabel.append(quality);
  const queueList = document.createElement("ul");
  queueList.className = "queue-list";
  queueDetails.append(queueSummary, queueTools, queueList);

  const keyPanel = document.createElement("details");
  keyPanel.className = "key-panel";
  const keySummary = document.createElement("summary");
  keySummary.textContent = "热键";
  prependIcon(keySummary, "Keyboard", Keyboard, ICON_SIZE.row);
  const keyHelp = document.createElement("p");
  keyHelp.className = "library-note";
  keyHelp.textContent = "罗技 G HUB / Options+ 若只能发普通组合键，填成 Ctrl+Alt+Right 这种形式。系统媒体键不用填。";
  const captureRow = document.createElement("label");
  captureRow.className = "key-capture";
  const captureBox = document.createElement("input");
  captureBox.type = "checkbox";
  captureBox.checked = true;
  captureBox.setAttribute("aria-label", "接管系统媒体键");
  const captureText = document.createElement("span");
  captureText.textContent = "接管系统媒体键";
  const captureHint = document.createElement("span");
  captureHint.className = "key-hint";
  captureHint.textContent = "会抢占其他播放器的媒体键";
  captureRow.append(captureBox, captureText, captureHint);
  const keyForm = document.createElement("div");
  keyForm.className = "library-form";
  const keyInputs = {} as Record<(typeof MEDIA_CUSTOM_ACTIONS)[number], HTMLInputElement>;
  for (const action of MEDIA_CUSTOM_ACTIONS) {
    const field = document.createElement("label");
    field.className = "key-row";
    field.append(MEDIA_ACTION_LABEL[action]);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "key-input";
    input.maxLength = 64;
    input.spellcheck = false;
    input.placeholder = "Ctrl+Alt+Right";
    input.setAttribute("aria-label", MEDIA_ACTION_LABEL[action]);
    keyInputs[action] = input;
    field.append(input);
    keyForm.append(field);
  }
  const keySave = button("保存按键");
  const keyNote = document.createElement("p");
  keyNote.className = "library-note";
  keyNote.hidden = true;
  keyForm.append(keySave);
  keyPanel.append(keySummary, keyHelp, captureRow, keyForm, keyNote);

  const showKeyResult = (shortcuts: MediaShortcutMap, messages: string[]) => {
    for (const action of MEDIA_CUSTOM_ACTIONS) keyInputs[action].value = shortcuts[action];
    keyNote.hidden = messages.length === 0;
    keyNote.textContent = messages.join(" ");
    keyNote.classList.toggle("warn", messages.length > 0);
  };

  const loginHeading = document.createElement("h2");
  loginHeading.className = "with-icon";
  const loginLabel = document.createElement("span");
  loginLabel.textContent = "登录网易云";
  prependIcon(loginHeading, "LogIn", LogIn, ICON_SIZE.row);
  loginHeading.append(loginLabel);

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

  const bus = document.createElement("details");
  bus.className = "bus-panel";
  const busSummary = document.createElement("summary");
  busSummary.textContent = "指令总线";
  prependIcon(busSummary, "Waypoints", Waypoints, ICON_SIZE.row);
  const busBody = document.createElement("p");
  busBody.className = "library-note";
  busBody.textContent = "本机 127.0.0.1 。令牌在 userData/bus-token 。示例：POST /command {\"command\":\"playback.pause\"}";
  const busPlay = button("播放");
  const busPause = button("暂停");
  const busStatus = document.createElement("p");
  busStatus.className = "library-note";
  busStatus.textContent = "状态：空闲";
  bus.append(busSummary, busBody, busPlay, busPause, busStatus);

  const settingsPanel = document.createElement("details");
  settingsPanel.className = "settings-panel";
  const settingsSummary = document.createElement("summary");
  settingsSummary.textContent = "设置";
  prependIcon(settingsSummary, "Settings", Settings, ICON_SIZE.row);
  const latticeRow = document.createElement("label");
  latticeRow.className = "key-capture";
  const latticeBox = document.createElement("input");
  latticeBox.type = "checkbox";
  latticeBox.checked = false;
  latticeBox.setAttribute("aria-label", "点阵");
  const latticeText = document.createElement("span");
  latticeText.textContent = "点阵";
  const latticeHint = document.createElement("span");
  latticeHint.className = "key-hint";
  latticeHint.textContent = "播放时的环境层，不是窗口外壳";
  latticeRow.append(latticeBox, latticeText, latticeHint);
  latticeBox.addEventListener("change", () => {
    void window.tide.setAppearance({ lattice: latticeBox.checked });
  });
  const deskForm = mountDeskForm();
  const presets = mountPresetForm();
  settingsPanel.append(settingsSummary, presets.element, latticeRow, qualityLabel, keyPanel, deskForm.element, bus);

  const topbar = document.createElement("div");
  topbar.className = "topbar";
  const homeButton = button("主页");
  prependIcon(homeButton, "House", House, ICON_SIZE.row);
  topbar.append(homeButton, searchForm);

  const queueCol = document.createElement("aside");
  queueCol.className = "queue-col glass";
  queueCol.setAttribute("aria-label", "播放队列");
  queueDetails.open = true;
  queueCol.append(queueDetails);

  const sheet = document.createElement("section");
  sheet.className = "browse-sheet glass";
  sheet.hidden = true;
  sheet.append(viewBar, searchNote, hits, tideHeading, tideActions, recommendHeading, recommend, list);

  const loginButton = iconButton("登录", "LogIn", LogIn, ICON_SIZE.control);
  loginButton.classList.add("corner-btn", "corner-login");
  const settingsButton = iconButton("设置", "Settings", Settings, ICON_SIZE.control);
  settingsButton.classList.add("corner-btn", "corner-settings");
  const loginPop = document.createElement("section");
  loginPop.className = "corner-panel login-panel glass";
  loginPop.hidden = true;
  loginPop.append(loginHeading, note, actions, form);
  const settingsPop = document.createElement("section");
  settingsPop.className = "corner-panel settings-pop glass";
  settingsPop.hidden = true;
  settingsPop.append(settingsPanel);
  settingsPanel.open = true;

  const showSheet = () => {
    sheet.hidden = false;
    home.element.hidden = true;
  };
  const showHomeCards = () => {
    sheet.hidden = true;
    home.element.hidden = false;
    showHome();
  };
  homeButton.addEventListener("click", showHomeCards);
  loginButton.addEventListener("click", () => {
    loginPop.hidden = !loginPop.hidden;
    settingsPop.hidden = true;
  });
  settingsButton.addEventListener("click", () => {
    settingsPop.hidden = !settingsPop.hidden;
    loginPop.hidden = true;
  });

  const home = mountHome(root, {
    onPlaylists: () => showSheet(),
    onDaily: () => {
      showSheet();
      dailyButton.click();
    },
    onDiscover: () => {
      showSheet();
      tideButton.click();
    },
    onLocal: () => {
      showSheet();
      void window.tide.localTracks().then((hits) => {
        showSearchNote(hits.length === 0 ? "还没有本地曲目" : "本地音乐", hits.length === 0);
        renderHits(hits);
        if (hits.length === 0) return;
        // Listed for play. The row handler starts playback.
      });
    },
    onAddLocal: () => {
      void window.tide.addLocalTracks().then((hits) => {
        home.setLocal(hits);
        showSheet();
        showSearchNote(hits.length === 0 ? "还没有本地曲目" : "本地音乐", hits.length === 0);
        renderHits(hits);
      });
    },
  });

  root.append(topbar, queueCol, sheet, loginButton, settingsButton, loginPop, settingsPop);
  void searchHeading;
  void panel;

  let pollTimer = 0;
  let apiReady = false;
  let playlists: PlaylistSummary[] = [];
  let searchType = 1;
  const tabButtons = [
    [tabSong, 1],
    [tabArtist, 100],
    [tabAlbum, 10],
    [tabLyric, 1006],
  ] as const;
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

  const refreshLiked = () => {
    void window.tide.likedIds().then((result) => {
      if (!result.ok || disposed) return;
      setLikedIds(result.ids, result.known);
    });
  };

  const render = (session: SessionSnapshot) => {
    refreshLiked();
    loginLabel.textContent = session.user?.nickname
      ?? (session.state === "invalid" ? "需要重新登录" : "登录网易云");
    note.textContent = session.message ?? "";
    note.classList.toggle("warn", session.state === "invalid");
    playlists = session.playlists;
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
        void showPlaylist(playlist.id, playlist.name);
      });
      item.append(row);
      list.append(item);
    }
    const signedIn = session.state === "logged_in";
    loginButton.dataset.attention = signedIn ? "false" : "true";
    home.setSession(session);
    recommendHeading.hidden = !signedIn;
    recommend.hidden = !signedIn;
    dailyButton.disabled = !apiReady;
    radarButton.disabled = !apiReady;
    fmButton.disabled = !apiReady;
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

  let shownHits: SearchHit[] = [];
  const renderHits = (rows: SearchHit[]) => {
    shownHits = rows;
    fillTrackList(hits, rows, playlists, showSearchNote);
  };

  const showCatalog = (rows: SearchHit[], label: string) => {
    viewBar.hidden = false;
    viewTitle.textContent = `${label} · 已载 ${rows.length} 首`;
    showSearchNote("", false);
    renderHits(rows);
  };

  const showPlaylist = async (id: string, name: string) => {
    if (opening || !apiReady || disposed) return;
    opening = true;
    showSearchNote(`正在读取${name}…`, false);
    const result = await window.tide.playlistTracks(id);
    opening = false;
    if (disposed) return;
    if (!result.ok) {
      hits.replaceChildren();
      showSearchNote(result.message, true);
      return;
    }
    showCatalog(result.hits, name);
  };

  const showDetail = async (label: string, load: () => Promise<SearchResult | ApiFailure>) => {
    if (opening || disposed) return;
    opening = true;
    showSearchNote(`正在读取${label}…`, false);
    const result = await load();
    opening = false;
    if (disposed) return;
    if (!result.ok) {
      showSearchNote(result.message, true);
      return;
    }
    showCatalog(result.hits, label);
  };

  const openHits = async (load: () => Promise<SearchResult | ApiFailure>, label: string) => {
    if (opening || !apiReady || disposed) return;
    opening = true;
    dailyButton.disabled = true;
    radarButton.disabled = true;
    fmButton.disabled = true;
    showSearchNote(`正在读取${label}…`, false);
    const result = await load();
    opening = false;
    if (disposed) return;
    dailyButton.disabled = !apiReady;
    radarButton.disabled = !apiReady;
    fmButton.disabled = !apiReady;
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
  fmButton.addEventListener("click", () => {
    void openHits(() => window.tide.personalFm(), "私人 FM");
  });

  let dragging = -1;
  let lastQueue: PlaybackSnapshot | null = null;
  const renderQueue = (snapshot: PlaybackSnapshot) => {
    lastQueue = snapshot;
    queueLabel.textContent = snapshot.queue.length === 0 ? "播放队列" : `播放队列 · ${snapshot.queue.length}`;
    queueList.replaceChildren();
    snapshot.queue.forEach((track, index) => {
      const item = document.createElement("li");
      item.className = index === snapshot.index ? "queue-row current" : "queue-row";
      item.draggable = true;
      item.addEventListener("dragstart", () => {
        dragging = index;
      });
      item.addEventListener("dragover", (event) => {
        event.preventDefault();
      });
      item.addEventListener("drop", () => {
        const from = dragging;
        dragging = -1;
        if (from < 0 || from === index) return;
        void window.tide.queueMove(from, index);
      });
      const liked = isLiked(track.id);
      const like = iconButton(liked ? "取消喜欢" : "喜欢", "Heart", Heart, ICON_SIZE.row);
      like.classList.add("queue-like");
      like.classList.toggle("on", liked);
      if (liked) setIcon(like, "Heart", Heart, ICON_SIZE.row, true);
      like.addEventListener("click", () => {
        const wanted = !isLiked(track.id);
        void window.tide.likeSong(track.id, wanted).then((result) => {
          if (!result.ok) {
            showSearchNote(result.message, true);
            return;
          }
          applyLike(track.id, result.liked);
          showSearchNote(result.message, false);
        });
      });
      const name = document.createElement("button");
      name.type = "button";
      name.className = "queue-title";
      name.textContent = `${track.title} · ${track.artist}`;
      name.addEventListener("click", () => {
        openNowPlaying();
        void window.tide.changeTrack(index);
      });
      const up = iconButton("上移", "ChevronUp", ChevronUp, ICON_SIZE.row);
      up.disabled = index === 0;
      up.addEventListener("click", () => {
        void window.tide.queueMove(index, index - 1);
      });
      const down = iconButton("下移", "ChevronDown", ChevronDown, ICON_SIZE.row);
      down.disabled = index === snapshot.queue.length - 1;
      down.addEventListener("click", () => {
        void window.tide.queueMove(index, index + 1);
      });
      const remove = iconButton("移除", "X", X, ICON_SIZE.row);
      remove.addEventListener("click", () => {
        void window.tide.queueRemove(index);
      });
      item.append(like, name, up, down, remove);
      queueList.append(item);
    });
  };
  clearQueue.addEventListener("click", () => {
    void window.tide.queueClear();
  });
  dislike.addEventListener("click", () => {
    void (async () => {
      const snap = await window.tide.getPlayback();
      const track = snap.index >= 0 ? snap.queue[snap.index] : undefined;
      if (!track) {
        showSearchNote("没有正在播放的曲目", true);
        return;
      }
      const result = await window.tide.fmTrash(track.id);
      if (!result.ok) {
        showSearchNote(result.message, true);
        return;
      }
      showSearchNote(result.message, false);
      const next = await window.tide.queueRemove(snap.index);
      if (next.queue.length > 0) return;
      const more = await window.tide.personalFm();
      if (!more.ok) {
        showSearchNote(more.message, true);
        return;
      }
      const index = more.hits.findIndex((hit) => hit.playable);
      if (index >= 0) void window.tide.playHits(more.hits, index);
    })();
  });
  quality.addEventListener("change", () => {
    void window.tide.setQuality(quality.value as AudioLevel);
  });
  captureBox.addEventListener("change", () => {
    const wanted = captureBox.checked;
    void window.tide.setCaptureMediaKeys(wanted).then((result) => {
      captureBox.checked = result.captureMediaKeys;
    });
  });
  keySave.addEventListener("click", () => {
    const shortcuts: MediaShortcutMap = {
      toggle: keyInputs.toggle.value,
      next: keyInputs.next.value,
      previous: keyInputs.previous.value,
      stop: keyInputs.stop.value,
    };
    void window.tide.setMediaShortcuts(shortcuts).then((result) => {
      showKeyResult(result.shortcuts, result.messages);
      if (result.messages.length === 0) {
        keyNote.hidden = false;
        keyNote.textContent = "已保存。留空表示不使用额外组合键。";
        keyNote.classList.remove("warn");
      }
    });
  });
  void window.tide.getMediaShortcuts().then((result) => {
    showKeyResult(result.shortcuts, result.messages);
    captureBox.checked = result.captureMediaKeys;
  });
  void window.tide.getQuality().then((level) => {
    if ((AUDIO_LEVELS as readonly string[]).includes(level)) quality.value = level;
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
      showSearchNote(result.message ?? "今日潮汐 · 探索", false);
      renderHits(result.hits);
    })();
  });

  const showSearchNote = (message: string, warn: boolean) => {
    searchNote.textContent = message;
    searchNote.classList.toggle("warn", warn);
    searchNote.hidden = message.length === 0;
  };

  const markTab = () => {
    for (const [element, type] of tabButtons) {
      const on = type === searchType;
      element.classList.toggle("on", on);
      element.setAttribute("aria-pressed", on ? "true" : "false");
    }
  };
  markTab();
  for (const [element, type] of tabButtons) {
    element.addEventListener("click", () => {
      searchType = type;
      markTab();
    });
  }

  back.addEventListener("click", () => {
    viewBar.hidden = true;
    hits.replaceChildren();
    showSearchNote("", false);
  });

  busPlay.addEventListener("click", () => {
    void window.tide.play();
  });
  busPause.addEventListener("click", () => {
    void window.tide.pause();
  });

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
    showSheet();
    void window.tide.search(keywords, searchType).then((result) => {
      searching = false;
      if (disposed) return;
      searchButton.disabled = !apiReady;
      if (!result.ok) {
        hits.replaceChildren();
        showSearchNote(result.message, true);
        return;
      }
      viewBar.hidden = true;
      if (result.kind === "artists") {
        renderNamed(result.artists, "没有找到歌手", (row) => {
          void showDetail(row.name, () => window.tide.artistSongs(row.id));
        });
        return;
      }
      if (result.kind === "albums") {
        renderNamed(result.albums.map((row) => ({ id: row.id, name: `${row.name} · ${row.artist}` })), "没有找到专辑", (row) => {
          void showDetail(row.name, () => window.tide.albumTracks(row.id));
        });
        return;
      }
      const empty = searchType === 1006 ? "没有找到歌词对应的歌曲" : "没有找到歌曲";
      showSearchNote(result.hits.length === 0 ? empty : "", false);
      renderHits(result.hits);
    });
  });

  const renderNamed = (
    rows: { id: string; name: string }[],
    empty: string,
    open: (row: { id: string; name: string }) => void,
  ) => {
    hits.replaceChildren();
    showSearchNote(rows.length === 0 ? empty : "", rows.length === 0);
    for (const row of rows) {
      const item = document.createElement("li");
      const buttonRow = button(row.name);
      buttonRow.addEventListener("click", () => open(row));
      item.append(buttonRow);
      hits.append(item);
    }
  };

  const stopLiked = onLiked(() => {
    fillTrackList(hits, shownHits, playlists, showSearchNote);
    if (lastQueue) renderQueue(lastQueue);
  });
  return {
    setBusPort(port) {
      if (typeof port !== "number" || !Number.isInteger(port)) return;
      busBody.textContent = `本机 127.0.0.1:${port} 。令牌在 userData/bus-token 。示例：POST /command {"command":"playback.pause"}`;
    },
    setPlayback(status) {
      busStatus.textContent = `状态：${status}`;
    },
    setQueue(snapshot) {
      renderQueue(snapshot);
      home.setQueue(snapshot);
    },
    setAppearance(appearance) {
      latticeBox.checked = appearance.lattice;
      presets.sync(appearance);
    },
    showHome() {
      showHomeCards();
    },
    notify(message) {
      showSearchNote(message, true);
    },
    setLattice(on) {
      latticeBox.checked = on;
    },
    setApiReady(ready) {
      apiReady = ready;
      refresh.disabled = !ready;
      qrButton.disabled = !ready;
      save.disabled = !ready;
      searchButton.disabled = !ready;
      searchInput.disabled = !ready;
      dailyButton.disabled = !ready;
      radarButton.disabled = !ready;
      fmButton.disabled = !ready;
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
        void window.tide.tideToday().then((result) => {
          if (!result.ok || disposed) return;
          const first = result.hits[0];
          home.setDiscover(result.hits.length, first ? `${first.title} · ${first.artist}` : (result.message ?? ""));
        });
        void window.tide.localTracks().then((hits) => {
          if (!disposed) home.setLocal(hits);
        });
      }
    },
    destroy() {
      disposed = true;
      stopPoll();
      stopLiked();
      deskForm.destroy();
      panel.remove();
    },
  };
}

function heading(text: string, name: string, node: IconNode): HTMLHeadingElement {
  const element = document.createElement("h2");
  element.className = "with-icon";
  prependIcon(element, name, node, ICON_SIZE.row);
  element.append(text);
  return element;
}

function button(label: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "text-button";
  element.textContent = label;
  return element;
}
