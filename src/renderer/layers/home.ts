import type { PlaybackSnapshot, SearchHit, SessionSnapshot } from "../../shared/contract";
import { openNowPlaying } from "../view";

export interface HomeHooks {
  onPlaylists: () => void;
  onDaily: () => void;
  onDiscover: () => void;
  onLocal: () => void;
  onAddLocal: () => void;
}

/** Cold-start card home. Lyrics stay hidden until Now Playing. */
export function mountHome(root: HTMLElement, hooks: HomeHooks): {
  element: HTMLElement;
  setQueue: (snapshot: PlaybackSnapshot) => void;
  setSession: (session: SessionSnapshot | null) => void;
  setDiscover: (count: number, note: string) => void;
  setLocal: (hits: SearchHit[]) => void;
} {
  const grid = document.createElement("section");
  grid.className = "home-grid";
  grid.setAttribute("aria-label", "主页");

  const clock = document.createElement("article");
  clock.className = "home-card home-clock";
  const date = document.createElement("p");
  date.className = "home-kicker";
  const time = document.createElement("p");
  time.className = "home-time";
  const quote = document.createElement("p");
  quote.className = "home-quote";
  quote.textContent = "先听手头的歌，潮水自己会来。";
  clock.append(date, time, quote);

  const tick = () => {
    const now = new Date();
    date.textContent = now.toLocaleDateString("zh-CN", { weekday: "long", month: "long", day: "numeric" });
    time.textContent = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  };
  tick();
  const timer = window.setInterval(tick, 30_000);

  const continueCard = card("继续播放", "当前没有在播的曲目", () => {
    openNowPlaying();
    void window.tide.play();
  });
  const libraryCard = card("歌单", "云端歌单在登录后出现", hooks.onPlaylists);
  const dailyCard = card("每日推荐", "登录后解锁", hooks.onDaily);
  const recentCard = card("最近播放", "还没有记录", hooks.onDiscover);
  const statsCard = card("今日收听", "0 首", hooks.onDiscover);
  const nextCard = card("即将播放", "队列是空的", () => openNowPlaying());
  const discoverCard = card("发现", "按听过的歌找相似的", hooks.onDiscover);
  const localCard = card("本地音乐", "不登录也能播", hooks.onLocal);
  const addLocal = document.createElement("button");
  addLocal.type = "button";
  addLocal.className = "text-button";
  addLocal.textContent = "添加";
  addLocal.addEventListener("click", (event) => {
    event.stopPropagation();
    hooks.onAddLocal();
  });
  localCard.append(addLocal);

  grid.append(clock, continueCard, libraryCard, dailyCard, recentCard, statsCard, nextCard, discoverCard, localCard);
  root.append(grid);

  const setBody = (host: HTMLElement, text: string) => {
    const body = host.querySelector(".home-body");
    if (body) body.textContent = text;
  };

  return {
    element: grid,
    setQueue(snapshot) {
      const track = snapshot.index >= 0 ? snapshot.queue[snapshot.index] : undefined;
      setBody(continueCard, track ? `${track.title} · ${track.artist}` : "当前没有在播的曲目");
      const upcoming = snapshot.queue.slice(snapshot.index + 1, snapshot.index + 3);
      setBody(nextCard, upcoming.length === 0 ? "队列是空的" : upcoming.map((row) => row.title).join(" · "));
    },
    setSession(session) {
      const signedIn = session?.state === "logged_in";
      setBody(libraryCard, signedIn ? `${session?.playlists.length ?? 0} 个歌单` : "云端歌单在登录后出现");
      setBody(dailyCard, signedIn ? "打开今天的推荐" : "登录后解锁");
    },
    setDiscover(count, note) {
      setBody(statsCard, count > 0 ? `${count} 首` : "还没有记录");
      setBody(recentCard, note || "还没有记录");
      setBody(discoverCard, note || "按听过的歌找相似的");
    },
    setLocal(hits) {
      setBody(localCard, hits.length === 0 ? "不登录也能播" : `${hits.length} 首在这台机器上`);
    },
    // timer is cleared with the page; destroy is the library's job via element removal
  };

  function card(title: string, body: string, onClick: () => void): HTMLElement {
    const element = document.createElement("article");
    element.className = "home-card";
    element.tabIndex = 0;
    element.setAttribute("role", "button");
    const heading = document.createElement("h2");
    heading.textContent = title;
    const copy = document.createElement("p");
    copy.className = "home-body";
    copy.textContent = body;
    element.append(heading, copy);
    element.addEventListener("click", onClick);
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onClick();
      }
    });
    return element;
  }

  void timer;
}
