# S'assurer que le script s'exécute dans le dossier du script
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Definition
$vbsPath = Join-Path $scriptPath "run_silent.vbs"

if (-not (Test-Path $vbsPath)) {
    Write-Error "Fichier run_silent.vbs introuvable dans $scriptPath."
    exit 1
}

# Nom de la tâche
$taskName = "BartopPhotoSelector"

# 1. Action : Lancer le script VBS via wscript.exe (ce qui évite d'ouvrir une fenêtre CMD)
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbsPath`""

# 2. Déclencheur : Toutes les heures à partir de maintenant, indéfiniment
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1)

# 3. Paramètres : Autoriser le lancement sur batterie, etc.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# 4. Enregistrement de la tâche pour l'utilisateur actuel
try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force -ErrorAction Stop
    Write-Host "La tâche planifiée '$taskName' a été créée avec succès !" -ForegroundColor Green
    Write-Host "Elle exécutera le script index.js toutes les heures en arrière-plan (sans fenêtre noire)." -ForegroundColor Cyan
} catch {
    Write-Error "Échec de la création de la tâche planifiée. Assurez-vous de lancer PowerShell en tant qu'Administrateur."
    Write-Host "Vous pouvez aussi créer la tâche manuellement dans le Planificateur de tâches Windows." -ForegroundColor Yellow
}
