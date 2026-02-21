#!/usr/bin/python
# -*- coding: utf-8 -*-

import pygame
import os
import time
import sys
import argparse
import glob
import fcntl
import struct
import random
import json

# --- CONFIGURATION ---
IMAGE_FOLDER = "/recalbox/share/userscripts/slideshow/images" 
SETTINGS_FILE = "/recalbox/share/userscripts/slideshow/slideshow_settings.json"
DEFAULT_DISPLAY_TIME = 15 
MIN_DISPLAY_TIME = 3
MAX_DISPLAY_TIME = 60
ZOOM_SPEED = 0.00015
FADE_SPEED = 8

# Input event constants
EV_KEY = 1
EV_ABS = 3
ABS_X = 0
ABS_Y = 1
ABS_HAT0X = 16
ABS_HAT0Y = 17

def load_settings():
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r') as f:
                return json.load(f)
        except Exception:
            pass
    return {"display_time": DEFAULT_DISPLAY_TIME}

def save_settings(settings):
    try:
        with open(SETTINGS_FILE, 'w') as f:
            json.dump(settings, f)
    except Exception:
        pass

def get_sidecar_data(image_path):
    """Reads the multi-line metadata from the associated .txt file."""
    txt_path = os.path.splitext(image_path)[0] + ".txt"
    data = {"label": "", "full_date": "", "source_path": ""}
    if os.path.exists(txt_path):
        try:
            with open(txt_path, 'r') as f:
                lines = f.readlines()
                if len(lines) >= 1: data["label"] = lines[0].strip()
                if len(lines) >= 2: data["full_date"] = lines[1].strip()
                if len(lines) >= 3: data["source_path"] = lines[2].strip()
                
                # Python 2 string handling
                for k in data:
                    if hasattr(data[k], 'decode'):
                        data[k] = data[k].decode('utf-8', 'ignore')
        except Exception:
            pass
    return data

def get_input_devices():
    return glob.glob('/dev/input/event*')

