const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');
const { globSync } = require('glob');
const convert = require('heic-convert');
const { execSync } = require('child_process');
const net = require('net');

const config = require('./config.json');

// Augmenter la limite mémoire pour les grosses photos HEIC/iPhone 15
Jimp.maxMemoryUsageInMB = 1024;

const { getBestLocation } = require('./geo');
const { getPhotoMetadata, getBestFolderLabel, capitalize, extractDateFromPath } = require('./metadata');

async function loadImage(photoPath) {
    const isHeic = photoPath.toLowerCase().endsWith('.heic');
    let imageBuffer;
    if (isHeic) {
        const inputBuffer = fs.readFileSync(photoPath);
        imageBuffer = await convert({
            buffer: inputBuffer,
            format: 'JPEG',
            quality: 1
        });
    } else {
        imageBuffer = photoPath;
    }
    return await Jimp.read(imageBuffer);
}

function calculateSharpness(image) {
    try {
        // Redimensionne à 128x128 et convertit en niveaux de gris
        const gray = image.clone().resize({ w: 128, h: 128 }).greyscale();
        const { data, width, height } = gray.bitmap;
        const laps = [];
        
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = (y * width + x) * 4;
                const val = data[idx];
                const valLeft = data[((y) * width + (x - 1)) * 4];
                const valRight = data[((y) * width + (x + 1)) * 4];
                const valUp = data[((y - 1) * width + (x)) * 4];
                const valDown = data[((y + 1) * width + (x)) * 4];
                
                // Noyau Laplacien 3x3 simple
                const lap = valLeft + valRight + valUp + valDown - 4 * val;
                laps.push(lap);
            }
        }
        
        const mean = laps.reduce((a, b) => a + b, 0) / laps.length;
        const variance = laps.reduce((a, b) => a + (b - mean) ** 2, 0) / laps.length;
        return variance;
    } catch (e) {
        return 999; // Fallback en cas d'erreur
    }
}

function validateImageQuality(image, filePath) {
    if (!config.ENABLE_QUALITY_FILTERS) return { valid: true };

    const width = image.bitmap.width;
    const height = image.bitmap.height;

    // 1. Résolution minimale
    if (width < config.FILTER_MIN_WIDTH || height < config.FILTER_MIN_HEIGHT) {
        return { valid: false, reason: `Résolution insuffisante (${width}x${height} < ${config.FILTER_MIN_WIDTH}x${config.FILTER_MIN_HEIGHT})` };
    }

    // 2. Format portrait
    const isPortrait = height > width;
    if (isPortrait && !config.FILTER_ALLOW_PORTRAIT) {
        return { valid: false, reason: "Format portrait exclu par la configuration" };
    }

    // 3. Ratio d'aspect maximum (exclut les panoramas extrêmes)
    const ratio = width / height;
    const maxRatio = config.FILTER_MAX_ASPECT_RATIO;
    if (ratio > maxRatio || (1 / ratio) > maxRatio) {
        return { valid: false, reason: `Ratio d'aspect trop extrême (${ratio.toFixed(2)} > ${maxRatio})` };
    }

    // 4. Netteté (Variance de Laplacien)
    const sharpness = calculateSharpness(image);
    if (sharpness < config.FILTER_MIN_SHARPNESS) {
        return { valid: false, reason: `Image trop floue ou plate (Netteté: ${Math.round(sharpness)} < ${config.FILTER_MIN_SHARPNESS})` };
    }

    return { valid: true, sharpness };
}

function getHostFromPath(p) {
    if (!p) return null;
    // Gère les chemins UNC Windows comme \\RECALBOX\share\images ou //RECALBOX/share/images
    if (p.startsWith('\\\\')) {
        const parts = p.slice(2).split('\\');
        return parts[0];
    }
    if (p.startsWith('//')) {
        const parts = p.slice(2).split('/');
        return parts[0];
    }
    return null;
}

function isHostOnline(host, port = 445, timeout = 2000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let resolved = false;

        socket.setTimeout(timeout);

        socket.connect(port, host, () => {
            resolved = true;
            socket.destroy();
            resolve(true);
        });

        socket.on('error', () => {
            if (!resolved) {
                resolved = true;
                socket.destroy();
                resolve(false);
            }
        });

        socket.on('timeout', () => {
            if (!resolved) {
                resolved = true;
                socket.destroy();
                resolve(false);
            }
        });
    });
}

function getVideoDuration(filePath) {
    try {
        const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
        const output = execSync(cmd).toString().trim();
        const seconds = parseFloat(output);
        if (isNaN(seconds)) return "";

        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    } catch (e) {
        return "";
    }
}

