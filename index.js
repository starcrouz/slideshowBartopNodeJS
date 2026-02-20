const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');
const { globSync } = require('glob');
const exifParser = require('exif-parser');
const nearbyCities = require('nearby-cities');

// --- CONFIGURATION ---
const SOURCE_DIR = 'E:/Google Drive/_Perso/Medias/Photos';
const DEST_DIR = '\\\\RECALBOX\\share\\userscripts\\slideshow\\images';
const NB_IMAGES = 100;
const SCREEN_W = 1280;
const SCREEN_H = 1024;

const MONTHS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

const COUNTRY_NAMES = { 
    "US": "USA", "GB": "Royaume-Uni", "IT": "Italie", "ES": "Espagne", "DE": "Allemagne", "CH": "Suisse", "BE": "Belgique",
    "TZ": "Tanzanie", "BG": "Bulgarie", "MA": "Maroc", "AT": "Autriche", "NO": "Norvège", "TR": "Turquie", "GR": "Grèce",
    "PT": "Portugal", "IE": "Irlande", "NL": "Pays-Bas", "CA": "Canada", "HR": "Croatie", "TH": "Thaïlande", "VN": "Vietnam",
    "GP": "Guadeloupe", "MQ": "Martinique", "RE": "Réunion", "GF": "Guyane"
};

const CITY_OVERRIDES = {
    "Le Kremlin-Bicêtre": "Paris",
    "Gentilly": "Paris",
    "Ivry-sur-Seine": "Paris",
    "Sari-Solenzara": "Ste-Lucie de Porto-Vecchio"
};

const GENERIC_FOLDERS = ["carte", "dcim", "apple", "camera", "export"];

// --- FONCTIONS ---

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function capitalize(s) {
    if (typeof s !== 'string' || s.length === 0) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function cleanFolderName(name) {
    if (!name) return "";
    let cleaned = name.replace(/[()]/g, '');
    cleaned = cleaned.replace(/\b\d{1,4}[-\s./]\d{1,2}[-\s./]\d{1,4}\b/g, '');
    cleaned = cleaned.replace(/\b\d{4}\b/g, '');
    cleaned = cleaned.replace(/[_|-]/g, ' ').replace(/\s\s+/g, ' ').trim();
    const lower = cleaned.toLowerCase();
    const forbidden = /^(ann[eé]e|chargement appareil photo)$/i;
    if (forbidden.test(lower) || lower === "") return "";
    return cleaned;
}

function getBestFolderLabel(filePath) {
    let parentPath = path.dirname(filePath);
    let folderName = path.basename(parentPath);
    if (GENERIC_FOLDERS.some(word => folderName.toLowerCase().includes(word))) {
        folderName = path.basename(path.dirname(parentPath));
    }
    return cleanFolderName(folderName);
}

/**
 * Tente d'extraire une date (Mois Année) depuis le nom du dossier si l'EXIF a echoué
 */
function extractDateFromPath(filePath) {
    let parentPath = path.dirname(filePath);
    let folderName = path.basename(parentPath);
    // On remonte si dossier generique
    if (GENERIC_FOLDERS.some(word => folderName.toLowerCase().includes(word))) {
        folderName = path.basename(path.dirname(parentPath));
    }

    // 1. Cherche YYYY-MM-DD ou YYYY MM DD
    const fullDateMatch = folderName.match(/(\d{4})[-\s.](\d{2})[-\s.](\d{2})/);
    if (fullDateMatch) {
        const year = fullDateMatch[1];
        const monthIdx = parseInt(fullDateMatch[2], 10) - 1;
        if (monthIdx >= 0 && monthIdx < 12) return `${MONTHS_FR[monthIdx]} ${year}`;
    }

    // 2. Fallback cherche juste l'annee (4 chiffres)
    const yearMatch = folderName.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) return yearMatch[0];

    return "";
}

// --- LOGIQUE PRINCIPALE ---

