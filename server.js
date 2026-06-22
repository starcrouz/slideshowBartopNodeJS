const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const convert = require('heic-convert');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let activeProcess = null;
let logBuffer = [];
let clients = [];

// API: Lire la configuration
app.get('/api/config', (req, res) => {
    try {
        const configData = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
        res.json(configData);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// API: Enregistrer la configuration
app.post('/api/config', (req, res) => {
    try {
        const newConfig = req.body;
        const configPath = path.join(__dirname, 'config.json');
        const currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        // Fusionner et forcer les types de données appropriés
        const merged = { ...currentConfig };
        for (const key in newConfig) {
            if (typeof currentConfig[key] === 'number') {
                merged[key] = Number(newConfig[key]);
            } else if (typeof currentConfig[key] === 'boolean') {
                merged[key] = newConfig[key] === true || newConfig[key] === 'true';
            } else {
                merged[key] = newConfig[key];
            }
        }

        fs.writeFileSync(configPath, JSON.stringify(merged, null, 4), 'utf8');
        res.json({ message: 'Configuration enregistrée avec succès' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// API: Obtenir l'historique du dernier tirage
app.get('/api/history', (req, res) => {
    const historyPath = path.join(__dirname, 'last_run.json');
    if (!fs.existsSync(historyPath)) {
        return res.status(404).json({ error: 'Aucun historique disponible' });
    }
    try {
        const historyData = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
        res.json(historyData);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// API: Lancer un tirage
app.post('/api/run', (req, res) => {
    if (activeProcess) {
        return res.status(400).json({ error: 'Un tirage est déjà en cours de traitement' });
    }

    logBuffer = [];
    activeProcess = spawn('node', ['index.js'], { cwd: __dirname });

    const handleData = (data) => {
        const text = data.toString();
        logBuffer.push(text);
        sendLogsToClients(text);
    };

    activeProcess.stdout.on('data', handleData);
    activeProcess.stderr.on('data', handleData);

    activeProcess.on('close', (code) => {
        const msg = `\n--- Terminé ! Code de sortie : ${code} ---\n`;
        logBuffer.push(msg);
        sendLogsToClients(msg);
        activeProcess = null;
    });

    res.json({ message: 'Tirage démarré' });
});

// API: Stream de logs temps réel (Server-Sent Events)
app.get('/api/run-logs', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Envoyer les logs déjà accumulés lors de la connexion
    res.write(`data: ${JSON.stringify({ logs: logBuffer.join('') })}\n\n`);

    const client = { res };
    clients.push(client);

    req.on('close', () => {
        clients = clients.filter(c => c !== client);
    });
});

function sendLogsToClients(text) {
    clients.forEach(c => {
        try {
            c.res.write(`data: ${JSON.stringify({ text })}\n\n`);
        } catch (e) {
            // Ignorer les erreurs d'envoi individuel
        }
    });
}

// API: Servir les photos (avec conversion HEIC à la volée pour le navigateur)
app.get('/api/photo', async (req, res) => {
    const photoPath = req.query.path;
    if (!photoPath) return res.status(400).send('Chemin manquant');
    if (!fs.existsSync(photoPath)) return res.status(404).send('Fichier introuvable');

    const isHeic = photoPath.toLowerCase().endsWith('.heic');
    if (isHeic) {
        try {
            const inputBuffer = fs.readFileSync(photoPath);
            const outputBuffer = await convert({
                buffer: inputBuffer,
                format: 'JPEG',
                quality: 0.6
            });
            res.contentType('image/jpeg');
            res.send(outputBuffer);
        } catch (e) {
            res.status(500).send('Erreur de conversion HEIC : ' + e.message);
        }
    } else {
        res.sendFile(photoPath);
    }
});

app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(` Serveur Dashboard Bartop démarré sur :`);
    console.log(` http://localhost:${PORT}`);
    console.log(`==================================================`);
});
