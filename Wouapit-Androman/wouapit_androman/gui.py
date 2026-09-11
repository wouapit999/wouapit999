"""
gui.py — The Wouapit-Androman desktop interface (Tkinter, stdlib only).

A tabbed window:
  * Connection  — detect devices, see the live USB mode, one-click switch
  * Files       — pull/push, export photos
  * Apps        — list, install, uninstall, back up APKs
  * Backup      — full device backup / restore
  * Screen      — screenshot, record, mirror
  * Tools       — reboot, logcat, contacts/SMS export, shell console

All work runs on background threads so the window never freezes, and a
PREMIUM · ACTIVATED banner makes clear every feature is unlocked.
"""

from __future__ import annotations

import queue
import threading
import traceback
from typing import Callable, Optional

try:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
except Exception as exc:  # pragma: no cover - headless environments
    tk = None
    _IMPORT_ERROR = exc

from . import __app_name__, __version__, license
from .adb import AdbClient, AdbError, Device
from .device import collect
from .features import Toolkit
from .usb import MODE_ORDER, USB_MODES, UsbSwitcher

ACCENT = "#00A884"
BG = "#0f1419"
CARD = "#1a2029"
FG = "#e6e6e6"
MUTED = "#8a94a6"


class App:
    def __init__(self, root: "tk.Tk"):
        self.root = root
        self.client = AdbClient()
        self.device: Optional[Device] = None
        self._events: "queue.Queue" = queue.Queue()

        root.title(f"{__app_name__} {__version__}")
        root.geometry("880x620")
        root.minsize(760, 540)
        root.configure(bg=BG)

        self._build_style()
        self._build_header()
        self._build_tabs()
        self._build_statusbar()

        self.root.after(150, self._drain_events)
        self.refresh_devices()

    # --------------------------------------------------------------- styling
    def _build_style(self):
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("TNotebook", background=BG, borderwidth=0)
        style.configure("TNotebook.Tab", background=CARD, foreground=FG,
                        padding=(16, 8), font=("Segoe UI", 10))
        style.map("TNotebook.Tab", background=[("selected", ACCENT)],
                  foreground=[("selected", "#04150f")])
        style.configure("TFrame", background=BG)
        style.configure("Card.TFrame", background=CARD)
        style.configure("TLabel", background=BG, foreground=FG, font=("Segoe UI", 10))
        style.configure("Card.TLabel", background=CARD, foreground=FG)
        style.configure("Muted.TLabel", background=BG, foreground=MUTED, font=("Segoe UI", 9))
        style.configure("H1.TLabel", background=BG, foreground=FG, font=("Segoe UI", 15, "bold"))
        style.configure("Accent.TButton", background=ACCENT, foreground="#04150f",
                        font=("Segoe UI", 10, "bold"), padding=(14, 8), borderwidth=0)
        style.map("Accent.TButton", background=[("active", "#00c99b")])
        style.configure("TButton", background=CARD, foreground=FG, padding=(10, 6), borderwidth=0)
        style.map("TButton", background=[("active", "#2a323d")])
        style.configure("Treeview", background=CARD, fieldbackground=CARD,
                        foreground=FG, borderwidth=0, rowheight=24)
        style.configure("Treeview.Heading", background=BG, foreground=MUTED)

    def _build_header(self):
        head = tk.Frame(self.root, bg=BG)
        head.pack(fill="x", padx=18, pady=(14, 6))
        tk.Label(head, text=f"📱  {__app_name__}", bg=BG, fg=FG,
                 font=("Segoe UI", 18, "bold")).pack(side="left")
        badge = tk.Label(head, text=f"  {license.EDITION} · {license.STATUS}  ",
                         bg=ACCENT, fg="#04150f", font=("Segoe UI", 9, "bold"))
        badge.pack(side="right", pady=6)
        tk.Label(head, text="All features unlocked — no upgrade required",
                 bg=BG, fg=MUTED, font=("Segoe UI", 9)).pack(side="right", padx=10)

    def _build_tabs(self):
        self.nb = ttk.Notebook(self.root)
        self.nb.pack(fill="both", expand=True, padx=14, pady=6)
        self._tab_connection()
        self._tab_files()
        self._tab_apps()
        self._tab_backup()
        self._tab_screen()
        self._tab_tools()

    def _build_statusbar(self):
        self.status_var = tk.StringVar(value="Ready.")
        bar = tk.Frame(self.root, bg=CARD)
        bar.pack(fill="x", side="bottom")
        self.spinner = tk.Label(bar, text="", bg=CARD, fg=ACCENT, font=("Segoe UI", 10))
        self.spinner.pack(side="left", padx=(10, 0))
        tk.Label(bar, textvariable=self.status_var, bg=CARD, fg=MUTED,
                 font=("Segoe UI", 9), anchor="w").pack(side="left", fill="x",
                                                        expand=True, padx=10, pady=5)

    # ---------------------------------------------------------- async plumbing
    def run_async(self, fn: Callable[[], str], on_done: Optional[Callable] = None,
                  busy: str = "Working..."):
        """Run fn() on a worker thread; report result on the UI thread."""
        self.set_busy(busy)

        def worker():
            try:
                result = fn()
                self._events.put(("ok", result, on_done))
            except Exception as exc:  # noqa: BLE001 - surfaced to the user
                tb = traceback.format_exc()
                self._events.put(("err", (exc, tb), on_done))

        threading.Thread(target=worker, daemon=True).start()

    def _drain_events(self):
        try:
            while True:
                kind, payload, on_done = self._events.get_nowait()
                self.set_busy(None)
                if kind == "ok":
                    self.set_status(str(payload).strip().splitlines()[0]
                                    if payload else "Done.")
                    if on_done:
                        on_done(payload)
                else:
                    exc, tb = payload
                    self.set_status(f"Error: {exc}")
                    messagebox.showerror("Wouapit-Androman", str(exc))
        except queue.Empty:
            pass
        self.root.after(150, self._drain_events)

    def set_busy(self, text: Optional[str]):
        self.spinner.config(text="⏳" if text else "")
        if text:
            self.set_status(text)

    def set_status(self, text: str):
        self.status_var.set(text)

    # ---------------------------------------------------- device selection
    def current_serial(self) -> Optional[str]:
        return self.device.serial if self.device else None

    def require_device(self) -> bool:
        if not self.device or not self.device.is_ready:
            messagebox.showwarning("No device",
                                   "Connect a phone with USB debugging enabled first.")
            return False
        return True

    def toolkit(self) -> Toolkit:
        return Toolkit(self.client, self.current_serial())

    # ============================================================= TAB: Connection
    def _tab_connection(self):
        f = ttk.Frame(self.nb)
        self.nb.add(f, text="  Connection  ")

        top = ttk.Frame(f)
        top.pack(fill="x", padx=16, pady=(16, 8))
        ttk.Label(top, text="Devices", style="H1.TLabel").pack(side="left")
        ttk.Button(top, text="⟳  Refresh", command=self.refresh_devices).pack(side="right")

        self.device_combo = ttk.Combobox(f, state="readonly")
        self.device_combo.pack(fill="x", padx=16)
        self.device_combo.bind("<<ComboboxSelected>>", self._on_device_selected)

        # USB mode card
        card = tk.Frame(f, bg=CARD)
        card.pack(fill="x", padx=16, pady=14)
        tk.Label(card, text="USB connection mode", bg=CARD, fg=MUTED,
                 font=("Segoe UI", 9)).pack(anchor="w", padx=14, pady=(12, 2))
        self.mode_now = tk.Label(card, text="—", bg=CARD, fg=FG,
                                 font=("Segoe UI", 16, "bold"))
        self.mode_now.pack(anchor="w", padx=14)

        row = tk.Frame(card, bg=CARD)
        row.pack(fill="x", padx=14, pady=12)
        ttk.Button(row, text="🔄  Switch to File Transfer (MTP)",
                   style="Accent.TButton",
                   command=lambda: self.switch_mode("mtp")).pack(side="left")
        ttk.Button(row, text="🔌  Charging only",
                   command=lambda: self.switch_mode("charging")).pack(side="left", padx=8)

        # Other modes
        more = tk.Frame(card, bg=CARD)
        more.pack(fill="x", padx=14, pady=(0, 12))
        tk.Label(more, text="Other modes:", bg=CARD, fg=MUTED,
                 font=("Segoe UI", 9)).pack(side="left")
        for key in MODE_ORDER:
            if key in ("mtp", "charging"):
                continue
            ttk.Button(more, text=USB_MODES[key]["label"],
                       command=lambda k=key: self.switch_mode(k)).pack(side="left", padx=4)

        # Device info table
        ttk.Label(f, text="Device details", style="H1.TLabel").pack(
            anchor="w", padx=16, pady=(6, 4))
        self.info_tree = ttk.Treeview(f, columns=("v",), show="tree", height=8)
        self.info_tree.column("#0", width=200)
        self.info_tree.column("v", width=440)
        self.info_tree.pack(fill="both", expand=True, padx=16, pady=(0, 14))

    def refresh_devices(self):
        def work():
            self.client.start_server()
            devs = self.client.devices()
            for d in devs:
                self.client.describe(d)
            return devs

        def done(devs):
            self._devices = devs
            labels = [f"{d.label()}  [{d.state}]" for d in devs] or ["(no devices)"]
            self.device_combo["values"] = labels
            ready = [d for d in devs if d.is_ready]
            if ready:
                self.device = ready[0]
                idx = devs.index(ready[0])
                self.device_combo.current(idx)
                self._load_device_view()
            else:
                self.device = None
                self.device_combo.set(labels[0])
                self.mode_now.config(text="—")
                self._set_info([("Status", "No ready device. Enable USB debugging "
                                            "and accept the prompt on the phone.")])
            if not self.client.available:
                self.set_status("adb not found — install Android platform-tools.")

        self.run_async(work, done, busy="Scanning for devices...")

    def _on_device_selected(self, _evt=None):
        idx = self.device_combo.current()
        if 0 <= idx < len(getattr(self, "_devices", [])):
            d = self._devices[idx]
            self.device = d if d.is_ready else None
            self._load_device_view()

    def _load_device_view(self):
        if not self.device:
            return
        self.refresh_mode()

        def work():
            return collect(self.client, self.device)

        def done(info):
            self._set_info(info.as_rows())

        self.run_async(work, done, busy="Reading device info...")

    def _set_info(self, rows):
        self.info_tree.delete(*self.info_tree.get_children())
        for k, v in rows:
            self.info_tree.insert("", "end", text=k, values=(v,))

    def refresh_mode(self):
        if not self.current_serial():
            return
        sw = UsbSwitcher(self.client, self.current_serial())
        self.run_async(lambda: sw.current().friendly,
                       lambda friendly: self.mode_now.config(text=friendly),
                       busy="Reading USB mode...")

    def switch_mode(self, mode: str):
        if not self.require_device():
            return
        sw = UsbSwitcher(self.client, self.current_serial())

        def work():
            msg = sw.set_mode(mode)
            return msg

        def done(_msg):
            self.refresh_mode()
            messagebox.showinfo("Wouapit-Androman",
                                f"USB mode set to {USB_MODES[mode]['label']}.")

        self.run_async(work, done, busy=f"Switching to {USB_MODES[mode]['label']}...")

    # ============================================================= TAB: Files
    def _tab_files(self):
        f = ttk.Frame(self.nb)
        self.nb.add(f, text="  Files  ")
        ttk.Label(f, text="File transfer", style="H1.TLabel").pack(
            anchor="w", padx=16, pady=(16, 8))

        r1 = ttk.Frame(f); r1.pack(fill="x", padx=16, pady=6)
        ttk.Button(r1, text="📷  Export all photos (DCIM)", style="Accent.TButton",
                   command=self.do_export_photos).pack(side="left")
        ttk.Button(r1, text="⬇  Pull a folder/file from phone",
                   command=self.do_pull).pack(side="left", padx=8)
        ttk.Button(r1, text="⬆  Push files to phone",
                   command=self.do_push).pack(side="left")

        ttk.Label(f, text="Browse /sdcard", style="Muted.TLabel").pack(
            anchor="w", padx=16, pady=(14, 2))
        self.path_var = tk.StringVar(value="/sdcard/")
        pr = ttk.Frame(f); pr.pack(fill="x", padx=16)
        ttk.Entry(pr, textvariable=self.path_var).pack(side="left", fill="x", expand=True)
        ttk.Button(pr, text="List", command=self.do_list).pack(side="left", padx=6)

        self.files_list = tk.Listbox(f, bg=CARD, fg=FG, borderwidth=0,
                                     highlightthickness=0, font=("Consolas", 10))
        self.files_list.pack(fill="both", expand=True, padx=16, pady=12)
        self.files_list.bind("<Double-Button-1>", self._files_descend)

    def do_export_photos(self):
        if not self.require_device():
            return
        self.run_async(self.toolkit().export_photos,
                       lambda p: messagebox.showinfo("Done", f"Photos saved to:\n{p}"),
                       busy="Exporting photos (this can take a while)...")

    def do_pull(self):
        if not self.require_device():
            return
        remote = self.path_var.get().strip() or "/sdcard/"
        dest = filedialog.askdirectory(title="Save to which folder?")
        if not dest:
            return
        self.run_async(lambda: self.toolkit().pull_path(remote, dest),
                       lambda p: messagebox.showinfo("Done", f"Pulled to:\n{p}"),
                       busy=f"Pulling {remote}...")

    def do_push(self):
        if not self.require_device():
            return
        files = filedialog.askopenfilenames(title="Select files to push")
        if not files:
            return
        remote = self.path_var.get().strip() or "/sdcard/Download/"

        def work():
            out = []
            for fpath in files:
                out.append(self.toolkit().push_path(fpath, remote))
            return f"Pushed {len(files)} item(s) to {remote}"

        self.run_async(work, lambda m: messagebox.showinfo("Done", m),
                       busy="Pushing files...")

    def do_list(self):
        if not self.require_device():
            return
        remote = self.path_var.get().strip() or "/sdcard/"
        self.run_async(lambda: self.toolkit().list_dir(remote), self._fill_files,
                       busy=f"Listing {remote}...")

    def _fill_files(self, entries):
        self.files_list.delete(0, "end")
        for e in entries:
            self.files_list.insert("end", e)

    def _files_descend(self, _evt):
        sel = self.files_list.curselection()
        if not sel:
            return
        name = self.files_list.get(sel[0]).strip()
        base = self.path_var.get().rstrip("/")
        self.path_var.set(f"{base}/{name}")
        self.do_list()

    # ============================================================= TAB: Apps
    def _tab_apps(self):
        f = ttk.Frame(self.nb)
        self.nb.add(f, text="  Apps  ")
        top = ttk.Frame(f); top.pack(fill="x", padx=16, pady=(16, 6))
        ttk.Label(top, text="App manager", style="H1.TLabel").pack(side="left")
        self.show_system = tk.BooleanVar(value=False)
        ttk.Checkbutton(top, text="Include system apps", variable=self.show_system,
                        command=self.do_list_apps).pack(side="right")
        ttk.Button(top, text="⟳ Refresh", command=self.do_list_apps).pack(side="right", padx=6)

        self.apps_list = tk.Listbox(f, bg=CARD, fg=FG, borderwidth=0,
                                    highlightthickness=0, font=("Consolas", 10),
                                    selectmode="browse")
        self.apps_list.pack(fill="both", expand=True, padx=16, pady=8)

        row = ttk.Frame(f); row.pack(fill="x", padx=16, pady=(0, 14))
        ttk.Button(row, text="📥  Install APK…", style="Accent.TButton",
                   command=self.do_install).pack(side="left")
        ttk.Button(row, text="💾  Back up selected APK",
                   command=self.do_backup_apk).pack(side="left", padx=8)
        ttk.Button(row, text="🗑  Uninstall selected",
                   command=self.do_uninstall).pack(side="left")

    def do_list_apps(self):
        if not self.require_device():
            return
        self.run_async(lambda: self.toolkit().list_apps(self.show_system.get()),
                       self._fill_apps, busy="Listing apps...")

    def _fill_apps(self, apps):
        self.apps_list.delete(0, "end")
        for a in apps:
            self.apps_list.insert("end", a.package)
        self.set_status(f"{len(apps)} package(s).")

    def _selected_app(self) -> Optional[str]:
        sel = self.apps_list.curselection()
        return self.apps_list.get(sel[0]) if sel else None

    def do_install(self):
        if not self.require_device():
            return
        apk = filedialog.askopenfilename(title="Select an APK",
                                         filetypes=[("Android package", "*.apk"), ("All", "*.*")])
        if not apk:
            return
        self.run_async(lambda: self.toolkit().install_apk(apk),
                       lambda m: messagebox.showinfo("Install", m or "Installed."),
                       busy="Installing APK...")

    def do_backup_apk(self):
        pkg = self._selected_app()
        if not pkg or not self.require_device():
            return
        self.run_async(lambda: self.toolkit().backup_apk(pkg),
                       lambda p: messagebox.showinfo("Done", f"APK saved to:\n{p}"),
                       busy=f"Backing up {pkg}...")

    def do_uninstall(self):
        pkg = self._selected_app()
        if not pkg or not self.require_device():
            return
        if not messagebox.askyesno("Uninstall", f"Uninstall {pkg}?"):
            return
        self.run_async(lambda: self.toolkit().uninstall_app(pkg),
                       lambda m: (self.do_list_apps(),
                                  messagebox.showinfo("Uninstall", m or "Done.")),
                       busy=f"Uninstalling {pkg}...")

    # ============================================================= TAB: Backup
    def _tab_backup(self):
        f = ttk.Frame(self.nb)
        self.nb.add(f, text="  Backup  ")
        ttk.Label(f, text="Backup & restore", style="H1.TLabel").pack(
            anchor="w", padx=16, pady=(16, 8))
        ttk.Label(f, text="Full-device backup uses Android's built-in adb backup. "
                          "You confirm on the phone; apps, app data and shared "
                          "storage are written to a single .ab archive.",
                  style="Muted.TLabel", wraplength=760, justify="left").pack(
            anchor="w", padx=16)

        row = ttk.Frame(f); row.pack(fill="x", padx=16, pady=16)
        ttk.Button(row, text="🗄  Create full backup…", style="Accent.TButton",
                   command=self.do_backup).pack(side="left")
        ttk.Button(row, text="♻  Restore from .ab…",
                   command=self.do_restore).pack(side="left", padx=8)

    def do_backup(self):
        if not self.require_device():
            return
        dest = filedialog.asksaveasfilename(title="Save backup as",
                                            defaultextension=".ab",
                                            filetypes=[("ADB backup", "*.ab")])
        if not dest:
            return
        messagebox.showinfo("Confirm on phone",
                            "Tap 'Back up my data' on the phone when prompted.")
        self.run_async(lambda: self.toolkit().full_backup(dest),
                       lambda p: messagebox.showinfo("Done", f"Backup saved to:\n{p}"),
                       busy="Backing up (confirm on the phone)...")

    def do_restore(self):
        if not self.require_device():
            return
        src = filedialog.askopenfilename(title="Select .ab backup",
                                         filetypes=[("ADB backup", "*.ab")])
        if not src:
            return
        self.run_async(lambda: self.toolkit().restore_backup(src),
                       lambda m: messagebox.showinfo("Restore", m),
                       busy="Restoring (confirm on the phone)...")

    # ============================================================= TAB: Screen
    def _tab_screen(self):
        f = ttk.Frame(self.nb)
        self.nb.add(f, text="  Screen  ")
        ttk.Label(f, text="Screen capture & mirror", style="H1.TLabel").pack(
            anchor="w", padx=16, pady=(16, 8))

        row = ttk.Frame(f); row.pack(fill="x", padx=16, pady=8)
        ttk.Button(row, text="📸  Screenshot", style="Accent.TButton",
                   command=self.do_screenshot).pack(side="left")
        ttk.Button(row, text="🎥  Record", command=self.do_record).pack(side="left", padx=8)
        ttk.Label(row, text="seconds:").pack(side="left")
        self.rec_secs = tk.IntVar(value=10)
        ttk.Spinbox(row, from_=1, to=180, textvariable=self.rec_secs,
                    width=5).pack(side="left", padx=4)
        ttk.Button(row, text="🖥  Mirror screen (scrcpy)",
                   command=self.do_mirror).pack(side="left", padx=8)

        self.shot_label = tk.Label(f, bg=CARD, fg=MUTED,
                                   text="Screenshots preview here.")
        self.shot_label.pack(fill="both", expand=True, padx=16, pady=12)

    def do_screenshot(self):
        if not self.require_device():
            return
        def done(path):
            self._preview(path)
            self.set_status(f"Saved {path}")
        self.run_async(self.toolkit().screenshot, done, busy="Capturing screenshot...")

    def _preview(self, path):
        try:
            img = tk.PhotoImage(file=path)
            # Downscale big PNGs so they fit.
            factor = max(1, img.width() // 380)
            if factor > 1:
                img = img.subsample(factor, factor)
            self.shot_label.config(image=img, text="")
            self.shot_label.image = img  # keep a reference
        except Exception:
            self.shot_label.config(text=f"Saved to {path}", image="")

    def do_record(self):
        if not self.require_device():
            return
        secs = self.rec_secs.get()
        self.run_async(lambda: self.toolkit().screen_record(secs),
                       lambda p: messagebox.showinfo("Done", f"Recording saved to:\n{p}"),
                       busy=f"Recording {secs}s...")

    def do_mirror(self):
        if not self.require_device():
            return
        self.run_async(self.toolkit().mirror_screen,
                       lambda m: self.set_status(m), busy="Launching scrcpy...")

    # ============================================================= TAB: Tools
    def _tab_tools(self):
        f = ttk.Frame(self.nb)
        self.nb.add(f, text="  Tools  ")
        ttk.Label(f, text="System tools", style="H1.TLabel").pack(
            anchor="w", padx=16, pady=(16, 6))

        rb = ttk.Frame(f); rb.pack(fill="x", padx=16, pady=4)
        ttk.Label(rb, text="Reboot:").pack(side="left")
        for mode, txt in [("", "System"), ("recovery", "Recovery"),
                          ("bootloader", "Bootloader"), ("fastboot", "Fastboot")]:
            ttk.Button(rb, text=txt,
                       command=lambda m=mode: self.do_reboot(m)).pack(side="left", padx=4)

        exp = ttk.Frame(f); exp.pack(fill="x", padx=16, pady=8)
        ttk.Button(exp, text="👤 Export contacts", command=self.do_contacts).pack(side="left")
        ttk.Button(exp, text="💬 Export SMS", command=self.do_sms).pack(side="left", padx=6)
        ttk.Button(exp, text="📝 Save logcat", command=self.do_logcat).pack(side="left")

        ttk.Label(f, text="Shell console (adb shell)", style="Muted.TLabel").pack(
            anchor="w", padx=16, pady=(12, 2))
        cr = ttk.Frame(f); cr.pack(fill="x", padx=16)
        self.cmd_var = tk.StringVar(value="getprop ro.product.model")
        ent = ttk.Entry(cr, textvariable=self.cmd_var)
        ent.pack(side="left", fill="x", expand=True)
        ent.bind("<Return>", lambda e: self.do_shell())
        ttk.Button(cr, text="Run", command=self.do_shell).pack(side="left", padx=6)

        self.console = tk.Text(f, bg="#0b0f14", fg="#9fe8cf", borderwidth=0,
                               height=10, font=("Consolas", 10))
        self.console.pack(fill="both", expand=True, padx=16, pady=12)

    def do_reboot(self, mode):
        if not self.require_device():
            return
        label = mode or "system"
        if not messagebox.askyesno("Reboot", f"Reboot the device to {label}?"):
            return
        self.run_async(lambda: self.toolkit().reboot(mode),
                       lambda m: self.set_status(m), busy=f"Rebooting to {label}...")

    def do_contacts(self):
        if not self.require_device():
            return
        self.run_async(self.toolkit().export_contacts_vcf,
                       lambda p: messagebox.showinfo("Contacts", f"Saved to:\n{p}"),
                       busy="Exporting contacts...")

    def do_sms(self):
        if not self.require_device():
            return
        self.run_async(self.toolkit().export_sms,
                       lambda p: messagebox.showinfo("SMS", f"Saved to:\n{p}"),
                       busy="Exporting SMS...")

    def do_logcat(self):
        if not self.require_device():
            return
        self.run_async(lambda: self.toolkit().logcat_snapshot(1000),
                       lambda p: messagebox.showinfo("Logcat", f"Saved to:\n{p}"),
                       busy="Capturing logcat...")

    def do_shell(self):
        if not self.require_device():
            return
        cmd = self.cmd_var.get().strip()
        if not cmd:
            return
        def done(output):
            self.console.insert("end", f"$ {cmd}\n{output}\n")
            self.console.see("end")
        self.run_async(lambda: self.toolkit().run_shell(cmd), done, busy="Running...")


def launch() -> int:
    if tk is None:
        print("Tkinter is not available in this Python. "
              f"({_IMPORT_ERROR})\nUse the command line instead, e.g. "
              "'wouapit-androman transfer'.")
        return 1
    root = tk.Tk()
    App(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(launch())