async function start() {
    console.log("--- Lancement du tirage photo intelligent ---");

    if (!fs.existsSync(DEST_DIR)) {
        console.error(`Erreur : Destination inaccessible : ${DEST_DIR}`);
        return;
    }

    const pattern = SOURCE_DIR.replace(/\\/g, '/') + '/**/*.{jpg,JPG,jpeg,JPEG}';
    const allFiles = globSync(pattern);
    console.log(`Photos trouvées : ${allFiles.length}\n`);

    if (allFiles.length === 0) return;

    const selection = allFiles.sort(() => 0.5 - Math.random()).slice(0, NB_IMAGES);

    for (let i = 0; i < selection.length; i++) {
        const photoPath = selection[i];
        const id = (i + 1).toString().padStart(3, '0');
        
        let dateStr = "";
        let locationStr = "";
        let gpsStatus = "Aucun";

        try {
            const buffer = fs.readFileSync(photoPath);
            const parser = exifParser.create(buffer);
            const result = parser.parse();

            // 1. DATE EXIF
            if (result.tags.DateTimeOriginal) {
                const date = new Date(result.tags.DateTimeOriginal * 1000);
                dateStr = `${MONTHS_FR[date.getMonth()]} ${date.getFullYear()}`;
            }

            // 2. GPS
            if (result.tags.GPSLatitude && result.tags.GPSLongitude) {
                const lat = result.tags.GPSLatitude;
                const lon = result.tags.GPSLongitude;
                
                const rawCities = nearbyCities({ latitude: lat, longitude: lon });

                if (rawCities.length > 0) {
                    const candidates = rawCities.slice(0, 50).map(city => {
                        const dist = getDistance(lat, lon, city.lat, city.lon);
                        return { ...city, dist, score: city.population / ((dist * 3) + 1) };
                    });

                    candidates.sort((a, b) => b.score - a.score);

                    const best = candidates[0];
                    let cityName = best.name;
                    let countryCode = best.country;

                    if (CITY_OVERRIDES[cityName]) cityName = CITY_OVERRIDES[cityName];

                    if (countryCode === "FR") {
                        locationStr = cityName;
                    } else {
                        const fullCountry = COUNTRY_NAMES[countryCode] || countryCode;
                        locationStr = `${cityName} (${fullCountry})`;
                    }
                    
                    let duel = "";
                    if (candidates.length > 1) {
                        duel = ` [Match: ${best.name}(${Math.round(best.score)}) > ${candidates[1].name}(${Math.round(candidates[1].score)})]`;
                    }
                    gpsStatus = `Trouvé : ${cityName} (${best.dist.toFixed(1)}km)${duel}`;
                }
            }
        } catch (e) {
            gpsStatus = "Erreur lecture EXIF";
        }

        // --- RATTRAPAGE DATE SI EXIF VIDE ---
        if (!dateStr) {
            dateStr = extractDateFromPath(photoPath);
        }

        // --- FALLBACK LIEU SI GPS VIDE ---
        if (!locationStr || locationStr === "") {
            locationStr = getBestFolderLabel(photoPath);
        }

        // ASSEMBLAGE
        let finalLabel = "";
        if (locationStr && dateStr) finalLabel = `${capitalize(locationStr)} - ${dateStr}`;
        else if (locationStr) finalLabel = capitalize(locationStr);
        else if (dateStr) finalLabel = dateStr;

        console.log(`[${id}/${NB_IMAGES}]`);
        console.log(`  Source : ${photoPath}`);
        console.log(`  GPS    : ${gpsStatus}`);
        console.log(`  Label  : ${finalLabel}`);
        console.log(`  --------------------------------------------------`);

        try {
            const image = await Jimp.read(photoPath);
            image.scaleToFit({ w: SCREEN_W, h: SCREEN_H });
            await image.write(path.join(DEST_DIR, `${id}.jpg`));
            fs.writeFileSync(path.join(DEST_DIR, `${id}.txt`), finalLabel, 'utf8');
        } catch (e) {
            console.error(`  ! Erreur image : ${e.message}`);
        }
    }

    console.log("\n--- Terminé ! ---");
}

start();