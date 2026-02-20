const fs = require('fs');
const path = require('path');
const exifParser = require('exif-parser');

const MONTHS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

function capitalize(s) {
    if (typeof s !== 'string' || s.length === 0) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function cleanFolderName(name) {
    if (!name) return "";
    let cleaned = name.replace(/[()]/g, '');
    // Remove dates like YYYY-MM-DD or DD.MM.YYYY
    cleaned = cleaned.replace(/\b\d{1,4}[-\s./]\d{1,2}[-\s./]\d{1,4}\b/g, '');
    // Remove standalone years
    cleaned = cleaned.replace(/\b\d{4}\b/g, '');
    // Clean separators and extra spaces
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

    // 1. Explicit YYYY-MM-DD or similar
    const fullDateMatch = folderName.match(/(\d{4})[-\s.](\d{2})[-\s.](\d{2})/);
    if (fullDateMatch) {
        const year = fullDateMatch[1];
        const monthIdx = parseInt(fullDateMatch[2], 10) - 1;
        if (monthIdx >= 0 && monthIdx < 12) return `${MONTHS_FR[monthIdx]} ${year}`;
    }

    // 2. Fallback to just the year
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

function getPhotoMetadata(photoPath, config) {
    let dateStr = "";
    let locationStr = "";
    let gpsStatus = "Aucun";
    let coords = null;

    try {
        const buffer = fs.readFileSync(photoPath);
        const parser = exifParser.create(buffer);
        const result = parser.parse();

        if (result.tags.DateTimeOriginal) {
            const date = new Date(result.tags.DateTimeOriginal * 1000);
            dateStr = `${MONTHS_FR[date.getMonth()]} ${date.getFullYear()}`;
        }

        if (result.tags.GPSLatitude && result.tags.GPSLongitude) {
            coords = {
                lat: result.tags.GPSLatitude,
                lon: result.tags.GPSLongitude
            };
        }
    } catch (e) {
        gpsStatus = "Erreur lecture EXIF";
    }

    // Fallbacks
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
