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

Abre una terminal dedicada en la carpeta de la versión. Usa el puerto `3000` para el servicio normal o `3001` para ensayar una candidata. Quita las variables de clave heredadas de esa sesión porque Node les da prioridad sobre el archivo.

```powershell
Remove-Item Env:GEMINI_API_KEY,Env:API_KEY -ErrorAction SilentlyContinue
$envFile = Join-Path $env:LOCALAPPDATA 'LinguistVision\.env'
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
    throw "Falta el archivo de configuración: $envFile"
}
$env:HOST = '127.0.0.1'
$env:PORT = '3000' # cambia a '3001' para el ensayo
if (Get-NetTCPConnection -State Listen -LocalPort ([int]$env:PORT) -ErrorAction SilentlyContinue) {
    throw "El puerto $env:PORT ya está en uso."
}
node --env-file="$envFile" --import tsx server/index.ts --production
```

Después de que el servidor anuncie el arranque, abre otra ventana de PowerShell. Usa el mismo puerto que en la terminal del servidor.

```powershell
$checkPort = 3000 # usa 3001 si estás comprobando la candidata
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $checkPort -ErrorAction Stop)
if ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1') {
    throw "El puerto $checkPort debe escuchar solo en 127.0.0.1."
}
$baseUrl = "http://127.0.0.1:$checkPort"
$health = Invoke-RestMethod "$baseUrl/api/health" -TimeoutSec 10
if ($health.ok -ne $true -or $health.configured -ne $true) {
    throw 'El servidor no está listo o falta la clave de Gemini.'
}
```

Abre en el navegador la dirección que acabas de comprobar. `configured: true` indica que el servidor cargó una clave. Para comprobar que Gemini la acepta, usa un video corto de prueba en esa misma dirección, transcríbelo y descarga los subtítulos. Si falla el ensayo en `3001`, deja la versión anterior activa en `3000`.

## Cambiar de versión y volver atrás

1. Anota la carpeta y el commit de la versión que funciona. Prepara la candidata y compruébala en el puerto `3001`. Si una comprobación falla, deja la versión activa en `3000`.
2. Termina las transcripciones o exportaciones activas. Detén el ensayo con `Ctrl+C` en su terminal y después detén el servidor anterior en la suya. Espera a que ambas terminales devuelvan el control. Entra en la carpeta candidata, repite **Arrancar y comprobar** con el puerto `3000` y abre la página. Si aparece `EADDRINUSE`, identifica qué proceso usa el puerto antes de reintentar.
3. Si el arranque o la comprobación falla, detén la candidata, entra en la carpeta anterior y repite **Arrancar y comprobar** en `3000` con el mismo archivo `.env`. Abre nuevamente la página.
4. Conserva al menos la última versión que funcionó, incluidas sus dependencias y `dist/`, para poder revertir sin reinstalar.
