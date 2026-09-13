/* ============================================================
   Country : 개별 국가 객체
   ============================================================ */
(function () {
  "use strict";

  var D = window.SIM_DATA;

  function Country(cfg, world) {
    var self = this;
    self.world = world;
    self.id = cfg.id;
    self.name = cfg.name;
    self.government = cfg.government;
    self.leader = cfg.leader;
    self.capital = cfg.capital;
    self.color = cfg.color;
    self.back = cfg.back || "#222";
    self.note = cfg.note || "";

    self.isPlayer = !!cfg.isPlayer;

    self.personality = {
      militarism: cfg.personality.militarism | 0,
      diplomacy: cfg.personality.diplomacy | 0,
      economy: cfg.personality.economy | 0,
      aggression: cfg.personality.aggression | 0,
      isolation: cfg.personality.isolation | 0
    };

    /* 경제 */
    self.population = cfg.population;
    self.gdp = cfg.gdp;                       // 억
    self.taxRate = cfg.taxRate;               // % ( 세수 비율 )
    self.treasury = cfg.treasury;             // 억
    self.debt = cfg.debt;
    self.inflation = cfg.inflation;
    self.unemployment = cfg.unemployment;
    self.economyGrowth = 0;                   // 이번 턴 성장률(누적 예약)
    self.baseGrowth = 0.08;                   // 성장 기반 (턴당 %, 연간 약 30% 미만)
    self.tradeLevel = 0;                      // 무역총량 보너스(누적)
    self.resourceBonus = 0;
    self.foodCrisis = 0;
    self.embargoed = 0;                       // 제재 횟수
    self.expenses = { military: 0, welfare: 0, admin: 0, research: 0, diplomacy: 0 };

    /* 군사 */
    self.military = {
      army: cfg.military.army,                // 병력(명)
      reserves: cfg.military.reserves,        // 예비군
      navy: cfg.military.navy,                // 함정
      air: cfg.military.air,                  // 항공기
      equipment: cfg.military.equipment,      // 장비수준 0~100
      tech: cfg.military.tech,                // 군사기술
      logistics: cfg.military.logistics,      // 군수/보급
      morale: cfg.military.morale,            // 사기
      mobilization: cfg.military.mobilization // 동원력
    };

    /* 사회 */
    self.society = {
      support: cfg.society.support,           // 국민 지지도
      stability: cfg.society.stability,       // 정권 안정도
      happiness: cfg.society.happiness,       // 행복도
      poverty: cfg.society.poverty,           // 빈곤율
      education: cfg.society.education,       // 교육수준
      security: cfg.society.security,         // 치안
      conflict: cfg.society.conflict          // 사회 갈등
    };

    /* 외교 */
    self.diplomacy = { influence: 40, trust: 50 };
    self.relations = {};                      // id -> -100..100
    self.alliances = [];                      // {aid, partner, mutualDefense, trade, intel, years}
    self.tradePacts = [];                     // partner id 목록

    /* 정치 */
    self.factions = { gov: 48, military: 21, opposition: 18, radical: 7, neutral: 6 };
    self.coupRisk = 0;                        // 0..100
    self.coupHistory = 0;

    /* 재정 */
    self.budget = {
      military: cfg.budget.military,
      welfare: cfg.budget.welfare,
      admin: cfg.budget.admin,
      research: cfg.budget.research,
      diplomacy: cfg.budget.diplomacy
    };

    /* AI 상태 */
    self.ai = { targetId: null, plan: "idle", idleTurns: 0, lastSpent: 0, spies: 0 };

    /* 경기버퍼: 이번 턴 행동 예약 */
    self.pending = { recruit: 0, disarm: 0, train: 0, equipment: 0, invest: 0, welfare: 0, taxChange: 0 };

    self.initRelations();
  }

  /* 모든 국가와 초기 관계 설정 (거리 무관 - 인접 여부에 따라 기반값) */
  Country.prototype.initRelations = function () {
    var self = this;
    var ids = Object.keys(self.world.countries);
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === self.id) continue;
      var base = 0;
      // 성향 차이에 따른 기본 호감
      var diff = Math.abs(self.personality.diplomacy - self.world.countries[ids[i]].personality.diplomacy);
      base += -diff / 4;
      // 평화 vs 깡패 성향
      if (self.personality.aggression > 60) base -= 10;
      if (self.world.countries[ids[i]].personality.aggression > 60) base -= 10;
      base += (Math.random() * 14 - 7);
      self.relations[ids[i]] = D.clamp(Math.round(base), -60, 60);
    }
  };

  Country.prototype.gdpNow = function () {
    return this.gdp + this.economyGrowth * this.gdp / 100;
  };

  /* 세입 (억) — 턴당: GDP 대비 약 1.4% (세율 18% 기준) */
