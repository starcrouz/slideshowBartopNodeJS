const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');
const { globSync } = require('glob');

const config = require('./config.json');
const { getBestLocation } = require('./geo');
const { getPhotoMetadata } = require('./metadata');

async function processImage(photoPath, id, total) {
    const meta = getPhotoMetadata(photoPath, config);
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
        const image = await Jimp.read(photoPath);
        image.scaleToFit({ w: config.SCREEN_W, h: config.SCREEN_H });
        await image.write(path.join(config.DEST_DIR, `${id}.jpg`));
        fs.writeFileSync(path.join(config.DEST_DIR, `${id}.txt`), finalLabel, 'utf8');
    } catch (e) {
        console.error(`  ! Erreur image : ${e.message}`);
    }
}

async function start() {
    console.log("--- Lancement du tirage photo intelligent (Mode Séquentiel) ---");

    if (!fs.existsSync(config.DEST_DIR)) {
        console.error(`Erreur : Destination inaccessible : ${config.DEST_DIR}`);
        return;
    }

    const pattern = config.SOURCE_DIR.replace(/\\/g, '/') + '/**/*.{jpg,JPG,jpeg,JPEG}';
    const allFiles = globSync(pattern);
    console.log(`Photos trouvées : ${allFiles.length}\n`);

    if (allFiles.length === 0) return;

    // Shuffle and pick
    const selection = allFiles.sort(() => 0.5 - Math.random()).slice(0, config.NB_IMAGES);

    // Sequential processing to keep CPU usage low
    for (let i = 0; i < selection.length; i++) {
        const id = (i + 1).toString().padStart(3, '0');
        await processImage(selection[i], id, selection.length);
    }

    console.log("\n--- Terminé ! ---");
}

start();