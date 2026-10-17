import { mountAiAssist } from "../ai-assist";
import { aiContext,aiCover } from "../ai-context";
import { editTidePlaylist } from "./playlist-editor";
import { AUDIO_LEVELS, AUDIO_LEVEL_LABEL, type AudioLevel } from "../../core/audio-level";
import { MEDIA_ACTION_LABEL, MEDIA_CUSTOM_ACTIONS, type MediaShortcutMap } from "../../core/media-keys";
import type { TidePlaylist, ApiFailure, Appearance, PlaybackSnapshot, PlaylistSummary, SearchHit, SearchResult, SessionSnapshot } from "../../shared/contract";
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
import { showHome } from "../view";
import { createNativeSearch } from "../native-shell.js";
import { mountDeskForm } from "./desk-form";
import { mountHome } from "./home";
import { mountPresetForm } from "./preset-form";
import { mountPaletteMenu } from "./palette-menu";
import { applyLike, isLiked, onLiked, setLikedIds } from "../liked";
import { fillTrackList } from "../track-row";
import { mountProof } from "./proof-view";
import { paintCover } from "../cover";

const RISK_ACK = "tide.risk.ack";

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
  const searchControl = createNativeSearch();
  const searchInput = searchControl.input as HTMLInputElement;
  searchInput.className = "search-input";
  searchInput.placeholder = "搜索音乐、歌手或专辑";
  searchInput.maxLength = 80;
  searchInput.setAttribute("aria-label", "搜索");
  const searchButton = iconButton("搜索", "Search", Search, ICON_SIZE.control);
  searchButton.type = "submit";
  searchButton.disabled = true;
  searchInput.disabled = true;
  const tabs = document.createElement("div");
  tabs.className = "search-tabs";
  tabs.id = "search-categories";
  tabs.hidden = true;
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", "搜索分类");
  searchInput.setAttribute("aria-controls", tabs.id);
  searchInput.setAttribute("aria-expanded", "false");
  const tabSong = button("单曲");
  const tabArtist = button("歌手");
  const tabAlbum = button("专辑");
  const tabLyric = button("歌词");
  tabs.append(tabSong, tabArtist, tabAlbum, tabLyric);
  searchForm.append(searchControl.element, searchButton, tabs);
  const expandSearch = (open: boolean) => {
    tabs.hidden = !open;
    searchForm.classList.toggle("search-active", open);
    searchInput.setAttribute("aria-expanded", String(open));
  };
  searchForm.addEventListener("focusin", () => expandSearch(true));
  searchForm.addEventListener("focusout", () => window.setTimeout(() => {
    if (!searchForm.contains(document.activeElement)) expandSearch(false);
  }));
  searchForm.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); searchInput.blur(); expandSearch(false); }
  });

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
  const tideRefresh = button("刷新今日潮汐");
  let todayRows: SearchHit[] = [];
  const tideActions = document.createElement("div");
  tideActions.className = "library-actions";
  tideActions.append(tideButton);
  tideRefresh.hidden = true; viewBar.append(tideRefresh);

  const recommendHeading = heading("推荐", "Radio", Radio);
  recommendHeading.hidden = true;
  const dailyButton = button("每日推荐");
  const radarButton = button("私人雷达");
  const fmButton = button("私人 FM");
  const recommend = document.createElement("div");
  recommend.className = "library-actions";
  recommend.hidden = true;
  recommend.append(dailyButton, radarButton, fmButton);

  const queueDetails = document.createElement("section");
  queueDetails.className = "queue-panel";
  const queueSummary = document.createElement("h2");
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
    input.placeholder = "";
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
  list.className = "playlist playlists";

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

  const settingsPanel = document.createElement("section");
  settingsPanel.className = "settings-panel";
  const settingsSummary = document.createElement("h2");
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
  const paletteMenu = mountPaletteMenu();
  const aiAssist=mountAiAssist(aiContext,aiCover,result=>window.dispatchEvent(new CustomEvent("tide:segments",{detail:result})));
  const miniOpen=button("打开小窗播放器");miniOpen.onclick=()=>void window.tide.setMiniPlayer({open:true});
  settingsPanel.append(settingsSummary,miniOpen, riskNotice(), presets.element,paletteMenu.button,aiAssist.element, latticeRow, qualityLabel, keyPanel, deskForm.element, bus);

  const topbar = document.createElement("div");
  topbar.className = "topbar";
  const homeButton = iconButton("主页", "House", House, ICON_SIZE.control);
  homeButton.classList.add("home-mark");
  topbar.append(homeButton, searchForm);

  const queueCol = document.createElement("aside");
  queueCol.className = "queue-col corner-panel glass";
  queueCol.hidden = true;
  queueCol.setAttribute("aria-label", "播放队列");
  queueCol.append(queueDetails);
  const queuePeek = document.createElement("div");
  queuePeek.className = "peek peek-queue";
  queuePeek.tabIndex = 0;
  queuePeek.setAttribute("aria-label", "显示播放队列");
  const queueButton = iconButton("播放队列", "ListMusic", ListMusic, ICON_SIZE.control);
  queueButton.classList.add("corner-btn", "corner-queue");
  queueButton.setAttribute("aria-expanded", "false");
  queuePeek.tabIndex=0;queuePeek.setAttribute("aria-label","显示播放队列");
  let queueTimer: ReturnType<typeof setTimeout> | undefined;
  const showQueue = (show: boolean) => {
    clearTimeout(queueTimer);
    queueCol.hidden = !show;
    queueButton.dataset.open = String(show);
    queueButton.setAttribute("aria-expanded", String(show));
  };
  const delayQueue = () => { queueTimer = setTimeout(() => {
    if (!queueCol.matches(":hover") && !queuePeek.matches(":hover")) showQueue(false);
  }, 240); };
  queuePeek.addEventListener("pointerenter", () => showQueue(true));
  queuePeek.addEventListener("focusin", () => showQueue(true));
  queuePeek.addEventListener("pointerleave", delayQueue);
  queuePeek.addEventListener("focusout", delayQueue);
  queueCol.addEventListener("pointerenter", () => clearTimeout(queueTimer));
  queueCol.addEventListener("pointerleave", delayQueue);
  queueCol.addEventListener("focusout", delayQueue);
  queueButton.addEventListener("click", () => {showQueue(queueCol.hidden);queueButton.blur();});

  const sheet = document.createElement("section");
  sheet.className = "browse-sheet glass";
  sheet.hidden = true;
  const searchPage=document.createElement("section");searchPage.className="browse-sheet glass search-page";searchPage.hidden=true;searchPage.setAttribute("aria-label","搜索结果");
  const searchHeader=document.createElement("header");searchHeader.className="search-page-header";
  const searchBack=button("返回主页"),searchTitle=document.createElement("h2");searchBack.addEventListener("click",()=>showHomeCards());searchHeader.append(searchBack,searchTitle);
  const searchMore=button("加载更多"),searchEnd=document.createElement("p");searchMore.className="text-button search-more";searchEnd.className="library-note";
  searchPage.append(searchHeader,searchMore,searchEnd);
  const playlistHero=document.createElement("div");playlistHero.className="playlist-hero";playlistHero.hidden=true;sheet.append(playlistHero);
  let detailFromSearch=false;
  const localActions = document.createElement("div");
  localActions.className = "local-actions";
  localActions.hidden = true;
  const localHeading = document.createElement("h2");
  localHeading.textContent = "本地音乐";
  const addLocal = button("添加本地音乐");
  localActions.append(localHeading, addLocal);
  const playlistPageTitle=document.createElement("h2");playlistPageTitle.className="playlist-page-title";playlistPageTitle.textContent="我的歌单";const createPlaylist=button("创建歌单");createPlaylist.className="text-button playlist-create";createPlaylist.addEventListener("click",()=>editTidePlaylist(undefined,async id=>{await refreshTideLists();showTidePlaylist(id);}));sheet.append(playlistPageTitle,createPlaylist);
  sheet.append(viewBar,playlistHero, localActions, searchNote, hits, tideHeading, tideActions, recommendHeading, recommend, list);

  const loginPeek = document.createElement("div");
  loginPeek.className = "peek peek-login";
  const loginButton = iconButton("登录", "LogIn", LogIn, ICON_SIZE.control);
  loginButton.classList.add("corner-btn", "corner-login");
  loginPeek.append(loginButton);
  const settingsPeek = document.createElement("div");
  settingsPeek.className = "peek peek-settings";
  const settingsButton = iconButton("设置", "Settings", Settings, ICON_SIZE.control);
  settingsButton.classList.add("corner-btn", "corner-settings");
  settingsPeek.append(settingsButton);
  const loginPop = document.createElement("section");
  loginPop.className = "corner-panel login-panel glass";
  loginPop.hidden = true;
  loginPop.append(loginHeading, note, actions, form);
  const settingsPop = document.createElement("section");
  settingsPop.className = "corner-panel settings-pop glass";
  settingsPop.hidden = true;
  settingsPop.append(settingsPanel);

  const showSheet = () => {
    currentTideId=null;localActions.hidden = true;
    searchPage.hidden=true;sheet.insertBefore(searchNote,hits.parentElement===sheet?hits:localActions.nextSibling);sheet.insertBefore(hits,tideHeading);
    playlistHero.hidden=true;sheet.dataset.section = "playlists";
    sheet.hidden = false;
    home.element.hidden = true;
  };
  const showHomeCards = () => {
    if(!home.element.hidden&&document.documentElement.dataset.view==='home'&&sheet.hidden&&searchPage.hidden&&proofHost.hidden)return;
    detailFromSearch=false;
    showQueue(false);
    sheet.hidden = true;searchPage.hidden=true;
    proofHost.hidden = true;
    proof.stop();
    home.element.hidden = false;
    showHome();
  };
  homeButton.addEventListener("click", showHomeCards);
  loginButton.addEventListener("click", () => {
    loginPop.hidden = !loginPop.hidden;
    loginButton.dataset.open = loginPop.hidden ? "false" : "true";loginButton.blur();
    settingsPop.hidden = true;
    settingsButton.dataset.open = "false";
  });
  settingsButton.addEventListener("click", () => {
    settingsPop.hidden = !settingsPop.hidden;
    settingsButton.dataset.open = settingsPop.hidden ? "false" : "true";settingsButton.blur();
    loginPop.hidden = true;
    loginButton.dataset.open = "false";
  });

  const autoHide=(peek:HTMLElement,pop:HTMLElement,control:HTMLElement)=>{
    let timer=0;const cancel=()=>{clearTimeout(timer);timer=0;};
    const leave=()=>{cancel();timer=window.setTimeout(()=>{const editing=pop.contains(document.activeElement)&&document.activeElement?.matches("input,select,textarea");if(!peek.matches(":hover")&&!pop.matches(":hover")&&!editing){pop.hidden=true;control.dataset.open="false";if(control===document.activeElement)control.blur();}},260);};
    for(const el of [peek,pop]){el.addEventListener("pointerenter",cancel);el.addEventListener("pointerleave",leave);el.addEventListener("focusout",leave);}
  };autoHide(loginPeek,loginPop,loginButton);autoHide(settingsPeek,settingsPop,settingsButton);

  const proofHost = document.createElement("section");
  proofHost.className = "proof-host";
  proofHost.hidden = true;
  const proof = mountProof(proofHost, (id, name) => {
    showSearchNote(name, false);
    const numeric = /^\d{1,20}$/.test(id);
    if (!numeric) return;
    const index = lastQueue?.queue.findIndex((track) => track.id === id) ?? -1;
    if (index >= 0) void window.tide.changeTrack(index);
  }, showHomeCards);
  const home = mountHome(root, {
    onPlaylists: () => {detailFromSearch=false;showSheet();void refreshTideLists();},
    onDaily: () => {
      showSheet();
      proofHost.hidden = true;
      dailyButton.click();
    },
    onTide: () => {
      showSheet();
      proofHost.hidden = true;
      tideButton.click();
    },
    onProof: () => {
      sheet.hidden = true;searchPage.hidden=true;
      home.element.hidden = true;
      proofHost.hidden = false;
      proof.show(playlists, (lastQueue?.queue ?? []).map(track => ({ ...track, playable: true })));
    },
    onLocal: () => {
      showSheet();
      localActions.hidden = false;
      sheet.dataset.section = "local";
      viewBar.hidden = true;
      void window.tide.localTracks().then((hits) => {
        showSearchNote(hits.length === 0 ? "还没有本地曲目" : "本地音乐", hits.length === 0);
        renderHits(hits);
        if (hits.length === 0) return;
        // Listed for play. The row handler starts playback.
      });
    },
  });
  addLocal.addEventListener("click", async () => {
    addLocal.disabled = true;
    try {
      const rows = await window.tide.addLocalTracks();
      if (disposed) return;
      home.setLocal(rows);
      localActions.hidden = false;
      sheet.dataset.section = "local";
      showSearchNote(rows.length === 0 ? "还没有本地曲目，点添加选择音乐文件" : `已载入 ${rows.length} 首本地音乐`, false);
      renderHits(rows);
    } catch {
      showSearchNote("添加失败，请重新选择音乐文件", true);
    } finally { addLocal.disabled = false; }
  });

  root.append(topbar, queuePeek, queueCol, sheet,searchPage, proofHost, loginPeek, settingsPeek, loginPop, settingsPop);
  void searchHeading;
  void panel;

  let pollTimer = 0;
  let apiReady = false;
  let playlists: PlaylistSummary[] = [];
  let tideLists:TidePlaylist[]=[];let currentTideId:string|null=null;let currentSession:SessionSnapshot|null=null;
  const refreshTideLists=async()=>{try{const rows=await window.tide.tidePlaylists();if(Array.isArray(rows))tideLists=rows;if(currentSession)render(currentSession);}catch{}};
  let searchType = 1;
  const tabButtons = [
    [tabSong, 1],
    [tabArtist, 100],
    [tabAlbum, 10],
    [tabLyric, 1006],
  ] as const;

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
    currentSession=session;refreshLiked();
    loginLabel.textContent = session.user?.nickname
      ?? (session.state === "invalid" ? "需要重新登录" : "登录网易云");
    note.textContent = session.message ?? "";
    note.classList.toggle("warn", session.state === "invalid");
    playlists = [...session.playlists,...tideLists.map(p=>({id:p.id,name:p.name,trackCount:p.songs.length,cover:p.cover}))];
    list.replaceChildren();
    for (const playlist of [{id:"tide-today",name:"今日潮汐",trackCount:20,cover:"./assets/today-tide.png"},{id:"tide-daily",name:"每日推荐",trackCount:30,cover:"./assets/daily-recommend.png"},...playlists]) {
      const item = document.createElement("li");
      const row = document.createElement("button");
      row.type = "button";
      row.className = "playlist-row playlist-card";row.setAttribute("aria-label",`打开歌单 ${playlist.name}`);
      const art=document.createElement("span");art.className="playlist-art";paintPlaylistArt(art,playlist.cover);
      const name = document.createElement("span");
      name.textContent = playlist.name;
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = `${playlist.trackCount} 首`;
      row.append(art,name, count);
      row.addEventListener("click", () => {
        if(playlist.id==="tide-today")void refreshToday(false);else if(playlist.id==="tide-daily")void openHits(()=>window.tide.dailyRecommend(),"每日推荐");else if(playlist.id.startsWith("tide-list-"))showTidePlaylist(playlist.id);else void showPlaylist(playlist.id, playlist.name);
      });
      item.append(row);
      list.append(item);
    }
    const signedIn = session.state === "logged_in";
    loginButton.dataset.attention = signedIn ? "false" : "true";
    paintAvatar(loginButton, signedIn ? session.user?.avatar : undefined);
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
  let shownSource: SearchResult["source"];
  const renderHits = (rows: SearchHit[], source?: SearchResult["source"]) => {
    shownHits = rows; shownSource = source;
    fillTrackList(hits, rows, playlists, showSearchNote, source,currentTideId?async songId=>{const id=currentTideId!;const result=await window.tide.removeTidePlaylistSong(id,songId);if(!result.ok){showSearchNote(result.message,true);return;}await refreshTideLists();showTidePlaylist(id);}:undefined);
  };

  const showCatalog = (rows: SearchHit[], label: string, cover?:string) => {
    showSheet();sheet.dataset.section="playlist";playlistHero.hidden=false;const title=document.createElement("h2");title.textContent=label;const art=document.createElement("span");art.className="playlist-detail-art";paintPlaylistArt(art,label==="今日潮汐"?"./assets/today-tide.png":label==="每日推荐"?"./assets/daily-recommend.png":cover??playlists.find(p=>p.name===label)?.cover);playlistHero.replaceChildren(art,title);
    viewBar.hidden = false;
    viewTitle.textContent = `${label} · 已载 ${rows.length} 首`;
    tideRefresh.hidden = label !== "今日潮汐";
    showSearchNote("", false);
    renderHits(rows);
  };

  const appendMore = (result: SearchResult, name: string) => {
    if (!result.source?.hasMore) return;
    const more = document.createElement("button"); more.type = "button"; more.className = "text-button"; more.textContent = "加载更多歌曲";
    const prior = shownHits;
    more.addEventListener("click", async () => {
      more.disabled = true;
      const next = await window.tide.playlistTracks(result.source!.playlistId, result.source!.offset);
      if (disposed || shownHits !== prior) return;
      if (!next.ok) { more.disabled = false; showSearchNote(next.message, true); return; }
      const seen = new Set(prior.map(h => h.id));
      const additions = next.hits.filter(h => !seen.has(h.id));
      showCatalog([...prior, ...additions], name);
      renderHits(shownHits, next.source);
      if (additions.length) appendMore(next, name);
    });
    const row = document.createElement("li"); row.append(more); hits.append(row);
  };

  const showTidePlaylist=(id:string)=>{const row=tideLists.find(p=>p.id===id);if(!row)return;showCatalog(row.songs,row.name,row.cover);currentTideId=id;renderHits(row.songs);
    const description=document.createElement("p");description.textContent=row.description;description.className="playlist-description";
    const actions=document.createElement("div");actions.className="library-actions";const edit=button("编辑歌单");edit.onclick=()=>editTidePlaylist(row,async()=>{await refreshTideLists();showTidePlaylist(id);});
    const sync=button(row.cloudId?"同步到网易云":"创建网易云副本");sync.onclick=async()=>{sync.disabled=true;const result=await window.tide.syncTidePlaylist(id);sync.disabled=false;showSearchNote(result.message??(result.ok?"已同步":"同步失败"),!result.ok);await refreshTideLists();};
    const remove=button("删除Tide歌单");let confirming=false;remove.onclick=async()=>{if(!confirming){confirming=true;remove.textContent="再次点击确认删除";return;}const result=await window.tide.deleteTidePlaylist(id);if(!result.ok){showSearchNote(result.message??"删除失败",true);return;}await refreshTideLists();showSheet();};actions.append(edit,sync,remove);playlistHero.append(description,actions);
  };

  const showPlaylist = async (id: string, name: string) => {
    detailFromSearch=false;
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
    renderHits(result.hits, result.source);
    appendMore(result, name);
  };

  const showDetail = async (label: string, load: () => Promise<SearchResult | ApiFailure>, cover?:string) => {
    if (opening || disposed) return;
    detailFromSearch=!searchPage.hidden;
    opening = true;
    showSearchNote(`正在读取${label}…`, false);
    const result = await load();
    opening = false;
    if (disposed) return;
    if (!result.ok) {
      showSearchNote(result.message, true);
      return;
    }
    showCatalog(result.hits, label,cover);
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
    showCatalog(result.hits,label,label==="每日推荐"?"./assets/daily-recommend.png":undefined);
    const index = result.hits.findIndex((hit) => hit.playable);
    if (index < 0) showSearchNote(result.hits.length === 0 ? `${label}是空的` : `${label}里没有可播放的曲目`, true);
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
  let queueSignature = "";
  const renderQueue = (snapshot: PlaybackSnapshot) => {
    lastQueue = snapshot;
    const signature = JSON.stringify([snapshot.index, snapshot.queue]);
    if (signature === queueSignature) return;
    queueSignature = signature;
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
        keyNote.textContent = "已保存。输入框里是当前绑定的组合。";
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

  const refreshToday = async (refresh: boolean) => {
    if (opening || disposed) return;
    opening = true; tideButton.disabled = true; tideRefresh.disabled = true;
    showSearchNote("正在整理今日潮汐…", false);
    try {
      const result = await window.tide.tideToday(refresh);
      if (disposed) return;
      if (!result.ok) { showSearchNote(result.message, true); return; }
      const rows = result.hits.slice(0, 20);
      if (refresh && !rows.length) { showSearchNote("暂时没有新的可用歌曲，已保留当前列表", true); return; }
      const currentId = lastQueue?.queue[lastQueue.index]?.id;
      if (refresh && rows.length && currentId && todayRows.some(hit => hit.id === currentId)) await window.tide.replaceUpcoming(rows);
      todayRows = rows;
      showCatalog(rows, "今日潮汐");
      showSearchNote(result.message ?? "今日潮汐 · 探索", false);
      home.setDiscover(rows.length, rows[0] ? `${rows[0].title} · ${rows[0].artist}` : "暂时没有可用歌曲");
    } catch { showSearchNote("刷新失败，已保留当前列表", true); }
    finally { opening = false; tideButton.disabled = false; tideRefresh.disabled = false; }
  };
  tideButton.addEventListener("click", () => void refreshToday(false));
  tideRefresh.addEventListener("click", () => void refreshToday(true));

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
  const artistSearch=(event:Event)=>{const name=(event as CustomEvent<string>).detail;if(typeof name!=="string"||!name.trim())return;searchInput.value=name.trim();searchType=100;markTab();showHome();searchForm.requestSubmit();};window.addEventListener("tide:artist-search",artistSearch);
  for (const [element, type] of tabButtons) {
    element.addEventListener("click", () => {
      searchType = type;
      markTab();
      if(!searchPage.hidden&&searchInput.value.trim())searchForm.requestSubmit();
    });
  }

  back.addEventListener("click", () => {
    if(detailFromSearch){detailFromSearch=false;showSearchPage();paintSearch();}else{showSheet();viewBar.hidden=true;hits.replaceChildren();showSearchNote("",false);}
  });

  busPlay.addEventListener("click", () => {
    void window.tide.play();
  });
  busPause.addEventListener("click", () => {
    void window.tide.pause();
  });

  let searchSession:{keywords:string;type:number;offset:number;rows:SearchResult;more:boolean;busy:boolean;error:string}|null=null;
  const showSearchPage=()=>{currentTideId=null;sheet.hidden=true;home.element.hidden=true;proofHost.hidden=true;proof.stop();searchPage.hidden=false;searchPage.insertBefore(searchNote,searchMore);searchPage.insertBefore(hits,searchMore);showHome();};
  const paintSearch=()=>{const state=searchSession;if(!state)return;const rows=state.rows;
    searchTitle.textContent=`“${state.keywords}”的搜索结果`;
    if(rows.kind==="artists")renderNamed(rows.artists,"没有找到歌手",row=>void showDetail(row.name,()=>window.tide.artistSongs(row.id),row.cover));
    else if(rows.kind==="albums")renderNamed(rows.albums.map(row=>({...row,name:`${row.name} · ${row.artist}`})),"没有找到专辑",row=>void showDetail(row.name,()=>window.tide.albumTracks(row.id),row.cover));
    else {renderHits(rows.hits);showSearchNote(rows.hits.length?"":"没有找到歌曲",false);}
    const count=rows.kind==="artists"?rows.artists.length:rows.kind==="albums"?rows.albums.length:rows.hits.length;
    searchMore.hidden=!state.more;searchMore.disabled=state.busy;searchMore.textContent=state.busy?"正在加载…":state.error?"重试加载更多":"加载更多";
    searchEnd.textContent=state.error||`${count} 条已加载${!state.more&&count?" · 已显示全部可用结果":""}`;
  };
  const loadSearch=async(state:NonNullable<typeof searchSession>,append:boolean)=>{
    if(state.busy)return;state.busy=true;state.error="";searchMore.disabled=true;searchMore.textContent="正在加载…";
    try{const result=await window.tide.search(state.keywords,state.type,append?state.offset:0);if(disposed||searchSession!==state)return;
      if(!result.ok){state.error=result.message;return;}
      const kind=result.kind,received=kind==="artists"?result.artists??[]:kind==="albums"?result.albums??[]:result.hits??[];
      const prior=append?(kind==="artists"?state.rows.artists:kind==="albums"?state.rows.albums:state.rows.hits):[];
      const known=new Set(prior.map(row=>row.id));const fresh=received.filter(row=>!known.has(row.id));
      state.rows={ok:true,kind,hits:kind==="songs"?[...prior,...fresh] as SearchHit[]:[],artists:kind==="artists"?[...prior,...fresh] as SearchResult["artists"]:[],albums:kind==="albums"?[...prior,...fresh] as SearchResult["albums"]:[]};
      const offset=result.nextOffset??state.offset+20;state.more=(result.hasMore??received.length===20)&&(!append||fresh.length>0)&&offset>state.offset;state.offset=offset;
    }catch{if(searchSession===state)state.error="搜索暂时失败，请重试";}
    finally{state.busy=false;if(searchSession===state&&!searchPage.hidden)paintSearch();}
  };
  searchMore.addEventListener("click",()=>{if(searchSession)void loadSearch(searchSession,true);});
  searchForm.addEventListener("submit",event=>{event.preventDefault();if(!apiReady)return;const keywords=searchInput.value.trim();if(!keywords)return;
    searchSession={keywords,type:searchType,offset:0,more:true,busy:false,error:"",rows:{ok:true,kind:"songs",hits:[],artists:[],albums:[]}};
    showSearchPage();hits.replaceChildren();searchTitle.textContent=`“${keywords}”的搜索结果`;searchEnd.textContent="";showSearchNote("正在搜索…",false);void loadSearch(searchSession,false);
  });

  const renderNamed = (
    rows: { id: string; name: string; cover?: string }[],
    empty: string,
    open: (row: { id: string; name: string;cover?:string }) => void,
  ) => {
    hits.replaceChildren();
    showSearchNote(rows.length === 0 ? empty : "", rows.length === 0);
    for (const row of rows) {
      const item = document.createElement("li");
      item.className = "catalog-row";
      const art = document.createElement("span");
      art.className = "catalog-cover";
      paintCover(art, row.cover, { lazy: true });
      const buttonRow = button(row.name);
      buttonRow.className = "catalog-entry";
      buttonRow.addEventListener("click", () => open(row));
      item.append(art, buttonRow);
      hits.append(item);
    }
  };

  const stopLiked = onLiked(() => {
    if(!searchPage.hidden&&searchSession){paintSearch();}else if(!sheet.hidden&&sheet.dataset.section!=="playlists")fillTrackList(hits, shownHits, playlists, showSearchNote, shownSource);
    queueSignature = "";
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
      latticeBox.checked = appearance.shell === "lattice" && appearance.lattice;
      latticeBox.disabled = appearance.shell === "lens";
      presets.sync(appearance);
      paletteMenu.sync(appearance);
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
        void refreshSession();void refreshTideLists();
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
      paletteMenu.destroy();
      window.removeEventListener("tide:artist-search",artistSearch);aiAssist.destroy();disposed = true;
      clearTimeout(queueTimer);
      stopPoll();
      stopLiked();
      deskForm.destroy();
      searchControl.destroy();
      proof.stop();
      panel.remove();
    },
  };
}

function riskNotice(): HTMLElement {
  const section = document.createElement("section");
  section.className = "disclaimer";
  let acked = false;
  try {
    acked = localStorage.getItem(RISK_ACK) === "1";
  } catch {
    acked = false;
  }
  section.hidden = acked;
  const title = document.createElement("h2");
  title.textContent = "使用前请阅读";
  const body = document.createElement("p");
  body.textContent =
    "潮汐是非官方客户端，仅供个人自用。使用非官方接口和 Cookie（含 MUSIC_U）可能违反网易云服务条款，并可能导致接口失效或账号受限。继续使用即表示这些后果由你自行承担。";
  const ack = document.createElement("button");
  ack.type = "button";
  ack.className = "text-button";
  ack.textContent = "知道了";
  ack.addEventListener("click", () => {
    try {
      localStorage.setItem(RISK_ACK, "1");
    } catch {
      // The note still closes for this session when storage is unavailable.
    }
    section.hidden = true;
  });
  section.append(title, body, ack);
  return section;
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

function paintAvatar(button: HTMLButtonElement, avatar: string | undefined): void {
  const existing = button.querySelector("img");
  if (!avatar || !/^https?:\/\//.test(avatar)) {
    existing?.remove();
    button.classList.remove("has-avatar");
    return;
  }
  button.classList.add("has-avatar");
  const image = existing instanceof HTMLImageElement ? existing : document.createElement("img");
  image.alt = "";
  image.src = avatar;
  if (!existing) button.replaceChildren(image);
}

function paintPlaylistArt(host:HTMLElement,url?:string){
 if(url?.startsWith("./assets/")||url?.startsWith("data:image/")){const image=document.createElement("img");image.src=url;image.alt="";image.decoding="async";host.replaceChildren(image);}else {paintCover(host,url,{lazy:true});const fallback=()=>{const image=document.createElement("img");image.src="./assets/today-tide.png";image.alt="";host.replaceChildren(image);};const img=host.querySelector("img");if(img)img.addEventListener("error",()=>requestAnimationFrame(fallback),{once:true});else fallback();}
}
