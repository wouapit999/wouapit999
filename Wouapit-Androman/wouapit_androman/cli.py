"""
cli.py — Command-line interface for Wouapit-Androman.

Every feature is reachable without the GUI, which makes the tool scriptable
and usable over SSH / on headless machines.

Examples
--------
    wouapit-androman devices
    wouapit-androman status
    wouapit-androman transfer          # switch to File Transfer (MTP)
    wouapit-androman charging
    wouapit-androman mode ptp
    wouapit-androman info
    wouapit-androman screenshot
    wouapit-androman apps
    wouapit-androman pull /sdcard/DCIM ./photos
"""

from __future__ import annotations

import argparse
import sys
from typing import List, Optional

from . import __version__, license
from .adb import AdbClient, AdbError, Device
from .device import collect
from .features import Toolkit
from .usb import MODE_ORDER, USB_MODES, UsbSwitcher


def _pick_device(client: AdbClient, serial: Optional[str]) -> Device:
    devices = [d for d in client.devices()]
    ready = [d for d in devices if d.is_ready]
    if serial:
        for d in devices:
            if d.serial == serial:
                return client.describe(d)
        raise AdbError(f"No device with serial {serial!r} is connected.")
    if not devices:
        raise AdbError("No device detected. Plug the phone in and enable USB debugging.")
    if not ready:
        states = ", ".join(f"{d.serial} [{d.state}]" for d in devices)
        raise AdbError(f"Device present but not ready: {states}. "
                       "Unlock the phone and accept the USB debugging prompt.")
    if len(ready) > 1 and not serial:
        listing = ", ".join(d.serial for d in ready)
        raise AdbError(f"Multiple devices connected ({listing}). "
                       "Choose one with --serial.")
    return client.describe(ready[0])


def cmd_devices(client: AdbClient, _args) -> int:
    devices = client.devices()
    if not devices:
        print("No devices detected.")
        return 1
    for d in devices:
        client.describe(d)
        print(f"  {d.serial:24} {d.state:14} {d.label()}")
    return 0


def cmd_status(client: AdbClient, args) -> int:
    dev = _pick_device(client, args.serial)
    state = UsbSwitcher(client, dev.serial).current()
    print(f"Device : {dev.label()}")
    print(f"USB mode: {state.friendly}"
          + (f"  (raw: {state.raw})" if state.raw else ""))
    return 0


def cmd_mode(client: AdbClient, args) -> int:
    mode = args.mode
    dev = _pick_device(client, args.serial)
    switcher = UsbSwitcher(client, dev.serial)
    print(switcher.set_mode(mode))
    print(f"Now: {switcher.current().friendly}")
    return 0


def cmd_info(client: AdbClient, args) -> int:
    dev = _pick_device(client, args.serial)
    info = collect(client, dev)
    width = max(len(k) for k, _ in info.as_rows())
    for key, val in info.as_rows():
        print(f"{key.ljust(width)} : {val}")
    return 0


def cmd_apps(client: AdbClient, args) -> int:
    dev = _pick_device(client, args.serial)
    tk = Toolkit(client, dev.serial)
    apps = tk.list_apps(include_system=args.all)
    for a in apps:
        print(a.package)
    print(f"\n{len(apps)} package(s).")
    return 0


def cmd_screenshot(client: AdbClient, args) -> int:
    dev = _pick_device(client, args.serial)
    path = Toolkit(client, dev.serial).screenshot(args.out)
    print(f"Saved screenshot to {path}")
    return 0


def cmd_record(client: AdbClient, args) -> int:
    dev = _pick_device(client, args.serial)
    print(f"Recording {args.seconds}s ...")
    path = Toolkit(client, dev.serial).screen_record(args.seconds, args.out)
    print(f"Saved recording to {path}")
    return 0


def cmd_pull(client: AdbClient, args) -> int:
    dev = _pick_device(client, args.serial)
    path = Toolkit(client, dev.serial).pull_path(args.remote, args.local)
    print(f"Pulled {args.remote} -> {path}")
    return 0


def cmd_push(client: AdbClient, args) -> int:
    dev = _pick_device(client, args.serial)
    out = Toolkit(client, dev.serial).push_path(args.local, args.remote)
    print(out.strip() or f"Pushed {args.local} -> {args.remote}")
    return 0


def cmd_backup(client: AdbClient, args) -> int:
    dev = _pick_device(client, args.serial)
    print("Confirm the backup on the phone screen ...")
    path = Toolkit(client, dev.serial).full_backup(args.out)
    print(f"Backup written to {path}")
    return 0


def cmd_reboot(client: AdbClient, args) -> int:
    dev = _pick_device(client, args.serial)
    print(Toolkit(client, dev.serial).reboot(args.mode or ""))
    return 0


def cmd_gui(client: AdbClient, _args) -> int:
    from .gui import launch
    return launch()


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="wouapit-androman",
        description=f"Wouapit-Androman {__version__} — {license.banner()}",
    )
    p.add_argument("--serial", help="target a specific device serial")
    p.add_argument("--adb", help="path to the adb binary")
    p.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = p.add_subparsers(dest="command")

    sub.add_parser("gui", help="launch the graphical interface").set_defaults(func=cmd_gui)
    sub.add_parser("devices", help="list connected devices").set_defaults(func=cmd_devices)
    sub.add_parser("status", help="show current USB mode").set_defaults(func=cmd_status)
    sub.add_parser("info", help="show device details").set_defaults(func=cmd_info)

    # Friendly shortcuts for the headline feature.
    t = sub.add_parser("transfer", help="switch to File Transfer (MTP)")
    t.set_defaults(func=cmd_mode, mode="mtp")
    c = sub.add_parser("charging", help="switch to charging only")
    c.set_defaults(func=cmd_mode, mode="charging")

    m = sub.add_parser("mode", help="set an explicit USB mode")
    m.add_argument("mode", choices=MODE_ORDER, help="; ".join(
        f"{k}={USB_MODES[k]['label']}" for k in MODE_ORDER))
    m.set_defaults(func=cmd_mode)

    a = sub.add_parser("apps", help="list installed apps")
    a.add_argument("--all", action="store_true", help="include system apps")
    a.set_defaults(func=cmd_apps)

    s = sub.add_parser("screenshot", help="capture a screenshot")
    s.add_argument("--out", help="output PNG path")
    s.set_defaults(func=cmd_screenshot)

    r = sub.add_parser("record", help="record the screen")
    r.add_argument("--seconds", type=int, default=10)
    r.add_argument("--out", help="output MP4 path")
    r.set_defaults(func=cmd_record)

    pl = sub.add_parser("pull", help="copy a file/folder from the phone")
    pl.add_argument("remote")
    pl.add_argument("local", nargs="?")
    pl.set_defaults(func=cmd_pull)

    ph = sub.add_parser("push", help="copy a file/folder to the phone")
    ph.add_argument("local")
    ph.add_argument("remote", nargs="?", default="/sdcard/Download/")
    ph.set_defaults(func=cmd_push)

    b = sub.add_parser("backup", help="full adb backup to an .ab archive")
    b.add_argument("--out", help="output .ab path")
    b.set_defaults(func=cmd_backup)

    rb = sub.add_parser("reboot", help="reboot the device")
    rb.add_argument("mode", nargs="?", choices=["system", "recovery", "bootloader", "fastboot"])
    rb.set_defaults(func=cmd_reboot)

    return p


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not getattr(args, "command", None):
        # No subcommand -> open the GUI, which is the friendliest default.
        args.func = cmd_gui

    client = AdbClient(adb_path=args.adb)
    try:
        return args.func(client, args)
    except AdbError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nCancelled.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
