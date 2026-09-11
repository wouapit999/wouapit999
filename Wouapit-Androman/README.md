# 📱 Wouapit-Androman

**A free, fully-unlocked Android toolkit.** Switch your Redmi / Xiaomi (or any
Android) phone from *"Charging only"* to **File Transfer (MTP)** straight from
your computer, plus a complete Dr.Fone-style device manager — file transfer,
app manager, backup & restore, screenshots, screen recording, screen mirroring
and more.

> **Every feature is unlocked. No trial, no paywall, no "upgrade to Premium".**
> The banner reads *Premium · Activated* because that is simply the only edition.

---

## Why this exists

When you plug a Redmi phone into a PC it usually comes up in **charging-only**
mode, and you have to unlock the phone, pull down the notification shade and tap
*"File transfer / Android Auto"* every single time. Wouapit-Androman flips that
switch for you from the computer with one click (or one command), and throws in
the device-management tools a paid suite would charge you for.

## How the USB switch works

Android exposes its active USB gadget configuration through a shell service.
With USB debugging enabled, Wouapit-Androman runs:

```
adb shell svc usb setFunctions mtp     # File Transfer (MTP)   ← the headline feature
adb shell svc usb setFunctions ptp     # Photo transfer (camera)
adb shell svc usb setFunctions rndis   # USB tethering
adb shell svc usb setFunctions none    # Charging only
adb shell svc usb getFunctions         # read the current mode
```

On older phones (Android 7 and below) it automatically falls back to the legacy
`setFunction` verb.

## Features (all included)

| Module | What it does |
| --- | --- |
| 🔄 **USB Mode Switch** | Charging → File Transfer (MTP), PTP, RNDIS tethering, MIDI, charging-only |
| 📁 **File Transfer** | Push/pull files & folders, one-click "export all photos (DCIM)", browse `/sdcard` |
| 📦 **App Manager** | List installed apps, install APK, uninstall, back up an app's APK to your PC |
| 🗄 **Backup & Restore** | Full-device `adb backup` archive (.ab) and restore |
| 📸 **Screen** | Screenshot, screen recording (up to 180 s), live mirroring via scrcpy |
| 🧰 **Tools** | Reboot (system/recovery/bootloader/fastboot), logcat capture, contacts & SMS export, shell console |
| 📊 **Dashboard** | Model, Android/MIUI version, security patch, battery, storage |

## Requirements

1. **Python 3.8+** (the GUI uses Tkinter, which ships with Python).
2. **Android platform-tools** (`adb`) on your `PATH`.
   Get it from <https://developer.android.com/tools/releases/platform-tools>.
3. *(Optional)* **scrcpy** for live screen mirroring: <https://github.com/Genymobile/scrcpy>.

### Enable USB debugging on your Redmi / Xiaomi phone

1. **Settings → About phone** → tap **MIUI version** 7 times to unlock
   *Developer options*.
2. **Settings → Additional settings → Developer options**:
   - Turn on **USB debugging**.
   - Turn on **USB debugging (Security settings)** — MIUI requires this one to
     let a computer change settings such as the USB mode.
3. Plug in the phone and tap **Allow** on the *"Allow USB debugging?"* prompt.

## Install & run

No installation required — clone and run:

```bash
git clone https://github.com/wouapit999/wouapit999.git
cd wouapit999/Wouapit-Androman

# Graphical app:
./run.sh                       # Windows: run.bat

# Or command line:
./run.sh transfer             # switch the phone to File Transfer (MTP)
./run.sh status               # show the current USB mode
```

Prefer a proper install?

```bash
pip install .
wouapit-androman              # launches the GUI
wouapit-androman transfer     # CLI shortcut
```

## Command-line reference

```
wouapit-androman devices            # list connected devices
wouapit-androman status             # show current USB mode
wouapit-androman transfer           # switch to File Transfer (MTP)
wouapit-androman charging           # switch to charging only
wouapit-androman mode ptp|rndis|midi|mtp|charging
wouapit-androman info               # device dashboard
wouapit-androman apps [--all]       # list installed apps
wouapit-androman screenshot [--out FILE]
wouapit-androman record [--seconds N] [--out FILE]
wouapit-androman pull  REMOTE [LOCAL]   # e.g. pull /sdcard/DCIM ./photos
wouapit-androman push  LOCAL  [REMOTE]
wouapit-androman backup [--out FILE.ab]
wouapit-androman reboot [recovery|bootloader|fastboot]
wouapit-androman gui                # force the graphical interface
```

Target a specific phone when several are attached with `--serial <serial>`, or
point at a custom adb with `--adb /path/to/adb`.

## Where files go

Exports (photos, screenshots, recordings, backups, APKs, logs) are written to a
`Wouapit-Androman/` folder in your home directory, organised by type and
timestamp.

## Tests

```bash
python -m unittest discover -s tests
```

The core USB/ADB parsing and mode-switching logic is covered by unit tests that
run without a phone.

## Notes & honesty

- This is an original, open-source tool. It is **not** affiliated with, and does
  not use any code from, Wondershare Dr.Fone; it simply offers a comparable set
  of device-management features, free.
- The USB switch, backups, screen capture and file transfer are standard,
  documented ADB operations. They need USB debugging enabled and the phone
  authorized — there is no bypass of any lock screen or account protection.
- SMS/contacts export is best-effort and depends on what your ROM's content
  providers allow over ADB.

## License

MIT — see [LICENSE](LICENSE).