async function processImage(photoPath, image, id, total, checkResult) {
    const meta = await getPhotoMetadata(photoPath, config);
    let locationStr = "";
    let gpsStatus = meta.gpsStatus;

    if (meta.coords) {
        const geo = getBestLocation(meta.coords.lat, meta.coords.lon, config);
        if (geo) {
            locationStr = geo.label;
            gpsStatus = geo.status;
        }
    }

    if (!locationStr) {
        locationStr = meta.folderLabel;
    }

    let finalLabel = "";
    if (locationStr && meta.dateStr) {
        finalLabel = `${capitalize(locationStr)} - ${meta.dateStr}`;
    } else if (locationStr) {
        finalLabel = capitalize(locationStr);
    } else if (meta.dateStr) {
        finalLabel = meta.dateStr;
    }

    const sharpnessInfo = checkResult && checkResult.sharpness ? ` [Netteté: ${Math.round(checkResult.sharpness)}]` : "";
    console.log(`[Photo ${id}/${total}]${sharpnessInfo}`);
    console.log(`  Source : ${photoPath}`);
    console.log(`  Label  : ${finalLabel}`);

    try {
        image.scaleToFit({ w: config.SCREEN_W, h: config.SCREEN_H });
        await image.write(path.join(config.DEST_DIR, `${id}.jpg`));

        const sidecarContent = [
            finalLabel,
            meta.fullDateStr || meta.dateStr,
            photoPath // On utilise le chemin absolu du PC pour le diagnostic
        ].join('\n');

        fs.writeFileSync(path.join(config.DEST_DIR, `${id}.txt`), sidecarContent, 'utf8');
        return finalLabel;
    } catch (e) {
        console.error(`  ! Erreur image : ${e.message}`);
        return null;
    }
}

async function processVideos(allVideoFiles) {
    console.log(`\n--- Tirage Vidéos (Limite ${config.VIDEO_LIMIT_MB} Mo) ---`);

    if (!fs.existsSync(config.VIDEO_DEST_DIR)) {
        fs.mkdirSync(config.VIDEO_DEST_DIR, { recursive: true });
    }

    const filteredFiles = allVideoFiles.filter(v => {
        const stats = fs.statSync(v);
        return stats.size >= 1 * 1024 * 1024;
    });

    const shuffled = filteredFiles.sort(() => 0.5 - Math.random());
    let currentSizeByte = 0;
    const limitByte = config.VIDEO_LIMIT_MB * 1024 * 1024;
    let count = 0;

    for (const vidPath of shuffled) {
        const stats = fs.statSync(vidPath);
        if (currentSizeByte + stats.size <= limitByte) {
            const id = (++count).toString().padStart(3, '0');
            const ext = path.extname(vidPath);
            const destName = `${id}${ext}`;
            const destPath = path.join(config.VIDEO_DEST_DIR, destName);

            // Nettoyage préalable uniquement pour cet index (évite les doublons d'extensions comme 001.mp4 et 001.mkv)
            try {
                const oldFiles = fs.readdirSync(config.VIDEO_DEST_DIR);
                for (const f of oldFiles) {
                    if (f.startsWith(id + '.')) {
                        fs.unlinkSync(path.join(config.VIDEO_DEST_DIR, f));
                    }
                }
            } catch (err) {
                // Ignorer les erreurs de nettoyage individuel
            }

            console.log(`[Video ${id}] ${path.basename(vidPath)} (${(stats.size / 1024 / 1024).toFixed(1)} Mo)`);
            fs.copyFileSync(vidPath, destPath);

            // Extraction Metadata Vidéo
            const label = getBestFolderLabel(vidPath, config);
            const date = extractDateFromPath(vidPath, config);
            const duration = getVideoDuration(vidPath);

            let finalLabel = "";
            if (label && date) finalLabel = `${capitalize(label)} - ${date}`;
            else if (label) finalLabel = capitalize(label);
            else if (date) finalLabel = date;

            const sidecarContent = [
                finalLabel || "Vidéo Perso",
                duration || "Durée inconnue",
                vidPath // Chemin PC original
            ].join('\n');

            fs.writeFileSync(path.join(config.VIDEO_DEST_DIR, `${id}.txt`), sidecarContent, 'utf8');
            currentSizeByte += stats.size;
        }
        if (currentSizeByte >= limitByte) break;
    }
    
    // Nettoyage des anciennes vidéos en trop
    try {
        const oldFiles = fs.readdirSync(config.VIDEO_DEST_DIR);
        for (const f of oldFiles) {
            const match = f.match(/^(\d+)\./);
            if (match) {
                const fileIndex = parseInt(match[1], 10);
                if (fileIndex > count) {
                    fs.unlinkSync(path.join(config.VIDEO_DEST_DIR, f));
                }
            }
        }
    } catch (err) {
        console.warn(`Attention : Impossible de nettoyer les fichiers vidéos superflus : ${err.message}`);
    }

    console.log(`Total Vidéos : ${count} (${(currentSizeByte / 1024 / 1024).toFixed(1)} Mo)`);
}

