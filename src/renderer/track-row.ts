import type { PlaylistSummary, SearchHit } from "../shared/contract";
import { applyLike, isLiked } from "./liked";

export function songPageUrl(id: string): string {
  return `https://music.163.com/song?id=${encodeURIComponent(id)}`;
}

/** Song rows with a play shortcut and the N8 menu. */
export function fillTrackList(
  list: HTMLElement,
  hits: readonly SearchHit[],
  playlists: readonly PlaylistSummary[],
  note: (message: string, warn: boolean) => void,
): void {
  list.replaceChildren();
  hits.forEach((hit, index) => {
    const item = document.createElement("li");
    item.className = "hit-row";

    const play = iconButton(hit.playable ? "播放" : "没有可播放的地址", "▶");
    play.disabled = !hit.playable;
    play.addEventListener("click", () => {
      if (!hit.playable) return;
      void window.tide.playHits([...hits], index);
    });

    const main = document.createElement("button");
    main.type = "button";
    main.className = hit.playable ? "hit" : "hit unavailable";
    main.disabled = !hit.playable;
    const title = document.createElement("span");
    title.className = "hit-title";
    title.textContent = hit.title;
    const meta = document.createElement("span");
    meta.className = "hit-meta";
    meta.textContent = hit.playable ? hit.artist : `${hit.artist} · 没有可播放的地址`;
    main.append(title, meta);
    if (hit.playable) {
      main.addEventListener("click", () => {
        void window.tide.playHits([...hits], index);
      });
    }

    const likedNow = isLiked(hit.id, hit.liked);
    const like = iconButton(likedNow ? "取消喜欢" : "喜欢", likedNow ? "♥" : "♡");
    like.classList.toggle("on", likedNow);
    like.addEventListener("click", () => {
      const wanted = !isLiked(hit.id, hit.liked);
      void window.tide.likeSong(hit.id, wanted).then((result) => {
        if (!result.ok) {
          note(result.message, true);
          return;
        }
        applyLike(hit.id, result.liked);
        note(result.message, false);
      });
    });

    const more = iconButton("更多", "⋯");
    const menu = document.createElement("div");
    menu.className = "track-menu";
    menu.hidden = true;
    more.addEventListener("click", () => {
      menu.hidden = !menu.hidden;
    });

    const playItem = menuButton("播放", () => {
      if (!hit.playable) {
        note("没有可播放的地址", true);
        return;
      }
      void window.tide.playHits([...hits], index);
    });
    playItem.disabled = !hit.playable;
    const nextItem = menuButton("下一首播放", () => {
      void window.tide.playNext(hit).then(() => note("已插到下一首", false));
    });
    const likeItem = menuButton("喜欢", () => like.click());
    const shareItem = menuButton("分享链接", () => {
      const url = songPageUrl(hit.id);
      void navigator.clipboard.writeText(url).then(
        () => note("链接已复制", false),
        () => note(`复制失败：${url}`, true),
      );
    });

    const collect = document.createElement("label");
    collect.className = "collect";
    collect.textContent = "收藏到…";
    const picker = document.createElement("select");
    picker.setAttribute("aria-label", "收藏到歌单");
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = playlists.length === 0 ? "请先登录" : "选择歌单";
    picker.append(empty);
    for (const playlist of playlists) {
      const option = document.createElement("option");
      option.value = playlist.id;
      option.textContent = playlist.name;
      picker.append(option);
    }
    const save = menuButton("收藏", () => {
      if (picker.value.length === 0) {
        note(playlists.length === 0 ? "请先登录后再收藏" : "先选一个歌单", true);
        return;
      }
      void window.tide.collectSong(picker.value, hit.id).then((result) => {
        note(result.ok ? result.message : result.message, !result.ok);
      });
    });
    collect.append(picker, save);
    menu.append(playItem, nextItem, likeItem, collect, shareItem);

    item.append(play, main, like, more, menu);
    list.append(item);
  });
}

function iconButton(label: string, glyph: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  button.setAttribute("aria-label", label);
  button.textContent = glyph;
  return button;
}

function menuButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}
