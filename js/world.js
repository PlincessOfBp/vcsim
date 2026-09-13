/* ============================================================
   World : 세계 상태 + 턴 엔진
   - 경제 / 군사 / 외교 / 정치 / 전쟁 / AI / 사건 / 뉴스 통합
   ============================================================ */
(function () {
  "use strict";

  var D = window.SIM_DATA;
  var C = window.Country;

  function clamp(v, lo, hi) { if (lo === undefined) lo = 0; if (hi === undefined) hi = 100; return Math.max(lo, Math.min(hi, v)); }
  function ri(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function chance(p) { return Math.random() * 100 < p; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function fmt(n) { return Math.round(n).toLocaleString("ko-KR"); }

  function World(seedData) {
    var self = this;
    var seed = seedData || {};

    self.turn = seed.turn || 1;
    self.date = seed.date || { y: 2037, m: 1, d: 17 };
    self.era = seed.era || "평화기";
    self.tension = seed.tension !== undefined ? seed.tension : 18;   // 세계 긴장도
    self.warCount = seed.warCount || 0;
    self.worldPeace = seed.worldPeace !== undefined ? seed.worldPeace : 92;

    self.playerId = seed.playerId || null;
    self.playerPrompt = seed.playerPrompt || null;   // {kind:'allydefense', warId, valid}

    /* 지역 */
    self.regions = {};
    self.neutralRegions = [];

    /* 국가 */
    self.countries = {};

    self.alliances = seed.alliances || []; // {id, a, b, mutualDefense, trade, intel, yearsLeft}
    self.wars = seed.wars || [];

    self.news = seed.news || [];
    self.log = [];
    self.knownSpy = [];          // id당 정보완벽 여부

    self.dayEnd = false;

    /* 지역 생성 (맵 설정 반영) */
    var grid = D.buildGrid(seed.grid);
    self.cols = grid.cols;
    self.rows = grid.rows;
    self.gridCfg = { cols: grid.cols, rows: grid.rows, countryIds: grid.countryIds.slice(), density: grid.density };
    var regKeys = Object.keys(grid.regionsById);
    for (var i = 0; i < regKeys.length; i++) {
      var src = grid.regionsById[regKeys[i]];
      self.regions[src.id] = {
        id: src.id, col: src.col, row: src.row, name: src.name,
        coast: src.coast, points: src.points, cx: src.cx, cy: src.cy,
        neighbors: src.neighbors.slice(),
        owner: null, originalOwner: src.startOwner, neutral: src.neutral,
        captured: null, capturedSide: null
      };
      if (src.neutral) self.neutralRegions.push(src.id);
    }

    /* 국가 생성 (선택된 국가 수만큼) */
    var countryList = [];
    for (var di = 0; di < D.countries.length; di++) {
      if (grid.countryIds.indexOf(D.countries[di].id) >= 0) countryList.push(D.countries[di]);
    }
    for (var k = 0; k < countryList.length; k++) {
      var c = new C(countryList[k], self);
      self.countries[c.id] = c;
      self.assignInitialRegions(c.id);
    }
    /* 모든 국가 간 관계 초기화(순서 문제 해소) */
    var cids = Object.keys(self.countries);
    for (var ci = 0; ci < cids.length; ci++) {
      self.countries[cids[ci]].initRelations();
      self.countries[cids[ci]].computeBudget();
    }

    /* 세이브 복원 시에만 보정 */
    if (seed.restore) {
      self.restoreRegions(seed, regKeys);
    }
  }

  /* 국가 id -> 초기 영토 배정 */
  World.prototype.assignInitialRegions = function (cid) {
    var self = this;
    var keys = Object.keys(self.regions);
    for (var i = 0; i < keys.length; i++) {
      var r = self.regions[keys[i]];
      if (!r.neutral && r.originalOwner === cid) r.owner = cid;
    }
  };

  World.prototype.restoreRegions = function (seed, regKeys) {
    var self = this;
    for (var i = 0; i < regKeys.length; i++) {
      var id = regKeys[i];
      var s = seed.regions && seed.regions[id];
      if (s) {
        self.regions[id].owner = s.owner || null;
        self.regions[id].captured = s.captured || null;
        self.regions[id].capturedSide = s.capturedSide || null;
      }
    }
    for (var j = 0; j < self.neutralRegions.length; j++) {
      var n = self.neutralRegions[j];
      if (!self.regions[n].owner) self.regions[n].owner = null;
    }
  };

  /* ---------- 조회 헬퍼 ---------- */

  World.prototype.player = function () {
    return this.playerId ? this.countries[this.playerId] : null;
  };

  World.prototype.getNeighborsOfRegion = function (rid) {
    return this.regions[rid].neighbors;
  };

  /* 국가와 국경을 공유하는 모든 인접 국가 id */
  World.prototype.neighborsOf = function (cid) {
    var self = this;
    var out = [], seen = {};
    var keys = Object.keys(self.regions);
    for (var i = 0; i < keys.length; i++) {
      var r = self.regions[keys[i]];
      if (r.owner !== cid) continue;
      for (var j = 0; j < r.neighbors.length; j++) {
        var n = self.regions[r.neighbors[j]];
        if (n.owner && n.owner !== cid && !seen[n.owner]) {
          seen[n.owner] = 1;
          out.push(n.owner);
        }
      }
    }
    return out;
  };

  World.prototype.regionsOf = function (cid) {
    var self = this;
    var out = [];
    var keys = Object.keys(self.regions);
    for (var i = 0; i < keys.length; i++) {
      if (self.regions[keys[i]].owner === cid) out.push(self.regions[keys[i]].id);
    }
    return out;
  };

  World.prototype.isAtWar = function (a, b) {
    // b가 없으면 a가 전쟁중인지
    var self = this;
    for (var i = 0; i < self.wars.length; i++) {
      var w = self.wars[i];
      if (w.status !== "active") continue;
      var aIn = w.attackers.indexOf(a) >= 0 || w.defenders.indexOf(a) >= 0;
      if (!aIn) continue;
      if (b === undefined) return true;
      var bIn = w.attackers.indexOf(b) >= 0 || w.defenders.indexOf(b) >= 0;
      if (bIn) {
        var aSide = w.attackers.indexOf(a) >= 0 ? "atk" : "def";
        var bSide = w.attackers.indexOf(b) >= 0 ? "atk" : "def";
        return aSide !== bSide; // 같은 편이 아니어야 전쟁
      }
    }
    return false;
  };

  World.prototype.warsOf = function (cid) {
    var self = this;
    return self.wars.filter(function (w) {
      if (w.status !== "active") return false;
      return w.attackers.indexOf(cid) >= 0 || w.defenders.indexOf(cid) >= 0;
    });
  };

  World.prototype.warBetween = function (a, b) {
    var self = this;
    for (var i = 0; i < self.wars.length; i++) {
      var w = self.wars[i];
      if (w.status !== "active") continue;
      var aSide = w.attackers.indexOf(a) >= 0 ? "atk" : (w.defenders.indexOf(a) >= 0 ? "def" : null);
      var bSide = w.attackers.indexOf(b) >= 0 ? "atk" : (w.defenders.indexOf(b) >= 0 ? "def" : null);
      if (aSide && bSide && aSide !== bSide) return w;
      if (aSide && bSide && aSide === bSide) continue;
    }
    return null;
  };

  World.prototype.warSideOf = function (w, cid) {
    if (w.attackers.indexOf(cid) >= 0) return "atk";
    if (w.defenders.indexOf(cid) >= 0) return "def";
    return null;
  };

  /* 전쟁에 참여하는 국가 전체 */
  World.prototype.warParticipants = function (w) {
    return w.attackers.concat(w.defenders);
  };

  /* ---------- 자동 일정: AI 결정 ---------- */

  World.prototype.presolveAI = function () {
    var self = this;
    var ids = Object.keys(self.countries);
    for (var i = 0; i < ids.length; i++) {
      var c = self.countries[ids[i]];
      if (c.isPlayer) continue;
      self.aiDecide(c);
    }
    self.resolveAllianceJoins();
  };

  World.prototype.aiDecide = function (c) {
    var self = this;
    var ids = Object.keys(self.countries);
    var atWar = self.isAtWar(c.id);
    var threatId = c.topThreat();
    var threat = threatId ? self.countries[threatId].militaryPower() : 0;
    var myPower = c.militaryPower();
    var treasury = c.treasury;
    var exp = c.expenseTotal() * 1.2;

    /* 1) 예산 조정 */
    var b = c.budget;
    if (atWar) {
      shiftBudget(c, "military", +6);
      shiftBudget(c, "welfare", -2);
      shiftBudget(c, "research", -3);
    } else if (threat > myPower * 1.4 && c.personality.militarism > 45) {
      shiftBudget(c, "military", +4);
      shiftBudget(c, "welfare", -2);
    } else if (c.personality.economy > 60 && treasury > 0) {
      shiftBudget(c, "research", +2);
    }
    // 차관/복지 균형 자동 조정(절대값 보정)
    normalizeBudget(c, 45);

    /* 2) 군사 투자 (자금이 여유 있을 때) */
    if (treasury > exp) {
      var moraleNeeded = 78 - c.military.morale;
      if ((atWar || threat > myPower * 1.1) && (c.personality.militarism > 40 || atWar)) {
        // 모병
        var target = Math.floor(c.population * 0.012);
        if (c.military.army < target) {
          var buy = Math.min(25000, Math.ceil((target - c.military.army) * 0.25));
          var cost = buy / 1000 * 35;
          if (c.treasury > cost) {
            c.treasury -= cost;
            c.military.army += buy;
          }
        }
        if (c.military.equipment < 82 && c.treasury > exp) {
          var ec = (82 - c.military.equipment) * 60;
          var invest = Math.min(c.treasury - exp, ec);
          if (invest > 200) {
            c.treasury -= invest;
            c.military.equipment += invest / 200 * 3;
            c.military.equipment = Math.round(c.military.equipment * 10) / 10;
          }
        }
        if (moraleNeeded > 10 && c.treasury > exp) {
          c.treasury -= 250;
          c.military.morale = clamp(c.military.morale + 3);
          if (c.treasury < 0) c.treasury = 0;
        }
      } else if (treasury > exp * 3 && c.military.logistics < 75) {
        c.treasury -= 300;
        c.military.logistics = clamp(c.military.logistics + 2);
      }
    }
    if (c.treasury < 0) c.treasury = 0;

    /* 3) 외교 */
    var nbrs = self.neighborsOf(c.id);
    // 무역협정 회복/신설
    for (var i = 0; i < nbrs.length; i++) {
      var n = nbrs[i];
      var o = self.countries[n];
      if (!o) continue;
      var rel = c.relations[n];
      if (rel > 10 && c.tradePacts.indexOf(n) < 0 && o.tradePacts.indexOf(c.id) < 0) {
        if (chance(c.personality.diplomacy * 0.5 + rel * 0.3)) {
          // 상대 동의 확률: 외교성 + 관계 + 경제성
          var agree = chance(40 + o.personality.diplomacy * 0.25 + rel * 0.15);
          if (agree) establishTradePact(self, c.id, n);
        }
      } else if (rel < -25 && chance(30)) {
        // 악화된 관계 개선 시도 (사절 파견)
        adjustRelation(self, c.id, n, 3);
        if (c.treasury > 150) { c.treasury -= 150; adjustRelation(self, c.id, n, 2); }
      }
    }
    // 동맹 제안
    if (c.personality.diplomacy > 45 && !atWar && chance(22)) {
      var candidates = [];
      for (var j = 0; j < nbrs.length; j++) {
        var nc = self.countries[nbrs[j]];
        if (!nc) continue;
        var rr = c.relations[nbrs[j]];
        if (rr > 20 && !hasAlliance(self, c.id, nbrs[j])) candidates.push(nbrs[j]);
      }
      if (candidates.length) {
        var targetId = pick(candidates);
        var t = self.countries[targetId];
        var accept = chance(30 + t.personality.diplomacy * 0.35 + c.relations[targetId] * 0.2 + (anger(self, t.id, c.id) ? -15 : 0));
        if (accept) {
          createAlliance(self, c.id, targetId, true, true, false, 10);
        }
      }
    }
    // 동맹국 지원
    for (j = 0; j < c.alliances.length; j++) {
      var al = c.alliances[j];
      var partner = self.countries[al.partner];
      if (partner && partner.treasury < 15000 && c.treasury > 60000 && chance(25)) {
        var gift = Math.min(3000, c.treasury * 0.05);
        c.treasury -= gift;
        partner.treasury += gift;
        adjustRelation(self, c.id, al.partner, 4);
        self.addNews("외교", c.name + "이 " + partner.name + "에 지원금 " + fmt(gift) + "억을 제공했다.", c.name + " 정부는 동맹국에 대한 지원을 지속하겠다고 밝혔다.", 4);
      }
      if (chance(10) && al.yearsLeft <= 2) {
        al.yearsLeft = 10; // 갱신
        self.addNews("외교", c.name + "과 " + partner.name + "의 동맹이 갱신되었다.", "양국은 정기 회담을 열고 협력 확대에 합의했다.", 3);
      }
    }

    /* 4) 침략 판단 */
    if (!atWar && c.personality.aggression >= 28) {
      var agg = c.personality.aggression;
      var mil = c.personality.militarism;
      var worldBad = countWorldWars(self) > 2;
      // 공격 선호도
      var desire = agg * 0.5 + mil * 0.3 - worldBad * 20;
      var weakest = null, weakestRel = 0, weakestPower = 999;
      for (var w = 0; w < nbrs.length; w++) {
        var wc = self.countries[nbrs[w]];
        if (!wc) continue;
        if (hasAlliance(self, c.id, nbrs[w]) && c.relations[nbrs[w]] > 0) continue;
        var pw = wc.militaryPower();
        var wrel = c.relations[nbrs[w]];
        var allP = powerWithAllies(self, wc.id);
        if (!self.isAtWar(nbrs[w])) {
          if (pw < weakestPower && wrel < -10) { weakestPower = pw; weakestRel = wrel; weakest = nbrs[w]; }
          // 강대국 제외: alliances 가 있는 상대는 침략 회피
          if (allP > powerWithAllies(self, c.id) * 1.2) continue;
        }
      }
      if (weakest && weakestPower < powerWithAllies(self, c.id) * (0.5 + desire / 400)) {
        var op = weakest;
        // 지지율/재원/긴장 고려
        var supportOK = c.society.support > 35;
        var treasuryOK = c.treasury > c.expenseTotal() * 2;
        var peace = self.worldPeace;
        var invChance = desire * 0.4 + supportOK * 10 + treasuryOK * 10 - (100 - peace) * 0.4 - self.tension * 0.3;
        invChance = clamp(invChance, 0, 45);
        if (chance(invChance)) {
          var cb = chooseCasusBelli(c, op);
          self.declareWar(c.id, op, cb.id);
        }
      }
    }

    /* 5) 전쟁 종결 판단 */
    var myWars = self.warsOf(c.id);
    for (var q = 0; q < myWars.length; q++) {
      var w2 = myWars[q];
      if (w2.status !== "active") continue;
      var side = self.warSideOf(w2, c.id);
      var enemySide = side === "atk" ? "def" : "atk";
      var oppProgress = side === "atk" ? w2.progress : -w2.progress; // 자신 기준 우위
      var exhaustion = side === "atk" ? w2.exhaustionA : w2.exhaustionD;
      var will = exhaustion > 55 || (oppProgress < -20 && exhaustion > 25);
      if (will) {
        // 상대도 지쳤는지
        var oppEx = side === "atk" ? w2.exhaustionD : w2.exhaustionA;
        if (oppEx > 40 || oppProgress < -20) {
          // 공격 측이 우세하면 영토양보 평화를 시도
          if (side === "atk" && oppProgress > 25 && chance(50)) {
            self.suePeace(c.id, w2.id, "attrition-cede");
          } else {
            self.suePeace(c.id, w2.id, "statusquo");
          }
        }
      }
    }

    /* 6) 중립 국경지역 편입 시도 (플레이어 아닐 시 가끔) */
    if (!c.isPlayer && chance(8) && c.treasury > 1000 && c.society.stability > 40) {
      var neut = self.neutralRegions.filter(function (rid) { return self.regions[rid].owner === null; });
      if (neut.length) {
        // 인접한 중립 지역 찾기
        for (var m = 0; m < neut.length; m++) {
          var reg = self.regions[neut[m]];
          var adjacent = false;
          for (var nb = 0; nb < reg.neighbors.length; nb++) {
            if (self.regions[reg.neighbors[nb]].owner === c.id) adjacent = true;
          }
          if (adjacent) {
            self.annexNeutral(c.id, reg.id, "ai");
            break;
          }
        }
      }
    }

    c.ai.idleTurns++;
  };

  /* ---------- 동맹참전 ---------- */

  World.prototype.resolveAllianceJoins = function () {
    var self = this;
    var did = true, guard = 0;
    while (did && guard++ < 20) {
      did = false;
      for (var i = 0; i < self.wars.length; i++) {
        var w = self.wars[i];
        if (w.status !== "active") continue;
        var members = [];
        // 각 참전국의 동맹 확인
        for (var k = 0; k < self.warParticipants(w).length; k++) {
          var pid = self.warParticipants(w)[k];
          var c = self.countries[pid];
          if (!c) continue;
          for (var a = 0; a < c.alliances.length; a++) {
            var al = c.alliances[a];
            var partner = al.partner;
            if (!al.mutualDefense) continue;
            if (!self.isAtWar(partner)) {
              members.push({ partner: partner, allyOf: pid });
            }
          }
        }
        for (var b = 0; b < members.length; b++) {
          var mem = members[b];
          var pc = self.countries[mem.partner];
          if (!pc || pc.isPlayer) {
            if (pc && pc.isPlayer) self.queuePlayerPrompt("allydefense", w.id, mem.allyOf);
            continue;
          }
          var join = chance(25 + pc.personality.diplomacy * 0.3 + pc.relations[mem.allyOf] * 0.2 - pc.personality.isolation * 0.2);
          if (join) {
            var side = self.warSideOf(w, mem.allyOf);
            self.addWarParticipant(w.id, mem.partner, side);
            did = true;
            self.addNews("전쟁", pc.name + "이 " + w.name + "에 참전한다!", pc.name + "은 " + self.countries[mem.allyOf].name + "과의 상호방위 조약에 따라 전쟁에 개입했다.", 2);
          }
        }
      }
    }
  };

  World.prototype.queuePlayerPrompt = function (kind, warId, allyId) {
    var self = this;
    if (self.playerPrompt && self.playerPrompt.valid && self.playerPrompt.kind === "allydefense" && self.playerPrompt.warId === warId) return;
    if (!self.playerPrompt || !self.playerPrompt.valid) {
      self.playerPrompt = { kind: kind, warId: warId, allyId: allyId, valid: true };
    }
  };

  /* ---------- 전쟁 시작/참전/평화 ---------- */

  World.prototype.declareWar = function (attackerId, defenderId, cbId) {
    var self = this;
    if (attackerId === defenderId) return null;
    if (self.isAtWar(attackerId, defenderId)) return null;
    var A = self.countries[attackerId], B = self.countries[defenderId];
    if (!A || !B) return null;
    var cb = D.casusBelli.filter(function (x) { return x.id === cbId; })[0] || D.casusBelli[5];
    var warId = "war" + (self.wars.length + 1);
    var dateStr = self.dateString();
    var war = {
      id: warId, name: A.name + "·" + B.name + " 전쟁",
      attackerId: attackerId, defenderId: defenderId,
      attackers: [attackerId], defenders: [defenderId],
      casusBelli: cbId, cbName: cb.name,
      progress: 0, phase: "국경충돌",
      capturedByA: [], capturedByD: [],
      casualtiesA: 0, casualtiesD: 0,
      exhaustionA: 5, exhaustionD: 3,
      turnStarted: self.turn, dateStarted: dateStr,
      status: "active", result: null, terms: null,
      usedA: [false, false, false, false, false],
      usedD: [false, false, false, false, false],
      turnsRunning: 0,
      territoriesAtStart: self.regionsOf(defenderId).length
    };
    self.wars.push(war);
    adjustRelation(self, attackerId, defenderId, -35);
    A.society.support = clamp(A.society.support + cb.supportBonus);
    A.personality.aggression = clamp(A.personality.aggression + 1);
    if (B.isPlayer) {
      A.society.support = clamp(A.society.support + 5);
    }
    self.tension = clamp(self.tension + 18, 0, 100);
    self.addNews("전쟁", "⚔️ 전쟁 선포! " + A.name + "이 " + B.name + "을 침공했다.", A.leader + "의 정부는 \"" + cb.desc + "\"를 명분으로 전면 침공을 선언했다. " + B.name + "은 즉각 경계령을 발동했다.", 1);
    if (B.society.support && cb.worldPenalty) {
      // 국제 여론 반응
      var penalty = cb.worldPenalty;
      murkGlobalOpinion(self, attackerId, penalty);
    }
    return war;
  };

  World.prototype.addWarParticipant = function (warId, cid, side) {
    var self = this;
    var w = self.wars.filter(function (x) { return x.id === warId; })[0];
    if (!w || w.status !== "active") return false;
    var where = side === "atk" ? w.attackers : w.defenders;
    if (where.indexOf(cid) >= 0) return false;
    where.push(cid);
    if (cid !== self.playerId) {
      var c = self.countries[cid];
      // 참전으로 인한 국민 지지 조정
      c.society.support = clamp(c.society.support + 2);
    }
    this.resyncWarPhase(w);
    return true;
  };

  /* 현재 점령 형태에 따른 전선 상황 갱신 */
  World.prototype.resyncWarPhase = function (w) {
    var self = this;
    if (w.progress > 45) w.phase = "전선 형성·전진";
    else if (w.progress < -45) w.phase = "방어선 후퇴";
    else if (Math.abs(w.progress) < 10) w.phase = "전선 교착";
    else w.phase = "국경 전투";
  };

  /* 휴전/평화 시도 (mode: statusquo | cede) */
  World.prototype.suePeace = function (cid, warId, mode) {
    var self = this;
    var w = self.wars.filter(function (x) { return x.id === warId; })[0];
    if (!w || w.status !== "active") return false;
    var side = self.warSideOf(w, cid);
    var enemySide = side === "atk" ? "def" : "atk";
    var enemy = enemySide === "atk" ? w.attackerId : w.defenderId;
    var E = self.countries[enemy], Cc = self.countries[cid];
    if (!E || !Cc) return false;

    var myAdv = side === "atk" ? w.progress : -w.progress;
    var myEx = side === "atk" ? w.exhaustionA : w.exhaustionD;
    var oppEx = side === "atk" ? w.exhaustionD : w.exhaustionA;

    // 강제 종결 조건 (적측 지침이 점령당한 경우 등)
    var defeatedByOccupation = self.warsOf(enemy).some(function (ww) {
      return ww.id === warId && ww.capturedByA.length >= ww.territoriesAtStart - (ww.territoriesAtStart || 10);
    });

    var m = "statusquo";
    if (mode === "cede") m = "cede";
    if (mode === "attrition-cede" && myAdv > 20) m = "cede";
    // 공격측이 점령지와 우위를 확보한 상황에서는 영토 양도로 종결 (점령 성과가 휴전으로 증발하지 않도록)
    if ((w.capturedByA || []).length > 0 && w.progress >= 0) m = "cede";
    if (defeatedByOccupation && side === "def") m = "cede";

    // 상대가 받아들일 확률 (이미 밀리고 있으면 기꺼이 수락)
    var oppAccept = 25 + oppEx * 0.5 + E.society.support * 0.08 + (myAdv > 15 ? 12 : 0) + (mode === "cede" ? -15 : 0);
    var accept = chance(clamp(oppAccept, 5, 85)) || defeatedByOccupation;
    if (!accept) {
      self.addNews("전쟁", Cc.name + "이(가) 평화 협상을 제안했지만 " + E.name + "이 거부했다.", "협상안이 거부되면서 전투가 재개되었다.", 4);
      return false;
    }
    self.endWar(w, m);
    return true;
  };

  /* 게임 엔진이 전쟁을 종결 */
  World.prototype.autoResolveWar = function (w) {
    var self = this;
    var A = self.countries[w.attackerId], B = self.countries[w.defenderId];
    var captured = (w.capturedByA || []).length;
    // 진행 상황에 따른 종결 형태
    if (w.progress > 40 && (w.exhaustionD > 55)) {
      self.endWar(w, "cede");
    } else if (w.progress < -30 && w.exhaustionA > 50) {
      // 공격측이 밀리고 있음 -> 공격측 후퇴, 이전 상태 회복
      self.endWar(w, "statusquo");
    } else if (w.exhaustionA > 70 && w.exhaustionD > 60) {
      // 양측 지친 상태: 공격측이 점령지를 확보했으면 영구 편입, 아니면 원상복구
      self.endWar(w, (captured > 0 && w.progress >= -10) ? "cede" : "statusquo");
    } else if (w.exhaustionA > 85 || w.exhaustionD > 85) {
      self.endWar(w, (captured > 0 && w.progress >= -10) ? "cede" : "statusquo");
    } else {
      return false;
    }
    return true;
  };

  World.prototype.endWar = function (w, mode) {
    var self = this;
    if (w.status !== "active") return;
    w.status = "ended";
    w.endedTurn = self.turn;
    w.mode = mode;

    var A = self.countries[w.attackerId];
    var B = self.countries[w.defenderId];

    // 점령지 정리
    var ceded = [];
    if (mode === "cede") {
      // 공격측 현재 점령지를 영구 편입
      for (var i = 0; i < w.capturedByA.length; i++) {
        var rid = w.capturedByA[i];
        var r = self.regions[rid];
        if (r && r.owner) {
          r.captured = null; r.capturedSide = null;
          ceded.push(rid);
        }
      }
      // 수비측이 탈환한 지역은 공격측에 반환 (항복 조건)
      for (var q = 0; q < w.capturedByD.length; q++) {
        var rq = self.regions[w.capturedByD[q]];
        if (rq) { rq.owner = w.attackerId; rq.captured = null; rq.capturedSide = null; }
      }
      w.capturedByD = [];
      // 배상금
      var repar = Math.floor(B.gdp * 0.01);
      if (repar > B.treasury * 0.6) repar = Math.floor(B.treasury * 0.6);
      B.treasury = Math.max(0, B.treasury - repar);
      A.treasury += repar;
      warResultNews(self, w, "cede", ceded, repar);
    } else {
      // status quo : 점령지 원상복구
      for (var j = 0; j < w.capturedByA.length; j++) {
        var rr = self.regions[w.capturedByA[j]];
        if (rr) { rr.owner = w.defenderId; rr.captured = null; rr.capturedSide = null; }
      }
      for (var k = 0; k < w.capturedByD.length; k++) {
        var rrr = self.regions[w.capturedByD[k]];
        if (rrr) { rrr.owner = w.attackerId; rrr.captured = null; rrr.capturedSide = null; }
      }
      warResultNews(self, w, "statusquo", [], 0);
    }

    // 관계 조정
    adjustRelation(self, w.attackerId, w.defenderId, -20);
    A.society.support = clamp(A.society.support - 6);
    A.personality.aggression = clamp(A.personality.aggression - 3);

    // 참전국들 사기/경제 파급
    var all = self.warParticipants(w);
    for (var q = 0; q < all.length; q++) {
      var c = self.countries[all[q]];
      c.military.morale = clamp(c.military.morale + 4);
      c.society.stability = clamp(c.society.stability + 3);
    }

    adjustRelation(self, w.attackerId, w.defenderId, -10);
    w.result = mode;
  };

  function warResultNews(self, w, mode, ceded, repar) {
    var A = self.countries[w.attackerId], B = self.countries[w.defenderId];
    var body;
    if (mode === "cede") {
      body = ceded.length
        ? A.name + "이 점령지 " + ceded.map(function (id) { return self.regions[id].name; }).join(", ") + "의 할양을 받아냈으며, " + B.name + "은 배상금 " + fmt(repar) + "억을 지불하기로 했다."
        : B.name + "은(는) 배상금 " + fmt(repar) + "억의 지불에 합의했다.";
      self.addNews("전쟁", "🕊️ " + w.name + " 종전! " + A.name + "이 승리했다.", body + " 현지에서는 휴전과 동시에 복구 작업이 시작될 예정이다.", 1);
    } else {
      self.addNews("전쟁", "🕊️ " + w.name + " 휴전 — 원상 회복", "양측이 사상자를 받아들인 채 현상 유지로 전쟁을 마무리했다. 긴장은 여전히 가라앉지 않고 있다.", 2);
    }
  }

  /* ---------- 경제 처리 ---------- */

  World.prototype.economyPhase = function (c) {
    var self = this;
    var atWar = self.isAtWar(c.id);
    var occupied = self.occupiedCount(c.id);
    var losses = occupied * 1.4;

    // 성장률 계산 (턴당 %)
    var growth = c.baseGrowth;
    growth += (c.tradeLevel) * 0.02;
    growth += c.resourceBonus;
    growth += (c.society.education - 50) * 0.004;
    growth += (c.society.stability - 50) * 0.008;
    growth -= c.inflation * 0.02;
    growth -= c.unemployment * 0.02;
    growth += c.pending.invest * (0.00003);
    if (atWar) {
      var bur = self.warBurden(c.id);
      growth -= 0.8 + bur * 0.004;
    }
    growth -= losses * 0.3;
    growth -= c.embargoed * 0.4;
    growth -= c.foodCrisis * 0.6;
    growth = clamp(growth, -3, 3);

    // 지출 계산
    c.computeBudget();

    var income = c.taxIncome() + (c.tradeLevel * 40);
    var taxAdj = (c.pending.taxChange || 0);
    if (taxAdj !== 0) {
      // 세율 변경은 UI에서 처리 (1%단위)
    }
    var spend = c.expenseTotal();
    c.treasury += income - spend;

    // 부채
    if (c.treasury < 0) {
      c.debt += Math.abs(c.treasury);
      c.treasury = 0;
    }
    // 부채 이자
    var interest = c.debt * 0.02;
    if (c.treasury > interest) c.treasury -= interest; else { c.treasury = 0; c.debt *= 1.03; }

    // GDP 업데이트
    c.economyGrowth = growth;
    var newGdp = c.gdp * (1 + growth / 100);
    c.gdp = Math.max(newGdp, 100);
    c.inflation = clamp(c.inflation + (growth > 2.5 ? 0.08 : growth < -1 ? -0.05 : 0) + (c.embargoed ? 0.3 : 0), 0, 30);
    c.unemployment = clamp(c.unemployment + (growth < 0 ? -growth * 0.2 : growth * -0.05) + (c.pending.recruit > 0 ? -0.2 : 0.05), 1, 35);

    // 무역 총량 붕괴(제재 시 약간)
    if (c.embargoed > 0) c.embargoed--;

    // 군사비 반영: 유지비 병력 수용 한도
    var upkeepBudget = c.expenses.military * 0.3;
    var desiredArmy = Math.min(c.military.army + c.military.reserves * 0.2, c.population * 0.05 + upkeepBudget * 20);
    // 인구 초과 모병 억제
    if (c.military.army > c.population * 0.04) {
      c.military.army = Math.floor(c.military.army * 0.98);
    }

    // 기술/장비 자연 발전
    c.military.tech = clamp(c.military.tech + 0.18 + c.budget.research * 0.02, 0, 100);
    c.military.equipment = clamp(c.military.equipment + (c.expenses.military < 100 ? -0.3 : 0.12), 5, 100);

    // 예비군 재충원
    var reserveTarget = c.population * 0.03;
    if (c.military.reserves < reserveTarget && c.treasury > 200) {
      c.treasury -= 120;
      c.military.reserves = Math.min(reserveTarget, c.military.reserves + Math.floor(c.population * 0.001));
    }

    c.pending.invest = 0;
    c.pending.recruit = 0;
    c.pending.taxChange = 0;
    c.pending.welfare = 0;
  };

  /* 전쟁 피해 규모 (점령/사상자 반영) */
  World.prototype.warBurden = function (cid) {
    var self = this;
    var myWars = self.warsOf(cid);
    var bur = 0;
    for (var i = 0; i < myWars.length; i++) {
      var w = myWars[i];
      var side = self.warSideOf(w, cid);
      bur += w.casualtiesA + w.casualtiesD;
    }
    return bur;
  };

  World.prototype.occupiedCount = function (cid) {
    var self = this;
    var n = 0;
    var keys = Object.keys(self.regions);
    for (var i = 0; i < keys.length; i++) {
      var r = self.regions[keys[i]];
      if (r.capturedSide && r.owner === cid) n++;
    }
    return n;
  };

  /* ---------- 정치 처리 ---------- */

  World.prototype.politicsPhase = function (c) {
    var self = this;
    c.updatePolitics();
    // 파벌 이동
    var f = c.factions;
    if (self.isAtWar(c.id)) f.military = clamp(f.military + 0.3);
    if (c.society.support < 35) f.opposition = clamp(f.opposition + 0.4);
    if (c.society.conflict > 55) f.radical = clamp(f.radical + 0.3);
    if (c.society.support > 55) f.gov = clamp(f.gov + 0.3);

    // 쿠데타 발생 판정
    var p = c.coupRisk / (c.isPlayer ? 120 : 60); // 플레이어는 대응 여지 부여
    if (chance(p)) {
      self.runCoup(c);
    }
    // 내각/선거 (저빈도)
    if (chance(4) && c.government.indexOf("공화국") >= 0) {
      var prev = c.leader;
      if (c.society.support < 40) {
        c.leader = randomLeaderName();
        c.society.support = clamp(c.society.support + 8);
        self.addNews("정치", c.name + " 정부가 총사퇴하고 새 총리가 취임했다.", "지지율 회복을 위한 인적 쇄신으로 풀이된다.", 3);
      }
    }

    c.foodCrisis = Math.max(0, c.foodCrisis - 1);
  };

  World.prototype.runCoup = function (c) {
    var self = this;
    var successChance = 25 + c.factions.military * 0.6 + c.society.conflict * 0.3 - c.society.support * 0.3;
    var success = chance(clamp(successChance, 10, 85));
    c.coupHistory++;
    c.coupRisk = 0;
    if (success) {
      c.leader = "국방회의 " + randomLeaderName();
      c.government = "군정";
      c.society.support = clamp(c.society.support - 5);
      c.society.stability = clamp(c.society.stability + 15);
      c.factions.military = clamp(c.factions.military - 8);
      c.personality.militarism = clamp(c.personality.militarism + 6);
      self.addNews("정치", "🚨 쿠데타 발생! " + c.name + "에서 군부가 권력을 장악했다.", "군부 세력이 수도 주요 시설을 장악하고 정권 교체를 선언했다. 국제사회가 긴장하고 있다.", 1);
    } else {
      c.factions.military = clamp(c.factions.military - 4);
      c.society.stability = clamp(c.society.stability - 8);
      c.society.conflict = clamp(c.society.conflict + 4);
      self.addNews("정치", "쿠데타 미수", c.name + "에서 군부 쿠데타 시도가 진압됐다. 정부는 관계자 수사를 예고했다.", 2);
    }
  };

  /* ---------- 사건 처리 ---------- */

  World.prototype.eventPhase = function () {
    var self = this;
    var pool = D.events;
    // 가중치 총합
    var total = pool.reduce(function (s, e) { return s + e.weight; }, 0);
    var rolls = 1 + (chance(45) ? 1 : 0);
    for (var r = 0; r < rolls; r++) {
      var pickR = Math.random() * total;
      var cum = 0, ev = null;
      for (var i = 0; i < pool.length; i++) {
        cum += pool[i].weight;
        if (pickR <= cum) { ev = pool[i]; break; }
      }
      if (!ev) continue;
      if (ev.global) {
        var txt = ev.apply(self, null);
        if (txt) self.addNews(catOf(ev.type), "🌍 " + ev.name, txt, 1);
      } else {
        var cid = pick(Object.keys(self.countries));
        var c = self.countries[cid];
        var txt2 = ev.apply(self, c);
        if (txt2) self.addNews(catOf(ev.type), ev.name, txt2, 2);
      }
    }
  };

  /* ---------- 국제사회 처리 ---------- */

  World.prototype.internationalPhase = function () {
    var self = this;
    // 긴장도 자연 감쇠
    self.tension = clamp(self.tension * 0.93 - 0.5);
    // 전쟁이 없으면 평화 상승
    var wars = self.wars.filter(function (x) { return x.status === "active"; });
    if (!wars.length) self.tension = clamp(self.tension - 1);
    self.warCount = wars.length;
    self.worldPeace = clamp(100 - wars.length * 18 - self.tension * 0.6);
    // 중립국여론 영향력: 국제적 고립 추적은 해제
  };

  World.prototype.dateString = function () {
    var d = this.date;
    return d.y + "년 " + d.m + "월 " + d.d + "일";
  };

  World.prototype.advanceDate = function () {
    var d = this.date;
    var dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    d.d++;
    if (d.d > dim[d.m - 1]) { d.d = 1; d.m++; }
    if (d.m > 12) { d.m = 1; d.y++; }
  };

  /* ---------- 뉴스 ---------- */

  World.prototype.addNews = function (type, title, body, importance) {
    var self = this;
    self.news.unshift({
      turn: self.turn,
      date: self.dateString(),
      type: type,
      title: title,
      body: body,
      importance: importance || 3
    });
    if (self.news.length > 30) self.news.length = 30;
  };

  /* ---------- 메인 턴 ---------- */

  World.prototype.tick = function () {
    var self = this;
    self.log = [];

    /* 0) 플레이어 벌칙: prompt 유효 */
    if (self.playerPrompt) {
      // 턴 종료 시 붙은 prompt는 다음 턴 처리 전 검증
      self.playerPrompt.valid = false;
    }

    /* 1) AI 결정 */
    self.presolveAI();

    /* 2) 경제 */
    var ids = Object.keys(self.countries);
    for (var i = 0; i < ids.length; i++) {
      self.economyPhase(self.countries[ids[i]]);
    }

    /* 3) 정치 */
    for (var j = 0; j < ids.length; j++) {
      self.politicsPhase(self.countries[ids[j]]);
    }

    /* 4) 전쟁 처리 */
    self.warPhase();

    /* 5) 사건 */
    self.eventPhase();

    /* 6) 국제사회 */
    self.internationalPhase();

    /* 7) 날짜 증가 */
    self.advanceDate();
    self.turn++;

    /* 8) 피해국 사기/국민정서 */
    self.postWounds();

    /* 충격 요인으로 일부 국가의 목표변경 반영 */
    self.refreshGoals();

    return self;
  };

  /* 전쟁 피해 뒤 국민정서 한 번 더 (사상자 반영) */
  World.prototype.postWounds = function () {
    var self = this;
    var ids = Object.keys(self.countries);
    for (var i = 0; i < ids.length; i++) {
      var c = self.countries[ids[i]];
      var bur = self.warBurden(c.id);
      if (bur > 200) {
        c.society.support = clamp(c.society.support - Math.min(bur * 0.001, 3));
        c.military.morale = clamp(c.military.morale + (bur > 20000 ? 2 : 0));
      }
      // 목표·AI 계획 재설정용
      c.ai.idleTurns += 10;
    }
  };

  /* -------- 목표 생성 (국가별 현재 상황 요약) -------- */
  World.prototype.refreshGoals = function () {
    var self = this;
    var ids = Object.keys(self.countries);
    for (var i = 0; i < ids.length; i++) {
      var c = self.countries[ids[i]];
      var g = [];
      if (c.economyGrowth < -1 || c.treasury < 0.1) g.push({ text: "경제 회복", p: 90 });
      else if (c.society.support < 40) g.push({ text: "국민 지지 회복", p: 80 });
      if (c.military.tech < 55) g.push({ text: "군사 기술 향상", p: 60 });
      var t = c.topThreat();
      if (t && (self.isAtWar(c.id, t) || c.relations[t] < -30)) g.push({ text: "군사력 강화", p: 85 });
      if (!self.isAtWar(c.id) && c.relations[t] > -10 && Math.random() < 0.5) g.push({ text: "주변국과 외교 개선", p: 55 });
      var w = self.warsOf(c.id)[0];
      if (w) g.push({ text: w.progress > 0 ? "전쟁 수행" : "방어선 사수", p: 100 });
      if (c.society.conflict > 55) g.push({ text: "사회 안정", p: 70 });
      if (c.coupRisk > 40) g.push({ text: "정권 방어", p: 95 });
      if (c.personality.militarism > 60 && !self.isAtWar(c.id)) g.push({ text: "군비 증강", p: 65 });
      if (!g.length) g.push({ text: "현상 유지", p: 40 });
      g.sort(function (a, b) { return b.p - a.p; });
      c.goals = g.slice(0, 4);
    }
  };

  /* ---------- 기타 조작 API (플레이어/AI 공용) ---------- */

  World.prototype.annexNeutral = function (cid, rid, by) {
    var self = this;
    var r = self.regions[rid];
    if (!r || r.owner) return false;
    r.owner = cid;
    var c = self.countries[cid];
    if (by === "player") {
      c.treasury -= 800;
      self.addNews("외교", c.name + "이(가) " + r.name + "을 국가 영토로 편입했다.", "정부는 국경 지역 개발 계획과 함께 주민 지원 대책을 발표했다.", 4);
    }
    return true;
  };

  /* 플레이어용: 국가 만들기 (지역 확정) */
  World.prototype.createPlayerCountry = function (cfg, regionId) {
    var self = this;
    if (self.playerId) return null;
    var r = self.regions[regionId];
    if (!r || r.owner) return null;
    var data = {
      id: "player", name: cfg.name, government: cfg.government,
      leader: cfg.leader, capital: cfg.capital,
      color: cfg.color, back: cfg.color,
      note: cfg.note || "플레이어가 직접 운영하는 국가.",
      isPlayer: true,
      personality: cfg.personality,
      population: 15000000, gdp: 180000, treasury: 18000, debt: 2000,
      taxRate: 18, inflation: 3.5, unemployment: 7,
      military: { army: 60000, reserves: 120000, navy: 12, air: 40, equipment: 45, tech: 50, logistics: 50, morale: 60, mobilization: 40 },
      society: { support: 60, stability: 62, happiness: 55, poverty: 16, education: 58, security: 58, conflict: 25 },
      budget: { military: 30, welfare: 25, admin: 15, research: 15, diplomacy: 15 }
    };
    var pc = new C(data, self);
    self.countries["player"] = pc;
    self.playerId = "player";
    r.owner = "player";
    r.originalOwner = "player";
    r.neutral = false;
    // 원래 중립이었던 지역 목록에서 제거
    var ni = self.neutralRegions.indexOf(regionId);
    if (ni >= 0) self.neutralRegions.splice(ni, 1);
    // 주변국 관계 형성 (전 국가 대상 균형 배정 + 대칭 초기화)
    pc.initRelations();
    var allIds = Object.keys(self.countries);
    for (var aq = 0; aq < allIds.length; aq++) {
      var oid = allIds[aq];
      if (oid === "player") continue;
      self.countries[oid].relations["player"] = D.clamp(pc.relations[oid] + (Math.random() * 20 - 10), -60, 60);
    }
    var nbrs = self.neighborsOf("player");
    for (var i = 0; i < nbrs.length; i++) {
      pc.relations[nbrs[i]] = D.clamp(pc.relations[nbrs[i]] + (Math.random() * 20 - 5));
    }
    pc.computeBudget();
    self.addNews("외교", "🌍 신생국 설립! " + pc.name + "이(가) 국제 무대에 등장했다.", pc.name + "은(는) " + r.name + "을 수도 영토로 하여 건국을 선언했다. 주요국들이 반응을 주시하고 있다.", 1);
    self.refreshGoals();
    return pc;
  };

  /* -------- 전쟁 진행 -------- */

  World.prototype.warPhase = function () {
    var self = this;
    var acts = self.wars.filter(function (x) { return x.status === "active"; });
    for (var i = 0; i < acts.length; i++) {
      self.runWarTurn(acts[i]);
    }
    // 종결 후 남은 전쟁 재판정
    for (var k = acts.length - 1; k >= 0; k--) {
      if (acts[k].status === "active") {
        self.autoResolveWar(acts[k]);
      }
    }
  };

  /* 특정 전쟁 한 턴 진행 */
  World.prototype.runWarTurn = function (w) {
    var self = this;
    var A = self.countries[w.attackerId], B = self.countries[w.defenderId];
    if (!A || !B) return;

    var off = powerOfSide(self, w.attackers), def = powerOfSide(self, w.defenders) * 1.15;

    /* 공격할 수 있는 경계 지역 결정 */
    var atkFronts = frontRegions(self, w.attackers, w.defenders);

    // 전투력 비 비교
    var diff = off - def;
    var denom = (off + def) || 1;
    var advance = (diff / denom) * 46;
    // 동맹 보너스
    advance += (w.attackers.length - 1) * 1.5 - (w.defenders.length - 1) * 1.2;
    w.progress = clamp(w.progress + advance, -100, 100);

    /* 지역 점령 - 게이트 방식 */
    var captureSchedule = [16, 34, 55, 74, 92];
    for (var g = 0; g < captureSchedule.length; g++) {
      var gate = captureSchedule[g];
      if (w.progress >= gate && !w.usedA[g]) {
        w.usedA[g] = true;
        var target = pickAttackerTarget(self, w);
        if (target) {
          w.capturedByA.push(target);
          self.regions[target].owner = w.attackerId;
          self.regions[target].captured = w.id;
          self.regions[target].capturedSide = "atk";
          self.addNews("전쟁", "⚔️ " + A.name + "군이 " + self.regions[target].name + "을 점령했다.", A.name + "군은 " + self.regions[target].name + " 일대에서 방어선을 돌파하고 지역 통제권을 확보했다.", 1);
          if (self.countries["player"] && w.defenders.indexOf("player") >= 0) {
            self.afterRegionLost("player", target);
          }
        } else {
          w.usedA[g] = false;
        }
        break;
      }
    }
    /* 수비측 반격 */
    for (var g2 = 0; g2 < captureSchedule.length; g2++) {
      var gate2 = captureSchedule[g2];
      if (w.progress <= -gate2 && !w.usedD[g2]) {
        w.usedD[g2] = true;
        var targetD = pickDefenderTarget(self, w);
        if (targetD) {
          w.capturedByD.push(targetD);
          self.regions[targetD].owner = w.defenderId;
          self.regions[targetD].captured = w.id;
          self.regions[targetD].capturedSide = "def";
          self.addNews("전쟁", "🛡️ " + B.name + "군이 " + self.regions[targetD].name + "을 탈환했다.", B.name + "군의 반격으로 전선 일부가 원상회복 됐다.", 2);
        } else {
          w.usedD[g2] = false;
        }
        break;
      }
    }

    /* 사상자 */
    var engageRate = 0.008 + Math.abs(diff) / (denom * 2);
    var casLoss = Math.max(1, Math.floor((A.military.army * 0.02 * (def / (off + def || 1)) )));
    var casDef = Math.max(1, Math.floor((B.military.army * 0.02 * (off / (off + def || 1)) )));

    // 실제 손실: 공격측 병력 감소
    A.military.army -= Math.min(A.military.army, casLoss + ri(0, casLoss));
    B.military.army -= Math.min(B.military.army, casDef + ri(0, casDef));
    var lossA = Math.max(0, casLoss), lossD = Math.max(0, casDef);
    w.casualtiesA += lossA; w.casualtiesD += lossD;

    /* 피로 누적 */
    w.exhaustionA = clamp(w.exhaustionA + 1.2 + lossA / 10000, 0, 100);
    w.exhaustionD = clamp(w.exhaustionD + 1.1 + lossD / 10000, 0, 100);
    w.turnsRunning = (w.turnsRunning || 0) + 1;

    /* 전선 상황 텍스트 갱신 */
    self.resyncWarPhase(w);

    /* 국제여론: 장기전 감점 */
    if (w.turnsRunning > 15) murkGlobalOpinion(self, w.attackerId, 2);
  };

  /* 아군/적군 측 합계 전투력 */
  function powerOfSide(self, ids) {
    var p = 0;
    for (var i = 0; i < ids.length; i++) {
      var c = self.countries[ids[i]];
      if (c) p += c.militaryPower() * (0.5 + c.military.mobilization / 100);
    }
    return p;
  }

  function powerWithAllies(self, cid) {
    var total = self.countries[cid].militaryPower();
    var as = self.countries[cid].alliances;
    for (var i = 0; i < as.length; i++) {
      var p = self.countries[as[i].partner];
      if (p && as[i].mutualDefense) total += p.militaryPower() * 0.4;
    }
    return total;
  }

  function frontRegions(self, attackers, defenders) {
    var out = [];
    var keys = Object.keys(self.regions);
    for (var i = 0; i < keys.length; i++) {
      var r = self.regions[keys[i]];
      if (attackers.indexOf(r.owner) < 0) continue;
      for (var j = 0; j < r.neighbors.length; j++) {
        var nb = self.regions[r.neighbors[j]];
        if (nb.owner && defenders.indexOf(nb.owner) >= 0) {
          out.push(r.id);
        }
      }
    }
    return out;
  }

  function pickAttackerTarget(self, w) {
    var fronts = frontRegions(self, w.attackers, w.defenders);
    var candidates = [];
    for (var i = 0; i < fronts.length; i++) {
      var f = self.regions[fronts[i]];
      for (var j = 0; j < f.neighbors.length; j++) {
        var nb = self.regions[f.neighbors[j]];
        if (nb.owner && w.defenders.indexOf(nb.owner) >= 0 && !w.capturedByA.includes(nb.id)) {
          candidates.push(nb.id);
        }
      }
    }
    if (!candidates.length) {
      // 전 영토를 다 점령했다면 종결
      w.universal = true;
      return null;
    }
    return pick(candidates);
  }

  function pickDefenderTarget(self, w) {
    // 공격측 영토 탈환: 우선 점령된 본토 탈환
    if (w.capturedByA.length) {
      return w.capturedByA[w.capturedByA.length - 1];
    }
    var fronts = frontRegions(self, w.defenders, w.attackers);
    var candidates = [];
    for (var i = 0; i < fronts.length; i++) {
      var f = self.regions[fronts[i]];
      for (var j = 0; j < f.neighbors.length; j++) {
        var nb = self.regions[f.neighbors[j]];
        if (nb.owner && w.attackers.indexOf(nb.owner) >= 0 && !w.capturedByD.includes(nb.id)) {
          candidates.push(nb.id);
        }
      }
    }
    if (!candidates.length) return null;
    return pick(candidates);
  }

  /* 플레이어 영토 상실 시 알림 */
  World.prototype.afterRegionLost = function (cid, rid) {
    var self = this;
    var r = self.regions[rid];
    self.playerPrompt = { kind: "regionlost", rid: rid, rname: r.name, cid: cid, valid: true };
  };

  /* ---------- 국가 목표 갱신은 refreshGoals()에서 처리 ---------- */

  /* ---------- 직렬화 ---------- */

  /* ---------- 플레이어 조작용 공용 API ---------- */
  World.prototype.relChange = function (a, b, d) { adjustRelation(this, a, b, d); };
  World.prototype.makeAlliance = function (a, b, md, tr) {
    if (hasAlliance(this, a, b)) return false;
    if (a === b) return false;
    if (this.countries[a].relations[b] < 15) return false;
    createAlliance(this, a, b, md, tr, false, 10);
    return true;
  };
  World.prototype.makeTrade = function (a, b) {
    if (this.countries[a].tradePacts.indexOf(b) >= 0) return false;
    if (a === b) return false;
    if (this.countries[a].relations[b] < -5) return false;
    establishTradePact(this, a, b);
    return true;
  };
  World.prototype.atWar = function (a, b) { return this.isAtWar(a, b); };
  World.prototype.warsList = function () { return this.wars; };
  World.prototype.adjustRelationPublic = World.prototype.relChange;

  World.prototype.toJSON = function () {
    var self = this;
    var countries = {};
    var ids = Object.keys(self.countries);
    for (var i = 0; i < ids.length; i++) {
      countries[ids[i]] = self.countries[ids[i]].toJSON();
    }
    var regions = {};
    var rk = Object.keys(self.regions);
    for (var j = 0; j < rk.length; j++) {
      var r = self.regions[rk[j]];
      regions[rk[j]] = { owner: r.owner, captured: r.captured, capturedSide: r.capturedSide };
    }
    // 전쟁 상태 유지 처리: 진행 중 플래그
    return {
      v: 1,
      turn: self.turn, date: self.date, era: self.era,
      tension: self.tension, warCount: self.warCount, worldPeace: self.worldPeace,
      playerId: self.playerId,
      grid: self.gridCfg,
      countries: countries,
      regions: regions,
      alliances: self.alliances,
      wars: self.wars,
      news: self.news
    };
  };

  World.fromJSON = function (data) {
    var seed = {
      turn: data.turn, date: data.date, era: data.era,
      tension: data.tension, warCount: data.warCount, worldPeace: data.worldPeace,
      playerId: data.playerId, wars: data.wars || [], alliances: data.alliances || [],
      news: data.news || [], restore: true, regions: data.regions,
      grid: data.grid   // 옛 세이브(9x6)는 grid 없음 → 기본값 클래식 재현
    };
    var w = new World(seed);
    // 국가 복구
    var ids = Object.keys(data.countries);
    for (var i = 0; i < ids.length; i++) {
      var c = C.fromJSON(data.countries[ids[i]], w);
      w.countries[ids[i]] = c;
    }
    w.playerId = data.playerId;
    return w;
  };

  /* ---------- 모듈 노출 ---------- */
  window.World = World;

  /* ---------- 모듈 내부 헬퍼 ---------- */

  function shiftBudget(c, key, amt) {
    c.budget[key] = clamp(c.budget[key] + amt, 5, 60);
  }
  function normalizeBudget(c, max) {
    var sum = c.budget.military + c.budget.welfare + c.budget.admin + c.budget.research + c.budget.diplomacy;
    if (sum <= 100) return;
    var over = sum - 100;
    // 군사 우선 유지, 나머지 감축
    var cuts = ["research", "welfare", "diplomacy", "admin"];
    for (var i = 0; i < cuts.length && over > 0; i++) {
      var red = Math.min(over, c.budget[cuts[i]] - 5);
      if (red > 0) { c.budget[cuts[i]] -= red; over -= red; }
    }
    if (over > 0) c.budget.military -= over;
  }

  function hasAlliance(self, a, b) {
    var c = self.countries[a];
    if (!c) return false;
    return c.alliances.some(function (al) { return al.partner === b; });
  }

  function createAlliance(self, a, b, mutualDefense, trade, intel, years) {
    // 양방향 목록 유지
    self.countries[a].alliances.push({ aid: "al" + (self.alliances.length + 1), partner: b, mutualDefense: mutualDefense, trade: trade, intel: intel, yearsLeft: years });
    self.countries[b].alliances.push({ aid: "al" + (self.alliances.length + 1), partner: a, mutualDefense: mutualDefense, trade: trade, intel: intel, yearsLeft: years });
    self.alliances.push({ id: "al" + (self.alliances.length + 1), a: a, b: b, mutualDefense: mutualDefense, trade: trade, intel: intel, yearsLeft: years });
    adjustRelation(self, a, b, 25);
    self.addNews("외교", "🤝 " + self.countries[a].name + "과 " + self.countries[b].name + "이 동맹을 체결했다.",
      self.countries[a].name + "·" + self.countries[b].name + " 양국은 상호방위와 협력에 합의하고 동맹 조약에 서명했다.", 1);
  }

  function establishTradePact(self, a, b) {
    if (self.countries[a].tradePacts.indexOf(b) < 0) self.countries[a].tradePacts.push(b);
    if (self.countries[b].tradePacts.indexOf(a) < 0) self.countries[b].tradePacts.push(a);
    self.countries[a].tradeLevel += 3;
    self.countries[b].tradeLevel += 3;
    adjustRelation(self, a, b, 6);
    self.addNews("경제", "📈 " + self.countries[a].name + "와 " + self.countries[b].name + "이 무역협정을 체결했다.", "양국 간 관세가 인하되어 교역량이 늘어날 전망이다.", 3);
  }

  function adjustRelation(self, a, b, d) {
    if (!self.countries[a] || !self.countries[b]) return;
    if (self.countries[a].relations[b] === undefined) self.countries[a].relations[b] = 0;
    if (self.countries[b].relations[a] === undefined) self.countries[b].relations[a] = 0;
    self.countries[a].relations[b] = clamp(self.countries[a].relations[b] + d, -100, 100);
    self.countries[b].relations[a] = clamp(self.countries[b].relations[a] + d, -100, 100);
  }

  function anger(self, cid, tid) {
    return (self.countries[cid].relations[tid] || 0) < -20;
  }

  function chooseCasusBelli(c, target) {
    // 성향에 따른 명분 선호
    var options = D.casusBelli.slice();
    var best = options[0], bestScore = -999;
    for (var i = 0; i < options.length; i++) {
      var o = options[i];
      var score = o.supportBonus * 2 + o.worldPenalty * -1.5;
      if (o.id === "territory") score += c.personality.aggression;
      if (o.id === "protection") score += 5;
      if (o.id === "ally") score += 6;
      if (o.id === "regime") score += (c.personality.militarism - 40);
      if (o.id === "total") score += (c.personality.aggression - 60) + (c.personality.isolation > 50 ? 8 : 0);
      score += Math.random() * 10;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    return best;
  }

  function countWorldWars(self) {
    return self.wars.filter(function (w) { return w.status === "active"; }).length;
  }

  function murkGlobalOpinion(self, attackerId, amount) {
    var ids = Object.keys(self.countries);
    for (var i = 0; i < ids.length; i++) {
      var c = self.countries[ids[i]];
      if (c.id === attackerId) continue;
      adjustRelation(self, c.id, attackerId, -amount);
    }
    self.addNews("외교", "🌐 국제사회가 " + self.countries[attackerId].name + "을(를) 비난했다.", "여러 국가가 성명을 내고 " + self.countries[attackerId].name + "의 행동에 대한 우려를 표명했다.", 3);
  }

  var first = ["아란", "벨", "카일", "데릭", "에린", "피온", "갈룬", "히로", "이사", "조엘", "칸", "레오", "미르", "네온", "온드", "파진", "란", "세인"];
  var last = ["하르", "벨란", "케인", "도란", "에스타", "리온", "말간", "노브라", "오른도", "펠릭", "산더스", "타란", "울릭", "베르", "자인", "크리드"];
  function randomLeaderName() {
    return pick(first) + pick(last);
  }

  function catOf(type) {
    var map = { economic: "경제", political: "정치", military: "군사", diplomatic: "외교", disaster: "재해" };
    return map[type] || "세계";
  }
})();