# SlideshowRecalbox

A complete solution to manage and display a high-quality photo slideshow on a Recalbox-powered Bartop/Raspberry Pi.

The project is divided into two distinct parts:
1. **Photo Selector (PC)**: A Node.js application to prepare your images.
2. **Screensaver System (RPi)**: A Python-based idle monitor and animated slideshow for Recalbox.

---

## 1. Photo Selector (PC / Node.js)

Maintains a selection of 100 optimized photos from your library.

- **Quality Filtering**: Excludes blurry, low-resolution, or badly proportioned images based on customizable thresholds.
- **In-place Overwriting**: Replaces files sequentially without clearing the folder first, avoiding slideshow downtime.

### Installation & Usage
1. `npm install`
2. Configure `config.json` (see settings below).
3. Run manually: `node index.js`

### Quality Filter Configuration
You can adjust the following parameters in `config.json` :
* `ENABLE_QUALITY_FILTERS` (true/false) : Activer ou désactiver les filtres.
* `FILTER_MIN_WIDTH` / `FILTER_MIN_HEIGHT` : Dimensions minimales des photos (ex: `800`x`600`).
* `FILTER_ALLOW_PORTRAIT` (true/false) : Autoriser ou rejeter les photos verticales.
* `FILTER_MAX_ASPECT_RATIO` : Élimine les panoramas extrêmes (ex: `2.2`).
* `FILTER_MIN_SHARPNESS` : Seuil de netteté (ex: `100`). Le script calcule la variance du Laplacien pour détecter le flou. Plus le chiffre est élevé, plus le filtre est sévère.

### Background Hourly Execution (Windows Task Scheduler)
To automatically update your photos/videos every hour, but **only if your Bartop is turned on and connected**:
1. Open PowerShell as **Administrator**.
2. Run the creation script:
   ```powershell
   Set-ExecutionPolicy Bypass -Scope Process -Force
   .\create_task.ps1
   ```
This registers a task named `BartopPhotoSelector` in your Windows Task Scheduler.
- **Silent operation**: It executes via [run_silent.vbs](file:///c:/Users/steph/Documents/Bartop-NodeJS/run_silent.vbs) to prevent command prompt windows from flashing.
- **Smart detection**: [index.js](file:///c:/Users/steph/Documents/Bartop-NodeJS/index.js) automatically tests connection with the Bartop's network name (TCP port 445) before running. If the Bartop is turned off, the script exits immediately (within 2 seconds) to avoid background lag or network timeouts.

To remove the scheduled task, run this in PowerShell:
```powershell
Unregister-ScheduledTask -TaskName "BartopPhotoSelector" -Confirm:$false
```

### Optional Interactive Web Dashboard (PC)
For a visual overview of your selection, you can run the local Web Dashboard on your PC. It allows you to:
- See the **selected photos** with their sharpness scores and labels.
- See the **discarded photos** and the reason they were rejected (blurry, bad size, portrait orientation, etc.).
- Easily edit `config.json` parameters.
- Trigger a new selection run and see the console logs in real-time.

To start the dashboard:
1. Run:
   ```bash
   node server.js
   ```
2. Open your browser at: `http://localhost:3000`
3. Stop it with `Ctrl+C` once you are done (it does not need to run in the background).

---

## 2. Screensaver System (RPi / Python)

A two-script system to turn your Recalbox into a photo frame when idle.

### Components
- **[idle_monitor.py](display/idle_monitor.py)**: The "brain". It monitors joysticks/buttons and kills EmulationStation when no activity is detected to launch the slideshow.
- **[slideshow.py](display/slideshow.py)**: The "display". Shows photos with a Ken Burns (zoom) effect and metadata labels.

### Features & Controls
- **Multi-Mode Support**: Toggle between **Photos**, **Personal Videos**, and **Game Videos** (Screenshots/Snaps).
- **Smart Shuffling**: Randomized display without repeats.
- **Ultra-responsive Exit**: Instant wake-up on any button (except Info/Mode).
- **Controls**:
  - **Exit**: Press **Any Button** (except Info/Mode) or any **Key**.
  - **Navigate**: Joystick **Left/Right** to skip.
  - **Adjust Speed**: Joystick **Up/Down** (Score 1-20, Up = Faster).
  - **Info Mode**: Press **Button 1** (ID 289) to pause and show details.
    - *Diagnostic tip*: While in Info Mode, press any other button to see its ID without exiting!
  - **Switch Mode**: Press the **Mode Button** (default ID 304) to cycle modes.

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
