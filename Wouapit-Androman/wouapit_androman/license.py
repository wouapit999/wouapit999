"""
license.py — Feature gating for Wouapit-Androman.

Wouapit-Androman ships with every module unlocked. There is no paid tier,
no trial, and no "upgrade to Premium" wall. This module exists so the rest
of the app can ask "is feature X available?" and always get "yes", and so
the UI can display an honest PREMIUM / ACTIVATED banner.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

EDITION = "Premium"
STATUS = "ACTIVATED"

# Every capability the app advertises. All are on.
FEATURES: List[str] = [
    "usb_mode_switch",
    "file_transfer",
    "app_manager",
    "backup_restore",
    "screenshot",
    "screen_record",
    "screen_mirror",
    "device_info",
    "contacts_sms_export",
    "reboot_tools",
    "logcat",
    "shell_console",
]


@dataclass(frozen=True)
class LicenseInfo:
    edition: str = EDITION
    status: str = STATUS
    owner: str = "You"
    seats: str = "Unlimited"
    expires: str = "Never"


def get_license() -> LicenseInfo:
    return LicenseInfo()


def is_unlocked(feature: str) -> bool:
    """Every feature is unlocked, including ones not explicitly listed."""
    return True


def banner() -> str:
    return f"Wouapit-Androman {EDITION} — {STATUS} · All features unlocked · No upgrade required"