Country.prototype.taxIncome = function () {
    var self = this;
    var eff = self.taxRate * 0.0008;   // 18% -> 0.0144
    var penalty = 1 - (self.society.conflict * 0.002);
    penalty = Math.max(penalty, 0.6);
    return self.gdp * eff * penalty;
  };

  /* 지출 합계 */
  Country.prototype.expenseTotal = function () {
    var e = this.expenses;
    return e.military + e.welfare + e.admin + e.research + e.diplomacy;
  };

  /* 예산 배분 실행: GDP 대비 ~1.54% 총지출 (문서 예시 기준) */
  Country.prototype.computeBudget = function () {
    var self = this;
    var base = self.gdp * 0.000154; // 총지출 ~1.54% GDP
    var b = self.budget;
    // 전쟁 중이면 군사비 우선 자동증액
    var warMult = self.world.isAtWar(self.id) ? 1.4 : 1.0;
    self.expenses.military = base * b.military * warMult;
    self.expenses.welfare = base * b.welfare;
    self.expenses.admin = base * b.admin;
    self.expenses.research = base * b.research;
    self.expenses.diplomacy = base * b.diplomacy;
  };

  /* 개인 실사 전투력 (표시용) 0~100 */
  Country.prototype.militaryPower = function () {
    var self = this;
    var m = self.military;
    var army = m.army / 100000;
    var power = Math.pow(Math.max(army, 0.3), 0.65);
    power *= (0.45 + m.equipment / 100 * 0.55);
    power *= (0.4 + m.tech / 100 * 0.6);
    power *= (0.5 + m.logistics / 100 * 0.5);
    power *= (0.5 + m.morale / 100 * 0.5);
    power *= (0.4 + m.mobilization / 100 * 0.6);
    // 해군/공군 소수 보정
    power += m.navy * 0.004 + m.air * 0.0015;
    return Math.round(power * 10) / 10;
  };

  /* 잠재적 위협 인식: 인접국 중 위협이 되는 국가 */
  Country.prototype.topThreat = function () {
    var self = this;
    var best = null, bestVal = -999;
    var nbrs = self.world.neighborsOf(self.id);
    for (var i = 0; i < nbrs.length; i++) {
      var other = self.world.countries[nbrs[i]];
      if (!other) continue;
      if (self.world.isAtWar(self.id, nbrs[i])) {
        return nbrs[i];
      }
      var threat = other.militaryPower();
      threat *= (1 + other.personality.aggression / 100);
      threat -= self.relations[nbrs[i]] * 0.3;
      if (self.world.isAtWar(nbrs[i])) threat *= 1.3;
      if (threat > bestVal) { bestVal = threat; best = nbrs[i]; }
    }
    return best;
  };

  /* AI가 상대국 정보를 실제로 얼마나 정확히 아는가 (정보 신뢰도) */
  Country.prototype.intelReliabilityOn = function (otherId) {
    var self = this;
    var base = 60 + self.personality.diplomacy * 0.1;
    base += self.ai.spies * 4;
    base -= self.world.countries[otherId].diplomacy.trust * 0.1;
    return D.clamp(base, 20, 97);
  };

  /* 행복도 / 지지도에 따른 내정 효과 */
  Country.prototype.updatePolitics = function () {
    var self = this;
    var s = self.society;
    var g = self.economyGrowth;
    // 지지도 이동 (성장률이 작아져 계수 상향)
    s.support = D.clamp(s.support + g * 6 + (s.happiness - 50) * 0.08 - self.unemployment * 0.05 - self.inflation * 0.05 + (self.pending.welfare > 0 ? 1.5 : 0));
    // 행복도 소폭 수렴
    s.happiness = D.clamp(s.happiness + (s.support - s.happiness) * 0.08 + s.poverty * -0.08);
    // 안정도
    var warStab = self.world.isAtWar(self.id) ? -3 : 0;
    s.stability = D.clamp(s.stability + (s.support - s.stability) * 0.15 + warStab - s.conflict * 0.05 + (self.pending.welfare > 0 ? 1 : 0));
    s.security = D.clamp(s.security + (s.stability - s.security) * 0.05);
    s.conflict = D.clamp(s.conflict - 0.6 + s.poverty * 0.02);
    // 쿠데타 위험
    var baseRisk = 100 - s.stability * 1.1 + s.conflict * 0.5 + self.factions.military * 0.3;
    baseRisk = Math.max(0, baseRisk);
    self.coupRisk = D.clamp(self.coupRisk + (baseRisk - self.coupRisk) * 0.3 + (self.foodCrisis > 0 ? 4 : 0));
  };

  /* 세이브/로드용 직렬화 */
  Country.prototype.toJSON = function () {
    var self = this;
    return {
      id: self.id, name: self.name, government: self.government, leader: self.leader,
      capital: self.capital, color: self.color, back: self.back, note: self.note,
      isPlayer: self.isPlayer,
      personality: self.personality,
      population: self.population, gdp: self.gdp, taxRate: self.taxRate,
      treasury: self.treasury, debt: self.debt, inflation: self.inflation,
      unemployment: self.unemployment, economyGrowth: 0, baseGrowth: self.baseGrowth,
      tradeLevel: self.tradeLevel, resourceBonus: self.resourceBonus,
      foodCrisis: self.foodCrisis, embargoed: self.embargoed,
      military: self.military,
      society: self.society,
      diplomacy: self.diplomacy, relations: self.relations,
      alliances: self.alliances, tradePacts: self.tradePacts,
      factions: self.factions, coupRisk: self.coupRisk, coupHistory: self.coupHistory,
      budget: self.budget,
      ai: self.ai
    };
  };

  Country.fromJSON = function (data, world) {
    var c = new Country({
      id: data.id, name: data.name, government: data.government, leader: data.leader,
      capital: data.capital, color: data.color, back: data.back, note: data.note,
      isPlayer: data.isPlayer,
      personality: data.personality,
      population: data.population, gdp: data.gdp, taxRate: data.taxRate,
      treasury: data.treasury, debt: data.debt, inflation: data.inflation,
      unemployment: data.unemployment,
      military: data.military, society: data.society, diplomacy: data.diplomacy,
      factions: data.factions, budget: data.budget,
      ai: data.ai || { targetId: null, plan: "idle", idleTurns: 0, lastSpent: 0, spies: 0 }
    }, world);
    c.alliances = data.alliances || [];
    c.tradePacts = data.tradePacts || [];
    c.relations = data.relations || {};
    c.coupRisk = data.coupRisk || 0;
    c.coupHistory = data.coupHistory || 0;
    c.tradeLevel = data.tradeLevel || 0;
    c.resourceBonus = data.resourceBonus || 0;
    c.foodCrisis = data.foodCrisis || 0;
    c.embargoed = data.embargoed || 0;
    c.baseGrowth = data.baseGrowth || 2.0;
    return c;
  };

  window.Country = Country;
})();