"""
features.py — The Dr.Fone-style toolkit, all unlocked.

Each feature is a small, dependency-free method built on the AdbClient. The
GUI and CLI both call into this one class so behaviour is identical between
them. Anything that produces files writes into a per-run output folder.
"""

from __future__ import annotations

import datetime as _dt
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from typing import List, Optional

from .adb import AdbClient, AdbError


@dataclass
class App:
    package: str
    path: str = ""
    system: bool = False


def _timestamp() -> str:
    return _dt.datetime.now().strftime("%Y%m%d-%H%M%S")


class Toolkit:
    """All device-management features for a single serial."""

    def __init__(self, client: AdbClient, serial: Optional[str] = None,
                 workdir: Optional[str] = None):
        self.client = client
        self.serial = serial
        self.workdir = workdir or os.path.join(os.path.expanduser("~"),
                                               "Wouapit-Androman")
        os.makedirs(self.workdir, exist_ok=True)

    # ------------------------------------------------------------- utilities
    def out_path(self, *parts: str) -> str:
        p = os.path.join(self.workdir, *parts)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        return p

    # =================================================== Phone Manager: files
    def list_dir(self, remote: str = "/sdcard/") -> List[str]:
        """List a directory on the phone (one entry per line)."""
        out = self.client.shell(["ls", "-1", "-a", remote], serial=self.serial)
        return [l for l in out.splitlines() if l.strip() not in (".", "..", "")]

    def pull_path(self, remote: str, local_dir: Optional[str] = None) -> str:
        """Copy a file or folder from the phone to the computer."""
        local_dir = local_dir or self.out_path("transfers", _timestamp())
        os.makedirs(local_dir, exist_ok=True)
        self.client.pull(remote, local_dir, serial=self.serial)
        return local_dir

    def push_path(self, local: str, remote: str = "/sdcard/Download/") -> str:
        """Copy a file or folder from the computer to the phone."""
        return self.client.push(local, remote, serial=self.serial)

    def export_photos(self, local_dir: Optional[str] = None) -> str:
        """Pull the DCIM camera folder — the most common transfer task."""
        local_dir = local_dir or self.out_path("photos", _timestamp())
        os.makedirs(local_dir, exist_ok=True)
        self.client.pull("/sdcard/DCIM", local_dir, serial=self.serial)
        return local_dir

    # ==================================================== App (APK) Manager
    def list_apps(self, include_system: bool = False) -> List[App]:
        args = ["pm", "list", "packages", "-f"]
        if not include_system:
            args.append("-3")  # third-party only
        out = self.client.shell(args, serial=self.serial)
        apps: List[App] = []
        for line in out.splitlines():
            line = line.strip()
            if not line.startswith("package:"):
                continue
            body = line[len("package:"):]
            # format: /path/to/base.apk=com.package.name
            if "=" in body:
                path, pkg = body.rsplit("=", 1)
            else:
                path, pkg = "", body
            apps.append(App(package=pkg.strip(), path=path.strip()))
        apps.sort(key=lambda a: a.package)
        return apps

    def install_apk(self, apk_path: str) -> str:
        return self.client.install(apk_path, serial=self.serial)

    def uninstall_app(self, package: str, keep_data: bool = False) -> str:
        return self.client.uninstall(package, serial=self.serial, keep_data=keep_data)

    def backup_apk(self, package: str, local_dir: Optional[str] = None) -> str:
        """Extract a single installed app's APK to the computer."""
        out = self.client.shell(["pm", "path", package], serial=self.serial)
        paths = [l.split("package:", 1)[1].strip()
                 for l in out.splitlines() if "package:" in l]
        if not paths:
            raise AdbError(f"Package not found: {package}")
        local_dir = local_dir or self.out_path("apks", _timestamp())
        os.makedirs(local_dir, exist_ok=True)
        for i, remote in enumerate(paths):
            name = f"{package}.apk" if len(paths) == 1 else f"{package}.{i}.apk"
            self.client.pull(remote, os.path.join(local_dir, name), serial=self.serial)
        return local_dir

    # ==================================================== Backup & Restore
    def full_backup(self, local_file: Optional[str] = None,
                    include_apks: bool = True, shared: bool = True) -> str:
        """Create an adb backup archive (.ab). The phone shows a confirm dialog."""
        local_file = local_file or self.out_path("backups", f"backup-{_timestamp()}.ab")
        os.makedirs(os.path.dirname(local_file), exist_ok=True)
        args = ["backup", "-all"]
        args.append("-apk" if include_apks else "-noapk")
        args.append("-shared" if shared else "-noshared")
        args += ["-f", local_file]
        # This blocks until the user taps "Back up my data" on the phone.
        self.client.raw(args, serial=self.serial, timeout=3600)
        return local_file

    def restore_backup(self, local_file: str) -> str:
        if not os.path.isfile(local_file):
            raise AdbError(f"Backup file not found: {local_file}")
        self.client.raw(["restore", local_file], serial=self.serial, timeout=3600)
        return "Restore started — confirm on the phone."

    # ==================================================== Screen: capture
    def screenshot(self, local_file: Optional[str] = None) -> str:
        local_file = local_file or self.out_path("screenshots", f"shot-{_timestamp()}.png")
        os.makedirs(os.path.dirname(local_file), exist_ok=True)
        remote = f"/sdcard/_wa_shot_{_timestamp()}.png"
        self.client.shell(["screencap", "-p", remote], serial=self.serial)
        self.client.pull(remote, local_file, serial=self.serial)
        self.client.shell(["rm", "-f", remote], serial=self.serial, check=False)
        return local_file

    def screen_record(self, seconds: int = 10, local_file: Optional[str] = None) -> str:
        """Record the screen for `seconds` then pull the mp4."""
        local_file = local_file or self.out_path("recordings", f"rec-{_timestamp()}.mp4")
        os.makedirs(os.path.dirname(local_file), exist_ok=True)
        remote = f"/sdcard/_wa_rec_{_timestamp()}.mp4"
        # screenrecord has a hard limit of 180s per invocation.
        seconds = max(1, min(int(seconds), 180))
        self.client.shell(["screenrecord", "--time-limit", str(seconds), remote],
                          serial=self.serial, timeout=seconds + 30)
        self.client.pull(remote, local_file, serial=self.serial)
        self.client.shell(["rm", "-f", remote], serial=self.serial, check=False)
        return local_file

    def mirror_screen(self) -> str:
        """Launch scrcpy for live screen mirroring/control, if installed."""
        scrcpy = shutil.which("scrcpy")
        if not scrcpy:
            raise AdbError(
                "Screen mirroring uses 'scrcpy', which is not installed. "
                "Install it from https://github.com/Genymobile/scrcpy "
                "(e.g. 'sudo apt install scrcpy' or 'brew install scrcpy')."
            )
        cmd = [scrcpy]
        if self.serial:
            cmd += ["-s", self.serial]
        # Fire and forget; scrcpy opens its own window.
        subprocess.Popen(cmd)
        return "Screen mirror launched in a new window."

    # ==================================================== Contacts / SMS
    def export_contacts_vcf(self, local_file: Optional[str] = None) -> str:
        """Best-effort contacts export via the contacts content provider."""
        local_file = local_file or self.out_path("contacts", f"contacts-{_timestamp()}.txt")
        os.makedirs(os.path.dirname(local_file), exist_ok=True)
        out = self.client.shell(
            ["content", "query", "--uri", "content://contacts/phones",
             "--projection", "display_name:number"],
            serial=self.serial, check=False,
        )
        with open(local_file, "w", encoding="utf-8") as fh:
            fh.write(out)
        return local_file

    def export_sms(self, local_file: Optional[str] = None) -> str:
        """Best-effort SMS export (requires a permissive ROM/provider)."""
        local_file = local_file or self.out_path("sms", f"sms-{_timestamp()}.txt")
        os.makedirs(os.path.dirname(local_file), exist_ok=True)
        out = self.client.shell(
            ["content", "query", "--uri", "content://sms",
             "--projection", "address:date:body"],
            serial=self.serial, check=False,
        )
        with open(local_file, "w", encoding="utf-8") as fh:
            fh.write(out)
        return local_file

    # ==================================================== System / reboot
    def reboot(self, mode: str = "") -> str:
        self.client.reboot(mode, serial=self.serial)
        target = mode or "system"
        return f"Reboot to {target} requested."

    def logcat_snapshot(self, lines: int = 500, local_file: Optional[str] = None) -> str:
        local_file = local_file or self.out_path("logs", f"logcat-{_timestamp()}.txt")
        os.makedirs(os.path.dirname(local_file), exist_ok=True)
        out = self.client.shell(["logcat", "-d", "-t", str(int(lines))],
                                serial=self.serial, timeout=60)
        with open(local_file, "w", encoding="utf-8") as fh:
            fh.write(out)
        return local_file

    def run_shell(self, command: str) -> str:
        """Run an arbitrary shell command on the device (power-user console)."""
        return self.client.shell(command, serial=self.serial, check=False)
