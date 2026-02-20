const fs = require('fs');
const path = require('path');
const exifr = require('exifr');

const MONTHS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

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

    if (cleaned === "" || /^(ann[eé]e|chargement appareil photo)$/i.test(cleaned)) {
        return "";
    }
    return cleaned;
}

function extractDateFromPath(filePath, config) {
    let parentPath = path.dirname(filePath);
    let folderName = path.basename(parentPath);

    if (config.GENERIC_FOLDERS.some(word => folderName.toLowerCase().includes(word))) {
        folderName = path.basename(path.dirname(parentPath));
    }

    const fullDateMatch = folderName.match(/(\d{4})[-\s.](\d{2})[-\s.](\d{2})/);
    if (fullDateMatch) {
        const year = fullDateMatch[1];
        const monthIdx = parseInt(fullDateMatch[2], 10) - 1;
        if (monthIdx >= 0 && monthIdx < 12) return `${MONTHS_FR[monthIdx]} ${year}`;
    }

    const yearMatch = folderName.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) return yearMatch[0];

    return "";
}

function getBestFolderLabel(filePath, config) {
    let parentPath = path.dirname(filePath);
    let folderName = path.basename(parentPath);

    if (config.GENERIC_FOLDERS.some(word => folderName.toLowerCase().includes(word))) {
        folderName = path.basename(path.dirname(parentPath));
    }

    return cleanFolderName(folderName);
}

async function getPhotoMetadata(photoPath, config) {
    let dateStr = "";
    let gpsStatus = "Aucun";
    let coords = null;

    try {
        // Robust parsing: enable GPS and XMP segments explicitly
        // We don't use 'pick' to avoid accidentally filtering out computed tags like latitude/longitude
        const result = await exifr.parse(photoPath, {
            gps: true,
            xmp: true,
            tiff: true,
            translateKeys: true,
            translateValues: true
        });

        if (result) {
            // 1. Extract Date
            if (result.DateTimeOriginal) {
                const date = new Date(result.DateTimeOriginal);
                if (!isNaN(date.getTime())) {
                    dateStr = `${MONTHS_FR[date.getMonth()]} ${date.getFullYear()}`;
                }
            }

            // 2. Extract GPS
            if (typeof result.latitude === 'number' && typeof result.longitude === 'number') {
                coords = {
                    lat: result.latitude,
                    lon: result.longitude
                };
            } else if (result.GPSLatitude && result.GPSLongitude) {
                // Fallback for some formats
                coords = {
                    lat: result.GPSLatitude,
                    lon: result.GPSLongitude
                };
            }
        }
    } catch (e) {
        gpsStatus = `Erreur EXIF: ${e.message}`;
    }

    if (!dateStr) {
        dateStr = extractDateFromPath(photoPath, config);
    }

    const folderLabel = getBestFolderLabel(photoPath, config);

    return {
        dateStr,
        coords,
        folderLabel,
        gpsStatus,
        capitalize
    };
}

module.exports = {
    getPhotoMetadata
};
