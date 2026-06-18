(function () {
  var P = "[df-gift]";

  function esc(s) {
    var el = document.createElement("span");
    el.textContent = s || "";
    return el.innerHTML;
  }

  function ready(cb) {
    if (window.__dealForgeCartAutoAdd) {
      cb(window.__dealForgeCartAutoAdd);
      return;
    }
    var n = 0;
    var t = setInterval(function () {
      if (window.__dealForgeCartAutoAdd) {
        clearInterval(t);
        cb(window.__dealForgeCartAutoAdd);
      } else if (++n > 50) {
        clearInterval(t);
      }
    }, 100);
  }

  function renderWidget(api, rule) {
    var host = api.ensureWidgetHost();
    if (!host) return;

    var badge = api.promoLabel(rule);
    var title = rule.get_title || "";
    var img = rule.get_image_url || "";
    var imgHtml = img
      ? '<img class="df-gift-widget__img" src="' +
        esc(img) +
        '" alt="' +
        esc(title) +
        '" width="88" height="88" loading="lazy">'
      : "";

    host.style.display = "";
    host.innerHTML =
      '<div class="df-gift-widget">' +
      '<div class="df-gift-widget__inner">' +
      imgHtml +
      '<div class="df-gift-widget__body">' +
      '<span class="df-gift-widget__badge">' +
      esc(badge) +
      "</span>" +
      '<p class="df-gift-widget__title">' +
      esc(title) +
      "</p>" +
      "</div>" +
      '<button type="button" class="df-gift-widget__btn">Claim Gift</button>' +
      "</div>" +
      "</div>";

    var btn = host.querySelector(".df-gift-widget__btn");
    if (!btn) return;

    btn.addEventListener("click", function () {
      var vid = api.gidTail(rule.get_variant_id);
      var qty = Number(rule.get_qty != null ? rule.get_qty : 1);
      if (!vid) return;

      btn.disabled = true;
      api
        .addGiftManual(vid, qty)
        .then(function (res) {
          if (res && (res.status || res.errors)) {
            console.warn(P, res.description || res.message || res.errors);
            btn.disabled = false;
            return;
          }
          return api.refreshUi().then(function () {
            api.sched();
          });
        })
        .catch(function (e) {
          console.warn(P, e);
          btn.disabled = false;
        });
    });
  }

  ready(function (api) {
    document.addEventListener("deal-forge:gift-widget-show", function (e) {
      var rule = e.detail && e.detail.rule;
      if (!rule) return;
      renderWidget(api, rule);
    });

    document.addEventListener("deal-forge:gift-widget-hide", function () {
      var host = document.getElementById("df-gift-widget");
      if (host) {
        host.innerHTML = "";
        host.style.display = "none";
      }
    });

    console.info(P, "ready");
  });
})();
