import type { PlaybackSnapshot, SearchHit, SessionSnapshot } from "../../shared/contract";
import type { Track } from "../../core/playback/types";
import type { SessionHistoryEntry } from "../session-history";
import { paintCover } from "../cover";
import { installCoverHalftones } from "../cover-halftone";
import { openNowPlaying } from "../view";

export interface HomeHooks {
  onPlaylists: (playlistId?: string) => void;
  onDaily: () => void;
  onTide: () => void;
  onLocal: () => void;
  onProof: () => void;
  onFootprint: () => void;
  onPlayTrack: (track: Track) => void;
}

/** Home content is composed only from the current playback/session/library state. */
export function mountHome(root: HTMLElement, hooks: HomeHooks): {
  element: HTMLElement;
  setQueue: (snapshot: PlaybackSnapshot) => void;
  setSession: (session: SessionSnapshot | null, playlists?: SessionSnapshot["playlists"]) => void;
  setDiscover: (count: number, note: string, first?: SearchHit) => void;
  setLocal: (hits: SearchHit[]) => void;
  setHistory: (rows: SessionHistoryEntry[]) => void;
  destroy: () => void;
} {
  const grid = document.createElement("section");
  grid.className = "home-grid home-layout desktop-scroll-surface";
  grid.setAttribute("aria-label", "主页");

  const masthead = document.createElement("header");
  masthead.className = "home-page-heading";
  const wordmark = document.createElement("span");
  wordmark.className = "home-wordmark";
  // Reserve the original dynamic TIDE mark's layout anchor without duplicating its text.
  wordmark.setAttribute("aria-hidden", "true");
  const intro = document.createElement("p");
  intro.className = "home-intro";
  intro.textContent = "潮汐，随音乐而动";
  masthead.append(wordmark, intro);

  const hero = section("home-listening", "此刻正在播放");
  hero.classList.add("home-hero");
  const heroArt = document.createElement("span");
  heroArt.className = "home-hero-art home-cover cover-slot";
  paintCover(heroArt, undefined);
  const heroMeta = document.createElement("div");
  heroMeta.className = "home-hero-meta";
  const trackName = document.createElement("h1");
  trackName.className = "home-current-title";
  trackName.textContent = "当前没有播放的曲目";
  const trackArtist = document.createElement("p");
  trackArtist.className = "home-current-artist";
  trackArtist.textContent = "选择一首歌，开始你的潮汐";
  const lyricPeek = document.createElement("div");
  lyricPeek.className = "home-current-lyric";
  lyricPeek.hidden = true;
  const lyricOrigin = document.createElement("p");
  lyricOrigin.className = "home-lyric-origin";
  const lyricTranslation = document.createElement("p");
  lyricTranslation.className = "home-lyric-translation";
  lyricPeek.append(lyricOrigin, lyricTranslation);
  heroMeta.append(trackName, trackArtist, lyricPeek);
  hero.append(heroArt, heroMeta);
  clickable(hero, openNowPlaying, "打开当前歌曲播放页");

  const discover = section("home-discover", "发现音乐");
  const discoverArt = document.createElement("span");
  discoverArt.className = "home-discover-art cover-slot";
  paintCover(discoverArt, undefined);
  const discoverMeta = document.createElement("div");
  discoverMeta.className = "home-discover-meta";
  const discoverTitle = document.createElement("h3");
  discoverTitle.className = "home-discover-title";
  discoverTitle.textContent = "今日潮汐";
  const discoverArtist = document.createElement("p");
  discoverArtist.className = "home-discover-artist";
  const discoverNote = document.createElement("p");
  discoverNote.className = "home-section-note";
  discoverMeta.append(discoverTitle, discoverArtist, discoverNote);
  discover.append(discoverMeta, discoverArt);
  clickable(discover, hooks.onTide, "打开今日潮汐推荐列表");

  const recent = section("home-recent", "最近播放");
  const recentList = document.createElement("ol");
  recentList.className = "home-recent-list";
  const recentEmpty = empty("听过的歌曲会保留在这里，下次打开也能继续发现。");
  recent.append(recentList, recentEmpty);

  const library = section("home-library", "你的音乐库");
  const libraryStrip = document.createElement("div");
  libraryStrip.className = "home-playlist-strip";
  const libraryEmpty = empty("登录后显示云端歌单；本地音乐可直接添加。");
  library.append(libraryStrip, libraryEmpty);
  clickable(library, () => hooks.onPlaylists(), "打开音乐库");

  const proof = section("home-proof", "音乐脉络");
  const proofTree = document.createElement("div");
  proofTree.className = "home-proof-tree";
  // The home card is a small proof-tree signature, not a live view of the queue;
  // clicking it opens the full proof view where the real graph is drawn.
  const renderProof = () => {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 250 180");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "音乐脉络示意图，点击查看完整证明树");
    const edge = (x1: number, y1: number, x2: number, y2: number) => {
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", `M${x1} ${y1} C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`);
      path.setAttribute("class", "home-proof-graph-edge");
      svg.append(path);
    };
    const dot = (x: number, y: number, radius: number, kind: string) => {
      const circle = document.createElementNS(ns, "circle");
      circle.setAttribute("cx", String(x));
      circle.setAttribute("cy", String(y));
      circle.setAttribute("r", String(radius));
      circle.setAttribute("class", `home-proof-dot ${kind}`);
      svg.append(circle);
    };
    const branches = [[36, 150], [90, 140], [144, 150]];
    dot(52, 90, 11, "root");
    dot(52, 90, 4, "core");
    for (const [x, y] of branches) {
      edge(63, 90, x - 7, y);
      dot(x, y, 7, "song");
      edge(x + 7, y, x + 63, y);
      dot(x + 70, y, 5, "leaf");
      dot(x + 88, y - 16, 2.5, "spark");
      dot(x + 92, y + 17, 2, "spark");
    }
    proofTree.replaceChildren(svg);
  };
  renderProof();
  proof.append(proofTree);
  clickable(proof, hooks.onProof, "查看音乐脉络证明树");

  grid.append(masthead, discover, hero, recent, proof, library);
  root.append(grid);
  const stopHalftones = installCoverHalftones(grid, ".home-hero-art, .home-discover-art, .home-proof-art, .home-recent-art, .home-playlist-art");

  const lyricEvent = (event: Event) => {
    const cue = (event as CustomEvent<{ original?: string; translation?: string }>).detail;
    const original = cue?.original?.trim() || "";
    const translation = cue?.translation?.trim() || "";
    lyricOrigin.textContent = original;
    lyricTranslation.textContent = translation;
    lyricTranslation.hidden = !translation;
    lyricPeek.hidden = !original && !translation;
  };
  window.addEventListener("tide:lyric-current", lyricEvent);

  return {
    element: grid,
    setQueue(snapshot) {
      const track = snapshot.index >= 0 ? snapshot.queue[snapshot.index] : undefined;
      const stateLabel = !track ? "开始聆听"
        : snapshot.status === "playing" ? "正在播放"
          : snapshot.status === "loading" ? "正在加载"
            : snapshot.status === "error" ? "播放遇到问题" : "继续聆听";
      hero.querySelector<HTMLElement>(".home-section-title")!.textContent = stateLabel;
      trackName.textContent = track?.title ?? "当前没有播放的曲目";
      trackArtist.textContent = track?.artist ?? "选择一首歌，开始你的潮汐";
      if (heroArt.dataset.cover !== (track?.cover ?? "")) {
        heroArt.dataset.cover = track?.cover ?? "";
        paintCover(heroArt, track?.cover);
      }
    },
    setSession(session, availablePlaylists = session?.playlists ?? []) {
      const signedIn = session?.state === "logged_in";
      const lists = availablePlaylists;
      libraryStrip.replaceChildren();
      for (const playlist of lists.slice(0, 6)) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "home-playlist-item";
        item.setAttribute("aria-label", `打开歌单 ${playlist.name}`);
        const art = document.createElement("span");
        art.className = "home-playlist-art cover-slot";
        paintCover(art, playlist.cover, { lazy: true });
        const title = document.createElement("span");
        title.className = "home-playlist-title";
        title.textContent = playlist.name;
        const count = document.createElement("span");
        count.className = "home-playlist-count";
        count.textContent = `${playlist.trackCount} 首`;
        item.append(art, title, count);
        item.addEventListener("click", (event) => { event.stopPropagation(); hooks.onPlaylists(playlist.id); });
        libraryStrip.append(item);
      }
      libraryEmpty.textContent = lists.length
        ? ""
        : signedIn ? "当前账号暂时没有云端歌单。" : "登录后显示云端歌单；本地音乐可直接添加。";
      libraryEmpty.hidden = lists.length > 0;
    },
    setDiscover(count, note, first) {
      discoverTitle.textContent = first?.title || "今日潮汐";
      discoverArtist.textContent = first?.artist || "随音乐，一起探索";
      discoverNote.textContent = count > 0
        ? `${count} 首推荐 · 今日潮汐`
        : note || "打开今日潮汐，发现下一首喜欢的歌。";
      if (discoverArt.dataset.cover !== (first?.cover ?? "")) {
        discoverArt.dataset.cover = first?.cover ?? "";
        paintCover(discoverArt, first?.cover);
      }
    },
    setLocal(hits) {
      library.setAttribute("aria-label", hits.length ? `打开音乐库，含 ${hits.length} 首本地歌曲` : "打开音乐库");
    },
    setHistory(rows) {
      recentList.replaceChildren();
      recentEmpty.hidden = rows.length > 0;
      for (const row of rows.slice(0, 5)) {
        const item = document.createElement("li");
        item.className = "home-recent-item";
        const play = document.createElement("button");
        play.type = "button";
        play.className = "home-recent-play";
        play.setAttribute("aria-label", `播放 ${row.title} · ${row.artist}`);
        const art = document.createElement("span");
        art.className = "home-recent-art cover-slot";
        paintCover(art, row.cover, { lazy: true });
        const meta = document.createElement("span");
        meta.className = "home-recent-meta";
        const title = document.createElement("span");
        title.className = "home-recent-title";
        title.textContent = row.title;
        const artist = document.createElement("span");
        artist.className = "home-recent-artist";
        artist.textContent = row.artist;
        meta.append(title, artist);
        play.title = "双击播放，或按 Enter / 空格播放";
        play.setAttribute("aria-label", `双击播放 ${row.title} · ${row.artist}，键盘可按 Enter 或空格`);
        play.append(art, meta);
        play.addEventListener("dblclick", () => hooks.onPlayTrack(row));
        play.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault(); hooks.onPlayTrack(row);
        });
        item.append(play);
        recentList.append(item);
      }
    },
    destroy() {
      window.removeEventListener("tide:lyric-current", lyricEvent);
      stopHalftones();
      grid.remove();
    },
  };
}

function section(name: string, title: string): HTMLElement {
  const element = document.createElement("section");
  element.className = `home-section glass ${name}`;
  element.dataset.homeSection = name.replace("home-", "");
  const heading = document.createElement("h2");
  heading.className = "home-section-title";
  heading.textContent = title;
  element.append(heading);
  return element;
}

function empty(message: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.className = "home-section-empty";
  element.textContent = message;
  return element;
}

function clickable(element: HTMLElement, activate: () => void, label: string): void {
  element.tabIndex = 0;
  element.setAttribute("role", "button");
  element.setAttribute("aria-label", label);
  element.classList.add("home-module-link");
  element.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("button")) return;
    activate();
  });
  element.addEventListener("keydown", (event) => {
    if (event.target !== element || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    activate();
  });
}
