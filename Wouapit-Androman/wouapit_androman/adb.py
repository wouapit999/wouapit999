"""
adb.py — Thin, robust wrapper around the Android Debug Bridge (ADB).

Everything Wouapit-Androman does on a device goes through this module.
It locates an `adb` binary, runs commands with timeouts, and parses the
output of the handful of commands the rest of the app relies on.

No third-party dependencies: only the Python standard library is used.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import List, Optional, Sequence, Tuple


class AdbError(RuntimeError):
    """Raised when an adb invocation fails or adb cannot be found."""


@dataclass
class Device:
    """A single device/emulator reported by `adb devices`."""

    serial: str
    state: str  # "device", "unauthorized", "offline", "recovery", ...
    props: dict = field(default_factory=dict)

    # --- convenience accessors, filled in by AdbClient.describe() -----------
    @property
    def model(self) -> str:
        return self.props.get("ro.product.model", "Unknown")

    @property
    def brand(self) -> str:
        return self.props.get("ro.product.brand", "Unknown")

    @property
    def manufacturer(self) -> str:
        return self.props.get("ro.product.manufacturer", "Unknown")

    @property
    def android_version(self) -> str:
        return self.props.get("ro.build.version.release", "?")

    @property
    def sdk(self) -> str:
        return self.props.get("ro.build.version.sdk", "?")

    @property
    def is_xiaomi(self) -> bool:
        text = " ".join(
            [self.brand, self.manufacturer, self.props.get("ro.product.name", "")]
        ).lower()
        return any(k in text for k in ("xiaomi", "redmi", "poco", "mi ", "miui"))

    @property
    def is_ready(self) -> bool:
        return self.state == "device"

    def label(self) -> str:
        name = self.model if self.model != "Unknown" else self.serial
        return f"{self.brand} {name} ({self.serial})".strip()


# Properties fetched to describe a device on the dashboard.
_PROP_KEYS = [
    "ro.product.brand",
    "ro.product.manufacturer",
    "ro.product.model",
    "ro.product.name",
    "ro.build.version.release",
    "ro.build.version.sdk",
    "ro.build.version.security_patch",
    "ro.serialno",
    "ro.miui.ui.version.name",
]


class AdbClient:
    """Locates and drives an adb binary."""

    def __init__(self, adb_path: Optional[str] = None, default_timeout: int = 30):
        self.adb_path = adb_path or self._find_adb()
        self.default_timeout = default_timeout

    # ------------------------------------------------------------------ setup
    @staticmethod
    def _find_adb() -> Optional[str]:
        """Look for adb on PATH, then in a few common install locations."""
        found = shutil.which("adb")
        if found:
            return found
        candidates = [
            os.path.expanduser("~/Android/Sdk/platform-tools/adb"),
            os.path.expanduser("~/Library/Android/sdk/platform-tools/adb"),
            "/usr/local/bin/adb",
            "/opt/platform-tools/adb",
            os.path.expandvars(r"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"),
            r"C:\platform-tools\adb.exe",
        ]
        for c in candidates:
            if c and os.path.isfile(c):
                return c
        return None

    @property
    def available(self) -> bool:
        return bool(self.adb_path)

    def require(self) -> None:
        if not self.available:
            raise AdbError(
                "The 'adb' command was not found. Install Android platform-tools "
                "and make sure 'adb' is on your PATH, or set the ADB path in Settings."
            )

    def version(self) -> str:
        self.require()
        return self._run([self.adb_path, "version"]).strip()

    # --------------------------------------------------------------- core run
    def _run(
        self,
        cmd: Sequence[str],
        timeout: Optional[int] = None,
        check: bool = True,
        input_text: Optional[str] = None,
    ) -> str:
        """Run a command, returning stdout. Raises AdbError on failure."""
        try:
            proc = subprocess.run(
                list(cmd),
                capture_output=True,
                text=True,
                timeout=timeout or self.default_timeout,
                input=input_text,
            )
        except FileNotFoundError as exc:
            raise AdbError(f"Could not execute {cmd[0]!r}: {exc}") from exc
        except subprocess.TimeoutExpired as exc:
            raise AdbError(f"Command timed out after {exc.timeout}s: {' '.join(cmd)}") from exc

        if check and proc.returncode != 0:
            msg = (proc.stderr or proc.stdout or "").strip()
            raise AdbError(msg or f"adb exited with code {proc.returncode}")
        return proc.stdout

    def _base(self, serial: Optional[str]) -> List[str]:
        self.require()
        base = [self.adb_path]
        if serial:
            base += ["-s", serial]
        return base

    # ----------------------------------------------------------- device level
    def start_server(self) -> None:
        self._run([self.adb_path, "start-server"])

    def kill_server(self) -> None:
        self._run([self.adb_path, "kill-server"])

    def devices(self) -> List[Device]:
        """Return the raw device list (without properties)."""
        self.require()
        out = self._run([self.adb_path, "devices", "-l"])
        result: List[Device] = []
        for line in out.splitlines()[1:]:  # skip "List of devices attached"
            line = line.strip()
            if not line or line.startswith("*"):
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            serial, state = parts[0], parts[1]
            result.append(Device(serial=serial, state=state))
        return result

    def describe(self, device: Device) -> Device:
        """Populate props for a ready device. Best-effort; ignores failures."""
        if not device.is_ready:
            return device
        for key in _PROP_KEYS:
            try:
                val = self.getprop(key, device.serial)
            except AdbError:
                val = ""
            if val:
                device.props[key] = val
        return device

    def first_ready_device(self) -> Optional[Device]:
        for d in self.devices():
            if d.is_ready:
                return self.describe(d)
        return None

    # --------------------------------------------------------------- commands
    def shell(
        self,
        args: Sequence[str] | str,
        serial: Optional[str] = None,
        timeout: Optional[int] = None,
        check: bool = True,
    ) -> str:
        """Run `adb shell ...`. `args` may be a string or a list."""
        cmd = self._base(serial) + ["shell"]
        if isinstance(args, str):
            cmd.append(args)
        else:
            cmd += list(args)
        return self._run(cmd, timeout=timeout, check=check)

    def getprop(self, name: str, serial: Optional[str] = None) -> str:
        return self.shell(["getprop", name], serial=serial).strip()

    def raw(self, args: Sequence[str], serial: Optional[str] = None,
            timeout: Optional[int] = None, check: bool = True) -> str:
        """Run an arbitrary `adb <args>` command for the given serial."""
        return self._run(self._base(serial) + list(args), timeout=timeout, check=check)

    # File transfer -----------------------------------------------------------
    def push(self, local: str, remote: str, serial: Optional[str] = None) -> str:
        return self._run(self._base(serial) + ["push", local, remote], timeout=None)

    def pull(self, remote: str, local: str, serial: Optional[str] = None) -> str:
        return self._run(self._base(serial) + ["pull", remote, local], timeout=None)

    def install(self, apk: str, serial: Optional[str] = None,
                replace: bool = True) -> str:
        args = ["install"]
        if replace:
            args.append("-r")
        args.append(apk)
        return self._run(self._base(serial) + args, timeout=300)

    def uninstall(self, package: str, serial: Optional[str] = None,
                  keep_data: bool = False) -> str:
        args = ["uninstall"]
        if keep_data:
            args.append("-k")
        args.append(package)
        return self._run(self._base(serial) + args, timeout=120)

    def reboot(self, mode: str = "", serial: Optional[str] = None) -> str:
        args = ["reboot"]
        if mode:
            args.append(mode)
        return self._run(self._base(serial) + args, timeout=30, check=False)


def parse_devices(output: str) -> List[Tuple[str, str]]:
    """Standalone parser for `adb devices` output. Useful for tests."""
    pairs: List[Tuple[str, str]] = []
    for line in output.splitlines():
        line = line.strip()
        if not line or line.startswith("List of devices") or line.startswith("*"):
            continue
        parts = line.split()
        if len(parts) >= 2:
            pairs.append((parts[0], parts[1]))
    return pairs
