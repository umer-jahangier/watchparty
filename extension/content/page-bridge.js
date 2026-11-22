// WatchParty fullscreen bridge (MAIN world).
// Only active inside embedded iframe players, and only while a party is running
// (the isolated content script sets data-wp-party="1" on this frame's <html>).
// It turns the player's own fullscreen request into "Fullscreen with chat" on the top
// page, so the party panel stays visible. The top page (YouTube etc.) is never patched.
(() => {
  if (window === window.top) return;

  const root = () => document.documentElement;
  const active = () => root()?.getAttribute("data-wp-party") === "1";
  const nativeReq = Element.prototype.requestFullscreen;
  const nativeWebkitReq = Element.prototype.webkitRequestFullscreen;
  const nativeExit = Document.prototype.exitFullscreen;
  const nativeWebkitExit = Document.prototype.webkitExitFullscreen;
  let fake = null;

  function fire(el) {
    ["fullscreenchange", "webkitfullscreenchange"].forEach((type) => {
      try {
        (el && el.isConnected ? el : document).dispatchEvent(new Event(type, { bubbles: true }));
      } catch {
        /* ignore */
      }
    });
  }

  function post(enter) {
    try {
      window.parent.postMessage({ source: "wp-fs", enter }, "*");
    } catch {
      /* ignore */
    }
  }

  function enter(el) {
    fake = el;
    post(true);
    fire(el);
    return Promise.resolve();
  }

  function leave(notifyTop) {
    if (!fake) return Promise.resolve();
    const el = fake;
    fake = null;
    if (notifyTop) post(false);
    fire(el);
    return Promise.resolve();
  }

  if (nativeReq) {
    Element.prototype.requestFullscreen = function (opts) {
      return active() ? enter(this) : nativeReq.call(this, opts);
    };
  }
  if (nativeWebkitReq) {
    Element.prototype.webkitRequestFullscreen = function (opts) {
      if (active()) {
        enter(this);
        return undefined;
      }
      return nativeWebkitReq.call(this, opts);
    };
  }
  if (nativeExit) {
    Document.prototype.exitFullscreen = function () {
      return fake ? leave(true) : nativeExit.call(this);
    };
  }
  if (nativeWebkitExit) {
    Document.prototype.webkitExitFullscreen = function () {
      if (fake) {
        leave(true);
        return undefined;
      }
      return nativeWebkitExit.call(this);
    };
  }

  ["fullscreenElement", "webkitFullscreenElement", "webkitCurrentFullScreenElement"].forEach((name) => {
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, name);
    if (!desc || !desc.get || desc.configurable === false) return;
    Object.defineProperty(Document.prototype, name, {
      configurable: true,
      get() {
        if (fake && this === document) return fake;
        return desc.get.call(this);
      },
    });
  });

  // The top page left "Fullscreen with chat" (Esc, exit button, party ended).
  window.addEventListener("wp-fs-state", (e) => {
    if (e.detail === "off") leave(false);
  });
})();
