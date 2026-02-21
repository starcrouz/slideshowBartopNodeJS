const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');
const { globSync } = require('glob');
const convert = require('heic-convert');

const config = require('./config.json');
const { getBestLocation } = require('./geo');
const { getPhotoMetadata } = require('./metadata');

async function processImage(photoPath, id, total) {
    const isHeic = photoPath.toLowerCase().endsWith('.heic');

    // 1. Get Metadata (Async with exifr)
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
        finalLabel = `${meta.capitalize(locationStr)} - ${meta.dateStr}`;
    } else if (locationStr) {
        finalLabel = meta.capitalize(locationStr);
    } else if (meta.dateStr) {
        finalLabel = meta.dateStr;
    }

    console.log(`[${id}/${total}]`);
    console.log(`  Source : ${photoPath}`);
    console.log(`  GPS    : ${gpsStatus}`);
    console.log(`  Label  : ${finalLabel}`);
    console.log(`  --------------------------------------------------`);

    try {
        let imageBuffer;
        if (isHeic) {
            // Convert HEIC to JPEG buffer
            const inputBuffer = fs.readFileSync(photoPath);
            imageBuffer = await convert({
                buffer: inputBuffer,
                format: 'JPEG',
                quality: 1
            });
        } else {
            imageBuffer = photoPath;
        }

        const image = await Jimp.read(imageBuffer);
        image.scaleToFit({ w: config.SCREEN_W, h: config.SCREEN_H });
        await image.write(path.join(config.DEST_DIR, `${id}.jpg`));

        // Detailed Sidecar Text
        // Format: Label\nFull Date\nSource Path
        const sidecarContent = [
            finalLabel,
            meta.fullDateStr || meta.dateStr,
            meta.rawPath
        ].join('\n');

        fs.writeFileSync(path.join(config.DEST_DIR, `${id}.txt`), sidecarContent, 'utf8');
    } catch (e) {
        console.error(`  ! Erreur image : ${e.message}`);
    }
}

async function start() {
    console.log("--- Lancement du tirage photo intelligent ---");

    if (!fs.existsSync(config.DEST_DIR)) {
        console.error(`Erreur : Destination inaccessible : ${config.DEST_DIR}`);
        return;
    }

    // Extended pattern to include HEIC
    const pattern = config.SOURCE_DIR.replace(/\\/g, '/') + '/**/*.{jpg,JPG,jpeg,JPEG,heic,HEIC}';
    const allFiles = globSync(pattern);
    console.log(`Photos trouvées : ${allFiles.length}\n`);

    if (allFiles.length === 0) return;

    // Shuffle and pick
    const selection = allFiles.sort(() => 0.5 - Math.random()).slice(0, config.NB_IMAGES);

    // Sequential processing
    for (let i = 0; i < selection.length; i++) {
        const id = (i + 1).toString().padStart(3, '0');
        await processImage(selection[i], id, selection.length);
    }

    console.log("\n--- Terminé ! ---");
}

start();