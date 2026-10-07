# Handy Gesture Control

Extensión de GNOME Shell para mover una ventana completa entre dos o más monitores mediante seguimiento local de la mano. La cámara solo se enciende cuando el usuario activa el control desde el menú superior.

## Configuración personalizada incluida

- Linux con GNOME Shell 50 y sesión Wayland.
- Dos monitores: la zona izquierda/derecha de la cámara corresponde a los monitores ordenados de izquierda a derecha.
- Cámara habitual: `/dev/video0`.
- Captura a 640 × 480 y procesamiento limitado a 24 fotogramas por segundo.
- Se detecta una mano. Abrir la mano prepara el gesto; juntar pulgar e índice durante 0,45 s toma la ventana normal frontal del monitor señalado.
- La ventana sigue el movimiento horizontal y vertical de la mano. Al separar los dedos se suelta sin un salto final.
- La cámara, los fotogramas y la inferencia permanecen en el equipo. No se guardan ni se transmiten imágenes.
- Solo se mueve la ventana. No se inyectan teclas o clics, no se controla el cursor y no se requieren permisos `sudo`.

## Instalación

Requisitos: GNOME Shell 50, Python 3.12 o superior con `venv`, una webcam compatible con V4L2 y dos monitores. La primera instalación necesita Internet para descargar MediaPipe, OpenCV y el modelo oficial de detección de manos.

1. Clona este repositorio:

   ```bash
   git clone https://github.com/JuanFelipeLH/handy-gesture-control.git
   cd handy-gesture-control
   ```

2. Instala las dependencias y el modelo local:

   ```bash
   python3 setup.py
   ```

   Los paquetes y el modelo quedan en `$XDG_DATA_HOME/handy-gesture-control` (por defecto `~/.local/share/handy-gesture-control`). La configuración queda en `$XDG_CONFIG_HOME/handy-gesture-control/config.json` (por defecto `~/.config/handy-gesture-control/config.json`). El instalador no reemplaza una configuración que ya exista.

3. Instala la extensión para el usuario:

   ```bash
   extension_dir="$HOME/.local/share/gnome-shell/extensions/handy-gesture-control@local"
   mkdir -p "$extension_dir"
   install -m 644 metadata.json extension.js hands.js hand_worker.py "$extension_dir/"
   gnome-extensions enable handy-gesture-control@local
   ```

4. Cierra la sesión y vuelve a entrar para cargar la extensión. En Wayland, no se puede reiniciar GNOME Shell con `Alt+F2`, `r`.

5. Usa el menú superior **MANO · APAGADA → Activar / detener cámara**. La cámara permanece apagada hasta que elijas esa opción.

## Uso

1. Activa la cámara desde el menú superior. Espera a que el estado indique que la mano está lista.
2. Abre la mano y mantenla visible un instante para preparar el gesto.
3. Coloca la mano en la mitad izquierda o derecha de la imagen de la cámara para indicar el monitor de origen. El orden de monitores se determina de izquierda a derecha en el escritorio.
4. Junta pulgar e índice durante aproximadamente medio segundo. Se selecciona la ventana normal visible que está más al frente en ese monitor; no necesitas enfocarla con el ratón.
5. Mantén la pinza y mueve la mano. La ventana acompaña el movimiento en ambos ejes y puede cruzar a otro monitor.
6. Separa pulgar e índice para soltar la ventana en su posición actual. Abre la mano antes de repetir el gesto.

Las ventanas minimizadas, de pantalla completa o con diálogos modales no se arrastran. Una ventana maximizada recupera temporalmente su tamaño normal. Si se pierde la mano, cambia el espacio de trabajo, se abre la vista de actividades o la ventana deja de poder moverse, el arrastre se cancela y conserva su última posición.

## Elegir la cámara

Lista cámaras disponibles:

```bash
v4l2-ctl --list-devices
```

Si `v4l2-ctl` no está instalado en Ubuntu, instala `v4l-utils`. Prueba el dispositivo correcto y edita `camera` en `~/.config/handy-gesture-control/config.json`, por ejemplo:

```json
{
  "camera": "/dev/video2",
  "fps": 24,
  "pinchEnter": 0.45,
  "pinchRelease": 0.72,
  "openThreshold": 0.85,
  "armSeconds": 0.45,
  "openSeconds": 0.35
}
```

Desactiva y vuelve a activar la cámara para que se aplique el cambio. Si aparece “No se pudo abrir /dev/video…”, verifica el dispositivo y que tu usuario tenga acceso al grupo `video`; no ejecutes la extensión como administrador.

## Alineación y calibración

- Coloca la cámara centrada entre los monitores, a la altura de la mano y con ambas manos/zonas visibles. Evita contraluz fuerte y una cámara inclinada.
- La imagen se refleja para que mover la mano físicamente a la derecha mueva la ventana a la derecha.
- La zona horizontal de la cámara se divide en franjas del mismo ancho según el número de monitores. Para dos pantallas, izquierda selecciona la pantalla izquierda y derecha la derecha. Esta selección depende del orden físico de los monitores en la configuración de GNOME.
- Haz la primera prueba con una ventana pequeña y no maximizada. Si el monitor objetivo no coincide, verifica en **Configuración → Pantallas** que los monitores estén ordenados igual que en el escritorio.
- Si el agarre se activa con facilidad, baja `pinchEnter` (por ejemplo, `0.40`) o sube `armSeconds` (por ejemplo, `0.60`). Si cuesta soltar, sube `pinchRelease` ligeramente. Mantén `pinchEnter < pinchRelease < openThreshold`.
- Si hay saltos por poca luz u oclusión, mejora la iluminación y coloca la mano más cerca de la cámara antes de bajar umbrales.
- `fps` limita el procesamiento, no la velocidad física de la cámara. Usa un valor entre 10 y 30; 24 es el ajuste inicial recomendado.

## Diagnóstico

- Comprueba la sesión con `echo "$XDG_SESSION_TYPE"`; se recomienda `wayland`.
- Comprueba los monitores con `gnome-randr query` o **Configuración → Pantallas**.
- Comprueba la cámara con `ls -l /dev/video*` y `v4l2-ctl --list-devices`.
- Mira los mensajes de la extensión con `journalctl --user -f /usr/bin/gnome-shell` mientras activas el seguimiento.
- Desactiva la cámara desde el menú antes de cerrar sesión o usar otra aplicación que necesite la webcam.

## Archivos y privacidad

- `extension.js`, `hands.js`: interfaz del menú superior, selección y movimiento de la ventana mediante GNOME Shell/Mutter.
- `hand_worker.py`: cámara e inferencia local de puntos de la mano con MediaPipe.
- `setup.py`: instala las dependencias en un entorno aislado del usuario, descarga el modelo y verifica su SHA-256.
- `config.example.json`: ejemplo editable de los parámetros personales.
- `AI_CONTEXT.md`: contexto y reglas para asistentes de programación que mantengan este proyecto.

No subas el modelo descargado, el entorno virtual, fotogramas, capturas de cámara, logs locales ni tu `config.json` si contiene rutas que quieras mantener privadas. El modelo se descarga durante la instalación.

## Licencias y atribución

Este proyecto usa la API de MediaPipe y el modelo Hand Landmarker de Google; consulta la licencia y avisos originales de [MediaPipe](https://github.com/google-ai-edge/mediapipe). OpenCV se instala como dependencia y mantiene sus avisos de terceros ([licencias del paquete](https://pypi.org/project/opencv-contrib-python/)). Este repositorio no redistribuye el modelo ni las dependencias binarias.
