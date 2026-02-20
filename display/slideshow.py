#!/usr/bin/python
# -*- coding: utf-8 -*-

import pygame
import os
import time
import sys

# --- CONFIGURATION ---
IMAGE_FOLDER = "/recalbox/share/userscripts/slideshow/images" 
DISPLAY_TIME = 15 
ZOOM_SPEED = 0.00015  # Slightly slower for better stability
FADE_SPEED = 8        # Speed of the fade-in

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

def run_slideshow():
    # Recalbox / FBcon specific settings
    os.environ["SDL_VIDEODRIVER"] = "fbcon"
    os.environ["SDL_NOMOUSE"] = "1"
    
    pygame.init()
    pygame.joystick.init()
    
    # Initialize all joysticks
    joysticks = [pygame.joystick.Joystick(x) for x in range(pygame.joystick.get_count())]
    for j in joysticks:
        j.init()
    
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

    # Input debouncing
    last_input_time = 0

    while running:
        now = time.time()
        
        # --- EVENT HANDLING ---
        for event in pygame.event.get():
            # 1. EXIT conditions
            if event.type in (pygame.QUIT, pygame.KEYDOWN):
                running = False
            
            # Joystick Button to exit
            if event.type == pygame.JOYBUTTONDOWN:
                running = False

            # Joystick Axis / Hat motion
            if now - last_input_time > 0.3: # Debounce inputs
                # Axis (Left Stick or D-Pad on some controllers)
                if event.type == pygame.JOYAXISMOTION:
                    # Axis 1 is usually Y (Up/Down)
                    if event.axis == 1:
                        if event.value < -0.5 or event.value > 0.5: # Up or Down
                            running = False
                    # Axis 0 is usually X (Left/Right)
                    if event.axis == 0:
                        if event.value > 0.5: # Right (Next)
                            idx = (idx + 1) % len(files)
                            need_load = True
                            last_input_time = now
                        elif event.value < -0.5: # Left (Prev)
                            idx = (idx - 1) % len(files)
                            need_load = True
                            last_input_time = now

                # Hat (D-Pad)
                if event.type == pygame.JOYHATMOTION:
                    hx, hy = event.value
                    if hy != 0: # Up or Down
                        running = False
                    if hx == 1: # Right (Next)
                        idx = (idx + 1) % len(files)
                        need_load = True
                        last_input_time = now
                    elif hx == -1: # Left (Prev)
                        idx = (idx - 1) % len(files)
                        need_load = True
                        last_input_time = now

        # --- LOGIC ---
        if not need_load and now - last_switch > DISPLAY_TIME:
            idx = (idx + 1) % len(files)
            need_load = True

        if need_load:
            try:
                # Load and initial scale (Fit to screen)
                img = pygame.image.load(files[idx]).convert()
                img_w, img_h = img.get_size()
                ratio = min(float(sw)/img_w, float(sh)/img_h)
                # Keep a slightly smaller version to avoid scaling huge original files in loop
                current_img_raw = pygame.transform.scale(img, (int(img_w*ratio), int(img_h*ratio)))
                
                # Metadata text
                txt_str = get_sidecar_text(files[idx])
                if txt_str:
                    txt_surf = font.render(txt_str, True, (255, 255, 255))
                    txt_shadow = font.render(txt_str, True, (0, 0, 0))
                
                zoom_factor = 1.0
                alpha = 0
                need_load = False
                last_switch = now
            except Exception as e:
                print("Error loading image: " + str(e))
                idx = (idx + 1) % len(files)

        # --- RENDERING & ANIMATION ---
        if current_img_raw:
            screen.fill((0, 0, 0))
            
            # Ken Burns effect (Subtle Zoom)
            zoom_factor += ZOOM_SPEED
            z_w = int(current_img_raw.get_width() * zoom_factor)
            z_h = int(current_img_raw.get_height() * zoom_factor)
            
            # Scaling optimized for RPi3 (uses scale which is faster than smoothscale)
            img_zoomed = pygame.transform.scale(current_img_raw, (z_w, z_h))
            
            # Centering
            pos_x = (sw - z_w) // 2
            pos_y = (sh - z_h) // 2
            
            # Fade-in
            if alpha < 255:
                alpha += FADE_SPEED
            img_zoomed.set_alpha(min(alpha, 255))
            
            screen.blit(img_zoomed, (pos_x, pos_y))
            
            # Metadata overlay
            if txt_str and txt_surf:
                tx = sw - txt_surf.get_width() - 30
                ty = sh - txt_surf.get_height() - 30
                screen.blit(txt_shadow, (tx+2, ty+2))
                screen.blit(txt_surf, (tx, ty))

            pygame.display.flip()
        
        time.sleep(0.04) # Target ~25 FPS to save CPU and keep events responsive

    pygame.quit()
    sys.exit()

if __name__ == "__main__":
    run_slideshow()
