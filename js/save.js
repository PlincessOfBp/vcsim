/* ============================================================
   SaveLib : LocalStorage 자동저장 + JSON 세이브 파일
   ============================================================ */
(function () {
  "use strict";

  var SAVE_KEY = "vcsim_autosave";
  var SAVE_SLOTS_KEY = "vcsim_slots";

  function SaveLib() {}

  /* 자동 저장 */
  SaveLib.autosave = function (world, slotName) {
    try {
      var data = world.toJSON();
      if (slotName) {
        var slots = SaveLib.listSlots();
        slots[slotName] = { savedAt: new Date().toISOString(), turn: data.turn, date: dateToString(data.date) };
        localStorage.setItem(SAVE_SLOTS_KEY, JSON.stringify(slots));
      }
      var payload = JSON.stringify(data);
      localStorage.setItem(SAVE_KEY, payload);
      return payload.length;
    } catch (e) {
      console.warn("자동저장 실패", e);
      return 0;
    }
  };

  SaveLib.hasAutosave = function () {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  };

  SaveLib.loadAutosave = function () {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  };

  SaveLib.clearAutosave = function () {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  };

  SaveLib.listSlots = function () {
    try {
      return JSON.parse(localStorage.getItem(SAVE_SLOTS_KEY) || "{}");
    } catch (e) { return {}; }
  };

  /* JSON 파일 내보내기 */
  SaveLib.exportFile = function (world) {
    var data = JSON.stringify(world.toJSON(), null, 2);
    var blob = new Blob([data], { type: "application/json" });
    var a = document.createElement("a");
    var timestamp = dateCompact(world.date);
    a.href = URL.createObjectURL(blob);
    a.download = "world_save_t" + world.turn + "_" + timestamp + ".json";
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
  };

  /* JSON 파일 불러오기 */
  SaveLib.importFile = function (file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var data = JSON.parse(e.target.result);
          if (!data.countries || data.v === undefined) {
            reject(new Error("올바른 세이브 파일이 아닙니다."));
            return;
          }
          // 포맷이 1버전인지 확인
          if (data.v !== 1) {
            reject(new Error("지원하지 않는 세이브 버전입니다: v" + data.v));
            return;
          }
          resolve(data);
        } catch (err) { reject(err); }
      };
      reader.onerror = function () { reject(new Error("파일 읽기 실패")); };
      reader.readAsText(file);
    });
  };

  function dateToString(d) {
    return (d.y || "unknown") + "년 " + (d.m || 1) + "월 " + (d.d || 1) + "일";
  }
  function dateCompact(d) {
    return (d.y || "") + "-" + pad(d.m) + "-" + pad(d.d);
  }
  function pad(n) { return ("0" + n).slice(-2); }

  window.SaveLib = SaveLib;
})();