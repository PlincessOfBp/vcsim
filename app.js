/* ============================================================
   앱 진입점
   ============================================================ */
(function () {
  "use strict";

  window.addEventListener("load", function () {
    /* 전역 오류 표시 (개발용) */
    window.addEventListener("error", function (e) {
      try {
        var t = document.getElementById("toast");
        if (t) {
          t.textContent = "오류: " + (e.message || e.type);
          t.classList.add("show");
        }
      } catch (err) {}
    });

    UI.checkStart();
  });
})();