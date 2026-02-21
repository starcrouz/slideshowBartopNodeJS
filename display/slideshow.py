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

# --- CONFIGURATION ---
IMAGE_FOLDER = "/recalbox/share/userscripts/slideshow/images" 
DISPLAY_TIME = 15 
ZOOM_SPEED = 0.00015
FADE_SPEED = 8

# Input event constants
EV_KEY = 1
EV_ABS = 3
ABS_X = 0
ABS_Y = 1
ABS_HAT0X = 16
ABS_HAT0Y = 17

def get_sidecar_text(image_path):
    """Reads the associated .txt file for a given image."""
    txt_path = os.path.splitext(image_path)[0] + ".txt"
    if os.path.exists(txt_path):
        try:
            with open(txt_path, 'r') as f:
                content = f.read()
                if hasattr(content, 'decode'):
                    return content.decode('utf-8').strip()
                return content.strip()
        except Exception:
            pass
    return ""

def get_input_devices():
    """Finds all input event devices (joysticks, buttons, etc.)."""
    return glob.glob('/dev/input/event*')

def run_slideshow(enable_animation=True):
    # Recalbox / FBcon specific settings
    os.environ["SDL_VIDEODRIVER"] = "fbcon"
    os.environ["SDL_NOMOUSE"] = "1"
    
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

    # Detect struct size for input_event (16 bytes on 32-bit, 24 bytes on 64-bit)
    # RPi 3 on Recalbox 6.1 is usually 32-bit.
    # format: long, long, short, short, int
    event_format = 'llHHi' 
    event_size = struct.calcsize(event_format)

    # Get screen resolution
    info = pygame.display.Info()
    sw, sh = info.current_w, info.current_h
    screen = pygame.display.set_mode((sw, sh), pygame.FULLSCREEN)
    pygame.mouse.set_visible(False)
    
    # Load font
    font = pygame.font.Font(None, int(sh * 0.05))

    # List only JPEG images
    files = sorted([os.path.join(IMAGE_FOLDER, f) for f in os.listdir(IMAGE_FOLDER) if f.lower().endswith('.jpg')])
    if not files:
        print("No images found in " + IMAGE_FOLDER)
        return

    idx = 0
    running = True
    need_load = True
    last_switch = time.time()
    
    # Animation variables
    current_img_raw = None
    zoom_factor = 1.0
    alpha = 0
    txt_surf = None
    txt_shadow = None
    txt_str = ""

    # Input debouncing for navigation
    last_nav_time = 0

    try:
        while running:
            now = time.time()
            
            # --- 1. LOW LEVEL INPUT HANDLING (SMARTER EXIT) ---
            for f in input_files:
                try:
                    data = f.read(event_size)
                    if data:
                        # Unpack: sec, usec, type, code, value
                        _, _, ev_type, ev_code, ev_value = struct.unpack(event_format, data)
                        
                        # EV_KEY (Buttons/Keys) -> Exit if pressed (value=1)
                        if ev_type == EV_KEY and ev_value == 1:
                            running = False
                            break
                        
                        # EV_ABS (Joysticks/Hats)
                        if ev_type == EV_ABS:
                            # Vertical motion -> Exit
                            if ev_code in (ABS_Y, ABS_HAT0Y) and abs(ev_value) > 10:
                                running = False
                                break
                            # Horizontal motion -> Handled by SDL to avoid double trigger
                            # but we could also handle it here if SDL is too slow.
                            # For now, we don't exit on horizontal.
                except Exception:
                    pass
            
            # --- 2. SDL EVENT HANDLING (NAVIGATION) ---
            for event in pygame.event.get():
                if event.type in (pygame.QUIT, pygame.KEYDOWN):
                    running = False
                
                if now - last_nav_time > 0.4:
                    # Navigation via Joystick/D-Pad
                    if event.type == pygame.JOYAXISMOTION:
                        if event.axis == 0: # Horizontal
                            if event.value > 0.6: # Right
                                idx = (idx + 1) % len(files)
                                need_load = True
                                last_nav_time = now
                            elif event.value < -0.6: # Left
                                idx = (idx - 1) % len(files)
                                need_load = True
                                last_nav_time = now
                    elif event.type == pygame.JOYHATMOTION:
                        hx, hy = event.value
                        if hx == 1: # Right
                            idx = (idx + 1) % len(files)
                            need_load = True
                            last_nav_time = now
                        elif hx == -1: # Left
                            idx = (idx - 1) % len(files)
                            need_load = True
                            last_nav_time = now

            # --- 3. SLIDE LOGIC ---
            if not need_load and now - last_switch > DISPLAY_TIME:
                idx = (idx + 1) % len(files)
                need_load = True

            if need_load:
                try:
                    img = pygame.image.load(files[idx]).convert()
                    img_w, img_h = img.get_size()
                    ratio = min(float(sw)/img_w, float(sh)/img_h)
                    current_img_raw = pygame.transform.scale(img, (int(img_w*ratio), int(img_h*ratio)))
                    
                    txt_str = get_sidecar_text(files[idx])
                    if txt_str:
                        txt_surf = font.render(txt_str, True, (255, 255, 255))
                        txt_shadow = font.render(txt_str, True, (0, 0, 0))
                    
                    zoom_factor = 1.0
                    alpha = 0
                    need_load = False
                    last_switch = now
                except Exception as e:
                    print("Error loading image " + files[idx] + ": " + str(e))
                    idx = (idx + 1) % len(files)

            # --- 4. RENDERING ---
            if current_img_raw:
                screen.fill((0, 0, 0))
                
                if enable_animation:
                    zoom_factor += ZOOM_SPEED
                    z_w = int(current_img_raw.get_width() * zoom_factor)
                    z_h = int(current_img_raw.get_height() * zoom_factor)
                    img_to_draw = pygame.transform.scale(current_img_raw, (z_w, z_h))
                    pos_x = (sw - z_w) // 2
                    pos_y = (sh - z_h) // 2
                else:
                    img_to_draw = current_img_raw
                    pos_x = (sw - current_img_raw.get_width()) // 2
                    pos_y = (sh - current_img_raw.get_height()) // 2
                
                if alpha < 255:
                    alpha += FADE_SPEED
                img_to_draw.set_alpha(min(alpha, 255))
                
                screen.blit(img_to_draw, (pos_x, pos_y))
                
                if txt_str and txt_surf:
                    tx = sw - txt_surf.get_width() - 30
                    ty = sh - txt_surf.get_height() - 30
                    screen.blit(txt_shadow, (tx+2, ty+2))
                    screen.blit(txt_surf, (tx, ty))

                pygame.display.flip()
            
            time.sleep(0.04 if enable_animation else 0.1)

    finally:
        for f in input_files:
            f.close()
        pygame.quit()
        sys.exit()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-animation", action="store_true", help="Disable Ken Burns effect to save CPU")
    args = parser.parse_args()
    
    run_slideshow(enable_animation=not args.no_animation)