async function start() {
    console.log("--- Lancement du tirage intelligent ---");

    const host = getHostFromPath(config.DEST_DIR);
    if (host) {
        console.log(`Vérification de la connexion avec le Bartop (${host})...`);
        const online = await isHostOnline(host);
        if (!online) {
            console.log(`[INFO] Le Bartop (${host}) est éteint ou injoignable sur le réseau.`);
            console.log("Fin du script sans modification.");
            return;
        }
        console.log("Le Bartop est en ligne !");
    }

    if (!fs.existsSync(config.DEST_DIR)) {
        console.error(`Erreur : Destination Photos inaccessible : ${config.DEST_DIR}`);
        return;
    }

    const photoPattern = config.SOURCE_DIR.replace(/\\/g, '/') + '/**/*.{jpg,JPG,jpeg,JPEG,heic,HEIC}';
    const allPhotos = globSync(photoPattern);
    console.log(`Photos trouvées : ${allPhotos.length}`);

    if (allPhotos.length > 0) {
        const shuffled = allPhotos.sort(() => 0.5 - Math.random());
        let count = 0;
        const maxAttempts = Math.min(shuffled.length, config.NB_IMAGES * 5);
        
        const runReport = {
            timestamp: Date.now(),
            stats: {
                totalPhotos: allPhotos.length,
                selected: 0,
                rejected: 0
            },
            selected: [],
            rejected: []
        };

        const writeReport = () => {
            try {
                fs.writeFileSync(path.join(__dirname, 'last_run.json'), JSON.stringify(runReport, null, 2), 'utf8');
            } catch (err) {
                // Sourd aux erreurs d'écriture temporaire
            }
        };

        // Écriture initiale vide pour réinitialiser l'affichage
        writeReport();
        
        console.log(`\n--- Sélection de ${config.NB_IMAGES} photos de qualité ---`);
        if (config.ENABLE_QUALITY_FILTERS) {
            console.log(`Filtres actifs :`);
            console.log(`  - Résolution min : ${config.FILTER_MIN_WIDTH}x${config.FILTER_MIN_HEIGHT}`);
            console.log(`  - Autoriser portrait : ${config.FILTER_ALLOW_PORTRAIT}`);
            console.log(`  - Ratio max : ${config.FILTER_MAX_ASPECT_RATIO}`);
            console.log(`  - Netteté min : ${config.FILTER_MIN_SHARPNESS}`);
        }

        for (let i = 0; i < shuffled.length && count < config.NB_IMAGES; i++) {
            if (i >= maxAttempts) {
                console.log(`\n[Avertissement] Limite de tentatives atteinte (${maxAttempts}). Arrêt de la sélection.`);
                break;
            }

            const photoPath = shuffled[i];
            try {
                const image = await loadImage(photoPath);
                const check = validateImageQuality(image, photoPath);
                
                if (!check.valid) {
                    console.log(`  [Rejeté] ${path.basename(photoPath)} : ${check.reason}`);
                    runReport.rejected.push({
                        path: photoPath,
                        reason: check.reason,
                        sharpness: Math.round(check.sharpness || 0),
                        width: image.bitmap.width,
                        height: image.bitmap.height
                    });
                    runReport.stats.rejected++;
                    writeReport();
                    continue;
                }

                count++;
                const id = count.toString().padStart(3, '0');
                const label = await processImage(photoPath, image, id, config.NB_IMAGES, check);
                
                runReport.selected.push({
                    path: photoPath,
                    label: label || "Sans label",
                    sharpness: Math.round(check.sharpness),
                    width: image.bitmap.width,
                    height: image.bitmap.height
                });
                runReport.stats.selected++;
                writeReport();
            } catch (err) {
                console.log(`  [Rejeté] Erreur chargement ${path.basename(photoPath)} : ${err.message}`);
                runReport.rejected.push({
                    path: photoPath,
                    reason: `Erreur chargement : ${err.message}`,
                    sharpness: 0,
                    width: 0,
                    height: 0
                });
                runReport.stats.rejected++;
                writeReport();
            }
        }
        
        // Nettoyage des anciennes images en trop à la fin de la sélection (ex: 101.jpg à 120.jpg si le nombre a baissé)
        try {
            const oldFiles = fs.readdirSync(config.DEST_DIR);
            for (const f of oldFiles) {
                const match = f.match(/^(\d+)\.(jpg|txt)$/i);
                if (match) {
                    const fileIndex = parseInt(match[1], 10);
                    if (fileIndex > count) {
                        fs.unlinkSync(path.join(config.DEST_DIR, f));
                    }
                }
            }
        } catch (err) {
            console.warn(`Attention : Impossible de nettoyer les fichiers d'images superflus : ${err.message}`);
        }

        console.log(`\nTotal Photos sélectionnées : ${count}/${config.NB_IMAGES}`);

        // Écriture finale
        writeReport();
    }

    const videoPattern = config.SOURCE_DIR.replace(/\\/g, '/') + '/**/*.{mp4,MP4,mkv,MKV,avi,AVI,mov,MOV}';
    const allVideos = globSync(videoPattern);
    console.log(`Vidéos trouvées : ${allVideos.length}`);

    if (allVideos.length > 0) {
        await processVideos(allVideos);
    }

    console.log("\n--- Terminé ! ---");
}

if (require.main === module) {
    start();
}

module.exports = {
    start,
    loadImage,
    validateImageQuality,
    calculateSharpness
};