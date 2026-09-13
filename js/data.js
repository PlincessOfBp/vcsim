/* ============================================================
   SIM_DATA : 세계/국가/이벤트 정적 데이터
   GitHub Pages (정적) 배포를 위해 JSON 대신 JS 임베드.
   ============================================================ */
window.SIM_DATA = (function () {
  "use strict";

  var COLS = 9;   // 지도 가로 칸
  var ROWS = 6;   // 지도 세로 칸
  var SIZE = 40;  // 헥사 렌더 크기(px)

  /* row별 layout 문자열: 9자, 각 칸은 국가 코드 또는 '.' (플레이어 창건지) */
  var LAYOUT = [
    "VVVAAKKLL",
    "VVVAAKKLL",
    "VDDA.KKLL",
    "DDD.CKKLL",
    "DDCCCEEEE",
    "D.CC.EEEE"
  ];

  var CODE_TO_ID = {
    V: "velos", A: "arcadia", K: "krandra",
    L: "latria", D: "dortania", C: "canaria", E: "esteria"
  };

  /* 지역 이름 (행 우선, col0..8) — 54개 */
  var REGION_NAMES = [
    // r0
    "벨가르 평원","세란디아 산맥","부론 분지","아르켄 평원","크라운 평야","루미엔 고원","네샤 계곡","토르발 해안","엘레드 반도",
    // r1
    "카르핀 습지","미라 초원","둔셀 저지","베오르 대평원","할린 구릉","이르칸 북부","세이넨 평원","파르웨 만","키렌 곶",
    // r2
    "안사드 숲","펠로스 하구","에란디 안개골","우르크 고지","니모르 황야","그라빈 대산맥","실란 벌판","헬루스 해협","데인 동부",
    // r3
    "자이르 광산지대","콘라드 평야","메리바 구릉","손델 갈림길","크라프 초지","이스투 요새지대","베트렌 계곡","옐로위 고원","노르베 반도",
    // r4
    "사레나 해변","배른트 늪","이델라 포구","실팔레 호반","하나르 들판","미르켄 숲","안델바르 평원","크레테르 산맥","오른델 곶",
    // r5
    "칼레르 섬","페이론 석호","로실란 남부","다루웨 사막","세르반 저지","랄로른 해안","바시엘만","엘티온 봉","지르헤 상록림"
  ];

  /* ---------- 헥사 그리드 유틸 (odd-r offset) ---------- */
  function hexCenter(col, row) {
    return {
      x: SIZE * Math.sqrt(3) * (col + 0.5 * (row % 2)) + SIZE,
      y: SIZE * 1.5 * row + SIZE
    };
  }

  function hexCorners(col, row) {
    var c = hexCenter(col, row);
    var pts = [];
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 180 * (60 * i);
      pts.push((c.x + SIZE * Math.cos(a)).toFixed(1) + "," + (c.y + SIZE * Math.sin(a)).toFixed(1));
    }
    return pts.join(" ");
  }

  function regionId(col, row) {
    return "r" + row + "c" + col;
  }

  function regionNeighbors(col, row, cols, rows) {
    cols = cols || COLS; rows = rows || ROWS;
    var dirs;
    if (row % 2 === 0) {
      dirs = [[-1, -1], [0, -1], [-1, 0], [1, 0], [-1, 1], [0, 1]];
    } else {
      dirs = [[0, -1], [1, -1], [-1, 0], [1, 0], [0, 1], [1, 1]];
    }
    var out = [];
    for (var i = 0; i < dirs.length; i++) {
      var nc = col + dirs[i][0], nr = row + dirs[i][1];
      if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) out.push(regionId(nc, nr));
    }
    return out;
  }

  function isCoast(col, row, cols, rows) {
    cols = cols || COLS; rows = rows || ROWS;
    return col === 0 || col === cols - 1 || row === 0 || row === rows - 1;
  }

  /* ---------- 지역 이름 생성 (임의 크기 맵용) ---------- */
  var NAME_PART = ["벨", "세", "부", "아르", "크라", "루", "네", "토", "엘", "카", "미", "둔", "베", "할", "이", "세이", "파르", "키르", "안사", "펠", "에란", "우르", "니모", "그라", "실란", "헬루", "데이", "자이", "콘", "메리", "손델", "클라프", "이스투", "베트", "옐로", "노르", "사레", "배른", "이델", "실팔", "하나", "미르", "안델", "크레", "오른", "칼레", "페이", "로실", "다루", "세르반", "랄로", "바시", "엘티", "지르", "오스", "바이", "켄달", "프로", "아니"];
  var TERRAIN = [" 평원", " 산맥", " 분지", " 고원", " 계곡", " 해안", " 곶", " 습지", " 초원", " 저지", " 구릉", " 북부", " 만", " 숲", " 하구", " 고지", " 황야", " 대산맥", " 벌판", " 해협", " 동부", " 광산지대", " 갈림길", " 초지", " 요새지대", " 반도", " 늪", " 포구", " 호반", " 들판", " 섬", " 석호", " 남부", " 사막", " 봉", " 상록림", " 영지", " 성채", " 주"];
  function regionName(idx, salt) {
    return NAME_PART[(idx * 5 + salt) % NAME_PART.length] + TERRAIN[(idx * 7 + salt * 3) % TERRAIN.length];
  }

  /* ---------- 맵 프리셋 & 국가 id ---------- */
  var DEFAULT_COUNTRY_IDS = ["velos", "arcadia", "krandra", "latria", "dortania", "canaria", "esteria"];
  var MAP_SIZE_PRESETS = [
    { label: "소형 7×5", cols: 7, rows: 5 },
    { label: "표준 9×6", cols: 9, rows: 6 },
    { label: "대형 11×7", cols: 11, rows: 7 }
  ];

  /* ---------- 지역 객체 생성 (파라메트릭) ---------- */
  function regionObject(col, row, name, codeOwner, cols, rows) {
    var startOwner = codeOwner || null;
    return {
      id: regionId(col, row), col: col, row: row, name: name,
      owner: null, neutral: !startOwner, startOwner: startOwner,
      coast: isCoast(col, row, cols, rows),
      points: hexCorners(col, row),
      cx: hexCenter(col, row).x,
      cy: hexCenter(col, row).y,
      neighbors: regionNeighbors(col, row, cols, rows)
    };
  }

  /* 클래식 9x6 프리셋 (기존 수작업 배치 재현 — 기존 세이브 호환) */
  function buildClassicGrid() {
    var regionsById = {}, neutralRegions = [], idx = 0;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var code = LAYOUT[r][c];
        var id = regionId(c, r);
        regionsById[id] = regionObject(c, r, REGION_NAMES[idx], code === "." ? null : (CODE_TO_ID[code] || null), COLS, ROWS);
        if (code === ".") neutralRegions.push(id);
        idx++;
      }
    }
    return { cols: COLS, rows: ROWS, countryIds: DEFAULT_COUNTRY_IDS.slice(), density: 90, regionsById: regionsById, neutralRegions: neutralRegions };
  }

  /* 수도 배치: 국가 수만큼 지도에 골고루 놓기 (텅 빈 곳 없이) */
  function placeCapitals(cols, rows, n) {
    var pts = [], used = {};
    for (var i = 0; i < n; i++) {
      var t = n === 1 ? 0.5 : i / (n - 1);
      var tx = (i % 2 === 0) ? 0.2 : 0.8;
      var ty = 0.16 + 0.68 * t;
      var c0 = Math.min(cols - 1, Math.round(tx * (cols - 1)));
      var r0 = Math.min(rows - 1, Math.round(ty * (rows - 1)));
      var placed = false;
      for (var rad = 0; rad < Math.max(cols, rows) && !placed; rad++) {
        for (var dr = -rad; dr <= rad && !placed; dr++) {
          for (var dc = -rad; dc <= rad && !placed; dc++) {
            if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
            var nc = c0 + dc, nr = r0 + dr;
            if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
              var key = regionId(nc, nr);
              if (!used[key]) { used[key] = 1; pts.push({ c: nc, r: nr }); placed = true; }
            }
          }
        }
      }
      if (!placed) break;
    }
    return pts;
  }

  /* 임의 크기 맵 생성: 수도 중심 블록 + 중립 밀도 조절 */
  function buildGeneratedGrid(cols, rows, countryIds, density) {
    var caps = placeCapitals(cols, rows, countryIds.length);
    var cells = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) cells.push({ c: c, r: r });
    }
    /* 거리 기반 소유 할당 (가장 가까운 수도) */
    var ownerIdx = new Array(cells.length);
    var dist = new Array(cells.length);
    for (var i = 0; i < cells.length; i++) {
      var best = -1, bestD = Infinity;
      for (var k = 0; k < caps.length; k++) {
        var dx = cells[i].c - caps[k].c, dy = cells[i].r - caps[k].r;
        var d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = k; }
      }
      ownerIdx[i] = best;
      dist[i] = bestD;
    }
    /* 목표 밀도까지 중립 전환 (수도는 유지, 먼 곳부터) */
    var total = cells.length;
    var targetClaim = Math.max(countryIds.length * 2, Math.round(total * density / 100));
    var order = [];
    for (var j = 0; j < cells.length; j++) {
      var isCap = false;
      for (var ck = 0; ck < caps.length; ck++) {
        if (cells[j].c === caps[ck].c && cells[j].r === caps[ck].r) { isCap = true; break; }
      }
      if (!isCap) order.push(j);
    }
    order.sort(function (a, b) { return dist[b] - dist[a]; });
    var claimed = cells.length;
    for (var o = 0; o < order.length && claimed > targetClaim; o++) {
      ownerIdx[order[o]] = -1;
      claimed--;
    }
    /* 지역 객체 생성 */
    var regionsById = {}, neutralRegions = [];
    for (var ci = 0; ci < cells.length; ci++) {
      var cell = cells[ci];
      var owner = ownerIdx[ci] >= 0 ? countryIds[ownerIdx[ci]] : null;
      var id = regionId(cell.c, cell.r);
      regionsById[id] = regionObject(cell.c, cell.r, regionName(ci, cell.c + cell.r * 3), owner, cols, rows);
      if (!owner) neutralRegions.push(id);
    }
    return { cols: cols, rows: rows, countryIds: countryIds.slice(), density: density, regionsById: regionsById, neutralRegions: neutralRegions };
  }

  function sameIds(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /* 최종 그리드 생성 (기본값: 표준 9x6 클래식) */
  function buildGrid(opts) {
    opts = opts || {};
    var cols = opts.cols || COLS, rows = opts.rows || ROWS;
    var ids = opts.countryIds || DEFAULT_COUNTRY_IDS.slice();
    var density = opts.density === undefined ? 90 : clamp(opts.density, 40, 95);
    if (cols === COLS && rows === ROWS && density >= 90 && sameIds(ids, DEFAULT_COUNTRY_IDS)) {
      return buildClassicGrid();
    }
    return buildGeneratedGrid(cols, rows, ids, density);
  }

  var defaultGrid = buildGrid(null);

  /* ---------- 국가 프리셋 ---------- */
  var countries = [
    {
      id: "velos", name: "벨로스 연방",
      government: "연방 공화국", leader: "그리송 벨라크", capital: "부론",
      color: "#c0392b", back: "#5e1d16",
      personality: { militarism: 88, diplomacy: 30, economy: 45, aggression: 85, isolation: 15 },
      population: 61000000, gdp: 720000, treasury: 55000, debt: 18000,
      taxRate: 20, inflation: 7.2, unemployment: 11,
      military: { army: 430000, reserves: 900000, navy: 130, air: 820, equipment: 72, tech: 60, logistics: 65, morale: 62, mobilization: 55 },
      society: { support: 51, stability: 58, happiness: 39, poverty: 24, education: 55, security: 42, conflict: 55 },
      budget: { military: 45, welfare: 18, admin: 14, research: 16, diplomacy: 7 },
      note: "강대한 군사력을 가진 팽창주의 연방. 북부 산악지대를 무대로 군국주의에 가깝게 행동한다."
    },
    {
      id: "arcadia", name: "아르카디아 공화국",
      government: "공화국", leader: "에드윈 카르", capital: "아르카",
      color: "#4A90E2", back: "#1d3a5e",
      personality: { militarism: 76, diplomacy: 42, economy: 60, aggression: 65, isolation: 20 },
      population: 48200000, gdp: 850000, treasury: 82400, debt: 12000,
      taxRate: 18, inflation: 3.8, unemployment: 6,
      military: { army: 250000, reserves: 650000, navy: 70, air: 450, equipment: 78, tech: 72, logistics: 70, morale: 68, mobilization: 60 },
      society: { support: 62, stability: 71, happiness: 60, poverty: 14, education: 72, security: 65, conflict: 28 },
      budget: { military: 38, welfare: 22, admin: 15, research: 18, diplomacy: 7 },
      note: "대륙 중앙의 강대국. 군사적 긴장 고조 때마다 국경 방어와 북부 안정을 중시한다."
    },
    {
      id: "krandra", name: "크산드라 제국",
      government: "전제 제국", leader: "황제 오벨리우스 3세", capital: "이스투",
      color: "#8e44ad", back: "#45215a",
      personality: { militarism: 70, diplomacy: 35, economy: 50, aggression: 62, isolation: 35 },
      population: 35500000, gdp: 480000, treasury: 30000, debt: 28000,
      taxRate: 24, inflation: 9.5, unemployment: 14,
      military: { army: 300000, reserves: 520000, navy: 45, air: 350, equipment: 62, tech: 55, logistics: 58, morale: 55, mobilization: 70 },
      society: { support: 44, stability: 49, happiness: 33, poverty: 27, education: 48, security: 46, conflict: 62 },
      budget: { military: 42, welfare: 14, admin: 20, research: 12, diplomacy: 12 },
      note: "요새 지대를 다스리는 전제 제국. 내부 불안이 높아 내정 혼란이 잦다."
    },
    {
      id: "latria", name: "라트리아 왕국",
      government: "입헌 군주국", leader: "왕 칼리안 2세", capital: "토르발",
      color: "#16a085", back: "#0d4d40",
      personality: { militarism: 38, diplomacy: 68, economy: 72, aggression: 28, isolation: 20 },
      population: 28500000, gdp: 520000, treasury: 60000, debt: 8000,
      taxRate: 17, inflation: 2.6, unemployment: 5,
      military: { army: 140000, reserves: 300000, navy: 210, air: 300, equipment: 75, tech: 70, logistics: 72, morale: 66, mobilization: 45 },
      society: { support: 58, stability: 66, happiness: 63, poverty: 11, education: 74, security: 68, conflict: 22 },
      budget: { military: 24, welfare: 28, admin: 16, research: 20, diplomacy: 12 },
      note: "북동부 해양국가. 해군과 무역에 강하며 전쟁을 회피하는 외교 중심 성향."
    },
    {
      id: "dortania", name: "도르타니아 공화국",
      government: "공화국", leader: "마리오 벤토", capital: "콘라드",
      color: "#d35400", back: "#6b2a00",
      personality: { militarism: 55, diplomacy: 55, economy: 60, aggression: 45, isolation: 30 },
      population: 45000000, gdp: 610000, treasury: 42000, debt: 15000,
      taxRate: 18, inflation: 4.4, unemployment: 8,
      military: { army: 260000, reserves: 500000, navy: 90, air: 500, equipment: 68, tech: 64, logistics: 63, morale: 60, mobilization: 58 },
      society: { support: 57, stability: 62, happiness: 52, poverty: 17, education: 62, security: 58, conflict: 40 },
      budget: { military: 33, welfare: 24, admin: 15, research: 16, diplomacy: 12 },
      note: "남서부 광산 국가. 균형 잡힌 성향으로 상황에 따라 협력과 대치를 오간다."
    },
    {
      id: "canaria", name: "카나리아 연합",
      government: "연합 공화국", leader: "류 산드린", capital: "하나르",
      color: "#2ecc71", back: "#0f4a22",
      personality: { militarism: 28, diplomacy: 72, economy: 76, aggression: 18, isolation: 25 },
      population: 39000000, gdp: 700000, treasury: 70000, debt: 5000,
      taxRate: 16, inflation: 2.2, unemployment: 4,
      military: { army: 180000, reserves: 260000, navy: 160, air: 400, equipment: 74, tech: 76, logistics: 74, morale: 72, mobilization: 40 },
      society: { support: 70, stability: 74, happiness: 68, poverty: 9, education: 78, security: 72, conflict: 16 },
      budget: { military: 20, welfare: 30, admin: 16, research: 22, diplomacy: 12 },
      note: "남부의 평화적 경제 강국. 중재와 무역협정을 선호하며 전쟁을 극도로 회피한다."
    },
    {
      id: "esteria", name: "에스테르",
      government: "공과국", leader: "수상 네이아 발룬", capital: "안델바르",
      color: "#f39c12", back: "#6b4a00",
      personality: { militarism: 42, diplomacy: 46, economy: 55, aggression: 38, isolation: 55 },
      population: 22000000, gdp: 330000, treasury: 22000, debt: 20000,
      taxRate: 19, inflation: 5.6, unemployment: 10,
      military: { army: 110000, reserves: 220000, navy: 30, air: 250, equipment: 60, tech: 58, logistics: 60, morale: 57, mobilization: 46 },
      society: { support: 50, stability: 55, happiness: 47, poverty: 20, education: 60, security: 55, conflict: 42 },
      budget: { military: 30, welfare: 22, admin: 18, research: 15, diplomacy: 15 },
      note: "동부의 고립주의 소국. 타국 분쟁에 거의 개입하지 않으며 국경 방어에 집중한다."
    }
  ];

  /* ---------- 침략 명분 ---------- */
  var casusBelli = [
    { id: "territory", name: "영토 분쟁", supportBonus: 6, worldPenalty: 3, desc: "접경 지역의 영유권을 주장한다. 국내 지지가 상승하지만 국제사회 반감이 크다." },
    { id: "protection", name: "국민 보호", supportBonus: 8, worldPenalty: 1, desc: "피해를 입은 국민을 보호한다는 명분. 국내 지지가 크게 오르고 국제 반감은 적다." },
    { id: "economy", name: "경제적 이익", supportBonus: 2, worldPenalty: 2, desc: "경제적 이익을 위해 침공한다. 지지도 효과는 적지만 명분이 명확하다." },
    { id: "ally", name: "동맹국 방어", supportBonus: 9, worldPenalty: -1, desc: "공격받은 동맹국을 방어한다. 국제사회의 지지를 얻는다." },
    { id: "regime", name: "정권 전복", supportBonus: -2, worldPenalty: 4, desc: "상대국 정권 교체를 목표로 한다. 명분이 약해 국제 비난이 크다." },
    { id: "total", name: "무조건 침략", supportBonus: -4, worldPenalty: 6, desc: "명분 없는 확장 전쟁. 국내외에서 강한 비난을 받는다." }
  ];

  /* ---------- 랜덤 이벤트 풀 ---------- */
  var events = [
    // 경제
    { id: "boom", name: "경제 호황", type: "economic", weight: 8, global: false,
      apply: function (w, c) { c.economyGrowth += 0.8; c.society.happiness = clamp(c.society.happiness + 3); c.society.support = clamp(c.society.support + 2); return c.name + "의 경제가 호황을 맞아 실업률이 급감하고 소비가 살아났다."; } },
    { id: "recession", name: "경기 침체", type: "economic", weight: 7, global: false,
      apply: function (w, c) { c.economyGrowth -= 0.6; c.unemployment = clamp(c.unemployment + 2, 1, 35); c.society.support = clamp(c.society.support - 2); return c.name + "에 경기 침체가 닥쳐 실업률이 급증하고 있다."; } },
    { id: "resource", name: "천연자원 발견", type: "economic", weight: 5, global: false,
      apply: function (w, c) { c.gdp += c.gdp * 0.04; c.treasury += c.gdpNow() * 0.002; c.resourceBonus = 3; return c.name + " 영토에서 대규모 천연자원이 발견되어 경제가 도약할 전망이다."; } },
    { id: "foodcrisis", name: "식량난", type: "disaster", weight: 5, global: false,
      apply: function (w, c) { c.economyGrowth -= 0.8; c.society.happiness = clamp(c.society.happiness - 3); c.society.conflict = clamp(c.society.conflict + 3); return c.name + "에서 식량 부족 사태가 발생해 물가가 급등하고 불만이 확산되고 있다."; } },
    { id: "debt", name: "국가 부채 위기", type: "economic", weight: 4, global: false,
      apply: function (w, c) { c.debt += c.gdp * 0.008; c.treasury -= Math.min(c.treasury, c.gdp * 0.003); c.society.support = clamp(c.society.support - 3); return c.name + "의 국가 부채가 위험 수준으로 치솟아 국제 금융시장의 우려가 커졌다."; } },
    // 정치
    { id: "election", name: "총선 실시", type: "political", weight: 6, global: false,
      apply: function (w, c) { var s = c.society; if (s.support > 50) { s.stability += 4; return c.name + " 총선에서 집권파가 승리해 체제가 안정됐다."; } s.stability -= 4; s.support = clamp(s.support + 2); return c.name + " 총선에서 야권이 크게 약진하며 정국이 불안해졌다."; } },
    { id: "protest", name: "대규모 시위", type: "political", weight: 7, global: false,
      apply: function (w, c) { c.society.support = clamp(c.society.support - 3); c.society.stability = clamp(c.society.stability - 4); c.society.conflict = clamp(c.society.conflict + 4); return c.name + " 수도에서 대규모 반정부 시위가 열렸다. 경찰과 충돌이 발생했다."; } },
    { id: "scandal", name: "정치 스캔들", type: "political", weight: 5, global: false,
      apply: function (w, c) { c.society.support = clamp(c.society.support - 3); c.society.stability = clamp(c.society.stability - 2); return c.name + " 정부 고위 인사가 부패 스캔들에 연루되어 여론이 악화됐다."; } },
    { id: "reform", name: "개혁 성공", type: "political", weight: 4, global: false,
      apply: function (w, c) { c.society.support = clamp(c.society.support + 4); c.society.education += 2; c.treasury -= 500; c.treasury = Math.max(0, c.treasury); return c.name + " 정부의 행정 개혁이 성과를 내며 국민 지지가 회복됐다."; } },
    // 군사
    { id: "borderclash", name: "국경 충돌", type: "military", weight: 7, global: false,
      apply: function (w, c) {
        var n = randomOf(w.neighborsOf(c.id), 1);
        if (!n) return null;
        adjustRelation(w, c.id, n, -12);
        var t = w.countries[n];
        t.society.conflict = clamp(t.society.conflict + 4);
        c.society.conflict = clamp(c.society.conflict + 4);
        c.society.support = clamp(c.society.support + 2);
        w.tension += 3;
        return c.name + "과 " + t.name + " 접경에서 국경 충돌이 발생했다. 양국 군대가 교전 중이다.";
      } },
    { id: "drill", name: "대규모 군사훈련", type: "military", weight: 6, global: false,
      apply: function (w, c) { c.military.morale += 3; c.society.support = clamp(c.society.support + 1); c.treasury -= 300; c.treasury = Math.max(0, c.treasury); w.tension += 2; return c.name + "이 대규모 군사훈련을 시작해 국경 주변 지역의 긴장이 높아졌다."; } },
    { id: "weapon", name: "신형 무기 개발", type: "military", weight: 4, global: false,
      apply: function (w, c) { c.military.tech += 4; c.military.equipment += 3; return c.name + "이 자체 개발 신형 무기체계의 실전 배치를 발표했다."; } },
    { id: "mutiny", name: "군부 반란 용의", type: "military", weight: 4, global: false,
      apply: function (w, c) { c.society.stability = clamp(c.society.stability - 5); c.military.morale -= 4; c.coupRisk = clamp(c.coupRisk + 8); return c.name + " 군부 일부가 반란을 준비했다는 정황이 포착됐다. 정권이 강경 대응에 나섰다."; } },
    // 외교
    { id: "summit", name: "정상회담 성사", type: "diplomatic", weight: 5, global: false,
      apply: function (w, c) {
        var n = randomOf(w.neighborsOf(c.id), 1);
        if (!n) return null;
        adjustRelation(w, c.id, n, 8);
        return c.name + "과 " + w.countries[n].name + " 간 정상회담이 열려 양국 관계 개선에 합의했다.";
      } },
    { id: "embargo", name: "국제 제재", type: "diplomatic", weight: 4, global: false,
      apply: function (w, c) { c.economyGrowth -= 0.6; c.unemployment = clamp(c.unemployment + 1, 1, 35); return c.name + "에 대한 국제사회의 경제 제재가 시작됐다. 수출이 급감하고 있다."; } },
    // 자연재해
    { id: "earthquake", name: "대지진", type: "disaster", weight: 3, global: false,
      apply: function (w, c) { c.economyGrowth -= 0.8; c.society.happiness = clamp(c.society.happiness - 4); c.society.support = clamp(c.society.support - 2); return c.name + "에서 규모 7의 대지진이 발생해 큰 피해가 발생했다."; } },
    { id: "flood", name: "대홍수", type: "disaster", weight: 3, global: false,
      apply: function (w, c) { c.economyGrowth -= 0.6; c.society.security -= 3; return c.name + "에서 대홍수가 발생해 농작물과 인프라가 유실됐다."; } },
    { id: "plague", name: "전염병 확산", type: "disaster", weight: 3, global: false,
      apply: function (w, c) { c.population -= Math.floor(c.population * 0.008); c.economyGrowth -= 0.7; c.society.support = clamp(c.society.support - 3); return c.name + "에서 신종 전염병이 확산되어 사망자가 늘고 경제가 위축되고 있다."; } },
    { id: "drought_chain", name: "장기 가뭄", type: "disaster", weight: 3, global: false,
      apply: function (w, c) { c.economyGrowth -= 0.5; c.society.happiness = clamp(c.society.happiness - 2); c.society.conflict = clamp(c.society.conflict + 2); c.foodCrisis += 1; return c.name + "에 장기 가뭄이 계속되면서 식량 생산이 줄고 유통 시장이 흔들리고 있다."; } }
  ];

  /* ---------- 유틸 (world에도 있으나 로드 시점 보장용) ---------- */
  function clamp(v, lo, hi) { if (lo === undefined) lo = 0; if (hi === undefined) hi = 100; return Math.max(lo, Math.min(hi, v)); }
  function randomOf(arr, count) {
    if (!arr || !arr.length) return null;
    var pool = arr.slice();
    var out = [];
    count = count === undefined ? 1 : count;
    for (var i = 0; i < count && pool.length; i++) {
      out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    return count === 1 ? out[0] : out;
  }
  function adjustRelation(w, a, b, d) {
    if (!w.countries[a] || !w.countries[b]) return;
    if (!w.countries[a].relations[b]) w.countries[a].relations[b] = 0;
    w.countries[a].relations[b] = clamp(w.countries[a].relations[b] + d, -100, 100);
    if (!w.countries[b].relations[a]) w.countries[b].relations[a] = 0;
    w.countries[b].relations[a] = clamp(w.countries[b].relations[a] + d, -100, 100);
  }
  function fmt(n) {
    return Math.round(n).toLocaleString("ko-KR");
  }

  return {
    COLS: COLS, ROWS: ROWS, SIZE: SIZE,
    LAYOUT: LAYOUT,
    regionsById: defaultGrid.regionsById,
    neutralRegions: defaultGrid.neutralRegions,
    regionId: regionId,
    hexCenter: hexCenter,
    hexCorners: hexCorners,
    regionNeighbors: regionNeighbors,
    buildGrid: buildGrid,
    MAP_SIZE_PRESETS: MAP_SIZE_PRESETS,
    DEFAULT_COUNTRY_IDS: DEFAULT_COUNTRY_IDS,
    countries: countries,
    casusBelli: casusBelli,
    events: events,
    clamp: clamp,
    randomOf: randomOf,
    adjustRelation: adjustRelation,
    fmt: fmt
  };
})();