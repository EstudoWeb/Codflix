(function () {
  // ================================
  // BLOQUEIO ANTES DE CARREGAR (DEVTOOLS JÁ ABERTO)
  // ================================
  const widthDiffEarly = window.outerWidth - window.innerWidth;
  const heightDiffEarly = window.outerHeight - window.innerHeight;

  if (widthDiffEarly > 160 || heightDiffEarly > 160) {
    document.documentElement.innerHTML = "";
    window.location.replace("https://www.google.com");
    return;
  }

  // ================================
  // CONFIG
  // ================================
  const REDIRECT_URL = "https://www.google.com";
  const DETECTION_INTERVAL = 1000; // ms
  const DEBUGGER_THRESHOLD = 100; // ms

  let blocked = false;

  function blockAccess() {
    if (blocked) return;
    blocked = true;

    try {
      document.documentElement.innerHTML = `
        <style>
          body {
            margin: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            background: #000;
            color: #fff;
            font-family: Arial, sans-serif;
          }
        </style>
        <h1>🚫 Acesso Bloqueado</h1>
      `;
    } catch (e) {}

    setTimeout(() => {
      window.location.href = REDIRECT_URL;
    }, 1200);
  }

  // ================================
  // BLOQUEAR BOTÃO DIREITO (DESKTOP)
  // ================================
  if (!("ontouchstart" in window)) {
    document.addEventListener("mousedown", function (e) {
      if (e.button === 2) {
        e.preventDefault();
        blockAccess();
      }
    });
  }

  // ================================
  // BLOQUEAR TECLAS
  // ================================
  document.addEventListener("keydown", function (e) {
    const key = e.key.toLowerCase();

    if (
      e.key === "F12" ||
      (e.ctrlKey && e.shiftKey && ["i", "j", "c"].includes(key)) ||
      (e.ctrlKey && key === "u")
    ) {
      e.preventDefault();
      blockAccess();
    }
  });

  // ================================
  // DEVTOOLS VIA DEBUGGER
  // ================================
  setInterval(function () {
    const start = performance.now();
    debugger;
    const end = performance.now();

    if (end - start > DEBUGGER_THRESHOLD) {
      blockAccess();
    }
  }, DETECTION_INTERVAL);

  // ================================
  // DEVTOOLS POR TAMANHO DA JANELA
  // ================================
  setInterval(function () {
    const widthDiff = window.outerWidth - window.innerWidth;
    const heightDiff = window.outerHeight - window.innerHeight;

    if (widthDiff > 160 || heightDiff > 160) {
      blockAccess();
    }
  }, 500);

})();
