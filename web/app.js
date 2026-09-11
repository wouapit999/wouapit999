/* Wouapit-Androman web console — vanilla JS, no dependencies. */
(function () {
  "use strict";

  /* ---------------- theme ---------------- */
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem("wa-theme"); } catch (e) {}
  if (saved) root.setAttribute("data-theme", saved);
  var themeBtn = document.getElementById("themeToggle");
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("wa-theme", next); } catch (e) {}
    });
  }

  /* ---------------- toast ---------------- */
  var toastEl = document.getElementById("toast");
  var toastTimer;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 1900);
  }

  /* ---------------- copy buttons ---------------- */
  function textToCopy(btn) {
    var sel = btn.getAttribute("data-copy");
    if (sel === "prev") {
      var code = btn.parentElement.querySelector("code");
      return code ? code.textContent : "";
    }
    var el = document.querySelector(sel);
    return el ? el.textContent : "";
  }
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".copy");
    if (!btn) return;
    var text = textToCopy(btn);
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { toast("Copied to clipboard"); },
        function () { toast("Copy failed — select manually"); }
      );
    } else {
      toast("Copy not supported here");
    }
  });

  /* ---------------- tabs ---------------- */
  var tabs = document.querySelectorAll(".tab");
  var panels = document.querySelectorAll(".panel");
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var name = tab.getAttribute("data-tab");
      tabs.forEach(function (t) { t.classList.toggle("is-active", t === tab); });
      panels.forEach(function (p) {
        p.classList.toggle("is-active", p.getAttribute("data-panel") === name);
      });
    });
  });

  /* ---------------- USB mode selection ---------------- */
  var MODES = {
    mtp:      { label: "File Transfer (MTP)", svc: "mtp",   chip: "USB: File Transfer (MTP)" },
    ptp:      { label: "Photo Transfer (PTP)", svc: "ptp",  chip: "USB: Photo (PTP)" },
    rndis:    { label: "USB Tethering (RNDIS)", svc: "rndis", chip: "USB: Tethering" },
    midi:     { label: "MIDI", svc: "midi", chip: "USB: MIDI" },
    charging: { label: "Charging only", svc: "none", chip: "USB: Charging only" }
  };
  var cmdText = document.getElementById("cmdText");
  var cliStatus = document.getElementById("cliStatus");
  var modeChip = document.getElementById("modeChip");
  var modeTiles = document.querySelectorAll(".mode-tile");

  function selectMode(mode) {
    var m = MODES[mode];
    if (!m) return;
    if (cmdText) cmdText.textContent = "adb shell svc usb setFunctions " + m.svc;
    if (cliStatus) {
      cliStatus.innerHTML = "Sets the phone to <b>" + m.label + "</b>. " +
        (connectedDevice
          ? "Copy the command and run it against your authorized device."
          : "Connect a device or run this in the desktop app.");
    }
    if (modeChip) { modeChip.textContent = m.chip; modeChip.classList.add("on"); }
    modeTiles.forEach(function (t) {
      t.classList.toggle("selected", t.getAttribute("data-mode") === mode);
    });
  }
  modeTiles.forEach(function (t) {
    t.addEventListener("click", function () { selectMode(t.getAttribute("data-mode")); });
  });

  /* ---------------- hero mock switch ---------------- */
  var heroSwitch = document.getElementById("heroSwitch");
  var heroPill = document.getElementById("heroPill");
  var heroOn = false;
  if (heroSwitch && heroPill) {
    heroSwitch.addEventListener("click", function () {
      heroOn = !heroOn;
      heroPill.textContent = heroOn ? "USB: File Transfer (MTP)" : "USB: Charging only";
      heroPill.classList.toggle("on", heroOn);
      heroSwitch.innerHTML = heroOn
        ? '<span class="switch-ic">🔌</span> Switch to Charging'
        : '<span class="switch-ic">🔄</span> Switch to File Transfer';
    });
  }

  /* ---------------- WebUSB device detection ---------------- */
  // Android devices commonly expose an ADB interface: class 0xFF, subclass 0x42, protocol 0x01.
  var connectedDevice = null;
  var connectBtn = document.getElementById("connectBtn");
  var devName = document.getElementById("devName");
  var devSub = document.getElementById("devSub");
  var devAvatar = document.getElementById("devAvatar");

  // A few well-known Android USB vendor IDs (Xiaomi, Google, Samsung, etc.).
  var VENDORS = {
    0x2717: "Xiaomi", 0x18d1: "Google", 0x04e8: "Samsung",
    0x22b8: "Motorola", 0x2a70: "OnePlus", 0x12d1: "Huawei",
    0x0bb4: "HTC", 0x1004: "LG", 0x0fce: "Sony"
  };

  function toHex(n) { return "0x" + n.toString(16).padStart(4, "0"); }

  async function connect() {
    if (!("usb" in navigator)) {
      toast("WebUSB needs Chrome or Edge over HTTPS");
      if (devSub) devSub.textContent = "This browser has no WebUSB. Use the desktop app instead.";
      return;
    }
    try {
      var device = await navigator.usb.requestDevice({
        filters: [
          { classCode: 0xff, subclassCode: 0x42, protocolCode: 0x01 }, // ADB
          { classCode: 0xff } // vendor-specific fallback
        ]
      });
      connectedDevice = device;
      var vendor = VENDORS[device.vendorId] || device.manufacturerName || "Android device";
      var name = device.productName || (vendor + " device");
      if (devName) devName.textContent = name;
      if (devAvatar) devAvatar.textContent = /xiaomi|redmi|poco/i.test(vendor + name) ? "🔶" : "📱";
      if (devSub) {
        devSub.textContent =
          vendor + " · vendor " + toHex(device.vendorId) + " · product " + toHex(device.productId) +
          (device.serialNumber ? " · SN " + device.serialNumber : "");
      }
      if (connectBtn) connectBtn.textContent = "Connected ✓";
      toast("Detected " + name);
    } catch (err) {
      if (err && err.name === "NotFoundError") {
        toast("No device picked");
      } else {
        toast("Could not access device");
        if (devSub) devSub.textContent = "WebUSB was blocked. On desktop, use the app for full control.";
      }
    }
  }
  if (connectBtn) connectBtn.addEventListener("click", connect);

  /* ---------------- feature grid ---------------- */
  var FEATURES = [
    ["🔄", "USB mode switch", "Charging → File Transfer (MTP), PTP, tethering, MIDI or charging-only, in one tap."],
    ["📁", "File transfer", "Push and pull files and folders, and export your whole DCIM camera roll at once."],
    ["📦", "App manager", "List installed apps, install APKs, uninstall, and back up any app’s APK to your PC."],
    ["🗄️", "Backup & restore", "Full-device archive with Android’s built-in backup, restored just as easily."],
    ["📸", "Screen capture", "Grab screenshots and record up to 3 minutes of video straight to your computer."],
    ["🖥️", "Screen mirror", "Live-mirror and control the phone on your desktop through scrcpy."],
    ["📊", "Device dashboard", "Model, Android & MIUI version, security patch, battery and storage at a glance."],
    ["🧰", "Power tools", "Reboot to recovery/bootloader/fastboot, capture logcat, and open a shell console."]
  ];
  var grid = document.getElementById("featureGrid");
  if (grid) {
    FEATURES.forEach(function (f) {
      var el = document.createElement("div");
      el.className = "feature";
      el.innerHTML = '<div class="f-ic">' + f[0] + "</div><h4>" + f[1] + "</h4><p>" + f[2] + "</p>";
      grid.appendChild(el);
    });
  }

  // default selection
  selectMode("mtp");
})();