def run_slideshow(enable_animation=True):
    # Recalbox / FBcon specific settings
    os.environ["SDL_VIDEODRIVER"] = "fbcon"
    os.environ["SDL_NOMOUSE"] = "1"
    
    settings = load_settings()
    display_time = settings.get("display_time", DEFAULT_DISPLAY_TIME)
    
    pygame.init()
    if pygame.joystick.get_count() > 0:
        pygame.joystick.init()
        for i in range(pygame.joystick.get_count()):
            pygame.joystick.Joystick(i).init()
    
    # Low-level input monitoring
    devices = get_input_devices()
    input_files = []
    for dev in devices:
        try:
            f = open(dev, 'rb')
            fd = f.fileno()
            flags = fcntl.fcntl(fd, fcntl.F_GETFL)
            fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
            input_files.append(f)
        except Exception:
            pass

    # Detect struct size for input_event
    event_format = 'llHHi' 
    event_size = struct.calcsize(event_format)

    # Get screen resolution
    info = pygame.display.Info()
    sw, sh = info.current_w, info.current_h
    screen = pygame.display.set_mode((sw, sh), pygame.FULLSCREEN)
    pygame.mouse.set_visible(False)
    
    # Load fonts
    font_main = pygame.font.Font(None, int(sh * 0.05))
    font_small = pygame.font.Font(None, int(sh * 0.03))

    # List only JPEG images
    all_files = sorted([os.path.join(IMAGE_FOLDER, f) for f in os.listdir(IMAGE_FOLDER) if f.lower().endswith('.jpg')])
    if not all_files:
        print("No images found in " + IMAGE_FOLDER)
        return

    # Shuffle logic: create a randomized indices list
    indices = range(len(all_files))
    random.shuffle(indices)
    current_idx_ptr = 0

    idx = indices[current_idx_ptr]
    running = True
    need_load = True
    last_switch = time.time()
    
    # State variables
    current_img_raw = None
    zoom_factor = 1.0
    alpha = 0
    meta_data = {}
    
    # Info Mode variables
    show_info = False
    info_timer = 0
    INFO_DURATION = 10 # Seconds to pause and show info

    # Input debouncing
    last_nav_time = 0
    last_speed_time = 0

    try:
        while running:
            now = time.time()
            
            # --- 1. LOW LEVEL INPUT HANDLING ---
            # Any input (except maybe axes if we want to be picky) could signal exit.
            # But the user wants Up/Down for speed.
            # Let's use ANY BUTTON press to exit, EXCEPT one for Info.
            for f in input_files:
                try:
                    data = f.read(event_size)
                    while data: # Process all buffered events
                        _, _, ev_type, ev_code, ev_value = struct.unpack(event_format, data)
                        
                        # EV_KEY (Buttons)
                        if ev_type == EV_KEY and ev_value == 1:
                            # Usually 304, 305 etc are buttons.
                            # We'll use one button specifically for Info (e.g. 305 / Button 1)
                            # All other buttons (or specific ones) can exit.
                            if ev_code == 305: # Button 1 (Info)
                                show_info = not show_info
                                if show_info: 
                                    info_timer = now + INFO_DURATION
                            else: # Any other button exits
                                running = False
                                break
                        data = f.read(event_size)
                except Exception:
                    pass
            
            if not running: break
            
            # --- 2. SDL EVENT HANDLING (NAV & SPEED) ---
            for event in pygame.event.get():
                if event.type in (pygame.QUIT, pygame.KEYDOWN):
                    running = False
                
                if now - last_nav_time > 0.4:
                    # NAVIGATION (Horizontal)
                    if event.type == pygame.JOYAXISMOTION and event.axis == 0:
                        if event.value > 0.6: # Next
                            current_idx_ptr = (current_idx_ptr + 1) % len(indices)
                            idx = indices[current_idx_ptr]
                            need_load = True
                            last_nav_time = now
                        elif event.value < -0.6: # Prev
                            current_idx_ptr = (current_idx_ptr - 1) % len(indices)
                            idx = indices[current_idx_ptr]
                            need_load = True
                            last_nav_time = now
                    elif event.type == pygame.JOYHATMOTION and event.value[0] != 0:
                        if event.value[0] == 1: # Right
                            current_idx_ptr = (current_idx_ptr + 1) % len(indices)
                        else: # Left
                            current_idx_ptr = (current_idx_ptr - 1) % len(indices)
                        idx = indices[current_idx_ptr]
                        need_load = True
                        last_nav_time = now

                # SPEED CONTROL (Vertical)
                if now - last_speed_time > 0.2:
                    change = 0
                    if event.type == pygame.JOYAXISMOTION and event.axis == 1:
                        if event.value < -0.6: change = -1 # Up -> Faster (less time)
                        elif event.value > 0.6: change = 1 # Down -> Slower (more time)
                    elif event.type == pygame.JOYHATMOTION and event.value[1] != 0:
                        change = -event.value[1] # Hat Up is 1, so change -1

                    if change != 0:
                        display_time = max(MIN_DISPLAY_TIME, min(MAX_DISPLAY_TIME, display_time + change))
                        last_speed_time = now
                        save_settings({"display_time": display_time})

            # --- 3. SLIDE LOGIC ---
            # If Info mode is on, we "pause" the timer
            if show_info:
                last_switch = now - display_time + (info_timer - now) # Freeze relative time
                if now > info_timer:
                    show_info = False

            if not need_load and not show_info and now - last_switch > display_time:
                current_idx_ptr = (current_idx_ptr + 1) % len(indices)
                idx = indices[current_idx_ptr]
                need_load = True

            if need_load:
                try:
                    img = pygame.image.load(all_files[idx]).convert()
                    img_w, img_h = img.get_size()
                    ratio = min(float(sw)/img_w, float(sh)/img_h)
                    current_img_raw = pygame.transform.scale(img, (int(img_w*ratio), int(img_h*ratio)))
                    
                    meta_data = get_sidecar_data(all_files[idx])
                    zoom_factor = 1.0
                    alpha = 0
                    need_load = False
                    last_switch = now
                except Exception as e:
                    print("Error loading image " + all_files[idx] + ": " + str(e))
                    current_idx_ptr = (current_idx_ptr + 1) % len(indices)
                    idx = indices[current_idx_ptr]

            # --- 4. RENDERING ---
            if current_img_raw:
                screen.fill((0, 0, 0))
                
                # Ken Burns Effect
                if enable_animation and not show_info:
                    zoom_factor += ZOOM_SPEED
                
                z_w = int(current_img_raw.get_width() * zoom_factor)
                z_h = int(current_img_raw.get_height() * zoom_factor)
                img_to_draw = pygame.transform.scale(current_img_raw, (z_w, z_h))
                pos_x = (sw - z_w) // 2
                pos_y = (sh - z_h) // 2
                
                # Fade-in
                if alpha < 255: alpha += FADE_SPEED
                img_to_draw.set_alpha(min(alpha, 255))
                
                screen.blit(img_to_draw, (pos_x, pos_y))
                
                # Metadata Overlays
                if not show_info:
                    # Normal Overlay
                    if meta_data.get("label"):
                        txt = font_main.render(meta_data["label"], True, (255, 255, 255))
                        shd = font_main.render(meta_data["label"], True, (0, 0, 0))
                        tx = sw - txt.get_width() - 30
                        ty = sh - txt.get_height() - 30
                        screen.blit(shd, (tx+2, ty+2))
                        screen.blit(txt, (tx, ty))
                else:
                    # Detailed Info Mode (Center Screen)
                    overlay = pygame.Surface((sw * 0.8, sh * 0.4))
                    overlay.set_alpha(180)
                    overlay.fill((0, 0, 0))
                    ox = (sw - overlay.get_width()) // 2
                    oy = (sh - overlay.get_height()) // 2
                    screen.blit(overlay, (ox, oy))
                    
                    info_lines = [
                        "PHOTO %d / %d" % (current_idx_ptr + 1, len(all_files)),
                        "Lieu: %s" % meta_data.get("label", "Inconnu"),
                        "Date: %s" % meta_data.get("full_date", "Inconnue"),
                        "Fichier: %s" % meta_data.get("source_path", "N/A"),
                        "Vitesse: %d sec" % display_time,
                        "Retour au diaporama dans %d s..." % int(max(0, info_timer - now))
                    ]
                    
                    for i, line in enumerate(info_lines):
                        color = (255, 255, 0) if i == 0 else (255, 255, 255)
                        txt = font_small.render(line, True, color)
                        screen.blit(txt, (ox + 20, oy + 20 + i * 35))

                pygame.display.flip()
            
            time.sleep(0.04 if enable_animation and not show_info else 0.1)

    finally:
        for f in input_files: f.close()
        pygame.quit()
        sys.exit()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-animation", action="store_true", help="Disable Ken Burns effect")
    args = parser.parse_args()
    run_slideshow(enable_animation=not args.no_animation)
