"""
Wouapit-Androman — a free, fully-unlocked Android device toolkit.

Headline feature: switch a Redmi/Xiaomi (or any Android) phone's USB mode
from "charging only" to File Transfer (MTP) straight from your computer,
plus a Dr.Fone-style toolkit (file transfer, app manager, backup/restore,
screenshots, screen recording, screen mirroring and more) with every
feature unlocked and no upgrade prompts.
"""

from .adb import AdbClient, AdbError, Device
from .usb import UsbSwitcher, USB_MODES, MODE_ORDER
from .device import DeviceInfo, collect
from .features import Toolkit, App
from . import license

__all__ = [
    "AdbClient", "AdbError", "Device",
    "UsbSwitcher", "USB_MODES", "MODE_ORDER",
    "DeviceInfo", "collect",
    "Toolkit", "App",
    "license",
]

__version__ = "1.0.0"
__app_name__ = "Wouapit-Androman"
