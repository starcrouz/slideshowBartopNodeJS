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
    return {"display_time": DEFAULT_DISPLAY_TIME, "info_button": 305}

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

def run_slideshow(enable_animation=True, target_info_button=305):
    # Recalbox / FBcon specific settings
    os.environ["SDL_VIDEODRIVER"] = "fbcon"
    os.environ["SDL_NOMOUSE"] = "1"
    
    settings = load_settings()
    display_time = settings.get("display_time", DEFAULT_DISPLAY_TIME)
    # The info button can be saved in settings if the user finds it
    info_button_code = settings.get("info_button", target_info_button)
    
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
    font_tiny = pygame.font.Font(None, int(sh * 0.025))

    # List only JPEG images
    all_files = sorted([os.path.join(IMAGE_FOLDER, f) for f in os.listdir(IMAGE_FOLDER) if f.lower().endswith('.jpg')])
    if not all_files:
        print("No images found in " + IMAGE_FOLDER)
        return

    # Shuffle logic
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
    
    # Overlays
    show_info = False
    info_timer = 0
    INFO_DURATION = 15 # A bit longer for reading

    speed_overlay_timer = 0
    SPEED_OVERLAY_DURATION = 2

    # Input debouncing
    last_nav_time = 0
    last_speed_time = 0

    print("--- Slideshow Started ---")
    print("TIP: Press buttons to see their codes in this console.")
    print("Target Info Button: %d" % info_button_code)

    try:
        while running:
            now = time.time()
            
            # --- 1. LOW LEVEL INPUT HANDLING ---
            for f in input_files:
                try:
                    data = f.read(event_size)
                    while data:
                        _, _, ev_type, ev_code, ev_value = struct.unpack(event_format, data)
                        
                        if ev_type == EV_KEY and ev_value == 1: # Button Press
                            print("[DEBUG] Button pressed! Code: %d" % ev_code)
                            
                            # Toggle Info Mode
                            if ev_code == info_button_code:
                                show_info = not show_info
                                if show_info: 
                                    info_timer = now + INFO_DURATION
                                    print("[INFO] Mode Info active.")
                            else: 
                                # Any other button exits
                                print("[INFO] Exit signal received (Button %d)." % ev_code)
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
                
                # Speed Control (Joystick Vertical)
                if now - last_speed_time > 0.15:
                    change = 0
                    if event.type == pygame.JOYAXISMOTION and event.axis == 1:
                        if event.value < -0.6: change = -1 # Up -> Faster
                        elif event.value > 0.6: change = 1 # Down -> Slower
                    elif event.type == pygame.JOYHATMOTION and event.value[1] != 0:
                        change = -event.value[1]

                    if change != 0:
                        display_time = max(MIN_DISPLAY_TIME, min(MAX_DISPLAY_TIME, display_time + change))
                        last_speed_time = now
                        speed_overlay_timer = now + SPEED_OVERLAY_DURATION
                        save_settings({"display_time": display_time, "info_button": info_button_code})

                # Navigation (Joystick Horizontal)
                if now - last_nav_time > 0.4:
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
                        if event.value[0] == 1: current_idx_ptr = (current_idx_ptr + 1) % len(indices)
                        else: current_idx_ptr = (current_idx_ptr - 1) % len(indices)
                        idx = indices[current_idx_ptr]
                        need_load = True
                        last_nav_time = now

            # --- 3. SLIDE LOGIC ---
            if show_info:
                last_switch = now - display_time + (max(0, info_timer - now))
                if now > info_timer: show_info = False

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
                except Exception:
                    current_idx_ptr = (current_idx_ptr + 1) % len(indices)
                    idx = indices[current_idx_ptr]

            # --- 4. RENDERING ---
            if current_img_raw:
                screen.fill((0, 0, 0))
                
                if enable_animation and not show_info:
                    zoom_factor += ZOOM_SPEED
                
                z_w = int(current_img_raw.get_width() * zoom_factor)
                z_h = int(current_img_raw.get_height() * zoom_factor)
                
                # Optimized zoom centering
                pos_x = (sw - z_w) // 2
                pos_y = (sh - z_h) // 2
                img_to_draw = pygame.transform.scale(current_img_raw, (z_w, z_h))
                
                if alpha < 255: alpha += FADE_SPEED
                img_to_draw.set_alpha(min(alpha, 255))
                screen.blit(img_to_draw, (pos_x, pos_y))
                
                # Overlays
                if show_info:
                    # Info Mode Panel
                    overlay = pygame.Surface((sw * 0.85, sh * 0.5))
                    overlay.set_alpha(200)
                    overlay.fill((20, 20, 20))
                    ox = (sw - overlay.get_width()) // 2
                    oy = (sh - overlay.get_height()) // 2
                    screen.blit(overlay, (ox, oy))
                    
                    info_lines = [
                        "DÉTAILS PHOTO [%d/%d]" % (current_idx_ptr + 1, len(all_files)),
                        "Lieu      : %s" % meta_data.get("label", "N/A"),
                        "Date      : %s" % meta_data.get("full_date", "N/A"),
                        "Fichier   : %s" % meta_data.get("source_path", "N/A"),
                        "Vitesse   : %d secondes" % display_time,
                        "Bouton ID : %d (Configuré pour Info)" % info_button_code,
                        "",
                        "Retour auto dans %ds..." % int(max(0, info_timer - now))
                    ]
                    for i, line in enumerate(info_lines):
                        c = (255, 255, 0) if i == 0 else (255, 255, 255)
                        txt = font_small.render(line, True, c)
                        screen.blit(txt, (ox + 30, oy + 30 + i * 32))
                else:
                    # Normal label
                    if meta_data.get("label"):
                        txt = font_main.render(meta_data["label"], True, (255, 255, 255))
                        shd = font_main.render(meta_data["label"], True, (0, 0, 0))
                        tx, ty = sw - txt.get_width() - 40, sh - txt.get_height() - 40
                        screen.blit(shd, (tx+2, ty+2))
                        screen.blit(txt, (tx, ty))
                    
                    # Speed adjustment overlay
                    if now < speed_overlay_timer:
                        s_txt = "Intervalle : %d s" % display_time
                        txt = font_small.render(s_txt, True, (255, 255, 0))
                        # Center top or corner
                        screen.blit(txt, (20, 20))

                pygame.display.flip()
            
            time.sleep(0.04 if enable_animation and not show_info else 0.1)

    finally:
        for f in input_files: f.close()
        pygame.quit()
        sys.exit()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-animation", action="store_true")
    parser.add_argument("--info-button", type=int, default=305)
    args = parser.parse_args()
    run_slideshow(enable_animation=not args.no_animation, target_info_button=args.info_button)
