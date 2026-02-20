#!/usr/bin/python
# -*- coding: utf-8 -*-
import os
import time
import subprocess
import glob
import fcntl
import sys

# --- CONFIGURATION ---
# Time in seconds before the screensaver starts
TIMEOUT_SECONDS = 60

# Process names that prevent the screensaver from starting (active gaming)
GAME_PROCESSES = ["retroarch", "mupen64plus", "fba2x", "ppsspp", "dolphin-emu"]

# Path to the slideshow script
SLIDESHOW_SCRIPT = "/recalbox/share/userscripts/slideshow/slideshow.py"

# Path to EmulationStation start script (Recalbox specific)
ES_START_SCRIPT = "/etc/init.d/S31emulationstation"
# ---------------------

def get_input_devices():
    """Finds all input event devices (joysticks, buttons, etc.)."""
    return glob.glob('/dev/input/event*')

def is_game_running():
    """Checks if any gaming emulator is currently active."""
    try:
        output = subprocess.check_output("ps w", shell=True)
        # Python 2 compatibility
        if hasattr(output, 'decode'):
            output = output.decode('utf-8', 'ignore')
        
        for proc in GAME_PROCESSES:
            if proc in output:
                return True
    except Exception:
        pass
    return False

def launch_screensaver():
    """Manages the transition from EmulationStation to the Slideshow and back."""
    sys.stdout.write("\n[INFO] Activity timeout. Stopping EmulationStation...\n")
    sys.stdout.flush()
    # Stop the UI to free up GPU and display resources
    subprocess.call(["killall", "emulationstation"])
    time.sleep(2)

    sys.stdout.write("[INFO] Starting Slideshow...\n")
    sys.stdout.flush()
    # This call blocks until the slideshow is exited (by user input)
    subprocess.call(["python", SLIDESHOW_SCRIPT])

    sys.stdout.write("[INFO] Relancing EmulationStation...\n")
    sys.stdout.flush()
    # Restart the UI
    subprocess.call([ES_START_SCRIPT, "start"])

def main():
    print("--- Recalbox Idle Monitor Started (CTRL+C to quit) ---")
    last_activity = time.time()
    
    # Set up non-blocking reads for all input devices
    devices = get_input_devices()
    files = []
    for dev in devices:
        try:
            f = open(dev, 'rb')
            fd = f.fileno()
            # Set O_NONBLOCK flag
            flags = fcntl.fcntl(fd, fcntl.F_GETFL)
            fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
            files.append(f)
        except Exception:
            pass

    if not files:
        print("[WARNING] No input devices found. Monitor may not work as expected.")

    try:
        while True:
            activity = False
            # Check all opened devices for any input data
            for f in files:
                try:
                    # Reading a small chunk to check for activity
                    if f.read(16):
                        activity = True
                except Exception:
                    # No data available (Expected in non-blocking mode)
                    pass

            current = time.time()
            if activity:
                last_activity = current
                sys.stdout.write("\r[ACTIVITY] Input detected. Timer reset.             ")
                sys.stdout.flush()
            elif is_game_running():
                # Don't start screensaver if a game is running
                last_activity = current
                sys.stdout.write("\r[INFO] Game running. Monitoring paused.           ")
                sys.stdout.flush()
            else:
                elapsed = current - last_activity
                remain = int(TIMEOUT_SECONDS - elapsed)
                if remain <= 0:
                    launch_screensaver()
                    # Reset timer after returning from slideshow
                    last_activity = time.time()
                else:
                    sys.stdout.write("\r[IDLE] Starting slideshow in %02d seconds...        " % remain)
                    sys.stdout.flush()
            
            time.sleep(0.5) # Check twice per second to save CPU
            
    except KeyboardInterrupt:
        print("\n[INFO] Monitor stopped by user.")
    finally:
        for f in files:
            f.close()

if __name__ == "__main__":
    main()
