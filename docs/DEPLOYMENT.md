# Despliegue y actualización en Windows

LinguistVision se ejecuta desde PowerShell con Node.js 24 LTS y Git. El navegador abre la aplicación en `127.0.0.1` y el servidor local se comunica con Gemini. Usa una carpeta por versión para poder volver al último commit que funcionó.

## Primera instalación

Abre PowerShell y prepara la carpeta del repositorio y la de versiones:

```powershell
node --version
$deployRoot = Join-Path $env:LOCALAPPDATA 'LinguistVision'
$sourceRepo = Join-Path $deployRoot 'source'
$releases = Join-Path $deployRoot 'releases'
New-Item -ItemType Directory -Force -Path $releases | Out-Null
git clone https://github.com/Robcaze1980/video_transcript.git $sourceRepo
if ($LASTEXITCODE -ne 0) { throw 'No se pudo clonar el repositorio.' }
```

Si ya tienes una copia del repositorio, asigna su ruta a `$sourceRepo` y sigue con **Preparar una versión**. Si el repositorio es privado, usa una sesión de GitHub con acceso.

Guarda `GEMINI_API_KEY` en `%LOCALAPPDATA%\LinguistVision\.env`, dentro de tu perfil de Windows. Ábrelo con `notepad (Join-Path $deployRoot '.env')` y guarda una línea `GEMINI_API_KEY=<tu clave de Gemini>`, sustituyendo el texto entre ángulos. Usa ese mismo archivo al cambiar de versión. El secreto de GitHub Actions se configura por separado del archivo local.

## Preparar una versión

Ejecuta estos pasos tanto para la primera instalación como para cada actualización. Durante una actualización, deja el servidor anterior funcionando mientras preparas la versión nueva.

```powershell
git -C $sourceRepo fetch origin main
if ($LASTEXITCODE -ne 0) { throw 'No se pudo obtener origin/main.' }
$revision = git -C $sourceRepo rev-parse --verify origin/main
if ($LASTEXITCODE -ne 0) { throw 'No se pudo identificar el commit.' }
$release = Join-Path $releases $revision
Write-Host "Commit candidato: $revision"
```

Si el commit coincide con el de la versión activa, termina aquí. Consulta el commit activo con `git rev-parse HEAD` desde su carpeta. Si es distinto, continúa:

```powershell
if (-not (Test-Path -LiteralPath $release)) {
    git -C $sourceRepo worktree add --detach $release $revision
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la carpeta de la versión.' }
}
$releaseRevision = git -C $release rev-parse --verify HEAD
if ($LASTEXITCODE -ne 0 -or $releaseRevision -ne $revision) {
    throw 'La carpeta existente no corresponde al commit candidato.'
}

Set-Location -LiteralPath $release
npm ci --include=dev
if ($LASTEXITCODE -ne 0) { throw 'Falló la instalación.' }
npm run lint
if ($LASTEXITCODE -ne 0) { throw 'Falló la revisión de tipos.' }
npm test
if ($LASTEXITCODE -ne 0) { throw 'Fallaron las pruebas.' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación.' }
```

El servidor compilado se arranca con `tsx` y usa Vite para cargar configuración. Por eso `npm ci --include=dev` instala también las dependencias de desarrollo.

## Arrancar y comprobar

Desde la carpeta de la versión, en una terminal dedicada, quita las variables de clave heredadas de esa sesión. Node da prioridad a las variables de la sesión sobre las del archivo:

```powershell
Remove-Item Env:GEMINI_API_KEY,Env:API_KEY -ErrorAction SilentlyContinue
$env:HOST = '127.0.0.1'
$env:PORT = '3000'
node --env-file="$env:LOCALAPPDATA\LinguistVision\.env" --import tsx server/index.ts --production
```

Para ensayar una actualización en paralelo, usa `3001` en esa terminal. Abre en el navegador `http://127.0.0.1:3000` (o `3001` durante el ensayo). En otra ventana de PowerShell, consulta el mismo puerto:

```powershell
$checkPort = 3000
$health = Invoke-RestMethod "http://127.0.0.1:$checkPort/api/health" -TimeoutSec 10
if ($health.ok -ne $true -or $health.configured -ne $true) {
    throw 'El servidor no está listo o falta la clave de Gemini.'
}
```

`configured: true` indica que el servidor cargó una clave. Para comprobar que Gemini la acepta, usa un video corto de prueba, transcríbelo y descarga los subtítulos. Si falla esa prueba, revisa la clave, el modelo y el mensaje del servidor antes de cambiar de versión.

## Cambiar de versión y volver atrás

1. Anota la carpeta y el commit de la versión que funciona. Prepara la candidata y compruébala en el puerto `3001`. Si una comprobación falla, deja la versión activa en `3000`.
2. Termina las transcripciones o exportaciones activas. Detén el ensayo con `Ctrl+C` en su terminal y después detén el servidor anterior en la suya. Espera a que ambas terminales devuelvan el control. Abre la carpeta candidata y arráncala en `3000`. Verifica la página y `/api/health`. Si aparece `EADDRINUSE`, identifica el proceso que ya usa el puerto antes de reintentar.
3. Si el arranque o la comprobación falla, detén la candidata y vuelve a arrancar desde la carpeta anterior en `3000`, con el mismo archivo `.env`. Comprueba nuevamente la página y `/api/health`.
4. Conserva al menos la última versión que funcionó, incluidas sus dependencias y `dist/`, para poder revertir sin reinstalar.
