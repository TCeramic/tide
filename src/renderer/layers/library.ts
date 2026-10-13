import type { ApiFailure, SessionSnapshot } from "../../shared/contract";

/** Login and playlist list inside #chrome. Playback stays a later milestone. */
export function mountLibrary(root: HTMLElement): {
  setApiReady: (ready: boolean) => void;
  destroy: () => void;
} {
  const panel = document.createElement("aside");
  panel.className = "library";
  panel.setAttribute("aria-label", "网易云歌单");

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

  panel.append(heading, note, actions, list, form);
  root.append(panel);

  let pollTimer = 0;
  let apiReady = false;
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
      const name = document.createElement("span");
      name.textContent = playlist.name;
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = String(playlist.trackCount);
      item.append(name, count);
      list.append(item);
    }
    const signedIn = session.state === "logged_in";
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

  return {
    setApiReady(ready) {
      apiReady = ready;
      refresh.disabled = !ready;
      qrButton.disabled = !ready;
      save.disabled = !ready;
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
