/* ============================================================
   UI : 화면 렌더링 + 플레이어 조작
   XSS 방지: 사용자 입력(name/leader/capital 등)은 esc()로 이스케이프
   ============================================================ */
(function () {
  "use strict";

  var D = window.SIM_DATA;

  /* HTML 이스케이프 */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fmt(n) { return Math.round(n).toLocaleString("ko-KR"); }
  function clamp(v, lo, hi) { if (lo === undefined) lo = 0; if (hi === undefined) hi = 100; return Math.max(lo, Math.min(hi, v)); }

  /* 정보 불확실성 표시: 신뢰도에 따라 근사치 반환 */
  function fuzzy(val, rel) {
    if (rel >= 90) return fmt(val);
    var mult = (rel < 85 ? 1.35 : 1.15);
    var lo = Math.max(0, Math.round(val * (1 - mult * ((100 - rel) / 100))));
    var hi = Math.round(val * (1 + mult * ((100 - rel) / 100)));
    return "약 " + fmt(lo) + "~" + fmt(hi);
  }
  function fuzzyPct(val, rel) {
    if (rel >= 90) return Math.round(val) + "%";
    var m = (100 - rel) / 4;
    var c = Math.round(val) + ri(-m, m);
    return clamp(c, 0, 100) + "%";
  }
  function ri(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

  var ui = {
    world: null,
    activeTab: "nation",
    selected: null,          // 선택된 타국 id or null
    mapMode: "view",         // view | found | invade
    foundRegion: null,       // 창건 선택 지역
    invadeTarget: null,
    cbTarget: null,
    cbSelected: null,
    spyTarget: null
  };

  var $ = function (sel) { return document.querySelector(sel); };
  function el(id) { return document.getElementById(id); }

  ui.attach = function (world) {
    ui.world = world;
    bindHeader();
    bindTabs();
    bindFooter();
  };

  function bindHeader() {}
  function bindTabs() {}

  function bindFooter() {
    var endBtn = el("btnEndTurn");
    if (endBtn) endBtn.addEventListener("click", function () {
      if (!ui.world || !ui.world.playerId) return;
      if (ui.world.playerPrompt && ui.world.playerPrompt.valid && ui.world.playerPrompt.kind === "allydefense") {
        flashMessage("외교 결정(동맹국 방어)을 먼저 선택하세요.");
        return;
      }
      ui.world.tick();
      SaveLib.autosave(ui.world);
      renderAll();
      flashMessage("턴 종료 — 세계가 움직였습니다. (제" + ui.world.turn + "턴)");
    });
    var saveBtn = el("btnSave");
    if (saveBtn) saveBtn.addEventListener("click", function () {
      SaveLib.exportFile(ui.world);
      SaveLib.autosave(ui.world);
      flashMessage("세이브 파일을 다운로드했습니다.");
    });
    var loadBtn = el("btnLoad");
    if (loadBtn) loadBtn.addEventListener("click", openLoadModal);
    var newBtn = el("btnNewGame");
    if (newBtn) newBtn.addEventListener("click", function () {
      if (ui.world && ui.world.playerId) {
        if (!confirm("새 국가를 만들면 현재 진행을 잃게 됩니다. 계속하시겠습니까?")) return;
      }
      ui.newGameFlow();
    });
  }

  /* ---------- 전체 렌더링 ---------- */
  function renderAll() {
    if (!ui.world) return;
    renderHeader();
    renderMap();
    renderPromptBar();
    renderTab();
    renderNewsMini();
  }

  function renderHeader() {
    var w = ui.world;
    var elDate = el("hDate"), elTurn = el("hTurn"), elPeace = el("hPeace"), elEra = el("hEra");
    if (elDate) elDate.textContent = w.dateString();
    if (elTurn) elTurn.textContent = "제" + w.turn + "턴";
    if (elPeace) elPeace.textContent = "세계 평화도 " + Math.round(w.worldPeace) + "%";
    if (w.worldPeace < 40) elPeace.className = "hval bad";
    else if (w.worldPeace < 70) elPeace.className = "hval warn";
    else elPeace.className = "hval good";
    if (elEra) elEra.textContent = worldEra(w);
  }

  function worldEra(w) {
    var wars = w.wars.filter(function (x) { return x.status === "active"; });
    if (wars.length >= 3) return "🔴 세계대전 시기";
    if (wars.length >= 1) return "🟠 국지전 시기";
    if (w.tension > 55) return "🟡 긴장 고조";
    return "🟢 평화기";
  }

  /* ---------- 지도 ---------- */
  function renderMap() {
    var svg = el("mapSvg");
    if (!svg || !ui.world) return;
    var w = ui.world;
    var W = 9, H = 6;
    var vbW = D.SIZE * Math.sqrt(3) * (W + 0.5) + D.SIZE * 2 + 20;
    var vbH = D.SIZE * 1.5 * (H - 1) + D.SIZE * 2 + 20;
    svg.setAttribute("viewBox", "0 0 " + vbW.toFixed(1) + " " + vbH.toFixed(1));

    var html = "";
    html += '<defs><pattern id="occStripes" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="8" stroke="#000" stroke-width="3" opacity="0.45"/></pattern></defs>';

    var keys = Object.keys(w.regions);
    for (var i = 0; i < keys.length; i++) {
      var r = w.regions[keys[i]];
      var fill, stroke = "#26303c", sw = 1.5;
      var country = r.owner ? w.countries[r.owner] : null;

      if (ui.mapMode === "found") {
        if (r.owner === null) {
          fill = "#ffe9a8";
          stroke = ui.foundRegion === r.id ? "#ffdd00" : "#8a6d00";
          sw = ui.foundRegion === r.id ? 4 : 2;
        } else {
          fill = darken(country ? country.color : "#555", 0.55);
          sw = 1;
        }
      } else {
        fill = country ? country.color : "#3a4350";
        if (country && country.isPlayer) { stroke = "#ffffff"; sw = 3; }
        if (ui.selected === r.owner) { stroke = "#ffe600"; sw = 3; }
      }

      var cls = "region";
      if (r.owner === null) cls += " neutral";
      if (country && country.isPlayer) cls += " mine";
      var title = (r.name + (country ? " [" + country.name + "]" : " (무인 지역)"));

      html += '<polygon id="reg-' + esc(r.id) + '" class="' + cls + '" points="' + r.points + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '">';
      html += '<title>' + esc(title) + '</title>';
      html += '</polygon>';

      // 점령지 표시
      if (r.captured) {
        html += '<polygon points="' + r.points + '" fill="url(#occStripes)" stroke="none" pointer-events="none"/>';
      }

      // 도시 마커: 수도/주요도시
      if (country && country.capital && country.regions && false) { }
    }

    // 국가명 라벨(지역 중심 근처)
    html += '<g id="labels" pointer-events="none">';
    var done = {};
    for (var j = 0; j < keys.length; j++) {
      var rr = w.regions[keys[j]];
      if (rr.owner && !done[rr.owner]) {
        done[rr.owner] = 1;
        var c = w.countries[rr.owner];
        html += '<text x="' + rr.cx + '" y="' + (rr.cy - 4) + '" text-anchor="middle" class="map-label" fill="#fff">' + esc(c ? c.name : "") + '</text>';
        // 수도 표시
        if (c) {
          html += '<text x="' + rr.cx + '" y="' + (rr.cy + 12) + '" text-anchor="middle" class="map-cap" fill="#ffe">' + (ui.mapMode === "found" ? "" : "★") + '</text>';
        }
      }
    }
    html += '</g>';

    // 플레이어 capital 위치 작은 별
    html += markerHTML();

    svg.innerHTML = html;

    // 클릭 이벤트
    var polys = svg.querySelectorAll("polygon.region");
    polys.forEach(function (p) {
      p.addEventListener("click", function (ev) {
        var rid = p.getAttribute("id").replace("reg-", "");
        handleRegionClick(rid);
      });
    });
  }

  function markerHTML() {
    var w = ui.world;
    if (!w || !w.playerId) return "";
    var c = w.countries[w.playerId];
    if (!c) return "";
    // 플레이어 영토 중 지리적 중심 찾기
    var regs = w.regionsOf(w.playerId);
    if (!regs.length) return "";
    var cx = 0, cy = 0;
    for (var i = 0; i < regs.length; i++) {
      var r = w.regions[regs[i]];
      cx += r.cx; cy += r.cy;
    }
    cx /= regs.length; cy /= regs.length;
    return '<g pointer-events="none"><circle cx="' + cx + '" cy="' + cy + '" r="5" fill="#fff" stroke="' + esc(c.color) + '" stroke-width="2"/><text x="' + cx + '" y="' + (cy + 15) + '" text-anchor="middle" class="map-cap">★수도</text></g>';
  }

  function darken(hex, f) {
    var m = hex.replace("#", "");
    if (m.length === 3) m = m.split("").map(function (x) { return x + x; }).join("");
    var r = parseInt(m.substr(0, 2), 16), g = parseInt(m.substr(2, 2), 16), b = parseInt(m.substr(4, 2), 16);
    r = Math.round(r * f); g = Math.round(g * f); b = Math.round(b * f);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  function handleRegionClick(rid) {
    var w = ui.world;
    if (ui.mapMode === "found") {
      var r = w.regions[rid];
      if (r.owner !== null) {
        flashMessage("무인 지역을 선택하세요. (회색 강조 칸)");
        return;
      }
      ui.foundRegion = rid;
      renderMap();
      if (ui.confirmFound) ui.confirmFound(rid);
      return;
    }
    var r2 = w.regions[rid];
    if (!r2.owner) {
      openNeutralModal(rid);
      return;
    }
    if (r2.owner === w.playerId) {
      ui.selected = null;
      setTab("nation");
      return;
    }
    ui.selected = r2.owner;
    renderMap();
    openCountryModal(r2.owner);
  }

  /* ---------- 뉴스 미리보기 ---------- */
  function renderNewsMini() {
    var box = el("newsMini");
    if (!box || !ui.world) return;
    var news = ui.world.news.slice(0, 5);
    var html = "";
    for (var i = 0; i < news.length; i++) {
      var n = news[i];
      html += '<div class="news-item' + (n.importance <= 1 ? " imp" : "") + '"><div class="news-date">' + esc(n.date) + '</div><div class="news-title">' + esc(n.title) + '</div></div>';
    }
    if (!news.length) html = '<div class="muted">아직 뉴스가 없습니다. 턴 종료를 눌러 세계를 움직여보세요.</div>';
    box.innerHTML = html;
  }

  /* ---------- 프롬프트 바 (동맹방어 등) ---------- */
  function renderPromptBar() {
    var box = el("promptBar");
    if (!box) return;
    var w = ui.world;
    if (!w) { box.innerHTML = ""; return; }
    var p = w.playerPrompt;
    if (!p || !p.valid) { box.innerHTML = ""; return; }

    if (p.kind === "allydefense") {
      var war = w.wars.filter(function (x) { return x.id === p.warId; })[0];
      if (!war || war.status !== "active") { box.innerHTML = ""; return; }
      var ally = w.countries[p.allyId];
      if (!ally) { box.innerHTML = ""; return; }
      box.innerHTML =
        '<div class="prompt"><div class="prompt-tit">⚠️ 동맹국 방어 요청</div>' +
        '<div class="prompt-txt">동맹국 <b>' + esc(ally.name) + '</b>이(가) <b>' + esc(war.name) + '</b>에 휘말렸습니다.</div>' +
        '<div class="prompt-actions">' +
        '<button data-opt="join">참전</button>' +
        '<button data-opt="fund">금전 지원</button>' +
        '<button data-opt="arms">무기 지원</button>' +
        '<button data-opt="neutral">중립</button>' +
        '</div></div>';
      box.querySelectorAll("button").forEach(function (b) {
        b.addEventListener("click", function () {
          resolveAllyDefense(b.getAttribute("data-opt"), war, ally);
        });
      });
    } else if (p.kind === "regionlost") {
      box.innerHTML =
        '<div class="prompt warn"><div class="prompt-tit">⚠️ 영토 상실</div>' +
        '<div class="prompt-txt"><b>' + esc(p.rname) + '</b>이(가) 적에게 점령되었습니다. 국민들이 불안에 떨고 있습니다.</div>' +
        '<div class="prompt-actions"><button data-opt="ok">확인</button></div></div>';
      box.querySelector("button").addEventListener("click", function () {
        w.playerPrompt.valid = false;
        renderPromptBar();
      });
    } else {
      box.innerHTML = "";
    }
  }

  function resolveAllyDefense(opt, war, ally) {
    var w = ui.world;
    var me = w.player();
    if (!me) return;
    switch (opt) {
      case "join": {
        var myAllySide = war.defenders.indexOf(ally.id) >= 0 ? "def" : "atk";
        w.addWarParticipant(war.id, "player", myAllySide);
        var enemy = myAllySide === "def" ? war.attackerId : war.defenders[0];
        w.relChange("player", enemy, -25);
        w.news("전쟁", "⚔️ " + me.name + "이 " + war.name + "에 참전한다!", me.name + "은 상호방위 조약에 따라 동맹국 " + ally.name + "을 지원하기 위해 전쟁에 개입했다.", 1);
        flashMessage("전쟁에 참전했습니다!");
        break;
      }
      case "fund": {
        var cost = Math.min(4000, me.treasury * 0.1);
        me.treasury -= cost;
        ally.treasury += cost;
        w.relChange("player", ally.id, 4);
        w.news("외교", me.name + "이 동맹국 " + ally.name + "에 지원금 " + fmt(cost) + "억을 보냈다.", "동맹국의 전시 체제 유지를 돕기 위한 지원이다.", 3);
        break;
      }
      case "arms": {
        var acost = Math.min(3000, me.treasury * 0.08);
        me.treasury -= acost;
        ally.military.equipment = clamp(ally.military.equipment + 3);
        w.relChange("player", ally.id, 3);
        w.news("군사", me.name + "이 동맹국 " + ally.name + "에 무기를 지원했다.", "동맹국의 군사 장비 보강을 위한 성의로 읽힌다.", 3);
        break;
      }
      case "neutral": {
        w.relChange("player", ally.id, -3);
        w.news("외교", me.name + "이 동맹국 분쟁에 중립을 선언했다.", "동맹국 " + ally.name + "은 실망감을 나타냈다.", 3);
        break;
      }
    }
    w.playerPrompt.valid = false;
    renderPromptBar();
    renderTab();
  }

  /* ---------- 플레이어 국가 상세 탭들 ---------- */

  function setTab(name) {
    ui.activeTab = name;
    renderTab();
  }

  function tabClass(name) {
    return "tb" + (ui.activeTab === name ? " on" : "");
  }

  function renderTab() {
    var w = ui.world;
    var c = w ? w.player() : null;
    var content = el("tabContent");
    if (!content) return;

    var tabButtons = [
      ["nation", "국가"], ["economy", "경제"], ["military", "군사"],
      ["diplomacy", "외교"], ["intel", "정보"], ["politics", "정치"],
      ["world", "세계"], ["news", "뉴스"]
    ];
    var btns = "";
    for (var i = 0; i < tabButtons.length; i++) {
      btns += '<button class="' + tabClass(tabButtons[i][0]) + '" data-tab="' + tabButtons[i][0] + '">' + tabButtons[i][1] + '</button>';
    }
    var tabbar = '<div class="tabbar">' + btns + '</div>';

    if (!c) {
      content.innerHTML = tabbar + '<div class="panel-note">국가를 먼저 생성하세요.</div>';
    } else {
      var inner = "";
      switch (ui.activeTab) {
        case "nation": inner = renderNation(c); break;
        case "economy": inner = renderEconomy(c); break;
        case "military": inner = renderMilitary(c); break;
        case "diplomacy": inner = renderDiplomacy(c); break;
        case "intel": inner = renderIntel(c); break;
        case "politics": inner = renderPolitics(c); break;
        case "world": inner = renderWorld(); break;
        case "news": inner = renderNews(); break;
      }
      content.innerHTML = tabbar + inner;
    }

    content.querySelectorAll("[data-tab]").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        ui.selected = null;
        setTab(b.getAttribute("data-tab"));
      });
    });
    wireTabActions(content);
  }

  /* 국가 탭 */
  function renderNation(c) {
    var w = ui.world;
    var atWar = w.atWar(c.id);
    var govLabel = c.government;
    var html = "";
    html += '<div class="nation-head"><span class="color-dot" style="background:' + esc(c.color) + '"></span><h2>' + esc(c.name) + '</h2>';
    html += '<div class="muted">' + esc(govLabel) + ' · 지도자 ' + esc(c.leader) + ' · 수도 ' + esc(c.capital) + '</div>';
    if (atWar) html += '<div class="badge war">전쟁 중</div>';
    html += '</div>';

    html += statsGrid([
      ["인구", fmt(c.population) + "명"], ["GDP", fmt(c.gdp) + "억"],
      ["국고", fmt(c.treasury) + "억"], ["부채", fmt(c.debt) + "억"],
      ["지지도", Math.round(c.society.support) + "%"], ["정권 안정도", Math.round(c.society.stability) + "%"],
      ["군사력", c.militaryPower()], ["영토", w.regionsOf(c.id).length + " 지역"]
    ]);

    /* 예산 슬라이더 */
    html += '<div class="section"><div class="section-t">국가 예산 배분 (%)</div>';
    var keys = ["military", "welfare", "admin", "research", "diplomacy"];
    var names = { military: "군사비", welfare: "복지비", admin: "행정비", research: "연구비", diplomacy: "외교비" };
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      html += '<div class="budget-row"><label>' + names[k] + '</label><input type="range" min="5" max="60" value="' + c.budget[k] + '" data-bkey="' + k + '"><span class="budget-val">' + c.budget[k] + '%</span></div>';
      html += '<button style="display:none" data-bapply="' + k + '"></button>';
    }
    html += '<div class="row-btns"><button data-action="applyBudget">예산 적용</button><button data-action="autoBudget">자동 최적화</button></div></div>';

    html += '<div class="section"><div class="section-t">국가 성향</div>';
    html += bar("군국주의", c.personality.militarism);
    html += bar("외교성", c.personality.diplomacy);
    html += bar("경제중시", c.personality.economy);
    html += bar("공격성", c.personality.aggression);
    html += bar("고립주의", c.personality.isolation);
    html += '</div>';

    html += '<div class="section"><div class="section-t">현재 국가 목표</div>';
    if (c.goals && c.goals.length) {
      html += '<ol class="goals">';
      for (var g = 0; g < c.goals.length; g++) html += '<li>' + esc(c.goals[g].text) + '</li>';
      html += '</ol>';
    } else html += '<div class="muted">아직 목표가 없다.</div>';
    html += '</div>';

    if (c.note) html += '<div class="note">' + esc(c.note) + '</div>';
    return html;
  }

  function statsGrid(items) {
    var html = '<div class="stats-grid">';
    for (var i = 0; i < items.length; i++) {
      html += '<div class="stat"><div class="stat-v">' + items[i][1] + '</div><div class="stat-l">' + items[i][0] + '</div></div>';
    }
    return html + '</div>';
  }

  function bar(label, val, color) {
    var col = color || "";
    return '<div class="bar-row"><span class="bar-l">' + label + '</span><div class="bar"><div class="bar-f" style="width:' + clamp(val, 0, 100) + '%;' + col + '"></div></div><span class="bar-v">' + Math.round(val) + '</span></div>';
  }

  /* 경제 탭 */
  function renderEconomy(c) {
    var w = ui.world;
    var atWar = w.atWar(c.id);
    var html = "";
    html += '<div class="section"><div class="section-t">경제 현황</div>';
    html += statsGrid([
      ["GDP", fmt(c.gdp) + "억"], ["성장률", (c.economyGrowth >= 0 ? "+" : "") + c.economyGrowth.toFixed(1) + "%"],
      ["1인당 GDP", fmt(c.gdp * 100000000 / c.population) + "억/인"], ["세율", c.taxRate + "%"],
      ["세입(예상)", fmt(c.taxIncome()) + "억"], ["지출(예상)", fmt(c.expenseTotal()) + "억"],
      ["물가", c.inflation.toFixed(1) + "%"], ["실업률", c.unemployment.toFixed(1) + "%"]
    ]);
    html += bar("사회 안정도", c.society.stability);
    html += bar("빈곤율", c.society.poverty);
    html += '</div>';

    html += '<div class="section"><div class="section-t">경제 정책</div>';
    html += '<div class="row"><label>세율 <b id="taxLabel">' + c.taxRate + '%</b></label>' +
      '<input type="range" min="5" max="40" value="' + c.taxRate + '" data-tax id="taxRange"></div>';
    html += '<div class="row-btns">' +
      '<button data-action="setTax">세율 적용</button>' +
      '<button data-action="invest">경제 투자 (-500억)</button>' +
      '<button data-action="welfare">복지 확대 (-600억)</button>' +
      '</div></div>';
    if (atWar) html += '<div class="warn">전쟁 중이라 경제가 크게 위축되고 있습니다.</div>';
    return html;
  }

  /* 군사 탭 */
  function renderMilitary(c) {
    var w = ui.world;
    var html = "";
    html += '<div class="section"><div class="section-t">군사 현황 <span class="sub">(군사력 ' + c.militaryPower() + ')</span></div>';
    html += statsGrid([
      ["육군(병력)", fmt(c.military.army) + "명"], ["예비군", fmt(c.military.reserves) + "명"],
      ["해군(함정)", fmt(c.military.navy) + "척"], ["공군(항공기)", fmt(c.military.air) + "대"],
      ["장비수준", Math.round(c.military.equipment)], ["군사기술", Math.round(c.military.tech)],
      ["군수/보급", Math.round(c.military.logistics)], ["사기", Math.round(c.military.morale)],
      ["동원력", Math.round(c.military.mobilization)]
    ]);
    html += '</div>';

    html += '<div class="section"><div class="section-t">군사 조치</div>';
    var recruitCost = 40;
    html += '<div class="row-btns">' +
      '<button data-action="recruit">모병 +1만 (-' + fmt(recruitCost * 10) + '억)</button>' +
      '<button data-action="train">사기 훈련 (-400억)</button>' +
      '<button data-action="equip">장비 구매 (-500억)</button>' +
      '<button data-action="mobilize">예비군 동원 (-800억)</button>' +
      '</div>';
    html += '<div class="muted">병력 유지에는 군사비가 소요됩니다.</div></div>';

    /* 전쟁 선포 */
    var nbrs = w.neighborsOf(c.id).filter(function (id) { return !w.atWar(c.id, id) && !hasAllianceOf(w, c.id, id); });
    if (nbrs.length) {
      html += '<div class="section"><div class="section-t">침략 선포</div>';
      html += '<select id="invadeSel"><option value="">— 공격 대상을 선택하세요 —</option>';
      for (var i = 0; i < nbrs.length; i++) {
        html += '<option value="' + esc(nbrs[i]) + '">' + esc(w.countries[nbrs[i]].name) + '</option>';
      }
      html += '</select>';
      html += '<div class="row-btns"><button data-action="invade">선포하기</button></div>';
      html += '<div class="muted">명분은 전쟁 선포 시 선택할 수 있습니다.</div></div>';
    }

    /* 현재 전쟁 */
    var myWars = w.warsOf(c.id).filter(function (x) { return x.status === "active"; });
    if (myWars.length) {
      html += '<div class="section"><div class="section-t">진행 중인 전쟁</div>';
      for (var k = 0; k < myWars.length; k++) {
        var ww = myWars[k];
        var side = w.warSideOf(ww, c.id);
        var prog = side === "atk" ? ww.progress : -ww.progress;
        var oppName = (side === "atk" ? ww.defenders[0] : ww.attackers[0]);
        html += '<div class="war-card">' +
          '<div class="war-name">' + esc(ww.name) + '</div>' +
          '<div class="muted">상대: ' + esc(oppName === c.id ? w.countries[oppName].name : (w.countries[oppName] ? w.countries[oppName].name : oppName)) + ' · 명분: ' + esc(ww.cbName) + '</div>' +
          '<div class="muted">점령: ' + ww.capturedByA.length + ' / 반격: ' + ww.capturedByD.length + ' · 전선: ' + esc(ww.phase) + '</div>' +
          '<div class="muted">사상자 · (' + fmt(ww.casualtiesA + ww.casualtiesD) + '명) · 피로 ' + (side === "atk" ? Math.round(ww.exhaustionA) : Math.round(ww.exhaustionD)) + '%</div>' +
          '<div class="row-btns">' +
          '<button data-action="peaceStatus">휴전 제안</button>' +
          '<button data-action="peaceCede">항복 (점령지 양도)</button>' +
          '</div></div>';
      }
      html += '</div>';
    }
    return html;
  }

  /* 외교 탭 */
  function renderDiplomacy(c) {
    var w = ui.world;
    var html = "";
    var ids = Object.keys(w.countries).filter(function (id) { return id !== c.id; });

    /* 동맹 목록 */
    var al = c.alliances;
    html += '<div class="section"><div class="section-t">동맹 (' + al.length + ')</div>';
    if (!al.length) html += '<div class="muted">체결된 동맹이 없습니다.</div>';
    for (var i = 0; i < al.length; i++) {
      var par = w.countries[al[i].partner];
      html += '<div class="diplo-row">🤝 <b>' + esc(par ? par.name : al[i].partner) + '</b>' +
        '<span class="muted">상호방위 ' + (al[i].mutualDefense ? "ON" : "OFF") + ' · 남은 기간 ' + al[i].yearsLeft + '년</span>' +
        '<button data-action="endAlliance" data-t="' + esc(al[i].partner) + '">탈퇴</button></div>';
    }
    html += '</div>';

    /* 무역 목록 */
    html += '<div class="section"><div class="section-t">무역협정 (' + c.tradePacts.length + ')</div>';
    if (!c.tradePacts.length) html += '<div class="muted">체결된 무역협정이 없습니다.</div>';
    for (var t = 0; t < c.tradePacts.length; t++) {
      var tp = w.countries[c.tradePacts[t]];
      html += '<div class="diplo-row">📦 <b>' + esc(tp ? tp.name : c.tradePacts[t]) + '</b><button data-action="endTrade" data-t="' + esc(c.tradePacts[t]) + '">파기</button></div>';
    }
    html += '</div>';

    /* 국가별 관계 */
    html += '<div class="section"><div class="section-t">외교 관계</div>';
    for (var j = 0; j < ids.length; j++) {
      var o = w.countries[ids[j]];
      var rel = c.relations[ids[j]] || 0;
      var relCls = rel < -30 ? "neg" : rel > 30 ? "pos" : "";
      var warring = w.atWar(c.id, ids[j]);
      html += '<div class="diplo-row">' +
        '<span class="color-dot" style="background:' + esc(o.color) + '"></span>' +
        '<b>' + esc(o.name) + '</b>' +
        '<span class="rel ' + relCls + '">' + (rel >= 0 ? "+" : "") + rel + '</span>' +
        (warring ? '<span class="badge war">전쟁</span>' : '') +
        '</div>' +
        '<div class="mini-actions">' +
        '<button data-action="improve" data-t="' + esc(ids[j]) + '">개선</button>' +
        '<button data-action="alliance" data-t="' + esc(ids[j]) + '">동맹</button>' +
        '<button data-action="trade" data-t="' + esc(ids[j]) + '">무역</button>' +
        '<button data-action="aid" data-t="' + esc(ids[j]) + '">지원</button>' +
        '<button data-action="sanction" data-t="' + esc(ids[j]) + '">제재</button>' +
        '<button data-action="worsen" data-t="' + esc(ids[j]) + '">압박</button>' +
        '</div>';
    }
    html += '</div>';
    return html;
  }

  /* 정보 탭 */
  function renderIntel(c) {
    var w = ui.world;
    var html = "";
    html += '<div class="section"><div class="section-t">정보 작전</div>';
    html += '<div class="muted">정보 작전을 수행하면 상대국의 실제 군사·경제 정보를 더 정확히 확인할 수 있습니다.</div>';
    html += '<select id="spySel"><option value="">— 정보 대상 선택 —</option>';
    var ids = Object.keys(w.countries).filter(function (id) { return id !== c.id; });
    for (var i = 0; i < ids.length; i++) {
      html += '<option value="' + esc(ids[i]) + '">' + esc(w.countries[ids[i]].name) + '</option>';
    }
    html += '</select>';
    html += '<div class="row-btns"><button data-action="spy">정보 작전 (-300억)</button></div>';
    html += '</div>';

    html += '<div class="section"><div class="section-t">외국 정보 (신뢰도별)</div>';
    for (var j = 0; j < ids.length; j++) {
      var o = w.countries[ids[j]];
      var rel2 = c.intelReliabilityOn(ids[j]);
      if (w.atWar(c.id, ids[j])) rel2 = clamp(rel2 + 10, 0, 100);
      html += '<div class="intel-card"><div class="intel-h">' + esc(o.name) + ' <span class="muted">신뢰도 ' + Math.round(rel2) + '%</span></div>';
      html += '<div class="intel-row">군사력 <b>' + fuzzy(o.militaryPower(), rel2) + '</b></div>';
      html += '<div class="intel-row">병력 <b>' + fuzzy(o.military.army, rel2) + '명</b></div>';
      html += '<div class="intel-row">국고 <b>' + fuzzy(o.treasury, rel2) + '억</b></div>';
      html += '<div class="intel-row">정권 안정도 <b>' + fuzzyPct(o.society.stability, rel2) + '</b></div>';
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  /* 정치 탭 */
  function renderPolitics(c) {
    var html = "";
    html += '<div class="section"><div class="section-t">정치 세력</div>';
    html += bar("정부 지지파", c.factions.gov);
    html += bar("군부", c.factions.military, "background:#c0392b");
    html += bar("야당", c.factions.opposition, "background:#e67e22");
    html += bar("급진파", c.factions.radical, "background:#8e44ad");
    html += bar("무당층", c.factions.neutral, "background:#95a5a6");
    html += '</div>';

    html += '<div class="section"><div class="section-t">정권 위험도</div>';
    html += bar("쿠데타 위험", c.coupRisk, c.coupRisk > 50 ? "background:#c0392b" : "background:#e67e22");
    html += '<div class="muted">정권 안정도 ' + Math.round(c.society.stability) + '% · 사회 갈등 ' + Math.round(c.society.conflict) + '</div>';
    html += '</div>';

    html += '<div class="section"><div class="section-t">대응 조치</div>';
    html += '<div class="row-btns">' +
      '<button data-action="reform">정치 개혁 (-800억)</button>' +
      '<button data-action="purge">군부 숙청 (-600억)</button>' +
      '<button data-action="police">경찰 강화 (-400억)</button>' +
      '<button data-action="talkOpp">야당과 협상 (-600억)</button>' +
      '<button data-action="emergency">비상사태 선포 (-1000억)</button>' +
      '</div>';
    html += '<div class="muted">* 비상사태는 안정도가 크게 오르지만 국제사회 반감이 있습니다.</div>';
    html += '</div>';
    return html;
  }

  /* 세계 탭 */
  function renderWorld() {
    var w = ui.world;
    var html = "";
    html += '<div class="section"><div class="section-t">국제 상황</div>';
    html += statsGrid([
      ["현재 턴", "제" + w.turn + "턴"], ["날짜", esc(w.dateString())],
      ["진행 전쟁", w.wars.filter(function (x) { return x.status === "active"; }).length + "건"],
      ["세계 긴장도", Math.round(w.tension) + "%"], ["세계 평화도", Math.round(w.worldPeace) + "%"]
    ]);
    html += '</div>';

    var wars = w.wars.filter(function (x) { return x.status === "active"; });
    if (wars.length) {
      html += '<div class="section"><div class="section-t">전쟁</div>';
      for (var i = 0; i < wars.length; i++) {
        var ww = wars[i];
        html += '<div class="war-card"><div class="war-name">⚔️ ' + esc(ww.name) + '</div>' +
          '<div class="muted">공격: ' + esc(w.countries[ww.attackerId].name) + ' · 방어: ' + esc(w.countries[ww.defenderId].name) + '</div>' +
          '<div class="muted">진행도 ' + (ww.progress >= 0 ? "+" : "") + Math.round(ww.progress) + ' · 명분: ' + esc(ww.cbName) + '</div></div>';
      }
      html += '</div>';
    }

    html += '<div class="section"><div class="section-t">국가 목록</div>';
    var ids = Object.keys(w.countries);
    for (var j = 0; j < ids.length; j++) {
      var c = w.countries[ids[j]];
      html += '<div class="country-mini" data-view="' + esc(ids[j]) + '">' +
        '<span class="color-dot" style="background:' + esc(c.color) + '"></span>' +
        '<div><b>' + esc(c.name) + '</b> <span class="muted">' + esc(c.government) + '</span></div>' +
        '<div class="muted">지도자 ' + esc(c.leader) + ' · 군사력 ' + c.militaryPower() + (c.isPlayer ? ' · <b>당신</b>' : '') + '</div>' +
        '</div>';
    }
    html += '</div>';
    return html;
  }

  /* 뉴스 탭 */
  function renderNews() {
    var w = ui.world;
    var html = '<div class="section"><div class="section-t">전체 세계 뉴스</div>';
    var news = w.news;
    if (!news.length) html += '<div class="muted">아직 뉴스가 없습니다.</div>';
    for (var i = 0; i < news.length; i++) {
      var n = news[i];
      html += '<div class="news-full' + (n.importance <= 1 ? " imp" : "") + '">' +
        '<div class="news-meta">' + esc(n.date) + ' · [' + esc(n.type) + ']</div>' +
        '<div class="news-title">' + esc(n.title) + '</div>' +
        '<div class="news-body">' + esc(n.body) + '</div>' +
        '</div>';
    }
    html += '</div>';
    return html;
  }

  /* ---------- 탭 내 버튼 이벤트 ---------- */
  function wireTabActions(content) {
    var w = ui.world;
    var c = w.player();

    /* 예산 슬라이더 */
    content.querySelectorAll("[data-bkey]").forEach(function (inp) {
      inp.addEventListener("input", function () {
        var val = parseInt(inp.value, 10);
        inp.parentNode.querySelector(".budget-val").textContent = val + "%";
        c.budget[inp.getAttribute("data-bkey")] = val;
      });
    });
    content.querySelectorAll("[data-action]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var act = btn.getAttribute("data-action");
        var t = btn.getAttribute("data-t");
        actPlayerAction(act, t);
      });
    });
    var taxRange = content.querySelector("[data-tax]");
    if (taxRange) {
      taxRange.addEventListener("input", function () {
        var l = document.getElementById("taxLabel");
        if (l) l.textContent = taxRange.value + "%";
      });
    }
    content.querySelectorAll("[data-view]").forEach(function (row) {
      row.addEventListener("click", function () {
        openCountryModal(row.getAttribute("data-view"));
      });
    });
  }

  /* 플레이어 행동 실행 */
  function actPlayerAction(act, t) {
    var w = ui.world;
    var c = w.player();
    switch (act) {
      case "applyBudget":
        SaveLib.autosave(w);
        flashMessage("예산이 적용되었습니다. 턴 종료 시 반영됩니다.");
        break;
      case "autoBudget": {
        var keys = ["military", "welfare", "admin", "research", "diplomacy"];
        var want = autoBudgetPreset(c);
        for (var i = 0; i < keys.length; i++) c.budget[keys[i]] = want[keys[i]];
        renderTab();
        flashMessage("상황에 맞게 예산을 자동 배분했습니다.");
        break;
      }
      case "setTax": {
        var tv = parseInt(document.getElementById("taxRange").value, 10);
        c.taxRate = tv;
        flashMessage("세율을 " + tv + "%로 변경했습니다.");
        break;
      }
      case "invest": {
        if (c.treasury < 500) { flashMessage("국고가 부족합니다."); return; }
        c.treasury -= 500; c.pending.invest += 500;
        flashMessage("경제 투자를 실행했습니다. 성장률에 반영됩니다.");
        renderTab(); break;
      }
      case "welfare": {
        if (c.treasury < 600) { flashMessage("국고가 부족합니다."); return; }
        c.treasury -= 600; c.pending.welfare += 1;
        flashMessage("복지 확대를 진행했습니다. 지지도가 오를 것입니다.");
        renderTab(); break;
      }
      case "recruit": {
        var cost = 400;
        if (c.treasury < cost) { flashMessage("국고가 부족합니다. (모병 " + fmt(cost) + "억 필요)"); return; }
        if (c.military.army >= c.population * 0.02) { flashMessage("모병 한도를 초과했습니다."); return; }
        c.treasury -= cost; c.military.army += 10000;
        flashMessage("1만 병력을 모병했습니다.");
        renderTab(); break;
      }
      case "train": {
        if (c.treasury < 400) { flashMessage("국고가 부족합니다."); return; }
        c.treasury -= 400; c.military.morale = clamp(c.military.morale + 3);
        flashMessage("사기 훈련을 실시했습니다.");
        renderTab(); break;
      }
      case "equip": {
        if (c.treasury < 500) { flashMessage("국고가 부족합니다."); return; }
        c.treasury -= 500; c.military.equipment = clamp(c.military.equipment + 2);
        flashMessage("신형 장비를 구매했습니다.");
        renderTab(); break;
      }
      case "mobilize": {
        if (c.treasury < 800) { flashMessage("국고가 부족합니다."); return; }
        if (c.military.reserves < 5000) { flashMessage("동원 가능한 예비군이 없습니다."); return; }
        c.treasury -= 800;
        var add = Math.floor(c.military.reserves * 0.1);
        c.military.army += add; c.military.reserves -= add;
        c.military.mobilization = clamp(c.military.mobilization + 2);
        flashMessage("예비군 " + fmt(add) + "명을 동원했습니다.");
        renderTab(); break;
      }
      case "invade": {
        var sel = document.getElementById("invadeSel");
        if (!sel || !sel.value) { flashMessage("공격 대상을 선택하세요."); return; }
        openCasusBelli(sel.value);
        break;
      }
      case "peaceStatus": case "peaceCede": {
        var wars = w.warsOf(c.id).filter(function (x) { return x.status === "active"; });
        if (!wars.length) return;
        var tw = wars[0];
        var peaceMode = act === "peaceCede" ? "cede" : "statusquo";
        w.suePeace(c.id, tw.id, peaceMode);
        renderTab(); break;
      }
      case "improve": {
        if (!t) return;
        var costI = 150;
        if (c.treasury < costI) { flashMessage("국고 부족 (사절 파견 비용 " + fmt(costI) + "억)"); return; }
        c.treasury -= costI;
        w.relChange(c.id, t, 8);
        flashMessage("외교 사절을 파견해 관계를 개선했습니다.");
        renderTab(); break;
      }
      case "worsen": {
        if (!t) return;
        w.relChange(c.id, t, -8);
        flashMessage("외교 압박을 가했습니다.");
        renderTab(); break;
      }
      case "alliance": {
        if (!t) return;
        var oc = w.countries[t];
        var rel = c.relations[t] || 0;
        if (rel < 15) { flashMessage("관계도가 낮아 동맹을 체결할 수 없습니다. (15 이상 필요)"); return; }
        var accept = Math.max(5, 45 + oc.personality.diplomacy * 0.3 + rel * 0.3);
        if (w.makeAlliance(c.id, t, true, true)) {
          flashMessage("동맹을 체결했습니다!");
        } else {
          flashMessage("동맹 체결에 실패했습니다.");
        }
        renderTab(); break;
      }
      case "trade": {
        if (!t) return;
        if (w.makeTrade(c.id, t)) flashMessage("무역협정을 체결했습니다!");
        else flashMessage("무역협정 체결에 실패했습니다.");
        renderTab(); break;
      }
      case "aid": {
        if (!t) return;
        openAidModal(t);
        break;
      }
      case "sanction": {
        if (!t) return;
        var costS = 300;
        if (c.treasury < costS) { flashMessage("국고 부족"); return; }
        c.treasury -= costS;
        w.relChange(c.id, t, -12);
        w.relChange(t, c.id, -12);
        var to = w.countries[t];
        to.embargoed = Math.max(to.embargoed, 3);
        w.news("외교", c.name + "이(가) " + to.name + "에 경제 제재를 가했다.", "무역 제한 조치가 발효되어 양국 경제에 영향을 줄 전망이다.", 3);
        flashMessage("제재를 가했습니다.");
        renderTab(); break;
      }
      case "endAlliance": {
        if (!t) return;
        var al = c.alliances.filter(function (x) { return x.partner === t; })[0];
        if (al) {
          c.alliances = c.alliances.filter(function (x) { return x.partner !== t; });
          var oo = w.countries[t];
          oo.alliances = oo.alliances.filter(function (x) { return x.partner !== c.id; });
          w.alliances = w.alliances.filter(function (x) { return !((x.a === c.id && x.b === t) || (x.a === t && x.b === c.id)); });
          w.relChange(c.id, t, -20);
          w.news("외교", c.name + "이(가) " + oo.name + "과의 동맹을 탈퇴했다.", "동맹 해지로 인해 양국 관계가 냉각될 전망이다.", 3);
          flashMessage("동맹에서 탈퇴했습니다.");
        }
        renderTab(); break;
      }
      case "endTrade": {
        if (!t) return;
        c.tradePacts = c.tradePacts.filter(function (x) { return x !== t; });
        var t2 = w.countries[t];
        t2.tradePacts = t2.tradePacts.filter(function (x) { return x !== c.id; });
        c.tradeLevel = Math.max(0, c.tradeLevel - 3);
        w.relChange(c.id, t, -6);
        flashMessage("무역협정을 파기했습니다.");
        renderTab(); break;
      }
      case "spy": {
        var sp = document.getElementById("spySel");
        var target = sp ? sp.value : null;
        if (!target) { flashMessage("정보 대상국을 선택하세요."); return; }
        if (c.treasury < 300) { flashMessage("국고가 부족합니다."); return; }
        c.treasury -= 300;
        c.ai.spies = (c.ai.spies || 0) + 1;
        var tg = w.countries[target];
        /* 정보로 정확도 상승 */
        w.news("정보", c.name + "의 정보기관이 " + tg.name + "에 대한 첩보 작전을 수행했다.", "정보 신뢰도가 상승해 상대 전력 파악이 용이해졌다.", 3);
        /* 발각 가능성 */
        if (chanceP(20 - tg.personality.isolation * 0.2)) {
          w.relChange(c.id, target, -15);
          tg.personality.aggression = clamp(tg.personality.aggression + 2);
          w.news("외교", "첩보 활동 발각!", c.name + "의 정보 활동이 " + tg.name + "에 적발되어 외교적 마찰이 일어났다.", 4);
        }
        flashMessage("정보 작전을 완료했습니다. 인텔 탭을 확인하세요.");
        renderTab(); break;
      }
      case "reform": {
        if (c.treasury < 800) { flashMessage("국고 부족"); return; }
        c.treasury -= 800;
        c.society.support = clamp(c.society.support + 6);
        c.society.stability = clamp(c.society.stability + 5);
        c.pending.welfare += 1;
        w.news("정치", c.name + "에서 정치 개혁이 시행됐다.", "국민 여론이 회복되고 정권 안정도가 올라가고 있다.", 3);
        flashMessage("개혁을 시행했습니다.");
        renderTab(); break;
      }
      case "purge": {
        if (c.treasury < 600) { flashMessage("국고 부족"); return; }
        c.treasury -= 600;
        c.factions.military = clamp(c.factions.military - 6);
        c.society.stability = clamp(c.society.stability + 3);
        c.society.conflict = clamp(c.society.conflict + 2);
        c.military.morale = clamp(c.military.morale - 3);
        w.news("정치", c.name + " 정부가 군부 숙청에 나섰다.", "군부 핵심 인사들이 대거 교체될 것으로 보인다.", 2);
        flashMessage("군부 숙청을 단행했습니다.");
        renderTab(); break;
      }
      case "police": {
        if (c.treasury < 400) { flashMessage("국고 부족"); return; }
        c.treasury -= 400;
        c.society.security = clamp(c.society.security + 5);
        c.society.conflict = clamp(c.society.conflict - 2);
        w.news("정치", c.name + "이 경찰력을 대폭 강화했다.", "치안이 개선되며 시민 불안이 가라앉고 있다.", 4);
        flashMessage("경찰력을 강화했습니다.");
        renderTab(); break;
      }
      case "talkOpp": {
        if (c.treasury < 600) { flashMessage("국고 부족"); return; }
        c.treasury -= 600;
        c.factions.opposition = clamp(c.factions.opposition - 4);
        c.society.stability = clamp(c.society.stability + 4);
        c.society.support = clamp(c.society.support + 2);
        w.news("정치", c.name + " 여야가 대화에 나섰다.", "야당과의 협상 타결이 기대되고 있다.", 3);
        flashMessage("야당과 협상했습니다.");
        renderTab(); break;
      }
      case "emergency": {
        if (c.treasury < 1000) { flashMessage("국고 부족"); return; }
        c.treasury -= 1000;
        c.society.stability = clamp(c.society.stability + 14);
        c.society.support = clamp(c.society.support - 3);
        murkPlayer(w, c, 3);
        w.news("정치", c.name + "이 비상사태를 선포했다.", "국제사회가 우려를 표명하며 인권 상황을 주시하고 있다.", 3);
        flashMessage("비상사태를 선포했습니다.");
        renderTab(); break;
      }
    }
  }

  function murkPlayer(w, c, amt) {
    var ids = Object.keys(w.countries);
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === c.id) continue;
      var o = w.countries[ids[i]];
      o.relations[c.id] = clamp((o.relations[c.id] || 0) - amt, -100, 100);
    }
  }

  /* ---------- 침략 명분 선택 ---------- */
  function openCasusBelli(targetId) {
    var w = ui.world;
    var t = w.countries[targetId];
    var html = '<div class="modal-back" data-close="1"><div class="modal">' +
      '<h3>⚔️ 침략 선포: ' + esc(t.name) + '</h3>' +
      '<div class="muted">명분을 선택하세요. 명분에 따라 국내 지지와 국제사회 반응이 달라집니다.</div>';
    for (var i = 0; i < D.casusBelli.length; i++) {
      var cb = D.casusBelli[i];
      html += '<div class="cb-item" data-cb="' + esc(cb.id) + '">' +
        '<b>' + esc(cb.name) + '</b><p>' + esc(cb.desc) + '</p>' +
        '<span class="muted">지지 ' + (cb.supportBonus >= 0 ? "+" : "") + cb.supportBonus + ' · 국제 반감 ' + cb.worldPenalty + '</span></div>';
    }
    html += '<div class="row-btns"><button data-close="1">취소</button></div></div></div>';
    var modal = openModalHTML(html);
    modal.querySelectorAll("[data-cb]").forEach(function (item) {
      item.addEventListener("click", function () {
        var cbId = item.getAttribute("data-cb");
        var war = w.declareWar("player", targetId, cbId);
        closeModal();
        renderAll();
        flashMessage(war ? "전쟁이 시작되었습니다!" : "전쟁을 선포할 수 없습니다.");
      });
    });
  }

  /* ---------- 지원금 모달 ---------- */
  function openAidModal(targetId) {
    var w = ui.world;
    var t = w.countries[targetId];
    var c = w.player();
    var html = '<div class="modal-back" data-close="1"><div class="modal">' +
      '<h3>💵 ' + esc(t.name) + ' 지원</h3><div class="muted">국고: ' + fmt(c.treasury) + '억</div>' +
      '<div class="aid-type">' +
      '<label><input type="radio" name="aidtype" value="open" checked> 공개 지원 (관계 +5)</label><br>' +
      '<label><input type="radio" name="aidtype" value="secret"> 비밀 지원 (발각 시 위험)</label></div>' +
      '<div><label>지원금: <input type="number" id="aidAmt" value="1000" min="100" max="' + Math.floor(c.treasury) + '"> 억</label></div>' +
      '<div class="row-btns"><button data-aid="1">지원</button><button data-close="1">취소</button></div></div></div>';
    var modal = openModalHTML(html);
    modal.querySelector("[data-aid]").addEventListener("click", function () {
      var amt = parseInt(document.getElementById("aidAmt").value, 10) || 0;
      if (amt < 100 || amt > c.treasury) { flashMessage("지원금이 잘못되었습니다."); return; }
      var type = modal.querySelector('input[name="aidtype"]:checked').value;
      c.treasury -= amt;
      if (type === "open") {
        t.treasury += amt;
        w.relChange(c.id, targetId, 5);
        w.news("외교", c.name + "이(가) " + t.name + "에 공개 지원금 " + fmt(amt) + "억을 제공했다.", "양국 관계가 개선될 전망이다.", 3);
        flashMessage("공개 지원을 완료했습니다.");
      } else {
        t.treasury += amt;
        if (chanceP(25)) {
          w.relChange(c.id, targetId, -20);
          w.news("외교", "⚠️ 비밀 지원 발각", t.name + " 정부가 " + c.name + "의 비밀 지원 사실을 폭로했다! 양국 관계가 급랭됐다.", 1);
          flashMessage("비밀 지원이 발각되었습니다!");
        } else {
          w.news("정보", c.name + "이(가) " + t.name + "에 비밀 지원을 집행했다.", "외부에 알려지지 않았다.", 4);
          flashMessage("비밀 지원이 집행됐습니다.");
        }
      }
      closeModal();
      renderTab();
    });
  }

  /* ---------- 국가 정보 모달 ---------- */
  function openCountryModal(cid) {
    var w = ui.world;
    var c = w.countries[cid];
    if (!c) return;
    var rel = w.playerId ? (w.countries[w.playerId].relations[cid] || 0) : 0;
    var html = '<div class="modal-back" data-close="1"><div class="modal country-modal">' +
      '<h3>' + esc(c.name) + '</h3>' +
      '<div class="muted">' + esc(c.government) + ' · 지도자 ' + esc(c.leader) + ' · 수도 ' + esc(c.capital) + '</div>' +
      statsGrid([
        ["인구", fmt(c.population) + "명"], ["GDP", fmt(c.gdp) + "억"],
        ["국고", fmt(c.treasury) + "억"], ["병력", fmt(c.military.army) + "명"],
        ["지지도", Math.round(c.society.support) + "%"], ["안정도", Math.round(c.society.stability) + "%"],
        ["군사력", c.militaryPower()], ["영토", w.regionsOf(cid).length + " 지역"]
      ]);
    if (w.playerId && cid !== w.playerId) {
      var relCls = rel < -30 ? "neg" : rel > 30 ? "pos" : "";
      html += '<div class="rel-view">당신과의 관계: <b class="rel ' + relCls + '">' + (rel >= 0 ? "+" : "") + rel + '</b></div>';
    }
    if (c.goals && c.goals.length) {
      html += '<div class="muted">현재 목표: ';
      var gs = [];
      for (var i = 0; i < c.goals.length; i++) gs.push(esc(c.goals[i].text));
      html += gs.join(" · ") + '</div>';
    }
    html += '<div class="row-btns"><button data-close="1">닫기</button></div></div></div>';
    var modal = openModalHTML(html);
    bindClose(modal);
  }

  /* 무인 지역 모달 */
  function openNeutralModal(rid) {
    var w = ui.world;
    var r = w.regions[rid];
    var c = w.player();
    var canAnnex = c && w.regions[rid].owner === null && neighborsOwner(w, rid, c.id);
    var html = '<div class="modal-back" data-close="1"><div class="modal">' +
      '<h3>🏜️ ' + esc(r.name) + '</h3>' +
      '<div class="muted">무인 경계 지역. 세계 어느 국가도 소유하지 않은 땅입니다.</div>' +
      (canAnnex ? '<div class="row-btns"><button data-annex="1">영토 편입 (-800억)</button></div>' : '') +
      '<div class="row-btns"><button data-close="1">닫기</button></div></div></div>';
    var modal = openModalHTML(html);
    var ann = modal.querySelector("[data-annex]");
    if (ann) {
      ann.addEventListener("click", function () {
        if (c.treasury < 800) { flashMessage("국고 부족"); return; }
        if (w.annexNeutral(c.id, rid, "player")) {
          closeModal();
          renderAll();
          flashMessage(esc(r.name) + "을(를) 편입했습니다!");
        }
      });
    }
    bindClose(modal);
  }

  function neighborsOwner(w, rid, cid) {
    var r = w.regions[rid];
    for (var i = 0; i < r.neighbors.length; i++) {
      if (w.regions[r.neighbors[i]].owner === cid) return true;
    }
    return false;
  }

  /* ---------- 모달/토스트 ---------- */
  var modalRoot;
  function openModalHTML(html) {
    if (modalRoot) closeModal();
    modalRoot = document.createElement("div");
    modalRoot.className = "modal-root";
    modalRoot.innerHTML = html;
    document.body.appendChild(modalRoot);
    bindClose(modalRoot);
    return modalRoot;
  }
  function closeModal() {
    if (modalRoot) { modalRoot.remove(); modalRoot = null; }
  }
  function bindClose(root) {
    var back = root.querySelector(".modal-back");
    if (back) {
      back.addEventListener("click", function (e) {
        if (e.target === back) closeModal();
      });
    }
    root.querySelectorAll("[data-close='1']").forEach(function (b) {
      b.addEventListener("click", function () { closeModal(); });
    });
  }

  function flashMessage(msg) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  /* ---------- 새 게임 ---------- */
  ui.startGame = ui.newGameFlow = function () {
    SaveLib.clearAutosave();
    ui.world = new World({});
    ui.world.refreshGoals();
    ui.attach(ui.world);
    renderAll();
    openNewGameModal();
  };

  function openNewGameModal() {
    var html =
      '<div class="modal-back" data-close="1"><div class="modal newgame-modal">' +
      '<h2>🌍 새 국가 창건</h2>' +
      '<div class="muted">세계는 당신이 참여하지 않아도 움직입니다. 이제 당신의 국가를 세우세요.</div>' +
      '<div class="form-grid">' +
      '<label>국가 이름<input id="ngName" maxlength="14" placeholder="예: 팝 공화국"></label>' +
      '<label>수도 이름<input id="ngCapital" maxlength="12" placeholder="예: 팝시티"></label>' +
      '<label>지도자 이름<input id="ngLeader" maxlength="12" placeholder="예: 팝"></label>' +
      '<label>정부 형태<select id="ngGov">' +
      '<option>공화국</option><option>입헌 군주국</option><option>전제 제국</option>' +
      '<option>연방 공화국</option><option>민주공화국</option><option>군사정권</option></select></label>' +
      '<label>국가 색상<input type="color" id="ngColor" value="#4A90E2"></label>' +
      '</div>' +
      '<div class="section"><div class="section-t">국가 성향</div>' +
      '<div class="row"><label>군국주의 <b id="vMil">50</b></label><input type="range" min="0" max="100" value="50" data-ng="mil"></div>' +
      '<div class="row"><label>외교성 <b id="vDip">50</b></label><input type="range" min="0" max="100" value="50" data-ng="dip"></div>' +
      '<div class="row"><label>경제중시 <b id="vEco">50</b></label><input type="range" min="0" max="100" value="50" data-ng="eco"></div>' +
      '<div class="row"><label>공격성 <b id="vAgg">50</b></label><input type="range" min="0" max="100" value="50" data-ng="agg"></div>' +
      '<div class="row"><label>고립주의 <b id="vIso">50</b></label><input type="range" min="0" max="100" value="50" data-ng="iso"></div>' +
      '</div>' +
      '<div class="row-btns">' +
      '<button data-ngnext="1" id="ngNext">지도에서 위치 선택 ▶</button>' +
      '<button data-close="1">나중에</button></div></div></div>';

    var modal = openModalHTML(html);
    var mv = modal.querySelectorAll("[data-ng]");
    mv.forEach(function (inp) {
      inp.addEventListener("input", function () {
        var id = "v" + capFirst(inp.getAttribute("data-ng"));
        var l = document.getElementById(id);
        if (l) l.textContent = inp.value;
      });
    });
    modal.querySelector("[data-ngnext]").addEventListener("click", function () {
      var name = (document.getElementById("ngName").value || "").trim();
      var capital = (document.getElementById("ngCapital").value || "").trim();
      var leader = (document.getElementById("ngLeader").value || "").trim();
      if (!name) { flashMessage("국가 이름을 입력하세요."); return; }
      if (!capital) capital = name + " 수도";
      if (!leader) leader = "국가 원수";
      ui.ngDraft = {
        name: name,
        capital: capital,
        leader: leader,
        government: document.getElementById("ngGov").value,
        color: document.getElementById("ngColor").value,
        personality: {
          militarism: inputV("mil"), diplomacy: inputV("dip"), economy: inputV("eco"),
          aggression: inputV("agg"), isolation: inputV("iso")
        }
      };
      closeModal();
      ui.mapMode = "found";
      ui.foundRegion = null;
      renderMap();
      showFoundPanel(ui.ngDraft);
    });
  }
  function inputV(name) {
    var inp = document.querySelector('[data-ng="' + name + '"]');
    return inp ? parseInt(inp.value, 10) : 50;
  }
  function capFirst(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function showFoundPanel(draft) {
    var old = document.getElementById("foundP");
    if (old) old.remove();
    var panel = document.createElement("div");
    panel.id = "foundP";
    panel.className = "found-panel";
    panel.innerHTML =
      '<div class="found-tit">📍 창건 위치 선택</div>' +
      '<div class="muted">지도에서 노란색 무인 지역을 클릭하세요.</div>' +
      '<div>(선택: <b id="foundSel">없음</b>)</div>' +
      '<div class="row-btns">' +
      '<button id="foundConfirm" disabled>국가 창건 확정</button>' +
      '<button id="foundBack">뒤로</button></div>';
    document.body.appendChild(panel);

    var selLabel = panel.querySelector("#foundSel");
    var confirm = panel.querySelector("#foundConfirm");
    ui.confirmFound = function (rid) {
      selLabel.textContent = ui.world.regions[rid].name;
      confirm.disabled = false;
      confirm.onclick = function () {
        var world = ui.world;
        var pc = world.createPlayerCountry(draft, rid);
        if (pc) {
          ui.mapMode = "view";
          panel.remove();
          setTab("nation");
          renderAll();
          SaveLib.autosave(world);
          flashMessage(pc.name + "이(가) 건국되었습니다!");
        }
      };
    };
    panel.querySelector("#foundBack").addEventListener("click", function () {
      panel.remove();
      ui.mapMode = "view";
      renderMap();
    });
  }

  /* ---------- 로드/시작 화면 ---------- */
  ui.checkStart = function () {
    var has = SaveLib.hasAutosave();
    var savedData = has ? SaveLib.loadAutosave() : null;
    if (savedData) {
      try {
        var w = World.fromJSON(savedData);
        var name = w.playerId ? w.countries[w.playerId].name : "알 수 없는 국가";
        var html = '<div class="modal-back" data-close="0"><div class="modal start-modal">' +
          '<h2>🌍 가상국가 전쟁 시뮬레이션</h2>' +
          '<div class="muted">세계가 스스로 움직이고, 당신이 그 안에 개입합니다.</div>' +
          '<div class="muted">이어하기: <b>' + esc(name) + '</b> (' + w.dateString() + ' · 제' + w.turn + '턴)</div>' +
          '<div class="row-btns">' +
          '<button data-start="continue">이어하기</button>' +
          '<button data-start="load">JSON 불러오기</button>' +
          '<button data-start="new">새 세계 시작</button></div></div></div>';
        var modal = openModalHTML(html);
        modal.querySelectorAll("[data-start]").forEach(function (b) {
          b.addEventListener("click", function () {
            var mode = b.getAttribute("data-start");
            if (mode === "continue") {
              ui.world = w;
              ui.attach(w);
              closeModal();
              renderAll();
              setTab("nation");
            } else if (mode === "new") {
              SaveLib.clearAutosave();
              closeModal();
              beginNewWorld();
            } else {
              openLoadModal();
            }
          });
        });
        return;
      } catch (e) {
        console.warn("세이브 복원 실패, 새 게임", e);
      }
    }
    beginNewWorld();
  };

  function beginNewWorld() {
    ui.world = new World({});
    ui.world.refreshGoals();
    ui.attach(ui.world);
    renderAll();
    openNewGameModal();
  }

  /* ---------- 로드 모달 ---------- */
  function openLoadModal() {
    var html = '<div class="modal-back" data-close="1"><div class="modal">' +
      '<h3>📂 세이브 불러오기</h3>' +
      '<div class="muted">JSON 세이브 파일을 선택하세요.</div>' +
      '<input type="file" id="loadFile" accept=".json">' +
      '<div class="row-btns"><button data-open="1">불러오기</button><button data-close="1">취소</button></div></div></div>';
    var modal = openModalHTML(html);
    modal.querySelector("[data-open]").addEventListener("click", function () {
      var f = document.getElementById("loadFile").files[0];
      if (!f) { flashMessage("세이브 파일을 선택하세요."); return; }
      SaveLib.importFile(f).then(function (data) {
        try {
          var w = World.fromJSON(data);
          ui.world = w;
          ui.attach(w);
          closeModal();
          renderAll();
          setTab("nation");
          SaveLib.autosave(w);
          flashMessage("세이브를 불러왔습니다!");
        } catch (e) {
          flashMessage("세이브 복원에 실패했습니다.");
          console.error(e);
        }
      }).catch(function (err) {
        flashMessage(err.message || "파일을 불러올 수 없습니다.");
      });
    });
    bindClose(modal);
  }

  /* ---------- 유틸 ---------- */
  function chanceP(p) { return Math.random() * 100 < p; }
  function hasAllianceOf(w, a, b) {
    var c = w.countries[a];
    return c.alliances.some(function (x) { return x.partner === b; });
  }
  function autoBudgetPreset(c) {
    var w = ui.world;
    var atWar = w.atWar(c.id);
    var threatHigh = c.topThreat() && w.countries[c.topThreat()].militaryPower() > c.militaryPower() * 1.3;
    var budget = { military: 35, welfare: 25, admin: 15, research: 15, diplomacy: 10 };
    if (atWar) budget = { military: 48, welfare: 18, admin: 12, research: 13, diplomacy: 9 };
    else if (threatHigh) budget = { military: 42, welfare: 20, admin: 13, research: 15, diplomacy: 10 };
    else if (c.society.support < 45) budget = { military: 28, welfare: 32, admin: 16, research: 14, diplomacy: 10 };
    else if (c.personality.economy > c.personality.militarism) budget = { military: 24, welfare: 28, admin: 15, research: 21, diplomacy: 12 };
    return budget;
  }

  /* ---------- API 노출 ---------- */
  ui.renderAll = renderAll;
  ui.renderMap = renderMap;
  ui.confirmFoundFn = function (rid) { if (ui.confirmFound) ui.confirmFound(rid); };
  ui.esc = esc;
  ui.fmt = fmt;

  window.UI = ui;
})();