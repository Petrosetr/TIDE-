      (function () {
        var progressFill = document.querySelector(".progress-fill");
        var faqItems = document.querySelectorAll(".faq-item");
        var root = document.documentElement;
        var shadowScreen = document.querySelector(".shadow-screen");
        var topbar = document.querySelector(".topbar");

        var getConfigUrl = function (key, fallback) {
          var config = window.TIDE_CONFIG || {};
          return typeof config[key] === "string" && config[key].trim() ? config[key].trim() : fallback;
        };

        var applyConfiguredLinks = function () {
          var workspaceUrl = getConfigUrl("workspaceUrl", "./setup");
          var setupUrl = workspaceUrl.replace(/\/+$/, "") + "/setup";

          document.querySelectorAll("[data-workspace-link]").forEach(function (link) {
            link.setAttribute("href", setupUrl);
          });
        };

        var updateProgress = function () {
          if (!progressFill) return;
          var scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
          var ratio = scrollHeight > 0 ? window.scrollY / scrollHeight : 0;
          progressFill.style.width = Math.min(ratio * 100, 100) + "%";
        };

        var updateScene = function () {
          var scrollY = window.scrollY;
          var heroShift = Math.min(scrollY * 0.08, 32);
          root.style.setProperty("--hero-shift", heroShift.toFixed(1) + "px");

          if (!shadowScreen) return;
          var rect = shadowScreen.getBoundingClientRect();
          var viewportMid = window.innerHeight * 0.5;
          var offset = (viewportMid - rect.top) * 0.05;
          var clamped = Math.max(Math.min(offset, 18), -18);
          root.style.setProperty("--screen-shift", clamped.toFixed(1) + "px");
        };

        var updateScrollState = function () {
          if (topbar) {
            topbar.classList.toggle("is-scrolled", window.scrollY > 12);
          }
          updateProgress();
          updateScene();
        };

        /* ── Scroll reveal observer ── */
        (function initReveal() {
          var els = document.querySelectorAll(".reveal");
          if (!els.length || !("IntersectionObserver" in window)) {
            els.forEach(function (e) { e.classList.add("is-visible"); });
            return;
          }
          var obs = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
              if (entry.isIntersecting) {
                entry.target.classList.add("is-visible");
                obs.unobserve(entry.target);
              }
            });
          }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
          els.forEach(function (e) { obs.observe(e); });
        })();

        /* ── River stream generator ── */
        (function buildRiver() {
          var svg = document.getElementById("riverSvg");
          if (!svg) return;
          var NS = "http://www.w3.org/2000/svg";

          /*
           * ONE base path from original index.html (Band C).
           * ALL streams are parallel copies at Y offsets.
           * Same curve = ZERO crossings, guaranteed.
           */
          /* Control points — wave starts from the very first point.
           * Same amplitude as original (~160px crests), just no flat lead-in.
           * Trough slightly deeper for visible lower crest.
           * Progressive spread at the end via SPREAD multiplier. */
          /* Smooth mathematical wave — sine × Gaussian envelope.
           * ~24 cubic Bézier segments with Hermite-derived control points
           * guarantee G2+ continuity (no kinks anywhere). */
          /*
           * Precompute centerline (dy=0) and its slope compensation factors.
           * slopeComp[i] = sqrt(1 + slope²) at each sample point.
           * Multiplying dy by slopeComp keeps perpendicular distance between
           * adjacent streams constant even on steep curve sections.
           */
          var NSEGS = 24;
          var pathX0 = -242, pathXEnd = 1608, pathXRange = pathXEnd - pathX0;
          var centerXs = new Array(NSEGS + 1);
          var centerYs = new Array(NSEGS + 1);
          var slopeComp = new Array(NSEGS + 1);
          (function precomputeCenterline() {
            var dx = pathXRange / NSEGS;
            for (var i = 0; i <= NSEGS; i++) {
              var t = i / NSEGS;
              centerXs[i] = pathX0 + t * pathXRange;
              var base = 730 - 700 * t;
              var phase = 2 * Math.PI * t * 1.15;
              var env = Math.exp(-Math.pow((t - 0.28) / 0.45, 2));
              centerYs[i] = base - 160 * Math.sin(phase) * env;
            }
            for (var i = 0; i <= NSEGS; i++) {
              var slope;
              if (i === 0) slope = (centerYs[1] - centerYs[0]) / dx;
              else if (i === NSEGS) slope = (centerYs[NSEGS] - centerYs[NSEGS - 1]) / dx;
              else slope = (centerYs[i + 1] - centerYs[i - 1]) / (2 * dx);
              slopeComp[i] = Math.sqrt(1 + slope * slope);
            }
          })();

          function buildPath(dy) {
            var xs = [], ys = [], slopes = [];
            for (var i = 0; i <= NSEGS; i++) {
              var t = i / NSEGS;
              /* spread: quadratic ease-in so derivative is 0 at onset (no kink) */
              var st = Math.max(0, (t - 0.5) / 0.5);
              var spread = 1 + st * st * 1.5;
              xs.push(centerXs[i]);
              /* slopeComp widens gap at steep sections to prevent visual overlap */
              ys.push(centerYs[i] + dy * spread * slopeComp[i]);
            }
            /* central-difference slopes for Hermite interpolation */
            var dx = pathXRange / NSEGS;
            for (var i = 0; i <= NSEGS; i++) {
              if (i === 0) slopes.push((ys[1] - ys[0]) / dx);
              else if (i === NSEGS) slopes.push((ys[NSEGS] - ys[NSEGS - 1]) / dx);
              else slopes.push((ys[i + 1] - ys[i - 1]) / (2 * dx));
            }
            /* build cubic Bézier path from Hermite data */
            var p = "M" + xs[0].toFixed(1) + " " + ys[0].toFixed(1);
            for (var i = 0; i < NSEGS; i++) {
              var segDx = xs[i + 1] - xs[i];
              var c1x = xs[i] + segDx / 3;
              var c1y = ys[i] + slopes[i] * segDx / 3;
              var c2x = xs[i + 1] - segDx / 3;
              var c2y = ys[i + 1] - slopes[i + 1] * segDx / 3;
              p += "C" + c1x.toFixed(1) + " " + c1y.toFixed(1) + "," +
                   c2x.toFixed(1) + " " + c2y.toFixed(1) + "," +
                   xs[i + 1].toFixed(1) + " " + ys[i + 1].toFixed(1);
            }
            return p;
          }

          /*
           * 12 streams, each its own color — no two adjacent share a color.
           * Width and dash-length wildly varied between streams.
           * Within each stream, dasharray is also varied (see render loop).
           */
          /*
           * 11 streams. Widths vary per-frame via animated stroke-width.
           * Each stream's width oscillates slowly, and neighbors compensate
           * by adjusting GAP dynamically. Static widths are the BASE.
           */
          var streams = [
            { w: 18, col: "#39D7DB", dl: 280  },
            { w: 55, col: "#1B58CF", dl: 900  },
            { w: 22, col: "#E7FCFF", dl: 450  },
            { w: 65, col: "#113D8F", dl: 1400 },
            { w: 20, col: "#1CC4D0", dl: 200  },
            { w: 48, col: "#2E7BE6", dl: 700  },
            { w: 25, col: "#4B9FE8", dl: 1100 },
            { w: 58, col: "#22DDD9", dl: 350  },
            { w: 16, col: "#154EAA", dl: 550  },
            { w: 60, col: "#2874B8", dl: 1600 },
          ];

          /* Stack: gap between adjacent stream edges */
          var GAP = 20;
          var totalH = 0;
          for (var i = 0; i < streams.length; i++) totalH += streams[i].w;
          totalH += (streams.length - 1) * GAP;
          var cursor = -totalH / 2;
          for (var i = 0; i < streams.length; i++) {
            streams[i].dy = cursor + streams[i].w / 2;
            cursor += streams[i].w + GAP;
          }

          /*
           * Width redistribution system.
           * Total width budget = sum of all base widths (constant).
           * Each stream has a chaotic "weight" (3 incommensurate sines).
           * Weights are normalized → widths redistribute: thickest ↔ thinnest.
           * dy recomputed each frame to keep GAP constant.
           */
          var N = streams.length;
          var wBase = [];
          var totalBudget = 0;
          for (var i = 0; i < N; i++) {
            wBase.push(streams[i].w);
            totalBudget += streams[i].w;
          }
          var minW = 8; /* never thinner than 8px */
          var maxW = 46; /* capped to reduce overlap at steep curve sections */

          /* 3 sine components per stream — smooth but visible (~20-60s cycles) */
          var wSines = [];
          for (var i = 0; i < N; i++) {
            wSines.push([
              { f: 0.0385 + i * 0.00517 },
              { f: 0.0231 + i * 0.00341 },
              { f: 0.0143 + i * 0.00253 }
            ]);
          }

          /* pathEls[streamIndex] = array of <path> elements for that stream */
          var pathEls = [];
          for (var i = 0; i < N; i++) pathEls.push([]);

          /* Render in stacking order (by Y position) — no overlap between lanes */
          var order = streams.map(function (s, i) { return { s: s, i: i }; });

          /* Seeded pseudo-random for reproducible varied dashes */
          function seededRand(seed) {
            var s = seed;
            return function () {
              s = (s * 1103515245 + 12345) & 0x7fffffff;
              return s / 0x7fffffff;
            };
          }

          /* Full palette — no colors too dark for the hero bg */
          var palette = [
            "#E7FCFF","#B0F0F5","#39D7DB","#30E8E4","#22DDD9",
            "#1CC4D0","#2E7BE6","#1B58CF","#4B9FE8","#2874B8",
            "#154EAA","#113D8F"
          ];

          /*
           * ALL lanes share ONE cycle length and ONE speed.
           * Same speed = drops never shift relative to each other = ZERO crossings.
           * Each drop still has unique color + length for variety.
           */
          var SPEED = 38; /* seconds per cycle — slow, smooth flow */
          var CYCLE = 3400; /* shared cycle length for all lanes */
          var timeSeed = Date.now() % 10000;

          /* Pre-randomize widths so streams look varied on first frame */
          (function preRandomize() {
            var fakeT = 200; /* simulate 200s of animation elapsed */
            var wSum = 0;
            var pw = new Array(N);
            for (var i = 0; i < N; i++) {
              var v = 1 +
                0.35 * Math.sin(fakeT * wSines[i][0].f * 2 * Math.PI) +
                0.2 * Math.sin(fakeT * wSines[i][1].f * 2 * Math.PI) +
                0.1 * Math.sin(fakeT * wSines[i][2].f * 2 * Math.PI);
              pw[i] = Math.max(0.15, v);
              wSum += pw[i];
            }
            for (var i = 0; i < N; i++) {
              streams[i].w = Math.min(maxW, Math.max(minW, totalBudget * pw[i] / wSum));
            }
            /* Restack with new widths */
            var tH = 0;
            for (var i = 0; i < N; i++) tH += streams[i].w;
            tH += (N - 1) * GAP;
            var c = -tH / 2;
            for (var i = 0; i < N; i++) {
              streams[i].dy = c + streams[i].w / 2;
              c += streams[i].w + GAP;
            }
          })();

          for (var r = 0; r < order.length; r++) {
            var s = order[r].s;
            var d = buildPath(s.dy);
            var rng = seededRand(order[r].i * 13 + 7 + timeSeed);

            /*
             * Fill the cycle with drops.
             * Gap must be > stroke width to prevent round-linecap overlap.
             * Bias toward shorter dashes (more short, fewer long).
             */
            /* Step 1: generate drop lengths, filling cycle densely */
            var safeGap = Math.round(s.w * 1.5) + 12;
            var dropLens = [];
            var dropCols = [];
            var totalLen = 0;
            while (totalLen < CYCLE - safeGap) {
              var t = rng();
              var dl = Math.round(50 + t * t * 500);
              dropLens.push(dl);
              dropCols.push(palette[Math.floor(rng() * palette.length)]);
              totalLen += dl + safeGap;
            }

            /* Step 2: distribute remaining space as gaps (at least safeGap each) */
            var nDrops = dropLens.length;
            var sumLen = 0;
            for (var gi = 0; gi < nDrops; gi++) sumLen += dropLens[gi];
            var totalGapBudget = CYCLE - sumLen;
            var baseGap = Math.max(safeGap, Math.floor(totalGapBudget / nDrops));

            /* Step 3: build drops with small random jitter on gaps */
            var drops = [];
            for (var gi = 0; gi < nDrops; gi++) {
              var jitter = Math.round((rng() - 0.5) * safeGap * 0.5);
              var gap = Math.max(safeGap, baseGap + jitter);
              drops.push({ len: dropLens[gi], gap: gap, col: dropCols[gi] });
            }

            /* Place drops sequentially within the shared cycle */
            var cursor = 0;
            for (var k = 0; k < drops.length; k++) {
              cursor += drops[k].gap;
              var dl = drops[k].len;

              var el = document.createElementNS(NS, "path");
              el.setAttribute("class", "flow-seg");
              el.setAttribute("d", d);
              el.setAttribute("style",
                "--lane-width:" + s.w + "px;" +
                "--seg-color:" + drops[k].col + ";" +
                "stroke-dasharray:" + dl + " " + (CYCLE - dl) + ";" +
                "--seg-offset:-" + cursor + "px;" +
                "--seg-shift:" + CYCLE + "px;" +
                "--seg-speed:" + SPEED + "s"
              );
              el._baseDash = dl;
              el._baseW = s.w;
              pathEls[order[r].i].push(el);
              svg.appendChild(el);

              cursor += dl;
            }
          }
          /*
           * Width animation loop.
           * Each stream's "weight" oscillates chaotically (3 sines).
           * Weights normalized → budget redistributed → sum constant.
           * dy recomputed each frame → GAP stays exactly the same.
           * Dash length compensated for linecap size changes.
           */
          /* Start 200s in the "past" so widths are already randomized on load */
          var t0 = performance.now() - 200000;
          var weights = new Array(N);
          var curWidths = new Array(N);

          function computeWeights(t) {
            var wSum = 0;
            for (var i = 0; i < N; i++) {
              var v = 1 +
                0.35 * Math.sin(t * wSines[i][0].f * 2 * Math.PI) +
                0.2 * Math.sin(t * wSines[i][1].f * 2 * Math.PI) +
                0.1 * Math.sin(t * wSines[i][2].f * 2 * Math.PI);
              weights[i] = Math.max(0.15, v);
              wSum += weights[i];
            }
            for (var i = 0; i < N; i++) {
              curWidths[i] = Math.min(maxW, Math.max(minW, totalBudget * weights[i] / wSum));
            }
          }

          function animateWidths(now) {
            var t = (now - t0) / 1000;

            /* 1–2. Compute weights and distribute budget */
            computeWeights(t);

            /* 3. Recompute dy to keep GAP constant */
            var tH = 0;
            for (var i = 0; i < N; i++) tH += curWidths[i];
            tH += (N - 1) * GAP;
            var c = -tH / 2;
            for (var i = 0; i < N; i++) {
              var dy = c + curWidths[i] / 2;
              var newPath = buildPath(dy);
              c += curWidths[i] + GAP;

              var w = curWidths[i];
              var wStr = w.toFixed(1);
              var els = pathEls[i];
              for (var j = 0; j < els.length; j++) {
                els[j].setAttribute("d", newPath);
                els[j].style.strokeWidth = wStr + "px";
                /* Compensate linecap growth */
                var capDelta = w - els[j]._baseW;
                var adjDash = Math.max(1, els[j]._baseDash - capDelta);
                els[j].style.strokeDasharray = adjDash.toFixed(1) + " " + (CYCLE - adjDash).toFixed(1);
              }
            }
            requestAnimationFrame(animateWidths);
          }
          requestAnimationFrame(animateWidths);
        })();

        updateScrollState();
        applyConfiguredLinks();
        window.addEventListener("scroll", updateScrollState, { passive: true });
        window.addEventListener("resize", updateScrollState);

        faqItems.forEach(function (item) {
          var trigger = item.querySelector(".faq-trigger");
          if (!trigger) return;

          trigger.addEventListener("click", function () {
            var willOpen = !item.classList.contains("is-open");

            faqItems.forEach(function (other) {
              var otherTrigger = other.querySelector(".faq-trigger");
              other.classList.remove("is-open");
              if (otherTrigger) {
                otherTrigger.setAttribute("aria-expanded", "false");
              }
            });

            if (willOpen) {
              item.classList.add("is-open");
              trigger.setAttribute("aria-expanded", "true");
            }
          });
        });
      })();


      (function renderLiveProof() {
        var proof = (window.TIDE_CONFIG && window.TIDE_CONFIG.proof) || null;
        var section = document.getElementById("live-proof");
        if (!section) {
          return;
        }
        section.removeAttribute("hidden");
        if (!proof || !proof.policyAnchor || !proof.receiptMint) {
          return;
        }

        function setText(id, value) {
          var el = document.getElementById(id);
          if (el) el.textContent = value || "—";
        }
        function setLink(id, value, href) {
          var el = document.getElementById(id);
          if (!el) return;
          if (value && href) {
            el.textContent = value;
            el.setAttribute("href", href);
          } else {
            el.textContent = "—";
            el.removeAttribute("href");
          }
        }
        function shortHex(value) {
          if (!value) return "";
          var v = String(value);
          if (v.length <= 16) return v;
          return v.slice(0, 10) + "…" + v.slice(-6);
        }
        function formatDate(value) {
          if (!value) return "";
          var d = new Date(value);
          if (isNaN(d.getTime())) return "";
          return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
        }

        var commit = proof.commit || "";
        var commitShort = proof.commitShort || (commit ? commit.slice(0, 7) : "");
        setLink(
          "live-proof-commit",
          commitShort || "—",
          commit ? "https://github.com/Petrosetr/TIDE-/commit/" + encodeURIComponent(commit) : ""
        );
        setText("live-proof-run", proof.runLabel || "Latest run");
        setText("live-proof-generated", formatDate(proof.generatedAt));
        setLink(
          "live-proof-policy-tx",
          shortHex(proof.policyAnchor.txDigest),
          proof.policyAnchor.txUrl || ""
        );
        setLink(
          "live-proof-policy-obj",
          shortHex(proof.policyAnchor.objectId),
          proof.policyAnchor.objectUrl || ""
        );
        setLink(
          "live-proof-mint-tx",
          shortHex(proof.receiptMint.txDigest),
          proof.receiptMint.txUrl || ""
        );
        setLink(
          "live-proof-receipt-obj",
          shortHex(proof.receiptMint.objectId),
          proof.receiptMint.objectUrl || ""
        );
        setText("live-proof-railpack", shortHex(proof.railPackDigestHex));
      })();
