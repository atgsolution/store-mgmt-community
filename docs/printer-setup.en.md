[Tiếng Việt](printer-setup.md) | [English](printer-setup.en.md)

# Thermal Printing Architecture

## 1. Output paths

Store MGMT provides two independent printing paths:

| Path | Rendering | Transport | Unicode |
|---|---|---|---|
| Browser Print | Print-specific HTML/CSS layout | Operating-system spooler and driver | Full |
| Direct USB | ESC/POS command stream | WebUSB endpoint | Normalized to ASCII |

Browser printing prioritizes visual parity with the preview. Direct USB prioritizes deterministic columns, speed, and dialog-free operation. The paths use different typography engines and therefore cannot be pixel-identical.

## 2. Browser Print specification

The print stylesheet defines:

- 80 mm paper width;
- 72 mm content width;
- zero page margin;
- white background, black text, and removal of non-receipt interface elements;
- a font scale shared with the preview and limited to values from 10 to 24.

Recommended driver settings:

1. select the correct driver and an 80 mm paper profile;
2. set scaling to 100%;
3. select None or Minimum margins;
4. disable browser headers and footers;
5. adjust thermal density in the driver or firmware if output is faint.

Final output remains constrained by the printable area reported by the driver. An incorrect paper profile can crop content even when the preview is correct.

## 3. Direct USB specification

The USB path initializes the printer with ESC/POS, selects native Font A at normal size, and builds the receipt on a fixed 48-column grid. Long content is wrapped before encoding; the footer advances four lines before a partial-cut command.

The interface font-size control affects only the preview and Browser Print. Direct USB uses a fixed configuration to prevent firmware scaling and horizontal overflow.

Vietnamese text is transliterated to unaccented characters before transfer because ESC/POS code pages vary across printer models. The preview and Browser Print retain full UTF-8.

## 4. Compatibility requirements

Direct USB requires:

- a Chrome build with WebUSB support;
- a secure context provided by HTTPS or localhost;
- a USB device exposing a BULK OUT endpoint and accepting ESC/POS;
- an explicit user gesture to grant device access;
- no competing application holding exclusive access to the USB interface.

On tablets, browser printing is available when the operating system recognizes the printer. Direct USB additionally requires browser WebUSB support and an ESC/POS-compatible printer; otherwise use a local print bridge or native adapter.

## 5. Diagnosis

| Symptom | First checks |
|---|---|
| Device chooser does not open | The page lacks HTTPS/localhost or the browser lacks WebUSB |
| Device cannot be opened | iPOS or another application owns the USB interface |
| Transfer fails | No BULK OUT endpoint or incompatible ESC/POS firmware |
| Right edge is cropped | Incorrect paper width, firmware scaling, or a 58 mm profile |
| Output is faint | Thermal density, power supply, print head, or paper quality |
| Vietnamese text is corrupted | Incompatible code page; use ASCII USB output or Browser Print |
| Footer is truncated | Model-specific feed or cutter behavior; increase trailing feed |

## 6. Operational policy

Each sales endpoint should standardize one printing path, print a calibration receipt, and lock its configuration before service. Drivers and firmware belong to the endpoint and must not be bundled with the web application; obtain them only from a verified manufacturer or distributor.
