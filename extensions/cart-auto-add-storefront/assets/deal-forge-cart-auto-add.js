(function () {
  var TAG = "_deal_forge_auto";
  var DEBOUNCE = 400;
  var P = "[df]";
  var timer;
  var cachedRules;
  var proxyTried;

  function rulesDom() {
    var el = document.getElementById("deal-forge-cart-auto-add-rules");
    if (!el) return [];
    try {
      var j = JSON.parse(el.textContent.trim());
      return Array.isArray(j) ? j : [];
    } catch (e) {
      console.warn(P, "rules JSON:", e.message);
      return [];
    }
  }

  function rules() {
    if (cachedRules != null) return cachedRules;
    return rulesDom();
  }

  function fetchProxy() {
    var fe = document.getElementById("deal-forge-cart-auto-add-fetch");
    var p = "/apps/customer-discount/cart-auto-add-rules";
    if (fe) {
      try {
        p = JSON.parse(fe.textContent.trim());
      } catch (e) {
        /* ignore */
      }
    }
    return fetch(p, { credentials: "same-origin" }).then(function (r) {
      if (!r.ok) return Promise.reject();
      return r.json();
    });
  }

  function ensureRules() {
    var d = rulesDom();
    if (d.length) {
      cachedRules = d;
      return Promise.resolve(d);
    }
    if (proxyTried) {
      return Promise.resolve(cachedRules != null ? cachedRules : []);
    }
    proxyTried = true;
    return fetchProxy().then(
      function (j) {
        cachedRules = Array.isArray(j) ? j : [];
        return cachedRules;
      },
      function () {
        cachedRules = [];
        return cachedRules;
      },
    );
  }

  function root() {
    return (
      (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) ||
      "/"
    );
  }

  function gidTail(g) {
    if (!g || typeof g !== "string") return null;
    var a = g.split("/");
    return a[a.length - 1] || null;
  }

  function hasTag(item) {
    var pr = item.properties;
    return pr && pr[TAG] != null && pr[TAG] !== "";
  }

  function autoIdx(items) {
    for (var i = 0; i < items.length; i++) if (hasTag(items[i])) return i;
    return -1;
  }

  function buySum(items, gids) {
    var id = {};
    for (var i = 0; i < gids.length; i++) {
      var t = gidTail(gids[i]);
      if (t) id[t] = 1;
    }
    var n = 0;
    for (var j = 0; j < items.length; j++) {
      if (hasTag(items[j])) continue;
      var pid = items[j].product_id != null ? String(items[j].product_id) : "";
      if (pid && id[pid]) n += items[j].quantity || 0;
    }
    return n;
  }

  function getManual(items, rule) {
    var want = gidTail(rule.get_variant_id);
    var gp = {};
    (rule.get_product_ids || []).forEach(function (g) {
      var t = gidTail(g);
      if (t) gp[t] = 1;
    });
    for (var k = 0; k < items.length; k++) {
      if (hasTag(items[k])) continue;
      var vid = items[k].variant_id != null ? String(items[k].variant_id) : "";
      var pid = items[k].product_id != null ? String(items[k].product_id) : "";
      if (want && vid === want) return true;
      if (pid && gp[pid]) return true;
    }
    return false;
  }

  function pickRule(items, rs) {
    for (var r = 0; r < rs.length; r++) {
      var rule = rs[r];
      var buys = rule.buy_product_ids || [];
      var gv = rule.get_variant_id;
      var need = Number(rule.buy_qty != null ? rule.buy_qty : 1);
      if (!gv || !buys.length) continue;
      if (buySum(items, buys) < need) continue;
      if (getManual(items, rule)) continue;
      return rule;
    }
    return null;
  }

  function diagnose() {
    return ensureRules().then(function () {
      var rs = rules();
      return cart().then(function (c) {
        var it = c.items || [];
        console.info(P, "DIAG", {
          src: rulesDom().length ? "liq" : proxyTried ? "pxy" : "x",
          rules: rs,
          ok: !!pickRule(it, rs),
          L: it.map(function (x) {
            return [x.product_id, x.variant_id, x.quantity, hasTag(x) ? 1 : 0];
          }),
        });
        return c;
      });
    });
  }

  function cart() {
    return fetch(root() + "cart.js", { credentials: "same-origin" }).then(
      function (x) {
        return x.json();
      },
    );
  }

  function parseCartRes(x) {
    return x.json().then(function (j) {
      if (!x.ok) {
        console.warn(P, "cart HTTP", x.status, j);
      }
      return j;
    });
  }

  function change(line, qty) {
    return fetch(root() + "cart/change.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ line: line, quantity: qty }),
    }).then(parseCartRes);
  }

  function addVar(vid, qty) {
    var pr = {};
    pr[TAG] = "1";
    return fetch(root() + "cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        items: [{ id: Number(vid), quantity: qty, properties: pr }],
      }),
    }).then(parseCartRes);
  }

  function sa() {
    return cart().then(function loop(c) {
      var ix = autoIdx(c.items || []);
      if (ix < 0) return;
      return change(ix + 1, 0).then(function () {
        return cart().then(loop);
      });
    });
  }

  function refreshUi() {
    var rt = window.routes || {};
    var base = rt.cart_url || root() + "cart";
    var q = base.indexOf("?") >= 0 ? "&" : "?";
    var ch = Promise.resolve();

    if (document.querySelector("cart-drawer")) {
      ch = ch.then(function () {
        return fetch(base + q + "section_id=cart-drawer", {
          credentials: "same-origin",
        })
          .then(function (x) {
            return x.text();
          })
          .then(function (html) {
            var doc = new DOMParser().parseFromString(html, "text/html");
            ["cart-drawer-items", ".cart-drawer__footer"].forEach(function (
              sel,
            ) {
              var s = doc.querySelector(sel);
              var d = document.querySelector(sel);
              if (s && d) d.replaceWith(s);
            });
          });
      });
    }

    var mw = document.getElementById("main-cart-items");
    var ct = mw && mw.querySelector("cart-items");
    if (ct) {
      ch = ch.then(function () {
        return fetch(base + q + "section_id=main-cart-items", {
          credentials: "same-origin",
        })
          .then(function (x) {
            return x.text();
          })
          .then(function (html) {
            var doc = new DOMParser().parseFromString(html, "text/html");
            var src = doc.querySelector("cart-items");
            if (src) ct.innerHTML = src.innerHTML;
          });
      });
    }

    return ch.catch(function () {});
  }

  function emit() {
    document.dispatchEvent(new CustomEvent("deal-forge:cart-auto-add"));
  }

  function afterAdd(res) {
    if (res && (res.status || res.errors)) {
      console.warn(P, res.description || res.message || res.errors);
    } else {
      emit();
    }
    return refreshUi();
  }

  function sync() {
    return ensureRules().then(function (rs) {
      return cart().then(function (c) {
        var items = c.items || [];
        var rule = pickRule(items, rs);
        if (!rule) {
          return sa().then(refreshUi);
        }

        var vid = gidTail(rule.get_variant_id);
        var qty = Number(rule.get_qty != null ? rule.get_qty : 1);
        var ai = autoIdx(items);

        if (ai >= 0) {
          var cur = items[ai];
          if (String(cur.variant_id) === vid && (cur.quantity || 0) === qty) {
            return;
          }
          return sa()
            .then(function () {
              return addVar(vid, qty);
            })
            .then(afterAdd);
        }

        return addVar(vid, qty).then(afterAdd);
      });
    });
  }

  function sched() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      sync().catch(function (e) {
        console.warn(P, e);
      });
    }, DEBOUNCE);
  }

  function cartUrl(u) {
    return (
      u &&
      typeof u === "string" &&
      (u.indexOf("cart/add") >= 0 ||
        u.indexOf("cart/change") >= 0 ||
        u.indexOf("cart/update") >= 0 ||
        u.indexOf("cart/clear") >= 0)
    );
  }

  function patchFetch() {
    var o = window.fetch;
    if (!o || o.__df) return;
    window.fetch = function () {
      var a = arguments;
      var u = typeof a[0] === "string" ? a[0] : a[0] && a[0].url;
      return o.apply(this, arguments).then(function (r) {
        if (cartUrl(u)) {
          sched();
        }
        return r;
      });
    };
    window.fetch.__df = true;
  }

  function patchXHR() {
    if (XMLHttpRequest.prototype.__df) return;
    var oo = XMLHttpRequest.prototype.open;
    var os = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function () {
      var u = arguments[1];
      this.__dfU =
        typeof u === "string" ? u : u && u.toString ? u.toString() : "";
      return oo.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var x = this;
      x.addEventListener("load", function () {
        if (cartUrl(x.__dfU)) {
          sched();
        }
      });
      return os.apply(this, arguments);
    };
    XMLHttpRequest.prototype.__df = true;
  }

  patchFetch();
  patchXHR();

  document.addEventListener("cart:updated", sched);

  window.__dealForgeCartAutoAdd = {
    sched: sched,
    sync: sync,
    rules: rules,
    diagnose: diagnose,
  };

  ensureRules().then(function () {
    var n = rules().length;
    console.info(P, "ready; rules count:", n);
    if (!n) console.info(P, "x:discount+proxy diagnose()");
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", sched);
    } else {
      sched();
    }
  });
})();
