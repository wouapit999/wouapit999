"""
Unit tests for the pure-logic parts of Wouapit-Androman.

These do not need a real phone or a real adb binary: the AdbClient is
replaced with a fake that returns canned shell output, so the parsing and
mode-switching logic can be verified deterministically.

Run with:  python -m pytest    (or)  python -m unittest
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from wouapit_androman import license
from wouapit_androman.adb import parse_devices
from wouapit_androman.usb import (MODE_ORDER, USB_MODES, UsbSwitcher,
                                  parse_functions)


class FakeClient:
    """Stand-in for AdbClient that records shell calls and replays output."""

    def __init__(self, responses=None):
        self.responses = responses or {}
        self.calls = []

    def shell(self, args, serial=None, timeout=None, check=True):
        key = " ".join(args) if not isinstance(args, str) else args
        self.calls.append((key, serial))
        if key in self.responses:
            val = self.responses[key]
            if isinstance(val, Exception):
                raise val
            return val
        return ""


class TestParseDevices(unittest.TestCase):
    def test_typical_output(self):
        out = (
            "List of devices attached\n"
            "abc123def   device\n"
            "emulator-5554   device\n"
        )
        self.assertEqual(
            parse_devices(out),
            [("abc123def", "device"), ("emulator-5554", "device")],
        )

    def test_unauthorized_and_empty(self):
        out = "List of devices attached\nXYZ   unauthorized\n\n"
        self.assertEqual(parse_devices(out), [("XYZ", "unauthorized")])

    def test_no_devices(self):
        self.assertEqual(parse_devices("List of devices attached\n"), [])


class TestParseFunctions(unittest.TestCase):
    def test_empty_is_charging(self):
        self.assertEqual(parse_functions(""), [])

    def test_mtp(self):
        self.assertEqual(parse_functions("mtp"), ["mtp"])

    def test_mtp_with_adb_filtered(self):
        self.assertEqual(parse_functions("mtp,adb"), ["mtp"])

    def test_whitespace_and_newlines(self):
        self.assertEqual(parse_functions("  ptp \n"), ["ptp"])

    def test_none_token(self):
        self.assertEqual(parse_functions("none"), [])


class TestUsbSwitcher(unittest.TestCase):
    def test_current_reports_friendly_mtp(self):
        client = FakeClient({"svc usb getFunctions": "mtp,adb"})
        state = UsbSwitcher(client, "s1").current()
        self.assertEqual(state.functions, ["mtp"])
        self.assertEqual(state.friendly, USB_MODES["mtp"]["label"])

    def test_current_empty_is_charging(self):
        client = FakeClient({"svc usb getFunctions": ""})
        state = UsbSwitcher(client, "s1").current()
        self.assertEqual(state.friendly, USB_MODES["charging"]["label"])

    def test_set_mode_sends_correct_token(self):
        client = FakeClient()
        msg = UsbSwitcher(client, "s1").set_mode("mtp")
        self.assertIn("File Transfer", msg)
        self.assertEqual(client.calls[0][0], "svc usb setFunctions mtp")

    def test_set_charging_sends_none(self):
        client = FakeClient()
        UsbSwitcher(client, "s1").to_charging()
        self.assertEqual(client.calls[0][0], "svc usb setFunctions none")

    def test_set_mode_rejects_unknown(self):
        with self.assertRaises(ValueError):
            UsbSwitcher(FakeClient(), "s1").set_mode("bogus")

    def test_all_modes_have_metadata(self):
        for key in MODE_ORDER:
            self.assertIn(key, USB_MODES)
            self.assertTrue(USB_MODES[key]["label"])
            self.assertTrue(USB_MODES[key]["svc"])


class TestLicense(unittest.TestCase):
    def test_everything_unlocked(self):
        self.assertTrue(license.is_unlocked("usb_mode_switch"))
        self.assertTrue(license.is_unlocked("anything_at_all"))
        self.assertEqual(license.get_license().status, "ACTIVATED")
        self.assertEqual(license.get_license().expires, "Never")


if __name__ == "__main__":
    unittest.main()
