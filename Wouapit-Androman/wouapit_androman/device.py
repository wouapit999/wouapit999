"""
device.py — Read-only device information gathering.

Builds the dashboard the GUI/CLI shows once a phone is connected: model,
Android version, battery, storage and MIUI version. Everything here is
best-effort — a missing value never raises, it just shows as "unknown".
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, Optional

from .adb import AdbClient, AdbError, Device


@dataclass
class DeviceInfo:
    serial: str
    brand: str = "Unknown"
    model: str = "Unknown"
    android: str = "?"
    sdk: str = "?"
    miui: str = ""
    security_patch: str = ""
    battery_level: Optional[int] = None
    battery_status: str = ""
    storage_total: str = ""
    storage_used: str = ""
    storage_free: str = ""
    is_xiaomi: bool = False
    extra: Dict[str, str] = field(default_factory=dict)

    def as_rows(self):
        rows = [
            ("Serial", self.serial),
            ("Brand", self.brand),
            ("Model", self.model),
            ("Android version", self.android),
            ("API level (SDK)", self.sdk),
        ]
        if self.miui:
            rows.append(("MIUI version", self.miui))
        if self.security_patch:
            rows.append(("Security patch", self.security_patch))
        if self.battery_level is not None:
            rows.append(("Battery", f"{self.battery_level}%  {self.battery_status}".strip()))
        if self.storage_total:
            rows.append(("Storage", f"{self.storage_used} used / {self.storage_total} total "
                                     f"({self.storage_free} free)"))
        return rows


_BATTERY_LEVEL = re.compile(r"level:\s*(\d+)")
_BATTERY_STATUS = re.compile(r"status:\s*(\d+)")
_BATTERY_STATUS_MAP = {
    "1": "Unknown", "2": "Charging", "3": "Discharging",
    "4": "Not charging", "5": "Full",
}


def collect(client: AdbClient, device: Device) -> DeviceInfo:
    """Gather a DeviceInfo for a connected, ready device."""
    client.describe(device)
    info = DeviceInfo(
        serial=device.serial,
        brand=device.brand,
        model=device.model,
        android=device.android_version,
        sdk=device.sdk,
        miui=device.props.get("ro.miui.ui.version.name", ""),
        security_patch=device.props.get("ro.build.version.security_patch", ""),
        is_xiaomi=device.is_xiaomi,
    )

    # Battery ---------------------------------------------------------------
    try:
        dump = client.shell(["dumpsys", "battery"], serial=device.serial)
        m = _BATTERY_LEVEL.search(dump)
        if m:
            info.battery_level = int(m.group(1))
        m = _BATTERY_STATUS.search(dump)
        if m:
            info.battery_status = _BATTERY_STATUS_MAP.get(m.group(1), "")
    except (AdbError, ValueError):
        pass

    # Storage (of the userdata/sdcard partition) ----------------------------
    try:
        out = client.shell(["df", "-h", "/storage/emulated/0"], serial=device.serial)
        lines = [l for l in out.splitlines() if l.strip()]
        if len(lines) >= 2:
            cols = lines[-1].split()
            # Filesystem Size Used Avail Use% Mounted
            if len(cols) >= 4:
                info.storage_total = cols[1]
                info.storage_used = cols[2]
                info.storage_free = cols[3]
    except AdbError:
        pass

    return info
