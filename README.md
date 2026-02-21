# SlideshowRecalbox

A complete solution to manage and display a high-quality photo slideshow on a Recalbox-powered Bartop/Raspberry Pi.

The project is divided into two distinct parts:
1. **Photo Selector (PC)**: A Node.js application to prepare your images.
2. **Screensaver System (RPi)**: A Python-based idle monitor and animated slideshow for Recalbox.

---

## 1. Photo Selector (PC / Node.js)

Maintains a selection of 100 optimized photos from your library.

- **Smart Selection**: Picks random photos (JPG, HEIC).
- **Auto-labeling**: Extracts EXIF data and reverse-geocodes GPS coordinates to city names.
- **Auto-conversion**: Converts HEIC photos to JPEG.
- **Lightweight**: Sequential processing to avoid background lag on your PC.

### Installation & Usage
1. `npm install`
2. Configure `config.json`.
3. Run: `node index.js`

---

## 2. Screensaver System (RPi / Python)

A two-script system to turn your Recalbox into a photo frame when idle.

### Components
- **[idle_monitor.py](display/idle_monitor.py)**: The "brain". It monitors joysticks/buttons and kills EmulationStation when no activity is detected to launch the slideshow.
- **[slideshow.py](display/slideshow.py)**: The "display". Shows photos with a Ken Burns (zoom) effect and metadata labels.

### Features & Controls
- **Smart Shuffling**: Photos are displayed in random order without repeats until the end of the list.
- **Ken Burns Effect**: Gentle zoom animation.
- **Ultra-responsive Exit**: Uses low-level input monitoring to exit instantly.
- **Controls**:
  - **Exit**: Press **Any Button** (except Info) or any **Key**.
  - **Navigate**: Move Joystick **Left/Right** (or D-Pad) to skip or go back.
  - **Adjust Speed**: Move Joystick **Up/Down** to change display time (saved automatically).
  - **Info Mode**: Press **Button 1** (or 'B') to pause and show detailed photo info (Path, Full Date, Position).

### Installation on Recalbox
1. Copy the `display` folder to `/recalbox/share/userscripts/`.
2. To start the monitor automatically:
   - Edit `/recalbox/share/system/custom.sh`:
     ```bash
     python /recalbox/share/userscripts/idle_monitor.py &
     ```
   - Ensure it's executable: `chmod +x /recalbox/share/system/custom.sh`

---

## Advanced Options

If your Raspberry Pi is struggling with the animation, you can disable it in `idle_monitor.py` by adding `--no-animation` to the slideshow call:
```python
subprocess.call(["python", "/recalbox/share/userscripts/slideshow/slideshow.py", "--no-animation"])
```

## License
ISC
