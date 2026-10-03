/* Embed KD NiFi assistant from another HTML page.
 *
 *   <script src="http://localhost:27120/embed.js"></script>
 *   <kd-nifi-chat></kd-nifi-chat>
 *
 * or:
 *   <div id="nifi-slot"></div>
 *   <script src="http://localhost:27120/embed.js"></script>
 *   <script>KDNifiChat.mount("#nifi-slot");</script>
 */
(function (global) {
  var DEFAULT_SRC = "http://localhost:27120/";

  function frame(src, height) {
    var iframe = document.createElement("iframe");
    iframe.src = src || DEFAULT_SRC;
    iframe.title = "KD NiFi assistant";
    iframe.style.cssText =
      "width:100%;height:" +
      (height || "720px") +
      ";border:1px solid #e5e7eb;border-radius:12px;background:#fff;";
    iframe.setAttribute("loading", "lazy");
    iframe.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
    return iframe;
  }

  class KdNifiChat extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      var src = this.getAttribute("src") || DEFAULT_SRC;
      var height = this.getAttribute("height") || "720px";
      this.style.display = "block";
      this.appendChild(frame(src, height));
    }
  }

  if (!customElements.get("kd-nifi-chat")) {
    customElements.define("kd-nifi-chat", KdNifiChat);
  }

  global.KDNifiChat = {
    src: DEFAULT_SRC,
    mount: function (target, opts) {
      opts = opts || {};
      var el = typeof target === "string" ? document.querySelector(target) : target;
      if (!el) throw new Error("KDNifiChat.mount: element not found");
      el.innerHTML = "";
      el.appendChild(frame(opts.src || DEFAULT_SRC, opts.height || "720px"));
      return el;
    },
  };
})(window);
