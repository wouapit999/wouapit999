"""
usb.py — Switch a phone's USB connection mode from the computer.

This is the headline feature of Wouapit-Androman. When you plug a Redmi /
Xiaomi (or any Android) phone into a PC it usually comes up in
"Charging only / No data transfer" mode. Android exposes the active USB
gadget configuration through the `svc usb` shell service, so with USB
debugging enabled we can flip it to MTP (File Transfer) — or any other
supported function — without touching the phone.

Under the hood:
    adb shell svc usb setFunctions mtp     # Android 8+ (API 26+)
    adb shell svc usb setFunction  mtp     # older Android (single "Function")
    adb shell svc usb getFunctions         # read the current mode

MTP  = Media/File Transfer   (what "switch to transfer" means)
PTP  = Picture Transfer / Camera
RNDIS= USB tethering (share the phone's network)
MIDI = MIDI instrument mode
none/charging = charging only, no data

Requirements on the phone:
  * Developer options -> USB debugging = ON
  * Authorize the computer (the RSA prompt) once.
On MIUI you additionally need Developer options -> "USB debugging (Security
settings)" enabled to allow changing settings over USB; see the README.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

from .adb import AdbClient, AdbError


# The USB functions we let the user choose from, in menu order.
# key -> (svc token, human label, description)
USB_MODES: Dict[str, Dict[str, str]] = {
    "mtp": {
        "svc": "mtp",
        "label": "File Transfer (MTP)",
        "desc": "Transfer photos, videos and any files. This is what most "
                "people mean by 'switch from charging to transfer'.",
    },
    "ptp": {
        "svc": "ptp",
        "label": "Photo Transfer (PTP)",
        "desc": "Exposes the phone as a camera. Useful for photo import tools.",
    },
    "rndis": {
        "svc": "rndis",
        "label": "USB Tethering (RNDIS)",
        "desc": "Share the phone's mobile/Wi-Fi connection with the computer.",
    },
    "midi": {
        "svc": "midi",
        "label": "MIDI",
        "desc": "Use the phone as a MIDI input/output device.",
    },
    "charging": {
        "svc": "none",
        "label": "Charging only (no data)",
        "desc": "Cut the data connection and only charge the phone.",
    },
}

# Order used to build menus / choice lists.
MODE_ORDER: List[str] = ["mtp", "ptp", "rndis", "midi", "charging"]


@dataclass
class UsbState:
    raw: str                    # exact string returned by `svc usb getFunctions`
    functions: List[str]        # parsed list, e.g. ["mtp"]
    friendly: str               # human label, e.g. "File Transfer (MTP)"


def _friendly_for(functions: List[str]) -> str:
    if not functions:
        return USB_MODES["charging"]["label"]
    joined = ",".join(functions)
    for key, meta in USB_MODES.items():
        if meta["svc"] == joined or meta["svc"] in functions:
            return meta["label"]
    return joined


def parse_functions(raw: str) -> List[str]:
    """Parse the output of `svc usb getFunctions` into a clean list.

    Real devices print things like ``mtp``, ``mtp,adb`` or an empty line.
    The ``adb`` transport function is always present when debugging, so it is
    filtered out — it is not a user-facing mode.
    """
    raw = (raw or "").strip()
    if not raw:
        return []
    # Some ROMs prefix noise; keep only the last token-ish chunk.
    line = raw.splitlines()[-1].strip()
    parts = [p.strip() for p in line.replace(" ", ",").split(",") if p.strip()]
    return [p for p in parts if p not in ("adb", "none")]


class UsbSwitcher:
    """High-level USB-mode operations for a single device serial."""

    def __init__(self, client: AdbClient, serial: Optional[str] = None):
        self.client = client
        self.serial = serial

    # ------------------------------------------------------------- read state
    def current(self) -> UsbState:
        """Return the phone's current USB function configuration."""
        try:
            raw = self.client.shell(["svc", "usb", "getFunctions"], serial=self.serial)
        except AdbError:
            # Some very old ROMs don't support getFunctions.
            raw = ""
        functions = parse_functions(raw)
        return UsbState(raw=raw.strip(), functions=functions,
                        friendly=_friendly_for(functions))

    # ----------------------------------------------------------- change state
    def set_mode(self, mode: str) -> str:
        """Switch the phone to `mode` (a key of USB_MODES).

        Tries the modern `setFunctions` first and falls back to the legacy
        `setFunction` used on Android 7 and earlier. Returns a status message.
        """
        if mode not in USB_MODES:
            raise ValueError(
                f"Unknown USB mode {mode!r}. Valid modes: {', '.join(USB_MODES)}"
            )
        token = USB_MODES[mode]["svc"]

        last_err: Optional[Exception] = None
        for verb in ("setFunctions", "setFunction"):
            try:
                self.client.shell(["svc", "usb", verb, token],
                                  serial=self.serial, timeout=20)
                return (
                    f"Switched USB mode to {USB_MODES[mode]['label']}. "
                    "The phone may briefly reconnect."
                )
            except AdbError as exc:
                last_err = exc
                continue

        raise AdbError(
            "Could not change the USB mode. On Redmi/MIUI phones make sure "
            "'USB debugging (Security settings)' is enabled in Developer "
            "options, then reconnect and authorize this computer.\n\n"
            f"Details: {last_err}"
        )

    def to_transfer(self) -> str:
        """Convenience: switch to File Transfer (MTP)."""
        return self.set_mode("mtp")

    def to_charging(self) -> str:
        """Convenience: switch to charging only."""
        return self.set_mode("charging")
