import { Heart, MoreHorizontal, Play } from "lucide";
import type { PlaylistCursor, PlaylistSummary, SearchHit } from "../shared/contract";
import { paintCover } from "./cover";
import { ICON_SIZE, iconButton, setIcon } from "./icons";
import { applyLike, isLiked } from "./liked";
import { openTrackMenu } from "./track-menu";

export function songPageUrl(id: string): string {
  return `https://music.163.com/song?id=${encodeURIComponent(id)}`;
}

/** Song rows with a play shortcut and the N8 menu. */
export function fillTrackList(
  list: HTMLElement,
  hits: readonly SearchHit[],
  playlists: readonly PlaylistSummary[],
  note: (message: string, warn: boolean) => void,
  source?: PlaylistCursor,
  onRemove?: (id:string)=>void,
): void {
  list.replaceChildren();
  const start = document.createElement("li");
  start.className = "hit-start";
  const startButton = document.createElement("button");
  startButton.type = "button";
  startButton.className = "text-button";
  startButton.textContent = "开始播放";
  startButton.addEventListener("click", async () => {
    const state=await window.tide.getPlayback();const playable=hits.map((h,i)=>h.playable?i:-1).filter(i=>i>=0);
    const index=state.shuffle?playable[Math.floor(Math.random()*playable.length)]??-1:playable[0]??-1;
    if (index < 0) {
      note("没有可播放的地址", true);
      return;
    }
    void window.tide.playHits([...hits], index, source);
  });
  start.append(startButton);
  list.append(start);
  hits.forEach((hit, index) => {
    const item = document.createElement("li");
    item.className = "hit-row";

    const play = iconButton(hit.playable ? "播放" : "没有可播放的地址", "Play", Play, ICON_SIZE.row);
    play.disabled = !hit.playable;
    play.addEventListener("click", () => {
      if (!hit.playable) return;
      void window.tide.playHits([...hits], index, source);
    });

    const art = document.createElement("span");
    art.className = "hit-cover";
    paintCover(art, hit.cover, { lazy: true });
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
        list.dataset.selected = String(index);
        list.querySelectorAll(".hit").forEach((row) => row.classList.remove("is-selected"));
        main.classList.add("is-selected");
      });
      main.addEventListener("dblclick", () => {
        void window.tide.playHits([...hits], index, source);
      });
    }

    const likedNow = isLiked(hit.id, hit.liked);
    const like = iconButton(likedNow ? "取消喜欢" : "喜欢", "Heart", Heart, ICON_SIZE.row);
    like.classList.toggle("on", likedNow);
    if (likedNow) setIcon(like, "Heart", Heart, ICON_SIZE.row, true);
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

    const more = iconButton("更多", "MoreHorizontal", MoreHorizontal, ICON_SIZE.row);
    const menu = document.createElement("div");
    menu.className = "track-menu";
    menu.hidden = true;
    more.addEventListener("click", () => {
      openTrackMenu(menu, more);
    });
    more.setAttribute("aria-haspopup", "dialog"); more.setAttribute("aria-expanded", "false");
    item.addEventListener("contextmenu", event => { event.preventDefault(); openTrackMenu(menu, more, { x:event.clientX,y:event.clientY }); });

    const playItem = menuButton("播放", () => {
      if (!hit.playable) {
        note("没有可播放的地址", true);
        return;
      }
      void window.tide.playHits([...hits], index, source);
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
      void (picker.value.startsWith("tide-list-")?window.tide.addToTidePlaylist(picker.value,hit):window.tide.collectSong(picker.value, hit.id)).then((result) => {
        note(result.message??(result.ok?"已收藏":"收藏失败"), !result.ok);
      });
    });
    collect.append(picker, save);
    menu.append(playItem, nextItem, likeItem, collect, shareItem);
    if(onRemove)menu.append(menuButton("从此歌单移除",()=>onRemove(hit.id)));

    item.append(art, play, main, like, more);
    list.append(item);
  });
}

function menuButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}
